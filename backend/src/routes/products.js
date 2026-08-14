import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';

const router = Router();

function generateBarcode() {
  // 12-digit numeric code, EAN-13/Code128 friendly
  const ts = Date.now().toString().slice(-8);
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `${ts}${rnd}`;
}

// Product catalog is created by dealers: each product belongs to exactly one
// dealer (the one that created it). Admin can browse everything for oversight.
// A DEALER only sees their own products; a RETAILER only sees products
// belonging to their primary dealer — this is what keeps purchases and sales
// scoped to "your own dealer's products" throughout the app.
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') {
    where = { dealerId: req.user.dealerId };
  } else if (req.user.role === 'RETAILER') {
    const retailer = await prisma.retailer.findUnique({ where: { id: req.user.retailerId } });
    where = { dealerId: retailer?.primaryDealerId ?? -1 }; // -1 matches nothing if somehow unset
  }
  const products = await prisma.product.findMany({ where, include: { category: true, supplier: true, dealer: true }, orderBy: { id: 'desc' } });
  res.json(products);
});

router.get('/:id', authRequired, async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, include: { category: true, supplier: true, dealer: true } });
  res.json(product);
});

// Create product - DEALER only. Every product is automatically tagged with
// the creating dealer's own id (never taken from the client) — this is what
// scopes the product to that dealer for purchases and sales downstream.
// Every product belongs to exactly one supplier — to offer the same item from a
// different supplier, clone it (see the frontend's "Clone to another supplier").
// Pricing, MRP, dates, and batch name are NOT set here — they're captured per
// batch when the product is purchased (see purchases.js).
router.post('/', authRequired, requireRole('DEALER'), async (req, res) => {
  const { categoryId, supplierId, name, sizeWeight, fssaiCode } = req.body;

  if (!supplierId) return res.status(400).json({ error: 'Supplier is required' });

  const barcode = generateBarcode();

  const product = await prisma.product.create({
    data: {
      categoryId: Number(categoryId), supplierId: Number(supplierId), dealerId: req.user.dealerId, name, sizeWeight,
      fssaiCode, barcode,
    },
    include: { category: true, supplier: true, dealer: true }
  });

  res.json(product);
});

router.put('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.dealerId !== req.user.dealerId) return res.status(403).json({ error: 'You can only edit your own products' });
  const { categoryId, supplierId, name, sizeWeight, fssaiCode } = req.body;
  const product = await prisma.product.update({
    where: { id },
    data: {
      categoryId: categoryId ? Number(categoryId) : undefined,
      supplierId: supplierId !== undefined ? (supplierId ? Number(supplierId) : null) : undefined,
      name, sizeWeight, fssaiCode
    },
    include: { category: true, supplier: true, dealer: true }
  });
  res.json(product);
});

// Lookup by barcode - used by POS / barcode scanner (any logged-in role).
// Product itself carries no pricing (it varies per purchase batch — see
// PurchaseItem), so the current selling price is resolved from the most
// recent batch that THIS owner (the logged-in dealer or retailer) purchased
// of this product. A dealer sells at that batch's sellingPrice; a retailer
// sells to their own customers at that batch's retailerSellingPrice.
router.get('/lookup/:barcode', authRequired, async (req, res) => {
  const product = await prisma.product.findUnique({ where: { barcode: req.params.barcode } });
  if (!product) return res.status(404).json({ error: 'Product not found for this barcode' });

  const scope = ownerScope(req);
  let latestItem = null;
  if (scope.ownerType === 'DEALER') {
    latestItem = await prisma.purchaseItem.findFirst({
      where: { productId: product.id, purchase: { ownerType: 'DEALER', dealerId: scope.dealerId } },
      orderBy: { id: 'desc' }
    });
  } else if (scope.ownerType === 'RETAILER') {
    latestItem = await prisma.purchaseItem.findFirst({
      where: { productId: product.id, purchase: { ownerType: 'RETAILER', retailerId: scope.retailerId } },
      orderBy: { id: 'desc' }
    });
  }

  if (!latestItem) {
    return res.status(404).json({ error: 'No purchased stock found for this product yet — record a purchase before selling it' });
  }

  res.json({
    ...product,
    sellingPrice: latestItem.sellingPrice,
    retailerSellingPrice: latestItem.retailerSellingPrice,
    mrp: latestItem.mrp,
    discount: latestItem.discount,
  });
});

router.delete('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.dealerId !== req.user.dealerId) return res.status(403).json({ error: 'You can only delete your own products' });
  await prisma.product.delete({ where: { id } });
  res.json({ ok: true });
});

export default router;
