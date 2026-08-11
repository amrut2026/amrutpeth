import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Any logged-in user needs to see divisions to pick one when creating a dealer/supplier
router.get('/', authRequired, async (req, res) => {
  res.json(await prisma.division.findMany({ orderBy: { name: 'asc' } }));
});

router.get('/:id', authRequired, async (req, res) => {
  const division = await prisma.division.findUnique({ where: { id: Number(req.params.id) } });
  res.json(division);
});

// Only ADMIN manages the division master list
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, description } = req.body;
  try {
    const division = await prisma.division.create({ data: { name, description: description || null } });
    res.json(division);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A division with this name already exists' });
    throw err;
  }
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, description } = req.body;
  try {
    const division = await prisma.division.update({
      where: { id: Number(req.params.id) },
      data: { name, description: description || null }
    });
    res.json(division);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A division with this name already exists' });
    throw err;
  }
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.division.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
