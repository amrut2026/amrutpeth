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

// Create purchase (stock inwards). Recorded as PENDING — inventory is NOT
// credited yet; it's only credited once the purchase is fully accepted (see
// the /:id/status route below), so stock isn't counted before it's actually
// been checked in.
router.post('/', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can record purchases' });
  const { supplierId, items } = req.body;
  // items: [{ productId, quantity, rate, sellingPrice, discount, mrp, manufacturingDate, expiryDate, batchName }]

  for (const i of items) {
    if (!i.rate || !i.dealerCommission || !i.sellingPrice || !i.mrp || i.discount === undefined || i.discount === '' || !i.retailerSellingPrice || !i.manufacturingDate || !i.expiryDate || !i.batchName) {
      return res.status(400).json({ error: 'Cost price, dealer commission, selling price, MRP, discount %, retailer selling price, dates, and batch name are required for every item' });
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
      status: 'PENDING',
      items: {
        create: items.map(i => ({
          productId: Number(i.productId),
          quantity: Number(i.quantity),
          rate: i.rate,
          dealerCommission: i.dealerCommission,
          sellingPrice: i.sellingPrice,
          discount: i.discount || 0,
          mrp: i.mrp,
          retailerSellingPrice: i.retailerSellingPrice,
          manufacturingDate: new Date(i.manufacturingDate),
          expiryDate: new Date(i.expiryDate),
          batchName: i.batchName,
        }))
      }
    },
    include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }
  });

  res.json(purchase);
});

// Edit a purchase's items while it's IN_REVIEW — lets the owner add a new
// item or correct an existing one before confirming/receiving it. Locked
// once the purchase moves past IN_REVIEW: inventory has already been
// credited from CONFIRMED/RECEIVED purchases (see /:id/status), so changing
// items after that point would silently desync stock from what was recorded.
// The whole item list is resubmitted and swapped in — the simplest way to
// support both "add a new item" and "edit an existing item" uniformly.
router.put('/:id', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  const id = Number(req.params.id);
  const { supplierId, items } = req.body;

  const existing = await prisma.purchase.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Purchase not found' });

  const owns = (scope.ownerType === 'DEALER' && existing.dealerId === scope.dealerId) ||
    (scope.ownerType === 'RETAILER' && existing.retailerId === scope.retailerId);
  if (!owns) return res.status(403).json({ error: 'You can only edit your own purchases' });

  if (existing.status !== 'IN_REVIEW') {
    return res.status(400).json({ error: 'Only a purchase that is under review can be edited' });
  }

  if (!items || !items.length) return res.status(400).json({ error: 'No items in purchase' });
  for (const i of items) {
    if (!i.rate || !i.dealerCommission || !i.sellingPrice || !i.mrp || i.discount === undefined || i.discount === '' || !i.retailerSellingPrice || !i.manufacturingDate || !i.expiryDate || !i.batchName) {
      return res.status(400).json({ error: 'Cost price, dealer commission, selling price, MRP, discount %, retailer selling price, dates, and batch name are required for every item' });
    }
  }

  // A retailer purchase always stays sourced from the same dealer it was
  // created against; only a dealer purchase's supplier can be changed here.
  let supplierIdToUse = existing.supplierId;
  const expectedDealerId = scope.ownerType === 'DEALER' ? scope.dealerId : existing.sourceDealerId;

  if (scope.ownerType === 'DEALER') {
    if (supplierId) supplierIdToUse = Number(supplierId);
    if (!supplierIdToUse) return res.status(400).json({ error: 'Supplier is required' });
  }

  const productIds = items.map((i) => Number(i.productId));
  const ownedProducts = await prisma.product.findMany({ where: { id: { in: productIds }, dealerId: expectedDealerId } });
  if (ownedProducts.length !== new Set(productIds).size) {
    return res.status(403).json({ error: 'One or more products do not belong to your dealer' });
  }
  if (scope.ownerType === 'DEALER' && ownedProducts.some((p) => p.supplierId !== supplierIdToUse)) {
    return res.status(403).json({ error: 'One or more products do not belong to the selected supplier' });
  }

  const purchase = await prisma.$transaction(async (tx) => {
    await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
    return tx.purchase.update({
      where: { id },
      data: {
        supplierId: scope.ownerType === 'DEALER' ? supplierIdToUse : existing.supplierId,
        items: {
          create: items.map(i => ({
            productId: Number(i.productId),
            quantity: Number(i.quantity),
            rate: i.rate,
            dealerCommission: i.dealerCommission,
            sellingPrice: i.sellingPrice,
            discount: i.discount || 0,
            mrp: i.mrp,
            retailerSellingPrice: i.retailerSellingPrice,
            manufacturingDate: new Date(i.manufacturingDate),
            expiryDate: new Date(i.expiryDate),
            batchName: i.batchName,
          }))
        }
      },
      include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }
    });
  });

  res.json(purchase);
});

