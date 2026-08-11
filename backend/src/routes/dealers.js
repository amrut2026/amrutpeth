import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// List dealers - ADMIN sees all, DEALER sees self
router.get('/', authRequired, async (req, res) => {
  const where = req.user.role === 'DEALER' ? { id: req.user.dealerId } : {};
  const dealers = await prisma.dealer.findMany({
    where,
    include: { bankAccounts: true, users: { select: { id: true, username: true } } }
  });
  res.json(dealers);
});

router.get('/:id', authRequired, async (req, res) => {
  const dealer = await prisma.dealer.findUnique({
    where: { id: Number(req.params.id) },
    include: { bankAccounts: true, retailers: true, users: { select: { id: true, username: true } } }
  });
  res.json(dealer);
});

// Create dealer (ADMIN only, i.e. manufacturer/platform owner onboarding a dealer)
// Optionally pass username + password to create that dealer's login in the same step.
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, bankAccounts, username, password } = req.body;

  if (username && !password) {
    return res.status(400).json({ error: 'Password is required to create a login' });
  }
  if (password && !username) {
    return res.status(400).json({ error: 'Username is required to create a login' });
  }

  try {
    const dealer = await prisma.$transaction(async (tx) => {
      const created = await tx.dealer.create({
        data: {
          name, address, contactNumber, gstNumber,
          bankAccounts: { create: (bankAccounts || []).map(b => ({
            accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
          })) }
        },
        include: { bankAccounts: true }
      });

      if (username) {
        const hash = await bcrypt.hash(password, 10);
        await tx.user.create({
          data: { username, password: hash, role: 'DEALER', dealerId: created.id }
        });
      }

      return created;
    });

    res.json(dealer);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    throw err;
  }
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

// Create a login for an existing dealer (no login yet), or reset an existing one's password.
router.post('/:id/credentials', authRequired, requireRole('ADMIN'), async (req, res) => {
  const dealerId = Number(req.params.id);
  const { username, password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const existing = await prisma.user.findFirst({ where: { dealerId } });
  const hash = await bcrypt.hash(password, 10);

  try {
    if (existing) {
      const user = await prisma.user.update({
        where: { id: existing.id },
        data: { password: hash, ...(username ? { username } : {}) }
      });
      return res.json({ id: user.id, username: user.username, role: user.role });
    }
    if (!username) return res.status(400).json({ error: 'Username is required to create a login' });
    const user = await prisma.user.create({
      data: { username, password: hash, role: 'DEALER', dealerId }
    });
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
    throw err;
  }
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.dealer.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
