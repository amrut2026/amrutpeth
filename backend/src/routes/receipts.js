import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'RETAILER') where = { retailerId: req.user.retailerId };
  if (req.user.role === 'DEALER') where = { voucher: { dealerId: req.user.dealerId } };
  const receipts = await prisma.receipt.findMany({ where, include: { voucher: true }, orderBy: { date: 'desc' } });
  res.json(receipts);
});

// Record a receipt against a voucher, and auto-update voucher status
router.post('/', authRequired, async (req, res) => {
  const { voucherId, amount, mode } = req.body;
  const voucher = await prisma.voucher.findUnique({ where: { id: Number(voucherId) }, include: { receipts: true } });
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });

  const receipt = await prisma.receipt.create({
    data: { voucherId: Number(voucherId), retailerId: voucher.retailerId, amount, mode }
  });

  const totalReceived = voucher.receipts.reduce((s, r) => s + Number(r.amount), 0) + Number(amount);
  const status = totalReceived >= Number(voucher.amount) ? 'PAID' : (totalReceived > 0 ? 'PARTIALLY_PAID' : 'OPEN');
  await prisma.voucher.update({ where: { id: voucher.id }, data: { status } });

  res.json(receipt);
});

export default router;
