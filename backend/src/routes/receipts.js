import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Was previously reachable (and unscoped — every receipt, every dealer)
// by any logged-in role, since /receipts in App.jsx is only
// login-protected, not role-protected — same gap as GET /payments and
// GET /vouchers, same fix: only RETAILER (own receipts), DEALER (receipts
// against their own vouchers), and ADMIN (oversight) have a legitimate
// reason to see this.
router.get('/', authRequired, requireRole('RETAILER', 'DEALER', 'ADMIN'), async (req, res) => {
  let where = {};
  if (req.user.role === 'RETAILER') where = { retailerId: req.user.retailerId };
  if (req.user.role === 'DEALER') where = { voucher: { dealerId: req.user.dealerId } };
  const receipts = await prisma.receipt.findMany({ where, include: { voucher: true, payment: true }, orderBy: { date: 'desc' } });
  res.json(receipts);
});

// Record a receipt against a voucher — RETAILER only, and only against
// their own voucher.
//
// A retailer's payment is a real financial transaction, exactly like a
// dealer paying a supplier — so it's recorded in the Payment table just
// like that side is (see vouchers.js POST /:id/payments), not left as a
// bare Receipt row with no backing ledger entry. The Receipt here is the
// confirmation-workflow wrapper around that Payment, created in the same
// transaction, linked via Receipt.paymentId — it does NOT touch the
// voucher's status: it's just the retailer's claim that they paid, sitting
// as TO_BE_CONFIRMED until the dealer confirms the money actually arrived
// (see PATCH /:id/confirm below). The voucher stays exactly as it was —
// still OPEN on a first payment, still PARTIALLY_PAID if an earlier
// payment was already confirmed — until that confirmation happens.
//
// Hard cap: the amount can never exceed what's actually still owed on the
// voucher. That's checked against every receipt already against it —
// confirmed ones AND any other still-pending (TO_BE_CONFIRMED) ones — not
// just confirmed ones, so a retailer can't stack multiple pending claims
// that would together overpay it before the dealer gets a chance to
// confirm any of them. Mirrors the same cap already enforced on the
// dealer -> supplier side.
router.post('/', authRequired, requireRole('RETAILER'), async (req, res) => {
  const { voucherId, amount, mode } = req.body;

  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  if (!mode) return res.status(400).json({ error: 'Payment mode is required' });

  const voucher = await prisma.voucher.findUnique({ where: { id: Number(voucherId) }, include: { receipts: true } });
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (voucher.retailerId !== req.user.retailerId) {
    return res.status(403).json({ error: 'You can only pay against your own vouchers' });
  }
  if (voucher.status === 'PAID') return res.status(400).json({ error: 'This voucher is already fully paid' });

  const alreadyAccountedFor = voucher.receipts.reduce((sum, r) => sum + Number(r.amount), 0);
  const remaining = Number(voucher.amount) - alreadyAccountedFor;
  if (Number(amount) > remaining) {
    return res.status(400).json({ error: `Amount exceeds the remaining balance of ${remaining.toFixed(2)}` });
  }

  const receipt = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        dealerId: voucher.dealerId,
        retailerId: voucher.retailerId,
        voucherId: voucher.id,
        amount: Number(amount),
        mode,
      }
    });

    return tx.receipt.create({
      data: {
        voucherId: voucher.id,
        retailerId: voucher.retailerId,
        paymentId: payment.id,
        amount: Number(amount),
        mode,
        status: 'TO_BE_CONFIRMED',
      },
      include: { payment: true, voucher: true }
    });
  });

  res.json(receipt);
});

// Dealer confirms a retailer's pending receipt actually arrived — DEALER
// only, and only for a receipt against one of their own vouchers. This is
// still the only step that actually reduces the retailer's outstanding
// balance: the Payment row already exists the instant the retailer submits
// it above (it's a real transaction from that moment), but the voucher
// itself only reflects it once the dealer confirms. Totals up every
// already-CONFIRMED receipt against the voucher (a still-pending
// TO_BE_CONFIRMED receipt from some other submission doesn't count yet)
// plus this one, and marks both this receipt and the voucher PAID or
// PARTIALLY_PAID depending on whether that total now covers the voucher
// in full.
router.patch('/:id/confirm', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { voucher: { include: { receipts: true } } }
  });
  if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
  if (receipt.voucher.dealerId !== req.user.dealerId) return res.status(403).json({ error: 'Forbidden' });
  if (receipt.status !== 'TO_BE_CONFIRMED') return res.status(400).json({ error: 'This receipt has already been confirmed' });

  const confirmedElsewhere = receipt.voucher.receipts
    .filter((r) => r.id !== receipt.id && r.status !== 'TO_BE_CONFIRMED')
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const totalConfirmed = confirmedElsewhere + Number(receipt.amount);
  const status = totalConfirmed >= Number(receipt.voucher.amount) ? 'PAID' : 'PARTIALLY_PAID';

  const [updatedReceipt] = await prisma.$transaction([
    prisma.receipt.update({ where: { id }, data: { status, confirmedAt: new Date() } }),
    prisma.voucher.update({ where: { id: receipt.voucherId }, data: { status } })
  ]);

  res.json(updatedReceipt);
});

export default router;
