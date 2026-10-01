import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';
import {
  GENERIC_IMAGE_KEY, MAX_IMAGE_BYTES, validateJfif,
  uploadProductImage, deleteProductImage, signedImageUrl,
} from '../r2.js';

const router = Router();

// prisma.js omits these Product fields from every query by default; this file
// opts back in because it filters them per role in serializeProduct().
const PRIVATE_FIELDS = { description: false, imageKey: false };

// ---- Product images (Cloudflare R2, private bucket) ------------------------
// WHO CAN DO WHAT:
//   upload / replace / remove  -> DEALER only (POST / and PUT /:id are already
//                                 requireRole('DEALER'); the multipart body is
//                                 parsed only AFTER that check passes)
//   see the image (imageUrl)   -> the owning DEALER, and AGGREGATOR (via
//                                 GET /:id, the product-details API)
//   every other role           -> imageUrl is never returned, and the raw
//                                 imageKey column is stripped too.
// The multi-line `description` follows the same idea: owning DEALER (to edit)
// and AGGREGATOR on GET /:id only — never in lists, never for other roles.
// AGGREGATOR's image URLs are signed with the amrutpeth_aggregator token.
// Images are served as short-lived presigned URLs; the bucket itself is private.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
function imageUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `Image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller` : 'Invalid image upload';
    res.status(400).json({ error: msg });
  });
}

const MAX_DESCRIPTION_LENGTH = 2000;
// '' / whitespace -> null; line breaks inside the text are kept as-is.
function cleanDescription(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

// Strips imageKey and description from the payload, then adds back only what
// the caller's role may see. Use this for every product returned by this file.
//   owning DEALER      -> imageUrl + description (needs both to edit)
//   AGGREGATOR         -> imageUrl always; description ONLY when `detail` is
//                         true, i.e. from the product-detail route GET /:id
//   everyone else      -> neither
async function serializeProduct(product, user, { detail = false } = {}) {
  if (!product) return product;
  const { imageKey, description, ...rest } = product;
  const isOwnerDealer = user.role === 'DEALER' && product.dealerId === user.dealerId;
  const isAggregator = user.role === 'AGGREGATOR';
  if (isOwnerDealer || (isAggregator && detail)) rest.description = description;
  if (isOwnerDealer || isAggregator) {
    try {
      rest.imageUrl = await signedImageUrl(imageKey, user.role);
    } catch (err) {
      console.error('Could not sign image URL for product', product.id, err.message);
      rest.imageUrl = null; // never break the product payload because of storage
    }
  }
  return rest;
}

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
  } else if (req.user.role === 'AGGREGATOR') {
    // AGGREGATOR is not tied to any one dealer (see schema.prisma), so
    // there's no single dealer's catalog to scope this to — and letting it
    // fall through to the unfiltered `where` every other unlisted role
    // would hit (ADMIN/ORGANISATION) would leak every dealer's entire
    // catalog to it. It has no need for this route anyway: it only ever
    // needs a specific retailer's own stock, already served (with product
    // details included) by GET /inventory/retailer/:retailerId.
    where = { id: -1 };
  }
  const products = await prisma.product.findMany({ where, omit: PRIVATE_FIELDS, include: { category: true, supplier: true, dealer: true }, orderBy: { id: 'desc' } });
  res.json(await Promise.all(products.map((p) => serializeProduct(p, req.user))));
});

// GET /api/products/names?categoryId=X, POST, and PUT /:id — the shared
// vocabulary behind the product creation form's Name dropdown (see
// schema.prisma ProductName). Scoped to a category — the dropdown only
// makes sense once a category is picked, so GET requires categoryId and
// POST/PUT validate the category exists before touching a name under it.
// Registered here, ahead of GET/PUT/DELETE /:id below, because "names" is a
// single path segment just like an :id would be — Express would otherwise
// try to match it against /:id first and blow up on Number("names").
router.get('/names', authRequired, async (req, res) => {
  const categoryId = Number(req.query.categoryId);
  if (!categoryId) return res.status(400).json({ error: 'categoryId is required' });
  const names = await prisma.productName.findMany({ where: { categoryId }, orderBy: { name: 'asc' } });
  res.json(names);
});

