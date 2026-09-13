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
// own dedicated AGGREGATOR-role login, tied to one dealer via
// User.dealerId, never as the retailer itself. Mirrors the ownership check
// in sales.js's POST /sales/on-behalf/:retailerId, so the two stay
// consistent: one dealer's aggregator integration can never read (or later
// sell against) another dealer's retailer.
router.get('/retailer/:retailerId', authRequired, requireRole('AGGREGATOR'), async (req, res) => {
  const retailerId = Number(req.params.retailerId);
  const retailer = await prisma.retailer.findUnique({ where: { id: retailerId } });
  if (!retailer || retailer.primaryDealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'Not your retailer' });
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
