import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Provisions AGGREGATOR logins — a third-party integration (e.g. an
// aggregator storefront) that can act on behalf of ANY retailer (see
// schema.prisma Role.AGGREGATOR). Deliberately NOT tied to a dealer or
// retailer via User.dealerId/retailerId — the external site itself picks
// which retailer a given sale is for, per request, via the on-behalf/
// :retailerId routes built for this role. So unlike an earlier version of
// this route, there's nothing here to scope it beyond the role itself —
// same shape as users.js's READONLY provisioning, ADMIN-only either way.

router.get('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const aggregators = await prisma.user.findMany({
    where: { role: 'AGGREGATOR' },
    select: { id: true, username: true, role: true, createdAt: true },
    orderBy: { id: 'desc' },
  });
  res.json(aggregators);
});

router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: { username, password: hash, role: 'AGGREGATOR' },
    });
    res.json({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt });
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
// has no dependent records of its own, so nothing is left dangling by
// removing it outright.
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
