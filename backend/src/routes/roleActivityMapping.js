import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Full mapping matrix: every role x every activity, with iactive flag if a mapping exists
router.get('/', authRequired, async (req, res) => {
  const [roles, activities, mappings] = await Promise.all([
    prisma.userRole.findMany({ orderBy: { roleId: 'asc' } }),
    prisma.activity.findMany({ orderBy: { activityId: 'asc' } }),
    prisma.roleActivityMapping.findMany()
  ]);
  res.json({ roles, activities, mappings });
});

// Create or toggle a mapping. Body: { role_id, activity_id, iactive }
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { role_id, activity_id, iactive } = req.body;
  const roleId = Number(role_id);
  const activityId = Number(activity_id);

  const mapping = await prisma.roleActivityMapping.upsert({
    where: { roleId_activityId: { roleId, activityId } },
    update: { iactive: iactive !== undefined ? Boolean(iactive) : true },
    create: { roleId, activityId, iactive: iactive !== undefined ? Boolean(iactive) : true }
  });
  res.json(mapping);
});

// Toggle active/inactive on an existing mapping
router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { iactive } = req.body;
  const mapping = await prisma.roleActivityMapping.update({
    where: { mappingId: Number(req.params.id) },
    data: { iactive: Boolean(iactive) }
  });
  res.json(mapping);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.roleActivityMapping.delete({ where: { mappingId: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
