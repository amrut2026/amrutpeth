import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Was previously reachable (and unscoped — every voucher, every dealer)
// by any logged-in role, since /vouchers in App.jsx is only
// login-protected, not role-protected. Only DEALER, RETAILER (each
// scoped to their own), and ADMIN (oversight) have a legitimate reason to
// see this — same gap and same fix as GET /payments.
router.get('/', authRequired, requireRole('DEALER', 'RETAILER', 'ADMIN'), async (req, res) => {
  let where = {};
  // dealerId is set on both RECEIVABLE and PAYABLE vouchers, so this one
  // filter already covers a dealer's outgoing (retailer) and incoming
  // (supplier) vouchers alike. RETAILER only ever appears on the
  // RECEIVABLE side, so retailerId is enough to scope them. Filtering by
  // type here too (not just retailerId) is belt-and-braces: a retailer
  // must never be able to see a dealer's PAYABLE (supplier) vouchers.
  if (req.user.role === 'DEALER') where = { dealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { retailerId: req.user.retailerId, type: 'RECEIVABLE' };
  const vouchers = await prisma.voucher.findMany({
    where,
    include: { receipts: true, payments: true, retailer: true, supplier: true },
    orderBy: { date: 'desc' }
  });
  res.json(vouchers);
});

// GET /api/vouchers/outstanding?supplierId=123 — DEALER only. This
// dealer's own OPEN/PARTIALLY_PAID PAYABLE vouchers against the given
// supplier, oldest first (date asc) — the FIFO order used when a
// sold-products settlement is adjusted against outstanding vouchers (see
// soldProducts.js POST /pay `adjustVouchers`, and adjustVouchersFifo
// below). Each voucher's own already-paid total (from its own linked
// Payment rows) is subtracted here so the frontend can show — and later
// confirm against — the true outstanding balance without re-deriving it
// itself.
router.get('/outstanding', authRequired, requireRole('DEALER'), async (req, res) => {
  const supplierId = Number(req.query.supplierId);
  if (!supplierId) return res.status(400).json({ error: 'supplierId is required' });

  const vouchers = await prisma.voucher.findMany({
    where: {
      dealerId: req.user.dealerId,
      supplierId,
      type: 'PAYABLE',
      status: { in: ['OPEN', 'PARTIALLY_PAID'] },
    },
    include: { payments: true },
    orderBy: { date: 'asc' },
  });

  const outstanding = vouchers.map((v) => {
    const paid = v.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      id: v.id,
      date: v.date,
      status: v.status,
      amount: Number(v.amount),
      outstanding: Number(v.amount) - paid,
    };
  });

  res.json({
    vouchers: outstanding,
    totalOutstanding: outstanding.reduce((sum, v) => sum + v.outstanding, 0),
  });
});

// Manually generate a voucher (dealer -> retailer receivable), e.g. for goods sent without a POS sale
router.post('/', authRequired, requireRole('DEALER'), async (req, res) => {
  const { retailerId, amount, description } = req.body;
  const voucher = await prisma.voucher.create({
    data: { dealerId: req.user.dealerId, retailerId: Number(retailerId), amount, description }
  });
  res.json(voucher);
});

