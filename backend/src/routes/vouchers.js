import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { dealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { retailerId: req.user.retailerId };
  const vouchers = await prisma.voucher.findMany({ where, include: { receipts: true, retailer: true }, orderBy: { date: 'desc' } });
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

export default router;
