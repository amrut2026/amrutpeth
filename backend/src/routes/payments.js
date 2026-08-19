import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Was previously reachable (and unscoped — full ledger) by any logged-in
// role, since /payments in App.jsx is only login-protected, not
// role-protected — same pattern this app narrows elsewhere once a route's
// real audience is clear (see dealers.js/suppliers.js).
//
// DEALER sees only their own payments, in both directions: what they paid
// a supplier (POST /vouchers/:id/payments), and what a retailer paid them
// (receipts.js POST /, which now creates a Payment for that direction too,
// not just a bare Receipt). RETAILER sees only their own outgoing
// payments. ADMIN sees everything (oversight, same as ADMIN's other
// unscoped read routes).
router.get('/', authRequired, requireRole('DEALER', 'RETAILER', 'ADMIN'), async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { dealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { retailerId: req.user.retailerId };
  const payments = await prisma.payment.findMany({ where, include: { dealer: true, supplier: true, retailer: true, voucher: true }, orderBy: { date: 'desc' } });
  res.json(payments);
});

// Generic dealer -> manufacturer payment, not tied to any specific PAYABLE
// voucher. Kept for backward compatibility / edge cases, but the Payments
// screen no longer uses this route for a dealer's normal flow — paying
// against a specific supplier voucher goes through
// POST /vouchers/:id/payments instead (see vouchers.js), which also moves
// that voucher OPEN -> PARTIALLY_PAID -> PAID as it's settled.
router.post('/', authRequired, requireRole('DEALER', 'ADMIN'), async (req, res) => {
  const dealerId = req.user.role === 'DEALER' ? req.user.dealerId : Number(req.body.dealerId);
  const { amount, mode, reference } = req.body;
  const payment = await prisma.payment.create({ data: { dealerId, amount, mode, reference } });
  res.json(payment);
});

export default router;
