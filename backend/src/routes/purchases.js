import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const scope = ownerScope(req);
  let where = {};
  if (scope.ownerType === 'DEALER') where = { ownerType: 'DEALER', dealerId: scope.dealerId };
  if (scope.ownerType === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: scope.retailerId };
  const purchases = await prisma.purchase.findMany({ where, include: { items: { include: { product: true } }, supplier: true }, orderBy: { date: 'desc' } });
  res.json(purchases);
});

// Create purchase (stock inwards) - increments inventory
router.post('/', authRequired, async (req, res) => {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can record purchases' });
  const { supplierId, items } = req.body; // items: [{ productId, quantity, rate }]

  const purchase = await prisma.purchase.create({
    data: {
      ownerType: scope.ownerType,
      dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
      retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
      supplierId: Number(supplierId),
      items: { create: items.map(i => ({ productId: Number(i.productId), quantity: Number(i.quantity), rate: i.rate })) }
    },
    include: { items: true, supplier: true }
  });

  for (const i of items) {
    const where = {
      productId_ownerType_dealerId_retailerId: {
        productId: Number(i.productId),
        ownerType: scope.ownerType,
        dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
        retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
      }
    };
    const existing = await prisma.inventory.findUnique({ where }).catch(() => null);
    if (existing) {
      await prisma.inventory.update({ where, data: { quantity: { increment: Number(i.quantity) } } });
    } else {
      await prisma.inventory.create({
        data: {
          productId: Number(i.productId),
          ownerType: scope.ownerType,
          dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
          retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
          quantity: Number(i.quantity),
          reorderLevel: 10
        }
      });
    }
  }

  res.json(purchase);
});

export default router;
