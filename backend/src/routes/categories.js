import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Categories are created by dealers and scoped to them: a DEALER only sees
// and manages their own; a RETAILER only sees their primary dealer's
// categories (mirrors the Products scoping); ADMIN sees every dealer's
// categories, read-only, across the whole platform.
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') {
    where = { dealerId: req.user.dealerId };
  } else if (req.user.role === 'RETAILER') {
    const retailer = await prisma.retailer.findUnique({ where: { id: req.user.retailerId } });
    where = { dealerId: retailer?.primaryDealerId ?? -1 }; // -1 matches nothing if somehow unset
  }
  const categories = await prisma.productCategory.findMany({ where, include: { dealer: true }, orderBy: { id: 'desc' } });
  res.json(categories);
});

// Create category - DEALER only. dealerId is always taken from the logged-in
// dealer's own id, never from the client, so a dealer can't create a category
// under someone else's name.
router.post('/', authRequired, requireRole('DEALER'), async (req, res) => {
  const { name, description } = req.body;
  const category = await prisma.productCategory.create({
    data: { name, description, dealerId: req.user.dealerId },
    include: { dealer: true }
  });
  res.json(category);
});

router.put('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.productCategory.findUnique({ where: { id } });
  if (!existing || existing.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only edit your own categories' });
  }
  const { name, description } = req.body;
  const category = await prisma.productCategory.update({ where: { id }, data: { name, description }, include: { dealer: true } });
  res.json(category);
});

router.delete('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.productCategory.findUnique({ where: { id } });
  if (!existing || existing.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only delete your own categories' });
  }
  await prisma.productCategory.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
