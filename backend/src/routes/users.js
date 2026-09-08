import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Plain login accounts with no owning entity. Every other role's login is
// created through that entity's own record (Dealer "Set login", Retailer
// "Set login", Organisation "Set login" — see dealers.js/retailers.js/
// organisations.js POST /:id/credentials) because dealerId/retailerId/
// organisationId on User (see schema.prisma) needs something to point at.
// READONLY has no such entity — it's a pure oversight login — so it's
// provisioned here instead, ADMIN-only like every other account-creation
// route in this app. Scoped to role: 'READONLY' throughout (not a generic
// user-management API) so this can't accidentally become a backdoor for
// creating ADMIN/ORGANISATION/DEALER/RETAILER accounts outside their
// normal entity-first flows.

router.get('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const users = await prisma.user.findMany({
    where: { role: 'READONLY' },
    select: { id: true, username: true, role: true, createdAt: true },
    orderBy: { id: 'desc' },
  });
  res.json(users);
});

router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: { username, password: hash, role: 'READONLY' },
    });
    res.json({ id: user.id, username: user.username, role: user.role, createdAt: user.createdAt });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
    throw err;
  }
});

// Reset an existing READONLY account's password — same "credentials" idea
// as the other entities' reset flow, minus the create-vs-update branching
// there, since these accounts are always created through POST / above
// (never lazily created from this endpoint).
router.post('/:id/reset-password', authRequired, requireRole('ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role !== 'READONLY') {
    return res.status(404).json({ error: 'User not found' });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.update({ where: { id }, data: { password: hash } });
  res.json({ id: user.id, username: user.username, role: user.role });
});

// Hard delete, unlike Division's soft-delete pattern — a READONLY account
// has no dependent records (no dealer/retailer/organisation, no purchases,
// nothing referencing it), so there's nothing left dangling by removing it
// outright, and no "reactivate later" need to design around.
router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role !== 'READONLY') {
    return res.status(404).json({ error: 'User not found' });
  }
  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
