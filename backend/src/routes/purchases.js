import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';
import { generatePurchaseOrderPdf } from '../lib/purchaseOrderPdf.js';

const router = Router();

// A DEALER buying from a supplier still enters full batch detail up front.
// A RETAILER buying from their own dealer only ever picks a product and a
// quantity — see Purchases.jsx and the PurchaseItem schema comment for why.
function fullItemFieldsError(items) {
  for (const i of items) {
    if (!i.rate || !i.dealerCommission || !i.sellingPrice || !i.mrp || i.discount === undefined || i.discount === '' || !i.retailerSellingPrice || !i.manufacturingDate || !i.expiryDate || !i.batchName) {
      return 'Cost price, dealer commission, selling price, MRP, discount %, retailer selling price, dates, and batch name are required for every item';
    }
  }
  return null;
}
function minimalItemFieldsError(items) {
  for (const i of items) {
    if (!i.productId) return 'Product is required for every item';
    if (!i.quantity || Number(i.quantity) <= 0) return 'Quantity must be greater than zero for every item';
  }
  return null;
}

// Validation + recompute for PATCH /:id/prices below — mirrors the same
// formulas Purchases.jsx uses client-side (computeSellingPrice /
// computeRetailerPrice), so a correction here always lands on the same
// numbers the dealer would see on screen while entering it.
function priceEditFieldsError(items) {
  for (const i of items) {
    if (i.rate === undefined || i.rate === '' || Number(i.rate) <= 0) return 'Cost price is required and must be greater than zero for every item';
    if (i.dealerCommission === undefined || i.dealerCommission === '' || Number(i.dealerCommission) < 0) return 'Dealer commission is required for every item';
    if (i.mrp === undefined || i.mrp === '' || Number(i.mrp) <= 0) return 'MRP is required and must be greater than zero for every item';
    if (i.discount === undefined || i.discount === '' || Number(i.discount) < 0) return 'Discount % is required for every item';
  }
  return null;
}
function computeSellingPrice(rate, dealerCommission) {
  return Number((Number(rate) + (Number(dealerCommission) * Number(rate)) / 100).toFixed(1));
}
function computeRetailerPrice(mrp, discount) {
  return Number((Number(mrp) - (Number(discount) * Number(mrp)) / 100).toFixed(2));
}
// Same PAID / PARTIALLY_PAID / OPEN determination vouchers.js POST
// /:id/payments already uses, applied here after a price correction
// changes a voucher's amount out from under however much has already
// been paid against it.
function voucherStatusFor(amount, alreadyPaid) {
  if (alreadyPaid <= 0) return 'OPEN';
  return alreadyPaid >= amount ? 'PAID' : 'PARTIALLY_PAID';
}

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
  // — a RETAILER's items only ever have productId + quantity; see the
  // fullItemFieldsError/minimalItemFieldsError helpers above.

  if (!items || !items.length) return res.status(400).json({ error: 'No items in purchase' });
  const itemsError = scope.ownerType === 'RETAILER' ? minimalItemFieldsError(items) : fullItemFieldsError(items);
  if (itemsError) return res.status(400).json({ error: itemsError });

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
        create: items.map(i => scope.ownerType === 'RETAILER'
          ? { productId: Number(i.productId), quantity: Number(i.quantity), originalQuantity: Number(i.quantity) }
          : {
              productId: Number(i.productId),
              quantity: Number(i.quantity),
              originalQuantity: Number(i.quantity),
              rate: i.rate,
              dealerCommission: i.dealerCommission,
              sellingPrice: i.sellingPrice,
              discount: i.discount || 0,
              mrp: i.mrp,
              retailerSellingPrice: i.retailerSellingPrice,
              manufacturingDate: new Date(i.manufacturingDate),
              expiryDate: new Date(i.expiryDate),
              batchName: i.batchName,
            })
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
// This also re-baselines originalQuantity to match (a full resubmission is
// treated as redeclaring the order) — for a quantity-only tweak that should
// NOT move the baseline, use PATCH /:id/quantities instead.
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
  const itemsError = scope.ownerType === 'RETAILER' ? minimalItemFieldsError(items) : fullItemFieldsError(items);
  if (itemsError) return res.status(400).json({ error: itemsError });

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
          create: items.map(i => scope.ownerType === 'RETAILER'
            ? { productId: Number(i.productId), quantity: Number(i.quantity), originalQuantity: Number(i.quantity) }
            : {
                productId: Number(i.productId),
                quantity: Number(i.quantity),
                originalQuantity: Number(i.quantity),
                rate: i.rate,
                dealerCommission: i.dealerCommission,
                sellingPrice: i.sellingPrice,
                discount: i.discount || 0,
                mrp: i.mrp,
                retailerSellingPrice: i.retailerSellingPrice,
                manufacturingDate: new Date(i.manufacturingDate),
                expiryDate: new Date(i.expiryDate),
                batchName: i.batchName,
              })
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
// resubmitting the whole item form via PUT. Deliberately leaves
// originalQuantity untouched — that's the baseline the UI compares
// `quantity` against to flag a line that's drifted from what was first
// asked for (see Purchases.jsx / Sales.jsx).
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
  // DEALER purchases (from a supplier) move straight to CONFIRMED once
  // reviewed. RETAILER purchases (from their own dealer) fork instead:
  // once reviewed, the retailer places the order (ORDERED) and it's then
  // out of their hands until the dealer dispatches it (IN_TRANSIT — see
  // sales.js PATCH /:id/dispatch, which is the only route allowed to make
  // that transition, since it also requires picking a batch per item).
  // Only once it's IN_TRANSIT can the retailer confirm RECEIVED.
  const nextStatusByRole = {
    DEALER: { PENDING: 'IN_REVIEW', IN_REVIEW: 'CONFIRMED' },
    RETAILER: { PENDING: 'IN_REVIEW', IN_REVIEW: 'ORDERED', IN_TRANSIT: 'RECEIVED' },
  };
  const expectedNext = nextStatusByRole[scope.ownerType]?.[currentStatus];
  if (!expectedNext || expectedNext !== status) {
    return res.status(400).json({ error: `Cannot move purchase from ${currentStatus} to ${status}` });
  }

  // Placing the order (RETAILER, IN_REVIEW -> ORDERED) creates a mirror
  // Sale row on the source dealer's side, in IN_PENDING status, so the
  // order shows up in that dealer's own Sales screen to be fulfilled.
  // Each SaleItem is linked back to the PurchaseItem it came from via
  // purchaseItemId, so sales.js PATCH /:id/dispatch can backfill pricing
  // onto the right line even if this purchase has two lines for the same
  // product.
  if (scope.ownerType === 'RETAILER' && status === 'ORDERED') {
    const linkedSale = await prisma.sale.create({
      data: {
        ownerType: 'DEALER',
        dealerId: existing.sourceDealerId,
        customerType: 'RETAILER',
        customerRetailerId: existing.retailerId,
        status: 'IN_PENDING',
        items: {
          create: existing.items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            originalQuantity: i.originalQuantity,
            purchaseItemId: i.id,
          }))
        }
      }
    });
    await prisma.purchase.update({ where: { id }, data: { linkedSaleId: linkedSale.id } });
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
      // Keyed on batchName too — each batch gets its own Inventory row with
      // its own quantity and its own pricing, so a seller can later choose
      // which batch to sell from (see sales.js). If the exact same batch
      // name is received again (re-receiving the same lot), its quantity is
      // topped up rather than creating a duplicate row.
      const invWhere = {
        productId_ownerType_dealerId_retailerId_batchName: {
          productId: i.productId,
          ownerType: scope.ownerType,
          dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
          retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
          batchName: i.batchName,
        }
      };

      const priceFields = {
        rate: i.rate,
        dealerCommission: i.dealerCommission,
        sellingPrice: i.sellingPrice,
        discount: i.discount,
        mrp: i.mrp,
        retailerSellingPrice: i.retailerSellingPrice,
        manufacturingDate: i.manufacturingDate,
        expiryDate: i.expiryDate,
        // Only ever populated on a RETAILER's PurchaseItem (backfilled at
        // dispatch time — see sales.js PATCH /:id/dispatch and
        // schema.prisma PurchaseItem.originDealerRate). Carrying it through
        // to Inventory here is the last hop in the chain that lets
        // soldProducts.js raise a dealer-owed-to-supplier settlement once
        // this retailer resells the batch. Always undefined/null for a
        // dealer's own purchase from a supplier.
        originDealerRate: i.originDealerRate,
      };

      const existingInv = await prisma.inventory.findUnique({ where: invWhere }).catch(() => null);
      if (existingInv) {
        await prisma.inventory.update({
          where: invWhere,
          data: { quantity: { increment: i.quantity }, ...priceFields }
        });
      } else {
        await prisma.inventory.create({
          data: {
            productId: i.productId,
            ownerType: scope.ownerType,
            dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
            retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
            batchName: i.batchName,
            quantity: i.quantity,
            reorderLevel: 10,
            ...priceFields
          }
        });
      }
    }
  }

  // A dealer's purchase from a supplier is the mirror of a supplier "selling"
  // to the dealer — auto-raise a payable voucher for the supplier, the same
  // way a dealer -> retailer sale auto-raises a receivable voucher (see
  // sales.js). It's created OPEN just like that one — nothing is assumed
  // paid at receipt time; the dealer settles it afterwards via
  // POST /vouchers/:id/payments (see payments.js/vouchers.js), which moves
  // it to PARTIALLY_PAID or PAID depending on how much has been paid in so
  // far. Fires exactly once, on the same CONFIRMED transition that credits
  // inventory above (see the isTerminal comment — this path can't be
  // re-entered for the same purchase).
  if (scope.ownerType === 'DEALER' && status === 'CONFIRMED') {
    const totalAmount = purchase.items.reduce((sum, i) => sum + Number(i.rate) * i.quantity, 0);
    await prisma.voucher.create({
      data: {
        type: 'PAYABLE',
        dealerId: scope.dealerId,
        supplierId: purchase.supplierId,
        purchaseId: id,
        amount: totalAmount,
        description: `Auto-voucher for Purchase #${id}`,
      }
    });
  }

  res.json(purchase);
});

