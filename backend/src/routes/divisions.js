import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Any logged-in user needs to see divisions to pick one when creating a
// dealer/supplier — that use case only ever wants active ones, so it's the
// default. The ORGANISATION management table (Divisions.jsx) needs to see
// deactivated divisions too, so it can reactivate them — it opts in with
// ?all=true.
router.get('/', authRequired, async (req, res) => {
  const where = req.query.all === 'true' ? {} : { isActive: true };
  res.json(await prisma.division.findMany({ where, orderBy: { name: 'asc' } }));
});

router.get('/:id', authRequired, async (req, res) => {
  const division = await prisma.division.findUnique({ where: { id: Number(req.params.id) } });
  res.json(division);
});

// Only ORGANISATION manages the division master list
router.post('/', authRequired, requireRole('ORGANISATION'), async (req, res) => {
  const { name, description } = req.body;
  try {
    const division = await prisma.division.create({ data: { name, description: description || null } });
    res.json(division);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'A division with this name already exists' });
    throw err;
  }
});

router.put('/:id', authRequired, requireRole('ORGANISATION'), async (req, res) => {
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

// Soft delete / reactivate. Divisions are never hard-deleted — dealers and
// suppliers reference them, and a hard delete would either cascade-break
// those records or fail outright. Deactivating (and, symmetrically,
// reactivating) is a toggle through this one route rather than two.
router.patch('/:id/active', authRequired, requireRole('ORGANISATION'), async (req, res) => {
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be true or false' });
  const division = await prisma.division.update({
    where: { id: Number(req.params.id) },
    data: { isActive }
  });
  res.json(division);
});

export default router;
