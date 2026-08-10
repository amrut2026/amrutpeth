import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Any logged-in dealer/retailer needs to see suppliers to record purchases against them
router.get('/', authRequired, async (req, res) => {
  res.json(await prisma.supplier.findMany({ orderBy: { name: 'asc' } }));
});

router.get('/:id', authRequired, async (req, res) => {
  const supplier = await prisma.supplier.findUnique({ where: { id: Number(req.params.id) } });
  res.json(supplier);
});

// Only ADMIN manages the supplier/manufacturer master list
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, address, contactNumber, gstNumber } = req.body;
  const supplier = await prisma.supplier.create({ data: { name, address, contactNumber, gstNumber } });
  res.json(supplier);
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, address, contactNumber, gstNumber } = req.body;
  const supplier = await prisma.supplier.update({
    where: { id: Number(req.params.id) },
    data: { name, address, contactNumber, gstNumber }
  });
  res.json(supplier);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.supplier.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