router.post('/names', authRequired, requireRole('DEALER'), async (req, res) => {
  const categoryId = Number(req.body.categoryId);
  const trimmed = (req.body.name || '').trim();
  if (!categoryId) return res.status(400).json({ error: 'categoryId is required' });
  if (!trimmed) return res.status(400).json({ error: 'Name is required' });

  const category = await prisma.productCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only add names under your own categories' });
  }

  // upsert, not create — de-dupes case-for-case within this category (see
  // schema.prisma ProductName @@unique([categoryId, name])) and just
  // returns the existing row instead of erroring if someone else already
  // added this exact name a moment ago.
  const created = await prisma.productName.upsert({
    where: { categoryId_name: { categoryId, name: trimmed } },
    update: {},
    create: { categoryId, name: trimmed },
  });
  res.json(created);
});

// PUT /api/products/names/:id — rename an existing entry (the "!" button
// next to the Name dropdown in Products.jsx). This only changes the
// dropdown's vocabulary going forward — Product.name is a plain string
// snapshot, not a foreign key (see schema.prisma ProductName), so existing
// products already using the old spelling keep it until edited themselves.
router.put('/names/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const trimmed = (req.body.name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Name is required' });

  const existing = await prisma.productName.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const category = await prisma.productCategory.findUnique({ where: { id: existing.categoryId } });
  if (!category || category.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only edit names under your own categories' });
  }

  try {
    const updated = await prisma.productName.update({ where: { id }, data: { name: trimmed } });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `"${trimmed}" already exists in this category` });
    throw err;
  }
});

// Factory for a flat (non-category-scoped) lookup vocabulary: GET the list,
// POST to add (upsert-based, so a fast double-submit can't error out), PUT
// to rename an existing entry. Used for Unit and Brand below — identical
// shape, differing only in which Prisma model and which field holds the
// value. Same "not a foreign key on Product" relationship as ProductName
// above — renaming here doesn't touch existing products.
function flatLookupRoutes(path, prismaModel, valueField) {
  router.get(`/${path}`, authRequired, async (req, res) => {
    const rows = await prismaModel.findMany({ orderBy: { [valueField]: 'asc' } });
    res.json(rows);
  });

  router.post(`/${path}`, authRequired, requireRole('DEALER'), async (req, res) => {
    const trimmed = (req.body[valueField] || '').trim();
    if (!trimmed) return res.status(400).json({ error: `${valueField} is required` });
    const created = await prismaModel.upsert({
      where: { [valueField]: trimmed },
      update: {},
      create: { [valueField]: trimmed },
    });
    res.json(created);
  });

  router.put(`/${path}/:id`, authRequired, requireRole('DEALER'), async (req, res) => {
    const id = Number(req.params.id);
    const trimmed = (req.body[valueField] || '').trim();
    if (!trimmed) return res.status(400).json({ error: `${valueField} is required` });
    try {
      const updated = await prismaModel.update({ where: { id }, data: { [valueField]: trimmed } });
      res.json(updated);
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ error: `"${trimmed}" already exists` });
      if (err.code === 'P2025') return res.status(404).json({ error: 'Not found' });
      throw err;
    }
  });
}

// GET /api/products/flavours?categoryId=X, POST, and PUT /:id — same shape
// and same reasoning as /names above (see schema.prisma Flavour
// @@unique([categoryId, value])): a flavour is scoped to the category it
// was added under, not a single global list shared by every category (e.g.
// "Mango" under Beverages is a separate entry from "Mango" under Snacks).
// Registered ahead of GET/PUT/DELETE /:id below for the same Express
// path-matching reason as /names.
router.get('/flavours', authRequired, async (req, res) => {
  const categoryId = Number(req.query.categoryId);
  if (!categoryId) return res.status(400).json({ error: 'categoryId is required' });
  const flavours = await prisma.flavour.findMany({ where: { categoryId }, orderBy: { value: 'asc' } });
  res.json(flavours);
});

router.post('/flavours', authRequired, requireRole('DEALER'), async (req, res) => {
  const categoryId = Number(req.body.categoryId);
  const trimmed = (req.body.value || '').trim();
  if (!categoryId) return res.status(400).json({ error: 'categoryId is required' });
  if (!trimmed) return res.status(400).json({ error: 'Flavour is required' });

  const category = await prisma.productCategory.findUnique({ where: { id: categoryId } });
  if (!category || category.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only add flavours under your own categories' });
  }

  // upsert, not create — de-dupes case-for-case within this category (see
  // schema.prisma Flavour @@unique([categoryId, value])) and just returns
  // the existing row instead of erroring if someone else already added
  // this exact flavour a moment ago.
  const created = await prisma.flavour.upsert({
    where: { categoryId_value: { categoryId, value: trimmed } },
    update: {},
    create: { categoryId, value: trimmed },
  });
  res.json(created);
});

