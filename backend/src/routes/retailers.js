import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// List retailers - ADMIN sees all (grouped under their respective dealer),
// DEALER sees own retailers, RETAILER sees self
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { primaryDealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { id: req.user.retailerId };
  const retailers = await prisma.retailer.findMany({
    where,
    include: { bankAccounts: true, users: { select: { id: true, username: true } }, dealer: true }
  });
  res.json(retailers);
});

router.get('/:id', authRequired, async (req, res) => {
  const retailer = await prisma.retailer.findUnique({
    where: { id: Number(req.params.id) },
    include: { bankAccounts: true, users: { select: { id: true, username: true } }, dealer: true }
  });
  res.json(retailer);
});

// Create retailer - DEALER only. Admin no longer creates retailers directly;
// it's the dealer onboarding their own retailer, so primaryDealerId always
// comes from the logged-in dealer's own id, never from the client.
// Optionally pass username + password to create that retailer's login in the same step.
router.post('/', authRequired, requireRole('DEALER'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, bankAccounts, username, password } = req.body;
  const primaryDealerId = req.user.dealerId;

  if (username && !password) {
    return res.status(400).json({ error: 'Password is required to create a login' });
  }
  if (password && !username) {
    return res.status(400).json({ error: 'Username is required to create a login' });
  }

  try {
    const retailer = await prisma.$transaction(async (tx) => {
      const created = await tx.retailer.create({
        data: {
          name, address, contactNumber, gstNumber, primaryDealerId,
          bankAccounts: { create: (bankAccounts || []).map(b => ({
            accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
          })) }
        },
        include: { bankAccounts: true }
      });

      if (username) {
        const hash = await bcrypt.hash(password, 10);
        await tx.user.create({
          data: { username, password: hash, role: 'RETAILER', retailerId: created.id }
        });
      }

      return created;
    });

    res.json(retailer);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    throw err;
  }
});

router.put('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.retailer.findUnique({ where: { id } });
  if (!existing || existing.primaryDealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only edit your own retailers' });
  }
  const { name, address, contactNumber, gstNumber } = req.body;
  const retailer = await prisma.retailer.update({ where: { id }, data: { name, address, contactNumber, gstNumber } });
  res.json(retailer);
});

router.post('/:id/bank-accounts', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const retailerId = Number(req.params.id);
  if (req.user.role === 'DEALER') {
    const retailer = await prisma.retailer.findUnique({ where: { id: retailerId } });
    if (!retailer || retailer.primaryDealerId !== req.user.dealerId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  if (req.user.role === 'RETAILER' && req.user.retailerId !== retailerId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { accountNumber, ifsc, bankName } = req.body;
  const acc = await prisma.retailerBankAccount.create({ data: { retailerId, accountNumber, ifsc, bankName } });
  res.json(acc);
});

// Create a login for an existing retailer (no login yet), or reset an existing one's password.
// DEALER can only do this for their own retailers.
router.post('/:id/credentials', authRequired, requireRole('DEALER'), async (req, res) => {
  const retailerId = Number(req.params.id);
  const { username, password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const retailer = await prisma.retailer.findUnique({ where: { id: retailerId } });
  if (!retailer || retailer.primaryDealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const existing = await prisma.user.findFirst({ where: { retailerId } });
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
      data: { username, password: hash, role: 'RETAILER', retailerId }
    });
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
    throw err;
  }
});

router.delete('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.retailer.findUnique({ where: { id } });
  if (!existing || existing.primaryDealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only delete your own retailers' });
  }
  await prisma.retailer.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
