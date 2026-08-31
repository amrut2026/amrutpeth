import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope } from '../middleware/auth.js';
import { adjustVouchersFifo } from './vouchers.js';

const router = Router();

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD'];

// Every SoldProduct row this scope is allowed to see/settle.
//  - RETAILER: their own "owedBy: RETAILER" rows (what they owe their own
//    dealer for cash sales) — unchanged.
//  - DEALER: two kinds, combined. Their own "owedBy: DEALER, dealerId: null"
//    rows (what they owe their own supplier for their own cash sales,
//    unchanged) PLUS "owedBy: DEALER, dealerId: <this dealer>" rows — units
//    originally dispatched from this dealer's own inventory that a RETAILER
//    then resold for cash. The second kind rides on the retailer's own
//    Sale (a dealer never has a Sale of their own for it), so it's matched
//    on SoldProduct.dealerId directly rather than via the Sale relation.
//    See schema.prisma SoldProduct.owedBy/dealerId.
function scopedWhere(scope, extra = {}) {
  if (scope.ownerType === 'DEALER') {
    return {
      ...extra,
      OR: [
        { owedBy: 'DEALER', dealerId: null, sale: { ownerType: 'DEALER', dealerId: scope.dealerId } },
        { owedBy: 'DEALER', dealerId: scope.dealerId },
      ],
    };
  }
  return {
    ...extra,
    owedBy: 'RETAILER',
    sale: { ownerType: 'RETAILER', retailerId: scope.retailerId },
  };
}

// Same as scopedWhere's DEALER branch, PLUS every one of this dealer's
// retailers' own owedBy: RETAILER rows — what they owe THIS dealer for
// their own cash sales, in any status (OPEN and PAID included, not just
// TO_BE_CONFIRMED as before). Used only by GET / below, for visibility —
// NOT by POST /pay, which must keep using scopedWhere: a dealer can view a
// retailer's row here, but can never settle it, only the retailer can (and
// this dealer can only confirm it once submitted, via PATCH
// /pay/:paymentId/confirm below).
function dealerViewWhere(scope, extra = {}) {
  const own = scopedWhere(scope, {}).OR;
  return {
    ...extra,
    OR: [
      ...own,
      { owedBy: 'RETAILER', sale: { ownerType: 'RETAILER', retailer: { primaryDealerId: scope.dealerId } } },
    ],
  };
}

// What's owed upstream is settled off a snapshot on the SaleItem, never the
// sale's own price (what the walk-in customer was charged) — see
// schema.prisma SaleItem.rate/sellingPrice/originDealerRate.
//  - A row with dealerId set is the "sold by a retailer" row: the
//    ORIGINATING dealer owes their own supplier the batch's originDealerRate.
//  - Otherwise keyed off the row's own owedBy (NOT the viewing scope — a
//    dealer's list now also includes their retailers' owedBy: RETAILER
//    rows for visibility, see dealerViewWhere below, so scope and owedBy
//    can differ): a DEALER-owed row owes the batch's rate, a RETAILER-owed
//    row owes the batch's sellingPrice.
function settlementPrice(row) {
  if (row.dealerId != null) return row.saleItem.originDealerRate;
  return row.owedBy === 'DEALER' ? row.saleItem.rate : row.saleItem.sellingPrice;
}

