import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Provisions AGGREGATOR logins — a third-party integration (e.g. an
// aggregator storefront) acting on behalf of one specific dealer's
// retailers (see schema.prisma Role.AGGREGATOR). Tied to a dealer via
// User.dealerId, the same field a DEALER login uses, but ADMIN-only to
// create — a dealer can't grant itself this cross-cutting on-behalf
// access. Same ADMIN-only, scoped-to-one-role shape as users.js
// (READONLY), except this role needs an owning dealer, so dealerId is
// required here where it's absent for READONLY.

router.get('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const aggregators = await prisma.user.findMany({
    where: { role: 'AGGREGATOR' },
    select: {
      id: true,
      username: true,
      role: true,
      dealerId: true,
      dealer: { select: { id: true, name: true } },
      createdAt: true,
    },
    orderBy: { id: 'desc' },
  });
  res.json(aggregators);
});

router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { username, password, dealerId } = req.body;
  if (!username || !password || !dealerId) {
    return res.status(400).json({ error: 'Username, password, and dealer are required' });
  }

  const dealer = await prisma.dealer.findUnique({ where: { id: Number(dealerId) } });
  if (!dealer) return res.status(400).json({ error: 'Dealer not found' });

  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: { username, password: hash, role: 'AGGREGATOR', dealerId: Number(dealerId) },
      select: {
        id: true,
        username: true,
        role: true,
        dealerId: true,
        dealer: { select: { id: true, name: true } },
        createdAt: true,
      },
    });
    res.json(user);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
    throw err;
  }
});

// Reset an existing AGGREGATOR account's password — same pattern as
// users.js's READONLY reset endpoint.
router.post('/:id/reset-password', authRequired, requireRole('ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role !== 'AGGREGATOR') {
    return res.status(404).json({ error: 'Aggregator not found' });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({ where: { id }, data: { password: hash } });
  res.json({ id: user.id, username: user.username, role: user.role });
});

// Hard delete, same reasoning as users.js (READONLY): an AGGREGATOR login
// has no dependent records of its own (nothing in the schema references a
// User directly, only its dealerId/retailerId columns point outward), so
// nothing is left dangling by removing it outright.
router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role !== 'AGGREGATOR') {
    return res.status(404).json({ error: 'Aggregator not found' });
  }
  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
