import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  res.json(await prisma.userRole.findMany({ orderBy: { roleId: 'asc' } }));
});

router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { roleName } = req.body;
  const role = await prisma.userRole.create({ data: { roleName } });
  res.json(role);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.userRole.delete({ where: { roleId: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