// GET /api/sold-products?status=OPEN|TO_BE_CONFIRMED|PAID — the logged-in
// dealer's or retailer's own SoldProduct rows (one or two per CASH-sale
// line item, see schema.prisma SoldProduct). batchName and quantity come
// from the linked SaleItem, never duplicated on this table, so they can't
// drift. price is the settlement price owed upstream — see
// settlementPrice() above, not SaleItem.price itself.
router.get('/', authRequired, async (req, res) => {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts have sold products' });

  const status = ['OPEN', 'TO_BE_CONFIRMED', 'PAID'].includes(req.query.status) ? req.query.status : undefined;

  // A DEALER's view includes their retailers' owedBy: RETAILER rows too
  // (what those retailers owe THIS dealer), not just their own — for
  // visibility only, see dealerViewWhere above. A RETAILER only ever has
  // their own rows, so scopedWhere alone is still right for them.
  const where = scope.ownerType === 'DEALER' ? dealerViewWhere(scope, { status }) : scopedWhere(scope, { status });

  const rows = await prisma.soldProduct.findMany({
    where,
    include: { product: { include: { supplier: true } }, saleItem: true, sale: { include: { retailer: true } } },
    orderBy: { createdAt: 'desc' },
  });

  // A "sold by retailer" row (dealerId set) is this dealer's own debt to
  // THEIR OWN supplier for stock a retailer resold. Until now it showed up
  // as OPEN ("payable to supplier") as soon as it existed — which double-
  // counts it against the sibling owedBy: RETAILER row for the same line
  // item (shown separately as "Owed to you by retailer, not yet paid"):
  // the same sale was appearing as owed money in both directions at once.
  // It should only become payable to the supplier once the retailer has
  // actually paid THIS dealer for it. So for every OPEN dealerId row, look
  // up its sibling — the owedBy: RETAILER SoldProduct on the same
  // saleItemId — and only keep the dealerId row if that sibling is PAID.
  // A PAID dealerId row (already settled to the supplier) is left alone
  // either way; it's history, not a pending item.
  let retailerStatusBySaleItemId = new Map();
  if (scope.ownerType === 'DEALER') {
    const pendingSaleItemIds = rows
      .filter((r) => r.dealerId != null && r.status === 'OPEN')
      .map((r) => r.saleItemId);
    if (pendingSaleItemIds.length) {
      const siblings = await prisma.soldProduct.findMany({
        where: { saleItemId: { in: pendingSaleItemIds }, owedBy: 'RETAILER' },
        select: { saleItemId: true, status: true },
      });
      retailerStatusBySaleItemId = new Map(siblings.map((s) => [s.saleItemId, s.status]));
    }
  }

  const visibleRows = rows.filter((r) => {
    if (r.dealerId == null || r.status !== 'OPEN') return true;
    return retailerStatusBySaleItemId.get(r.saleItemId) === 'PAID';
  });

  res.json(visibleRows.map((r) => {
    const price = settlementPrice(r);
    return {
      id: r.id,
      saleId: r.saleId,
      date: r.sale.date,
      productId: r.productId,
      productName: r.product.name,
      // Same sizeWeight/flavour/brand shown under the product name on the
      // Sales and Purchases screens — kept as separate fields (rather than
      // pre-joined into one string) so the frontend can lay them out the
      // same way it already does elsewhere.
      productSizeWeight: r.product.sizeWeight,
      productFlavour: r.product.flavour,
      productBrand: r.product.brand,
      // Which supplier this product traces back to — used to group a
      // DEALER's own list (a RETAILER only ever has one counterparty, their
      // primary dealer, so this is unused on that side).
      supplierId: r.product.supplierId,
      supplierName: r.product.supplier?.name || null,
      batchName: r.saleItem.batchName,
      quantity: r.saleItem.quantity,
      price,
      amount: price != null ? Number(price) * r.saleItem.quantity : 0,
      status: r.status,
      // Set once a payment has been submitted for this row (TO_BE_CONFIRMED
      // or PAID) — lets a DEALER group their TO_BE_CONFIRMED rows by the
      // single retailer payment that raised them, so one "Confirm" action
      // (PATCH /pay/:paymentId/confirm) can settle the whole batch.
      paymentId: r.paymentId,
      // Who made the sale — present whenever the underlying Sale belongs to
      // a retailer, which covers both an owedBy: RETAILER row (a dealer
      // confirming a payment wants to know which retailer it came from)
      // AND a "sold by retailer" owedBy: DEALER row (dealerId set — the
      // retailer resold this dealer's stock, but it's still this dealer's
      // own obligation to their supplier). A dealer's own direct cash sale
      // has no retailer on its Sale at all, so this stays null there. Not
      // the same as `remark` below, which only marks the separate
      // dealer-owed-to-supplier row.
      retailerId: r.sale.retailerId ?? null,
      retailerName: r.sale.retailer?.name || null,
      // Only present on a "sold by retailer" row (see above) — the
      // originating dealer's own reference, so it's clear in their list
      // this wasn't a sale they made directly themselves.
      remark: r.dealerId != null ? `Sold by retailer ${r.sale.retailer?.name || r.sale.retailerId}` : null,
      // Same "sold by retailer" condition as remark above, as an explicit
      // boolean — lets the frontend split a DEALER's own payable rows into
      // "sold by your retailers" (dealerId set) vs "your own direct cash
      // sales" (dealerId null) without parsing remark's text.
      soldByRetailer: r.dealerId != null,
      // True when this row is the viewer's own obligation (so it's
      // selectable/payable by them via POST /pay below); false for a
      // retailer-owed row shown to a DEALER purely for visibility — see
      // dealerViewWhere above. Always true for a RETAILER, who never sees
      // anyone else's rows.
      payableByMe: r.owedBy === scope.ownerType,
    };
  }));
});