// Record a payment the DEALER has made against one of their own PAYABLE
// (supplier) vouchers — the payable-side counterpart to a RETAILER's Receipt
// against a RECEIVABLE voucher. Covers both the auto-generated vouchers from
// a confirmed purchase (see purchases.js) and any future manually-created
// PAYABLE voucher. Moves the voucher from OPEN to PARTIALLY_PAID or PAID
// depending on how much has been paid in total once this payment is added;
// never lets it be paid twice or overpaid.
router.post('/:id/payments', authRequired, requireRole('DEALER'), async (req, res) => {
  const voucherId = Number(req.params.id);
  const { amount, mode, reference } = req.body;

  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  if (!mode) return res.status(400).json({ error: 'Payment mode is required' });

  const voucher = await prisma.voucher.findUnique({ where: { id: voucherId }, include: { payments: true } });
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (voucher.dealerId !== req.user.dealerId) return res.status(403).json({ error: 'Forbidden' });
  if (voucher.type !== 'PAYABLE') return res.status(400).json({ error: 'Payments can only be recorded against supplier vouchers' });
  if (voucher.status === 'PAID') return res.status(400).json({ error: 'This voucher is already fully paid' });

  const alreadyPaid = voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const remaining = Number(voucher.amount) - alreadyPaid;
  if (Number(amount) > remaining) {
    return res.status(400).json({ error: `Amount exceeds the remaining balance of ${remaining.toFixed(2)}` });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        dealerId: voucher.dealerId,
        supplierId: voucher.supplierId,
        voucherId: voucher.id,
        amount: Number(amount),
        mode,
        reference: reference || null,
      }
    });

    const newTotalPaid = alreadyPaid + Number(amount);
    const newStatus = newTotalPaid >= Number(voucher.amount) ? 'PAID' : 'PARTIALLY_PAID';

    return tx.voucher.update({
      where: { id: voucher.id },
      data: { status: newStatus },
      include: { payments: true, supplier: true, retailer: true }
    });
  });

  res.json(updated);
});

// Applies `amount` of a dealer's payment against their own oldest
// OPEN/PARTIALLY_PAID PAYABLE vouchers for one supplier, FIFO by date —
// used when a sold-products settlement (soldProducts.js POST /pay) is
// also adjusted against outstanding vouchers, at the payer's explicit
// confirmation of the pop-up shown on GET /outstanding above (see
// SoldProducts.jsx). Must be called with a transaction client (`tx`) so it
// runs atomically alongside the sold-products Payment/status update it's
// paired with.
//
// Walks vouchers oldest-first: each voucher absorbs as much of the
// remaining amount as it still owes (voucher.amount minus what it's
// already had paid against it) — left PARTIALLY_PAID if that only covers
// part of it, moved to PAID if it covers it in full, in which case the
// leftover carries on to the next oldest voucher. Stops once the amount
// runs out or there are no more open vouchers for this supplier — any
// amount left over at that point (rare: it means the outstanding total
// changed between the GET /outstanding check and this call) is simply not
// applied to any voucher.
//
// Records one Payment per voucher touched, same shape as POST
// /:id/payments above, and appends a dated note to that voucher's own
// description so it's clear on the voucher itself that (and how much of)
// it was settled via a sold-products payment rather than a direct
// voucher payment.
export async function adjustVouchersFifo(tx, { dealerId, supplierId, amount, mode, reference, sourceDescription }) {
  let remaining = Number(amount);
  if (!(remaining > 0)) return { touched: [], remainingUnapplied: remaining };

  const vouchers = await tx.voucher.findMany({
    where: { dealerId, supplierId, type: 'PAYABLE', status: { in: ['OPEN', 'PARTIALLY_PAID'] } },
    include: { payments: true },
    orderBy: { date: 'asc' },
  });

  const touched = [];
  for (const voucher of vouchers) {
    if (remaining <= 0) break;
    const alreadyPaid = voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const voucherRemaining = Number(voucher.amount) - alreadyPaid;
    if (voucherRemaining <= 0) continue; // stale OPEN/PARTIALLY_PAID row - shouldn't normally happen

    const applied = Math.min(remaining, voucherRemaining);
    const newStatus = applied >= voucherRemaining ? 'PAID' : 'PARTIALLY_PAID';
    const note = `Adjusted ₹${applied.toFixed(2)} against ${sourceDescription || 'a sold-products payment'} on ${new Date().toLocaleDateString()}.`;

    await tx.payment.create({
      data: { dealerId, supplierId, voucherId: voucher.id, amount: applied, mode, reference: reference || null },
    });

    await tx.voucher.update({
      where: { id: voucher.id },
      data: {
        status: newStatus,
        description: voucher.description ? `${voucher.description}\n${note}` : note,
      },
    });

    touched.push({ voucherId: voucher.id, applied, newStatus });
    remaining -= applied;
  }

  return { touched, remainingUnapplied: remaining };
}

export default router;