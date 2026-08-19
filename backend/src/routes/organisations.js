import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  res.json(await prisma.organisation.findMany({
    include: { users: { select: { id: true, username: true } } },
    orderBy: { createdAt: 'desc' }
  }));
});

router.get('/:id', authRequired, async (req, res) => {
  const org = await prisma.organisation.findUnique({
    where: { orgId: Number(req.params.id) },
    include: { users: { select: { id: true, username: true } } }
  });
  res.json(org);
});

// Create organisation - ADMIN only (platform/apex level setup).
// Optionally pass username + password to create that organisation's login
// in the same step, same pattern as Dealer/Retailer creation.
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { org_name, org_address, org_contact, org_type, username, password } = req.body;

  if (username && !password) {
    return res.status(400).json({ error: 'Password is required to create a login' });
  }
  if (password && !username) {
    return res.status(400).json({ error: 'Username is required to create a login' });
  }

  try {
    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organisation.create({
        data: {
          orgName: org_name,
          orgAddress: org_address,
          orgContact: org_contact,
          orgType: org_type || 'MAHAMANDAL'
        }
      });

      if (username) {
        const hash = await bcrypt.hash(password, 10);
        await tx.user.create({
          data: { username, password: hash, role: 'ORGANISATION', organisationId: created.orgId }
        });
      }

      return created;
    });

    res.json(org);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Username already taken' });
    }
    throw err;
  }
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { org_name, org_address, org_contact, org_type } = req.body;
  const org = await prisma.organisation.update({
    where: { orgId: Number(req.params.id) },
    data: { orgName: org_name, orgAddress: org_address, orgContact: org_contact, orgType: org_type }
  });
  res.json(org);
});

// Create a login for an existing organisation (no login yet), or reset an existing one's password.
router.post('/:id/credentials', authRequired, requireRole('ADMIN'), async (req, res) => {
  const organisationId = Number(req.params.id);
  const { username, password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });

  const existing = await prisma.user.findFirst({ where: { organisationId } });
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
      data: { username, password: hash, role: 'ORGANISATION', organisationId }
    });
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already taken' });
    throw err;
  }
});

// No DELETE route: ADMIN's write access to Organisation is create/update
// only (see the new dealer-creation boundary this pairs with in
// dealers.js). If you need a way to deactivate/remove an organisation
// later, that's a separate decision — flag it and I'll add it back with
// whatever rule you want (e.g. only when it has no dealers left).

export default router;
