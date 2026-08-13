import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';

const router = Router();

// Purchase of product is a Dealer/Retailer activity only — Admin (and any other
// role) is blocked from both viewing and recording purchases.
router.get('/', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  let where = {};
  if (scope.ownerType === 'DEALER') where = { ownerType: 'DEALER', dealerId: scope.dealerId };
  if (scope.ownerType === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: scope.retailerId };
  const purchases = await prisma.purchase.findMany({ where, include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }, orderBy: { date: 'desc' } });
  res.json(purchases);
});

// Create purchase (stock inwards) - increments inventory
router.post('/', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can record purchases' });
  const { supplierId, items } = req.body;
  // items: [{ productId, quantity, rate, sellingPrice, discount, mrp, manufacturingDate, expiryDate, batchName }]

  for (const i of items) {
    if (!i.rate || !i.dealerCommission || !i.sellingPrice || !i.mrp || !i.manufacturingDate || !i.expiryDate || !i.batchName) {
      return res.status(400).json({ error: 'Cost price, dealer commission, selling price, MRP, dates, and batch name are required for every item' });
    }
  }

  let supplierIdToUse = null;
  let sourceDealerIdToUse = null;

  if (scope.ownerType === 'DEALER') {
    if (!supplierId) return res.status(400).json({ error: 'Supplier is required' });
    supplierIdToUse = Number(supplierId);
  } else {
    // RETAILER: always sourced from their own primary dealer.
    // Looked up server-side rather than trusting the client, so a retailer can't
    // record a purchase against a dealer that isn't theirs.
    const retailer = await prisma.retailer.findUnique({ where: { id: scope.retailerId } });
    if (!retailer) return res.status(404).json({ error: 'Retailer not found' });
    sourceDealerIdToUse = retailer.primaryDealerId;
  }

  // Every item must be a product belonging to the relevant dealer — a dealer's
  // own products for a dealer purchase, or the retailer's primary dealer's
  // products for a retailer purchase. Checked server-side (not just via the
  // already-scoped dropdown) so a purchase can't be recorded against products
  // from a different dealer.
  const expectedDealerId = scope.ownerType === 'DEALER' ? scope.dealerId : sourceDealerIdToUse;
  const productIds = items.map((i) => Number(i.productId));
  const ownedProducts = await prisma.product.findMany({ where: { id: { in: productIds }, dealerId: expectedDealerId } });
  if (ownedProducts.length !== new Set(productIds).size) {
    return res.status(403).json({ error: 'One or more products do not belong to your dealer' });
  }
  // For a dealer purchase specifically, every product must also belong to the
  // supplier selected for this purchase — a purchase can only bring in stock
  // from one supplier at a time.
  if (scope.ownerType === 'DEALER' && ownedProducts.some((p) => p.supplierId !== supplierIdToUse)) {
    return res.status(403).json({ error: 'One or more products do not belong to the selected supplier' });
  }

  const purchase = await prisma.purchase.create({
    data: {
      ownerType: scope.ownerType,
      dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
      retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
      supplierId: supplierIdToUse,
      sourceDealerId: sourceDealerIdToUse,
      items: {
        create: items.map(i => ({
          productId: Number(i.productId),
          quantity: Number(i.quantity),
          rate: i.rate,
          dealerCommission: i.dealerCommission,
          sellingPrice: i.sellingPrice,
          discount: i.discount || 0,
          mrp: i.mrp,
          manufacturingDate: new Date(i.manufacturingDate),
          expiryDate: new Date(i.expiryDate),
          batchName: i.batchName,
        }))
      }
    },
    include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }
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