// GET /api/sold-products/counterparties — DEALER only. The suppliers
// they've purchased from (same derivation as GET /reports/purchases), so
// the "pay" form can offer a dropdown of who to pay. A RETAILER doesn't
// need this — they only ever pay their one primary dealer, resolved
// server-side in POST /pay below.
router.get('/counterparties', authRequired, async (req, res) => {
  if (req.user.role !== 'DEALER') return res.json([]);
  const purchases = await prisma.purchase.findMany({
    where: { ownerType: 'DEALER', dealerId: req.user.dealerId },
    include: { supplier: true },
  });
  const map = new Map();
  for (const p of purchases) if (p.supplier) map.set(p.supplier.id, p.supplier.name);
  res.json([...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
});

// POST /api/sold-products/pay — settle a batch of the caller's own OPEN
// SoldProduct rows in one go.
// Body (RETAILER): { soldProductIds, mode, reference }
//   -> pays the retailer's own primary dealer. Marks the rows
//      TO_BE_CONFIRMED, not PAID — mirrors the Receipt flow, the dealer
//      must confirm the money actually arrived (PATCH
//      /pay/:paymentId/confirm below) before it's considered settled.
// Body (DEALER):    { soldProductIds, supplierId, mode, reference, adjustVouchers }
//   -> pays the chosen supplier. Selected rows may be a mix of the dealer's
//      own cash sales and units a retailer resold on their behalf — both
//      settle against the same chosen supplier in one Payment. No
//      confirmation step — marked PAID immediately, same as a PAYABLE
//      Voucher.
//      adjustVouchers (DEALER only, optional, defaults false): when true,
//      this same payment amount is also applied — FIFO, oldest date
//      first — against this dealer's own OPEN/PARTIALLY_PAID PAYABLE
//      vouchers for the chosen supplier (see vouchers.js
//      adjustVouchersFifo). The frontend only sends this after the user
//      explicitly confirms it via the pop-up shown when GET
//      /vouchers/outstanding finds any such vouchers — this route itself
//      doesn't check for their existence, it just applies whatever's
//      asked for.
// Creates one Payment for the total (never trusted from the client — always
// recomputed here from each row's settlementPrice * quantity), then links
// every selected row back to that Payment.
router.post('/pay', authRequired, async (req, res) => {
  try {
    const scope = ownerScope(req);
    if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can pay for sold products' });

    const { soldProductIds, mode, reference, adjustVouchers } = req.body;
    if (!Array.isArray(soldProductIds) || !soldProductIds.length) {
      return res.status(400).json({ error: 'No sold products selected' });
    }
    if (!PAYMENT_MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of ${PAYMENT_MODES.join(', ')}` });
    }

    let dealerId;
    let retailerId = null;
    let supplierId = null;

    if (scope.ownerType === 'RETAILER') {
      const retailer = await prisma.retailer.findUnique({ where: { id: scope.retailerId } });
      if (!retailer) return res.status(404).json({ error: 'Retailer not found' });
      dealerId = retailer.primaryDealerId;
      retailerId = scope.retailerId;
    } else {
      if (!req.body.supplierId) return res.status(400).json({ error: 'supplierId is required' });
      supplierId = Number(req.body.supplierId);
      dealerId = scope.dealerId;
    }

    const ids = soldProductIds.map(Number);
    const rows = await prisma.soldProduct.findMany({
      where: scopedWhere(scope, { id: { in: ids }, status: 'OPEN' }),
      include: { saleItem: true, product: true },
    });

    if (rows.length !== ids.length) {
      return res.status(400).json({ error: 'One or more selected items are not open, or do not belong to you' });
    }
    if (scope.ownerType === 'DEALER' && rows.some((r) => r.product.supplierId !== supplierId)) {
      return res.status(400).json({ error: 'All selected items must belong to the chosen supplier' });
    }
    if (rows.some((r) => settlementPrice(r) == null)) {
      return res.status(400).json({ error: 'One or more selected items has no price yet' });
    }
    // Mirror the GET / visibility rule above: a DEALER can't pay their
    // supplier for a "sold by retailer" row (dealerId set) until the
    // retailer has actually paid THIS dealer for it — otherwise the two
    // legs settle out of order. scopedWhere alone doesn't know about the
    // sibling owedBy: RETAILER row, so check it explicitly here too;
    // without this a client could still POST a dealerId row's id directly
    // even though GET / now hides it from the picker.
    if (scope.ownerType === 'DEALER') {
      const pendingSaleItemIds = rows.filter((r) => r.dealerId != null).map((r) => r.saleItemId);
      if (pendingSaleItemIds.length) {
        const siblings = await prisma.soldProduct.findMany({
          where: { saleItemId: { in: pendingSaleItemIds }, owedBy: 'RETAILER' },
          select: { saleItemId: true, status: true },
        });
        const retailerStatusBySaleItemId = new Map(siblings.map((s) => [s.saleItemId, s.status]));
        const notYetPaidByRetailer = rows.some(
          (r) => r.dealerId != null && retailerStatusBySaleItemId.get(r.saleItemId) !== 'PAID'
        );
        if (notYetPaidByRetailer) {
          return res.status(400).json({ error: 'One or more selected items has not been paid by the retailer yet' });
        }
      }
    }

    const amount = rows.reduce((sum, r) => sum + Number(settlementPrice(r)) * r.saleItem.quantity, 0);
    const nextStatus = scope.ownerType === 'RETAILER' ? 'TO_BE_CONFIRMED' : 'PAID';
    const shouldAdjustVouchers = scope.ownerType === 'DEALER' && !!adjustVouchers;

    let voucherAdjustment = null;

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: { dealerId, retailerId, supplierId, amount, mode, reference: reference || null },
      });
      await tx.soldProduct.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: nextStatus, paymentId: created.id },
      });

      if (shouldAdjustVouchers) {
        voucherAdjustment = await adjustVouchersFifo(tx, {
          dealerId,
          supplierId,
          amount,
          mode,
          reference: reference || null,
          sourceDescription: `Sold Products Payment #${created.id}`,
        });
      }

      return created;
    });

    res.json({ ...payment, voucherAdjustment });
  } catch (err) {
    console.error('sold-products pay failed:', err);
    res.status(500).json({ error: 'Failed to pay for sold products', detail: err.message });
  }
});

