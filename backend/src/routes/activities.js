import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  res.json(await prisma.activity.findMany({ orderBy: { activityId: 'asc' } }));
});

router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { activityName } = req.body;
  const activity = await prisma.activity.create({ data: { activityName } });
  res.json(activity);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.activity.delete({ where: { activityId: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
