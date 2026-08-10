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
router.get('/', authRequired, async (req, res) => {
  const products = await prisma.product.findMany({ include: { category: true }, orderBy: { id: 'desc' } });
  res.json(products);
});

router.get('/:id', authRequired, async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, include: { category: true } });
  res.json(product);
});

// Create product - ADMIN only (manufacturer/platform owner manages the master catalog)
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const {
    categoryId, name, sizeWeight, costPrice, sellingPrice, discount, mrp,
    manufacturingDate, expiryDate, batchName, fssaiCode
  } = req.body;

  const barcode = generateBarcode();

  const product = await prisma.product.create({
    data: {
      categoryId: Number(categoryId), name, sizeWeight,
      costPrice, sellingPrice, discount: discount || 0, mrp,
      manufacturingDate: new Date(manufacturingDate),
      expiryDate: new Date(expiryDate),
      batchName, fssaiCode, barcode,
    }
  });

  res.json(product);
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const id = Number(req.params.id);
  const {
    categoryId, name, sizeWeight, costPrice, sellingPrice, discount, mrp,
    manufacturingDate, expiryDate, batchName, fssaiCode
  } = req.body;
  const product = await prisma.product.update({
    where: { id },
    data: {
      categoryId: categoryId ? Number(categoryId) : undefined,
      name, sizeWeight, costPrice, sellingPrice, discount, mrp,
      manufacturingDate: manufacturingDate ? new Date(manufacturingDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      batchName, fssaiCode
    }
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