// Update only the quantity of one or more items on a purchase, without
// touching anything else. Allowed while the purchase is PENDING or
// IN_REVIEW — the two stages before inventory gets credited (see the
// /:id/status route) — so a quick quantity correction doesn't require
// resubmitting the whole item form via PUT.
router.patch('/:id/quantities', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  const id = Number(req.params.id);
  const { items } = req.body; // [{ id, quantity }]

  const existing = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return res.status(404).json({ error: 'Purchase not found' });

  const owns = (scope.ownerType === 'DEALER' && existing.dealerId === scope.dealerId) ||
    (scope.ownerType === 'RETAILER' && existing.retailerId === scope.retailerId);
  if (!owns) return res.status(403).json({ error: 'You can only update your own purchases' });

  const status = existing.status || 'PENDING';
  if (status !== 'PENDING' && status !== 'IN_REVIEW') {
    return res.status(400).json({ error: 'Quantity can only be edited while a purchase is pending or under review' });
  }

  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items to update' });

  const validItemIds = new Set(existing.items.map((i) => i.id));
  for (const i of items) {
    if (!validItemIds.has(Number(i.id))) return res.status(400).json({ error: 'Item does not belong to this purchase' });
    if (!i.quantity || Number(i.quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });
  }

  await prisma.$transaction(
    items.map((i) => prisma.purchaseItem.update({ where: { id: Number(i.id) }, data: { quantity: Number(i.quantity) } }))
  );

  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }
  });

  res.json(purchase);
});

// Purchase status workflow: PENDING -> IN_REVIEW ("mark for review", either
// owner) -> CONFIRMED (dealer's own purchases, from their supplier) or
// RECEIVED (a retailer's own purchases, from their dealer). Scoped so an
// owner can only move their own purchases through the workflow.
router.patch('/:id/status', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  const id = Number(req.params.id);
  const { status } = req.body;

  const existing = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return res.status(404).json({ error: 'Purchase not found' });

  const owns = (scope.ownerType === 'DEALER' && existing.dealerId === scope.dealerId) ||
    (scope.ownerType === 'RETAILER' && existing.retailerId === scope.retailerId);
  if (!owns) return res.status(403).json({ error: 'You can only update your own purchases' });

  const currentStatus = existing.status || 'PENDING';
  const nextStatusByRole = {
    DEALER: { PENDING: 'IN_REVIEW', IN_REVIEW: 'CONFIRMED' },
    RETAILER: { PENDING: 'IN_REVIEW', IN_REVIEW: 'RECEIVED' },
  };
  const expectedNext = nextStatusByRole[scope.ownerType]?.[currentStatus];
  if (!expectedNext || expectedNext !== status) {
    return res.status(400).json({ error: `Cannot move purchase from ${currentStatus} to ${status}` });
  }

  const purchase = await prisma.purchase.update({
    where: { id },
    data: { status },
    include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }
  });

  // Inventory is only credited once, on the terminal transition: a dealer's
  // own purchase (from a supplier) hitting CONFIRMED, or a retailer's own
  // purchase (from their dealer) hitting RECEIVED. Since PENDING -> IN_REVIEW
  // -> CONFIRMED/RECEIVED only ever moves forward (there's no route back),
  // this can only fire once per purchase.
  const isTerminal = (scope.ownerType === 'DEALER' && status === 'CONFIRMED') ||
    (scope.ownerType === 'RETAILER' && status === 'RECEIVED');
  if (isTerminal) {
    for (const i of purchase.items) {
      const invWhere = {
        productId_ownerType_dealerId_retailerId: {
          productId: i.productId,
          ownerType: scope.ownerType,
          dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
          retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
        }
      };
      const existingInv = await prisma.inventory.findUnique({ where: invWhere }).catch(() => null);
      if (existingInv) {
        await prisma.inventory.update({ where: invWhere, data: { quantity: { increment: i.quantity } } });
      } else {
        await prisma.inventory.create({
          data: {
            productId: i.productId,
            ownerType: scope.ownerType,
            dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
            retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
            quantity: i.quantity,
            reorderLevel: 10
          }
        });
      }
    }
  }

  res.json(purchase);
});

export default router;
