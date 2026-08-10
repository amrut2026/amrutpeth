import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// List dealers - ADMIN sees all, DEALER sees self
router.get('/', authRequired, async (req, res) => {
  const where = req.user.role === 'DEALER' ? { id: req.user.dealerId } : {};
  const dealers = await prisma.dealer.findMany({ where, include: { bankAccounts: true } });
  res.json(dealers);
});

router.get('/:id', authRequired, async (req, res) => {
  const dealer = await prisma.dealer.findUnique({
    where: { id: Number(req.params.id) },
    include: { bankAccounts: true, retailers: true }
  });
  res.json(dealer);
});

// Create dealer (ADMIN only, i.e. manufacturer/platform owner onboarding a dealer)
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, bankAccounts } = req.body;
  const dealer = await prisma.dealer.create({
    data: {
      name, address, contactNumber, gstNumber,
      bankAccounts: { create: (bankAccounts || []).map(b => ({
        accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
      })) }
    },
    include: { bankAccounts: true }
  });
  res.json(dealer);
});

router.put('/:id', authRequired, requireRole('ADMIN', 'DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role === 'DEALER' && req.user.dealerId !== id) return res.status(403).json({ error: 'Forbidden' });
  const { name, address, contactNumber, gstNumber } = req.body;
  const dealer = await prisma.dealer.update({ where: { id }, data: { name, address, contactNumber, gstNumber } });
  res.json(dealer);
});

router.post('/:id/bank-accounts', authRequired, requireRole('ADMIN', 'DEALER'), async (req, res) => {
  const dealerId = Number(req.params.id);
  const { accountNumber, ifsc, bankName } = req.body;
  const acc = await prisma.dealerBankAccount.create({ data: { dealerId, accountNumber, ifsc, bankName } });
  res.json(acc);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.dealer.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
