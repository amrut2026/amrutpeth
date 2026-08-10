import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Anyone logged in can browse categories (needed to filter/select products)
router.get('/', authRequired, async (req, res) => {
  res.json(await prisma.productCategory.findMany());
});

// Only ADMIN manages the category master list
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, description } = req.body;
  res.json(await prisma.productCategory.create({ data: { name, description } }));
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, description } = req.body;
  res.json(await prisma.productCategory.update({ where: { id: Number(req.params.id) }, data: { name, description } }));
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.productCategory.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
