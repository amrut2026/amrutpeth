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

export default router;