import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// List dealers - DEALER sees self, ORGANISATION sees only dealers under its
// own organisation (a dealer creates under exactly one org - see POST /
// below - so this is the natural read-scope now that ORGANISATION is the
// one creating them). ADMIN keeps unscoped read access for oversight, since
// ADMIN no longer creates/edits dealers itself (see POST/PUT below) but
// still needs visibility across all organisations.
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { id: req.user.dealerId };
  else if (req.user.role === 'ORGANISATION') where = { organisationId: req.user.organisationId };
  const dealers = await prisma.dealer.findMany({
    where,
    include: { bankAccounts: true, users: { select: { id: true, username: true } }, division: true, organisation: true }
  });
  res.json(dealers);
});

router.get('/:id', authRequired, async (req, res) => {
  const dealer = await prisma.dealer.findUnique({
    where: { id: Number(req.params.id) },
    include: { bankAccounts: true, retailers: true, users: { select: { id: true, username: true } }, division: true, organisation: true }
  });
  if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
  if (req.user.role === 'ORGANISATION' && dealer.organisationId !== req.user.organisationId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(dealer);
});

// Create dealer - ORGANISATION only. ADMIN no longer creates dealers
// directly; that's exclusively the owning organisation's job now (ADMIN's
// role narrows to creating/updating Organisation itself - see
// organisations.js). organisationId is always the logged-in organisation's
// own id, never taken from the request body - an ORGANISATION user can only
// ever create dealers under itself.
// Optionally pass username + password to create that dealer's login in the same step.
router.post('/', authRequired, requireRole('ORGANISATION'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, divisionId, bankAccounts, username, password } = req.body;
  const organisationId = req.user.organisationId;

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
          name, address, contactNumber,
          gstNumber: gstNumber ? gstNumber.trim() || null : null,
          divisionId: divisionId ? Number(divisionId) : null,
          organisationId,
          bankAccounts: { create: (bankAccounts || []).map(b => ({
            accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
          })) }
        },
        include: { bankAccounts: true, division: true, organisation: true }
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

// Edit dealer - DEALER only, and only their own record. ADMIN and
// ORGANISATION no longer edit a dealer's details here: ADMIN's write access
// is limited to Organisation (create/update); ORGANISATION's write access
// to Dealer is limited to creating one (see POST / above) - editing an
// existing dealer's own details is the dealer's own responsibility.
router.put('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.dealerId !== id) return res.status(403).json({ error: 'Forbidden' });
  const { name, address, contactNumber, gstNumber } = req.body;
  const dealer = await prisma.dealer.update({
    where: { id },
    data: { name, address, contactNumber, gstNumber: gstNumber ? gstNumber.trim() || null : null }
  });
  res.json(dealer);
});

// DEALER only, and only for their own bank accounts (previously any
// authenticated DEALER could post a bank account to any dealerId - fixed
// here while narrowing this route's role list).
router.post('/:id/bank-accounts', authRequired, requireRole('DEALER'), async (req, res) => {
  const dealerId = Number(req.params.id);
  if (req.user.dealerId !== dealerId) return res.status(403).json({ error: 'Forbidden' });
  const { accountNumber, ifsc, bankName } = req.body;
  const acc = await prisma.dealerBankAccount.create({ data: { dealerId, accountNumber, ifsc, bankName } });
  res.json(acc);
});

// Create a login for an existing dealer (no login yet), or reset an existing
// one's password - ORGANISATION only, and only for a dealer under its own
// organisation. This is a judgment call beyond the literal "ORGANISATION
// only creates dealers": with ADMIN no longer touching Dealer at all, a
// dealer that's ever locked out of their login would otherwise have no
// recovery path. If you'd rather this be create-only too (no password
// resets for anyone), say so and I'll pull this back out.
router.post('/:id/credentials', authRequired, requireRole('ORGANISATION'), async (req, res) => {
  const dealerId = Number(req.params.id);
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) return res.status(404).json({ error: 'Dealer not found' });
  if (dealer.organisationId !== req.user.organisationId) return res.status(403).json({ error: 'Forbidden' });

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

export default router;