// PATCH /api/purchases/:id/prices — DEALER only. Corrects Cost Price,
// Dealer Commission, MRP, and Discount % on one or more items of an
// already-CONFIRMED purchase (a mistake caught after the fact, not the
// pre-confirmation edit PUT /:id already covers). sellingPrice and
// retailerSellingPrice are always recalculated here from the corrected
// values, never trusted from the client — same formulas Purchases.jsx uses
// on screen (see computeSellingPrice/computeRetailerPrice above).
//
// Cascades everywhere this batch's pricing already flowed to:
//   1. This purchase's own PurchaseItem rows.
//   2. This dealer's own Inventory row for that exact batch (quantity is
//      untouched — see PATCH /:id/quantities for that axis instead).
//   3. This purchase's PAYABLE voucher (Purchase.payableVoucher) — amount
//      recomputed from the corrected rate across the whole purchase, status
//      re-derived against whatever's already been paid against it. If no
//      voucher exists yet (a legacy purchase, or one that never got one),
//      it's raised now instead of being left without one.
//   4. Every SaleItem this dealer has already sold from that exact batch
//      (productId + batchName) — CASH sales and RETAILER sales alike —
//      re-snapshotted with the corrected rate/sellingPrice/price/mrp/
//      discount, and the parent Sale's totalAmount recomputed.
//   5. For a RETAILER-sale line, the downstream retailer's own PurchaseItem
//      (linked via SaleItem.purchaseItemId) gets the same backfill dispatch
//      would have written, and — if that retailer has already marked the
//      purchase RECEIVED — their own Inventory row for the batch too.
//   6. That sale's own RECEIVABLE voucher (Sale.receivableVoucher), amount
//      and status recomputed the same way as the payable voucher above —
//      and raised now if it's missing, same reasoning, but never for a
//      CASH sale (which never has one).
//   7. The purchase itself moves to MODIFIED (from CONFIRMED, or staying
//      MODIFIED on a second correction) — see PurchaseStatus in
//      schema.prisma — so it's visibly distinct from an untouched
//      CONFIRMED purchase. Can be re-run on an already-MODIFIED purchase.
//
// Deliberately does NOT reach further than a retailer's own Inventory —
// any SoldProduct settlement a retailer has already raised (or paid) by
// reselling this stock to their own customers is left alone. Those are a
// periodic, independent settlement (see schema.prisma SoldProduct) and
// retroactively rewriting an obligation that may already be
// TO_BE_CONFIRMED or PAID would silently disagree with money already in
// motion — a correction that deep needs a human to reconcile it, not this
// endpoint.
router.patch('/:id/prices', authRequired, requireRole('DEALER'), async (req, res) => {
  try {
    const scope = ownerScope(req);
    const id = Number(req.params.id);
    const { items } = req.body; // [{ id: purchaseItemId, rate, dealerCommission, mrp, discount }]

    const purchase = await prisma.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
    if (purchase.ownerType !== 'DEALER' || purchase.dealerId !== scope.dealerId) {
      return res.status(403).json({ error: 'You can only edit your own purchases' });
    }
    if (purchase.status !== 'CONFIRMED' && purchase.status !== 'MODIFIED') {
      return res.status(400).json({ error: 'Only a confirmed purchase can have its pricing corrected — use the regular edit form before then' });
    }

    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items to update' });
    const itemsError = priceEditFieldsError(items);
    if (itemsError) return res.status(400).json({ error: itemsError });

    const itemById = new Map(purchase.items.map((i) => [i.id, i]));
    for (const i of items) {
      if (!itemById.has(Number(i.id))) return res.status(400).json({ error: 'Item does not belong to this purchase' });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1 & 2. Update each corrected PurchaseItem and its Inventory row.
      const correctedById = new Map();
      for (const i of items) {
        const existingItem = itemById.get(Number(i.id));
        const rate = Number(i.rate);
        const dealerCommission = Number(i.dealerCommission);
        const mrp = Number(i.mrp);
        const discount = Number(i.discount);
        const sellingPrice = computeSellingPrice(rate, dealerCommission);
        const retailerSellingPrice = computeRetailerPrice(mrp, discount);
        correctedById.set(existingItem.id, { rate, dealerCommission, mrp, discount, sellingPrice, retailerSellingPrice, batchName: existingItem.batchName, productId: existingItem.productId });

        await tx.purchaseItem.update({
          where: { id: existingItem.id },
          data: { rate, dealerCommission, mrp, discount, sellingPrice, retailerSellingPrice }
        });

        await tx.inventory.updateMany({
          where: {
            productId: existingItem.productId,
            ownerType: 'DEALER',
            dealerId: scope.dealerId,
            retailerId: null,
            batchName: existingItem.batchName,
          },
          data: { rate, dealerCommission, sellingPrice, discount, mrp, retailerSellingPrice }
        });
      }

      // 3. Recompute this purchase's own PAYABLE voucher from ALL of its
      // items (not just the ones just edited), since a partial correction
      // still changes the purchase's total. If no voucher exists yet —
      // either a legacy purchase from before Voucher.purchaseId existed, or
      // one that for whatever reason never got its CONFIRMED-time voucher —
      // treat this correction the same as that original CONFIRMED
      // transition would have and raise it now, rather than silently
      // leaving the purchase with no payable voucher at all.
      const allItems = await tx.purchaseItem.findMany({ where: { purchaseId: id } });
      const newAmount = allItems.reduce((sum, i) => sum + Number(i.rate) * i.quantity, 0);
      const voucher = await tx.voucher.findUnique({ where: { purchaseId: id }, include: { payments: true } });
      if (voucher) {
        const alreadyPaid = voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0);
        await tx.voucher.update({
          where: { id: voucher.id },
          data: { amount: newAmount, status: voucherStatusFor(newAmount, alreadyPaid) }
        });
      } else {
        await tx.voucher.create({
          data: {
            type: 'PAYABLE',
            dealerId: scope.dealerId,
            supplierId: purchase.supplierId,
            purchaseId: id,
            amount: newAmount,
            description: `Auto-voucher for Purchase #${id} (raised at price correction — none existed)`,
          }
        });
      }

      // 4 & 5 & 6. Cascade into every dealer -> retailer sale already
      // fulfilled from one of the corrected batches.
      const affectedSaleIds = new Set();
      for (const corrected of correctedById.values()) {
        if (!corrected.batchName) continue; // no batch, nothing could have been sold from it yet

        const saleItems = await tx.saleItem.findMany({
          where: {
            productId: corrected.productId,
            batchName: corrected.batchName,
            sale: { ownerType: 'DEALER', dealerId: scope.dealerId },
          },
          include: { sale: true },
        });

        for (const saleItem of saleItems) {
          const isRetailerSale = saleItem.sale.customerType === 'RETAILER';
          const newPrice = isRetailerSale ? corrected.sellingPrice : corrected.retailerSellingPrice;

          await tx.saleItem.update({
            where: { id: saleItem.id },
            data: {
              price: newPrice,
              mrp: corrected.mrp,
              discount: corrected.discount,
              rate: corrected.rate,
              sellingPrice: corrected.sellingPrice,
            }
          });
          affectedSaleIds.add(saleItem.sale.id);

          // 5. Backfill the downstream retailer's own PurchaseItem exactly
          // like dispatch would have, if this line came from a retailer's
          // placed order.
          if (saleItem.purchaseItemId) {
            await tx.purchaseItem.update({
              where: { id: saleItem.purchaseItemId },
              data: {
                rate: corrected.sellingPrice,
                dealerCommission: 0,
                sellingPrice: corrected.sellingPrice,
                discount: corrected.discount,
                mrp: corrected.mrp,
                retailerSellingPrice: corrected.retailerSellingPrice,
                originDealerRate: corrected.rate,
              }
            });

            // If that retailer already marked the purchase RECEIVED, their
            // own Inventory batch is already credited from this line —
            // correct it too.
            const retailerPurchaseItem = await tx.purchaseItem.findUnique({
              where: { id: saleItem.purchaseItemId },
              include: { purchase: true }
            });
            if (retailerPurchaseItem?.purchase?.status === 'RECEIVED') {
              await tx.inventory.updateMany({
                where: {
                  productId: corrected.productId,
                  ownerType: 'RETAILER',
                  dealerId: null,
                  retailerId: retailerPurchaseItem.purchase.retailerId,
                  batchName: corrected.batchName,
                },
                data: {
                  rate: corrected.sellingPrice,
                  dealerCommission: 0,
                  sellingPrice: corrected.sellingPrice,
                  discount: corrected.discount,
                  mrp: corrected.mrp,
                  retailerSellingPrice: corrected.retailerSellingPrice,
                  originDealerRate: corrected.rate,
                }
              });
            }
          }
        }
      }

      // 6. Recompute totalAmount and the RECEIVABLE voucher for every
      // affected sale, from that sale's own full (post-update) item list —
      // a sale can carry lines from more than one batch, only some of
      // which this correction touched.
      for (const saleId of affectedSaleIds) {
        const freshItems = await tx.saleItem.findMany({ where: { saleId } });
        const newTotal = freshItems.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);
        const affectedSale = await tx.sale.update({ where: { id: saleId }, data: { totalAmount: newTotal } });

        const saleVoucher = await tx.voucher.findUnique({ where: { saleId }, include: { payments: true } });
        if (saleVoucher) {
          const alreadyPaid = saleVoucher.payments.reduce((sum, p) => sum + Number(p.amount), 0);
          await tx.voucher.update({
            where: { id: saleVoucher.id },
            data: { amount: newTotal, status: voucherStatusFor(newTotal, alreadyPaid) }
          });
        } else if (affectedSale.customerType === 'RETAILER' && affectedSale.customerRetailerId) {
          // Same reasoning as the payable voucher above — a legacy sale
          // from before Voucher.saleId existed, or one that otherwise never
          // got its RECEIVABLE voucher, gets it raised now rather than
          // being left with none. Never applies to a CASH sale, which
          // never has a voucher at all.
          await tx.voucher.create({
            data: {
              dealerId: scope.dealerId,
              retailerId: affectedSale.customerRetailerId,
              saleId,
              amount: newTotal,
              description: `Auto-voucher for Sale #${saleId} (raised at price correction — none existed)`,
            }
          });
        }
      }

      // Flag the purchase itself as MODIFIED — everything above (inventory,
      // vouchers, downstream sales) has already been brought in line with
      // the correction; this just makes the correction visible on the
      // purchase's own record, distinct from an untouched CONFIRMED one.
      await tx.purchase.update({ where: { id }, data: { status: 'MODIFIED' } });

      return { affectedSaleCount: affectedSaleIds.size };
    });

    const updated = await prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }
    });

    res.json({ ...updated, affectedSaleCount: result.affectedSaleCount });
  } catch (err) {
    console.error('purchase price correction failed:', err);
    res.status(500).json({ error: 'Failed to update pricing', detail: err.message });
  }
});