// PUT /api/products/flavours/:id — rename an existing entry (the "!"
// button next to the Flavour dropdown in Products.jsx). This only changes
// the dropdown's vocabulary going forward — Product.flavour is a plain
// string snapshot, not a foreign key (see schema.prisma Flavour), so
// existing products already using the old spelling keep it until edited
// themselves.
router.put('/flavours/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const trimmed = (req.body.value || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Flavour is required' });

  const existing = await prisma.flavour.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const category = await prisma.productCategory.findUnique({ where: { id: existing.categoryId } });
  if (!category || category.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only edit flavours under your own categories' });
  }

  try {
    const updated = await prisma.flavour.update({ where: { id }, data: { value: trimmed } });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: `"${trimmed}" already exists in this category` });
    throw err;
  }
});

// Unit/sizeWeight and Brand still have no category tie ("1kg", "Tata" can
// apply under more than one category), so they stay flat lists shared
// across every dealer, unlike ProductName/Flavour above.
flatLookupRoutes('units', prisma.unit, 'value');
flatLookupRoutes('brands', prisma.brand, 'value');

router.get('/:id', authRequired, async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, omit: PRIVATE_FIELDS, include: { category: true, supplier: true, dealer: true } });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(await serializeProduct(product, req.user, { detail: true }));
});

// Create product - DEALER only. Every product is automatically tagged with
// the creating dealer's own id (never taken from the client) — this is what
// scopes the product to that dealer for purchases and sales downstream.
// Every product belongs to exactly one supplier — to offer the same item from a
// different supplier, clone it (see the frontend's "Clone to another supplier").
// Pricing, MRP, dates, and batch name are NOT set here — they're captured per
// batch when the product is purchased (see purchases.js).
//
// supplier + category + name + sizeWeight + flavour + brand together
// identify one product — see schema.prisma Product @@unique. Checked here
// first for a clean error message; the schema constraint (caught below as
// P2002) is the real guarantee against a race between two
// near-simultaneous creates.
router.post('/', authRequired, requireRole('DEALER'), imageUpload, async (req, res) => {
  const { categoryId, supplierId, name, sizeWeight, flavour, brand, cgst, sgst, fssaiCode } = req.body;
  const description = cleanDescription(req.body.description);

  if (!supplierId) return res.status(400).json({ error: 'Supplier is required' });
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    return res.status(400).json({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
  }
  if (req.file) {
    const imageError = validateJfif(req.file);
    if (imageError) return res.status(400).json({ error: imageError });
  }

  const duplicate = await prisma.product.findFirst({
    where: {
      supplierId: Number(supplierId), categoryId: Number(categoryId), name, sizeWeight,
      flavour: flavour || null, brand: brand || null,
    },
  });
  if (duplicate) {
    return res.status(409).json({ error: 'A product with this supplier, category, name, size/weight, flavour, and brand already exists' });
  }

  // cgst/sgst default to the selected category's own rate (Products.jsx
  // pre-fills them from there, editable before submit) — falling back to
  // the category here too, in case the client omits them for any reason,
  // rather than silently landing on the schema's generic 2.5 default.
  const category = await prisma.productCategory.findUnique({ where: { id: Number(categoryId) } });
  if (!category) return res.status(400).json({ error: 'Category not found' });

  const barcode = generateBarcode();

  // No image supplied -> the shared placeholder "generic.jfif" in the bucket.
  let imageKey = GENERIC_IMAGE_KEY;
  if (req.file) imageKey = await uploadProductImage(req.user.dealerId, req.file.buffer);

  try {
    const product = await prisma.product.create({
      data: {
        categoryId: Number(categoryId), supplierId: Number(supplierId), dealerId: req.user.dealerId, name, sizeWeight,
        flavour: flavour || null, brand: brand || null,
        cgst: cgst !== undefined && cgst !== '' ? Number(cgst) : category.cgst,
        sgst: sgst !== undefined && sgst !== '' ? Number(sgst) : category.sgst,
        fssaiCode, barcode, imageKey, description,
      },
      omit: PRIVATE_FIELDS,
      include: { category: true, supplier: true, dealer: true }
    });
    res.json(await serializeProduct(product, req.user));
  } catch (err) {
    await deleteProductImage(imageKey); // don't leave an orphaned upload behind
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A product with this supplier, category, name, size/weight, flavour, and brand already exists' });
    }
    throw err;
  }
});