// PATCH /api/sold-products/pay/:paymentId/confirm — DEALER only. Confirms a
// batch of TO_BE_CONFIRMED rows that a retailer's payment (POST /pay above)
// raised, moving them all to PAID in one step. Scoped to owedBy: RETAILER
// rows whose retailer's primaryDealerId is this logged-in dealer — NOT the
// scopedWhere() helper above, which covers the unrelated owedBy: DEALER
// rows (the dealer's own settlement to their supplier, which is never
// TO_BE_CONFIRMED in the first place).
//
// Also creates the Receipt entry for this payment here (not at POST /pay
// time) — since a sold-products settlement runs its own TO_BE_CONFIRMED ->
// PAID cycle directly on the SoldProduct rows above, the Receipt is
// created already PAID, purely so this payment shows up alongside voucher
// receipts in the retailer's payment history (see schema.prisma Receipt).
router.patch('/pay/:paymentId/confirm', authRequired, async (req, res) => {
  if (req.user.role !== 'DEALER') return res.status(403).json({ error: 'Only a dealer can confirm a sold-products payment' });

  const paymentId = Number(req.params.paymentId);

  const rows = await prisma.soldProduct.findMany({
    where: {
      paymentId,
      status: 'TO_BE_CONFIRMED',
      owedBy: 'RETAILER',
      sale: { ownerType: 'RETAILER', retailer: { primaryDealerId: req.user.dealerId } },
    },
  });
  if (!rows.length) {
    return res.status(404).json({ error: 'No pending sold-products payment found for this dealer with that id' });
  }

  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });

  await prisma.$transaction([
    prisma.soldProduct.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: 'PAID' },
    }),
    prisma.receipt.create({
      data: {
        voucherId: null,
        retailerId: payment.retailerId,
        paymentId: payment.id,
        amount: payment.amount,
        mode: payment.mode,
        status: 'PAID',
        confirmedAt: new Date(),
      },
    }),
  ]);

  res.json({ paymentId, confirmed: rows.length });
});

export default router;