// GET /api/purchases/:id/bill — printable A4 Purchase Order PDF, same
// naming convention as GET /sales/:id/bill even though this one renders a
// "PURCHASE ORDER" (see purchaseOrderPdf.js). Available for both a
// DEALER's own purchase (header: dealer + supplier) and a RETAILER's own
// purchase (header: retailer + dealer) — same document either way, just a
// different pair of parties. No status restriction: both sides can print
// at any stage (PENDING through CONFIRMED/RECEIVED/MODIFIED) purely to
// review what's on the order as it stands, not just once it's final.
router.get('/:id/bill', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  try {
    const scope = ownerScope(req);
    const id = Number(req.params.id);
    const purchase = await prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { product: true } }, supplier: true, sourceDealer: true }
    });
    if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

    let party;
    let counterpartyName;
    if (scope.ownerType === 'DEALER') {
      if (purchase.ownerType !== 'DEALER' || purchase.dealerId !== scope.dealerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      party = await prisma.dealer.findUnique({ where: { id: scope.dealerId } });
      counterpartyName = purchase.supplier?.name;
    } else {
      if (purchase.ownerType !== 'RETAILER' || purchase.retailerId !== scope.retailerId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      party = await prisma.retailer.findUnique({ where: { id: scope.retailerId } });
      counterpartyName = purchase.sourceDealer?.name;
    }

    const pdfBuffer = await generatePurchaseOrderPdf(purchase, party, counterpartyName);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="purchase-order-${purchase.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('purchase order PDF generation failed:', err);
    res.status(500).json({ error: 'Failed to generate purchase order', detail: err.message });
  }
});

export default router;