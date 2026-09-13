import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const scope = ownerScope(req);
  let where = {};
  if (scope.ownerType === 'DEALER') where = { ownerType: 'DEALER', dealerId: scope.dealerId };
  if (scope.ownerType === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: scope.retailerId };
  const rows = await prisma.inventory.findMany({ where, include: { product: true } });
  const result = rows.map(r => ({ ...r, lowStock: r.quantity <= r.reorderLevel }));
  res.json(result);
});

// GET /api/inventory/retailer/:retailerId — AGGREGATOR only. Lets an
// aggregator integration fetch a SPECIFIC retailer's live stock, once its
// customer has picked that retailer — the aggregator authenticates with its
// own dedicated AGGREGATOR-role login, which is not tied to any one dealer
// (see schema.prisma Role.AGGREGATOR): the external site itself may pick
// any retailer, so this only checks that the retailer exists, not that it
// belongs to any particular dealer. Mirrors sales.js's
// POST /sales/on-behalf/:retailerId, so the two stay consistent.
router.get('/retailer/:retailerId', authRequired, requireRole('AGGREGATOR'), async (req, res) => {
  const retailerId = Number(req.params.retailerId);
  const retailer = await prisma.retailer.findUnique({ where: { id: retailerId } });
  if (!retailer) {
    return res.status(404).json({ error: 'Retailer not found' });
  }
  const rows = await prisma.inventory.findMany({
    where: { ownerType: 'RETAILER', retailerId },
    include: { product: true }
  });
  res.json(rows.map(r => ({ ...r, lowStock: r.quantity <= r.reorderLevel })));
});

router.put('/:id/reorder-level', authRequired, async (req, res) => {
  const { reorderLevel } = req.body;
  const row = await prisma.inventory.update({ where: { id: Number(req.params.id) }, data: { reorderLevel: Number(reorderLevel) } });
  res.json(row);
});

export default router;
