import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

function generateBarcode() {
  // 12-digit numeric code, EAN-13/Code128 friendly
  const ts = Date.now().toString().slice(-8);
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `${ts}${rnd}`;
}

// Product catalog is shared across the whole platform — any logged-in
// dealer/retailer/admin can browse it (they need this to record purchases
// and sales), but only ADMIN can create/edit/delete entries.
// DEALER accounts only see products from suppliers in their own division.
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') {
    const dealer = await prisma.dealer.findUnique({ where: { id: req.user.dealerId } });
    where = { supplier: { divisionId: dealer?.divisionId ?? -1 } }; // -1 matches nothing if the dealer has no division set
  }
  const products = await prisma.product.findMany({ where, include: { category: true, supplier: true }, orderBy: { id: 'desc' } });
  res.json(products);
});

router.get('/:id', authRequired, async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, include: { category: true, supplier: true } });
  res.json(product);
});

// Create product - ADMIN only (manufacturer/platform owner manages the master catalog)
// Every product belongs to exactly one supplier — to offer the same item from a
// different supplier, clone it (see the frontend's "Clone to another supplier").
// Pricing, MRP, dates, and batch name are NOT set here — they're captured per
// batch when the product is purchased (see purchases.js).
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { categoryId, supplierId, name, sizeWeight, fssaiCode } = req.body;

  if (!supplierId) return res.status(400).json({ error: 'Supplier is required' });

  const barcode = generateBarcode();

  const product = await prisma.product.create({
    data: {
      categoryId: Number(categoryId), supplierId: Number(supplierId), name, sizeWeight,
      fssaiCode, barcode,
    },
    include: { category: true, supplier: true }
  });

  res.json(product);
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  const { categoryId, supplierId, name, sizeWeight, fssaiCode } = req.body;
  const product = await prisma.product.update({
    where: { id },
    data: {
      categoryId: categoryId ? Number(categoryId) : undefined,
      supplierId: supplierId !== undefined ? (supplierId ? Number(supplierId) : null) : undefined,
      name, sizeWeight, fssaiCode
    },
    include: { category: true, supplier: true }
  });
  res.json(product);
});

// Lookup by barcode - used by POS / barcode scanner (any logged-in role)
router.get('/lookup/:barcode', authRequired, async (req, res) => {
  const product = await prisma.product.findUnique({ where: { barcode: req.params.barcode } });
  if (!product) return res.status(404).json({ error: 'Product not found for this barcode' });
  res.json(product);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.product.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