router.put('/:id', authRequired, requireRole('DEALER'), imageUpload, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findUnique({ where: { id }, omit: PRIVATE_FIELDS });
  if (!existing || existing.dealerId !== req.user.dealerId) return res.status(403).json({ error: 'You can only edit your own products' });
  const { categoryId, supplierId, name, sizeWeight, flavour, brand, cgst, sgst, fssaiCode } = req.body;
  const nextDescription = req.body.description !== undefined ? cleanDescription(req.body.description) : undefined;
  if (nextDescription && nextDescription.length > MAX_DESCRIPTION_LENGTH) {
    return res.status(400).json({ error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
  }
  if (req.file) {
    const imageError = validateJfif(req.file);
    if (imageError) return res.status(400).json({ error: imageError });
  }

  // Same duplicate check as POST, against the combination this edit would
  // leave the product with (falling back to its current values for
  // whichever fields weren't sent) — excluding itself, obviously.
  const nextSupplierId = supplierId !== undefined ? (supplierId ? Number(supplierId) : null) : existing.supplierId;
  const nextCategoryId = categoryId ? Number(categoryId) : existing.categoryId;
  const nextName = name !== undefined ? name : existing.name;
  const nextSizeWeight = sizeWeight !== undefined ? sizeWeight : existing.sizeWeight;
  const nextFlavour = flavour !== undefined ? (flavour || null) : existing.flavour;
  const nextBrand = brand !== undefined ? (brand || null) : existing.brand;
  const duplicate = await prisma.product.findFirst({
    where: {
      id: { not: id }, supplierId: nextSupplierId, categoryId: nextCategoryId, name: nextName, sizeWeight: nextSizeWeight,
      flavour: nextFlavour, brand: nextBrand,
    },
  });
  if (duplicate) {
    return res.status(409).json({ error: 'A product with this supplier, category, name, size/weight, flavour, and brand already exists' });
  }

  // New file replaces the image; removeImage=true reverts to the generic one;
  // otherwise the current image is left untouched.
  let imageKey; // undefined = don't change
  if (req.file) imageKey = await uploadProductImage(req.user.dealerId, req.file.buffer);
  else if (req.body.removeImage === 'true') imageKey = GENERIC_IMAGE_KEY;

  try {
    const product = await prisma.product.update({
      where: { id },
      data: {
        categoryId: categoryId ? Number(categoryId) : undefined,
        supplierId: supplierId !== undefined ? (supplierId ? Number(supplierId) : null) : undefined,
        name, sizeWeight,
        flavour: flavour !== undefined ? (flavour || null) : undefined,
        brand: brand !== undefined ? (brand || null) : undefined,
        cgst: cgst !== undefined && cgst !== '' ? Number(cgst) : undefined,
        sgst: sgst !== undefined && sgst !== '' ? Number(sgst) : undefined,
        fssaiCode,
        imageKey,
        description: nextDescription,
      },
      omit: PRIVATE_FIELDS,
      include: { category: true, supplier: true, dealer: true }
    });
    if (imageKey && imageKey !== existing.imageKey) await deleteProductImage(existing.imageKey);
    res.json(await serializeProduct(product, req.user));
  } catch (err) {
    if (req.file && imageKey) await deleteProductImage(imageKey);
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A product with this supplier, category, name, size/weight, flavour, and brand already exists' });
    }
    throw err;
  }
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

  const { imageKey, description, ...productPublic } = product; // belt and braces: prisma.js already omits these; never exposed on the POS lookup
  res.json({
    ...productPublic,
    sellingPrice: latestItem.sellingPrice,
    retailerSellingPrice: latestItem.retailerSellingPrice,
    mrp: latestItem.mrp,
    discount: latestItem.discount,
  });
});

router.delete('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.product.findUnique({ where: { id }, omit: PRIVATE_FIELDS });
  if (!existing || existing.dealerId !== req.user.dealerId) return res.status(403).json({ error: 'You can only delete your own products' });
  await prisma.product.delete({ where: { id } });
  await deleteProductImage(existing.imageKey);
  res.json({ ok: true });
});

export default router;
