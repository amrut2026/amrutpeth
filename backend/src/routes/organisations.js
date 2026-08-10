import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  res.json(await prisma.organisation.findMany({ orderBy: { createdAt: 'desc' } }));
});

router.get('/:id', authRequired, async (req, res) => {
  const org = await prisma.organisation.findUnique({ where: { orgId: Number(req.params.id) } });
  res.json(org);
});

// Create organisation - ADMIN only (platform/apex level setup)
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { org_name, org_address, org_contact, org_type } = req.body;
  const org = await prisma.organisation.create({
    data: {
      orgName: org_name,
      orgAddress: org_address,
      orgContact: org_contact,
      orgType: org_type || 'MAHAMANDAL'
    }
  });
  res.json(org);
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { org_name, org_address, org_contact, org_type } = req.body;
  const org = await prisma.organisation.update({
    where: { orgId: Number(req.params.id) },
    data: { orgName: org_name, orgAddress: org_address, orgContact: org_contact, orgType: org_type }
  });
  res.json(org);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.organisation.delete({ where: { orgId: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
