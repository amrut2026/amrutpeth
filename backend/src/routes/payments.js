import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const where = req.user.role === 'DEALER' ? { dealerId: req.user.dealerId } : {};
  const payments = await prisma.payment.findMany({ where, include: { dealer: true }, orderBy: { date: 'desc' } });
  res.json(payments);
});

// Dealer releases payment to manufacturer (ADMIN)
router.post('/', authRequired, requireRole('DEALER', 'ADMIN'), async (req, res) => {
  const dealerId = req.user.role === 'DEALER' ? req.user.dealerId : Number(req.body.dealerId);
  const { amount, mode, reference } = req.body;
  const payment = await prisma.payment.create({ data: { dealerId, amount, mode, reference } });
  res.json(payment);
});

export default router;
