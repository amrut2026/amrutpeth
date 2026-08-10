import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope } from '../middleware/auth.js';

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

router.put('/:id/reorder-level', authRequired, async (req, res) => {
  const { reorderLevel } = req.body;
  const row = await prisma.inventory.update({ where: { id: Number(req.params.id) }, data: { reorderLevel: Number(reorderLevel) } });
  res.json(row);
});

export default router;
