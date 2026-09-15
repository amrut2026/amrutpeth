import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';

const router = Router();

const returnIncludeShape = {
  items: { include: { product: true, voucher: true, payment: true } },
  supplier: true,
  sourceDealer: true,
  retailer: true,
  dealer: true,
};

function approvedTotal(items) {
  return items.reduce((sum, it) => sum + Number(it.rate) * (it.approvedQuantity ?? 0), 0);
}

// GET /goods-returns/inventory — the exact batches this dealer/retailer
// can currently return from (quantity > 0 only), each annotated with the
// specific vouchers it could be credited against. The picker is
// product-first now (see GoodsReturns.jsx): the caller picks a product,
// then a voucher FOR that product — never a voucher first — so instead of
// narrowing the whole inventory list down to one already-chosen voucher,
// every eligible row needs its own list of valid vouchers up front.
//
// "Valid for this row" means: an outstanding (not fully PAID) voucher
// whose underlying purchase actually included this exact product+batch.
// The two owner types resolve "the purchase a voucher was for" differently
// (same join either side has always used for this):
//   - RETAILER: a RECEIVABLE voucher raised off the mirror Sale on the
//     dealer's side (Voucher.saleId) — the same Sale this retailer's own
//     Purchase points to once placed (Purchase.linkedSaleId) — so the
//     purchase has to be looked up via that join.
//   - DEALER: a PAYABLE voucher auto-raised directly from their own
//     purchase (Voucher.purchaseId) — no join needed.
// A voucher that can't be resolved to a purchase at all (a legacy voucher,
// or one never raised from one) is offered as a fallback option on EVERY
// row instead of being silently excluded — same "never leave the picker
// looking emptier than it should" reasoning the old ?voucherId= narrowing
// used.
router.get('/inventory', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  const where = scope.ownerType === 'DEALER'
    ? { ownerType: 'DEALER', dealerId: scope.dealerId }
    : { ownerType: 'RETAILER', retailerId: scope.retailerId };
  const rows = await prisma.inventory.findMany({
    where,
    // product.category included so the picker's Category filter (see
    // GoodsReturns.jsx) has something to filter/group on — every other
    // route in this file that reads Inventory only needs the product
    // itself, not its category, so this include is local to this route.
    include: { product: { include: { category: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  const eligible = rows.filter((r) => r.quantity > 0);

  // How much of THIS exact batch has actually been approved/settled to
  // date — GoodsReturnItem.approvedQuantity is null until a return reaches
  // CONFIRMED (see PATCH /:id/status below), whichever owner type it
  // belongs to, so summing it directly already excludes anything still
  // pending.
  const approved = eligible.length
    ? await prisma.goodsReturnItem.groupBy({
        by: ['inventoryId'],
        where: { inventoryId: { in: eligible.map((r) => r.id) }, approvedQuantity: { not: null } },
        _sum: { approvedQuantity: true },
      })
    : [];
  const approvedByInventoryId = new Map(approved.map((a) => [a.inventoryId, a._sum.approvedQuantity || 0]));

  let vouchers = [];
  if (eligible.length) {
    if (scope.ownerType === 'DEALER') {
      vouchers = await prisma.voucher.findMany({
        where: { type: 'PAYABLE', dealerId: scope.dealerId, status: { not: 'PAID' } },
        include: { purchase: { include: { items: true } } },
      });
    } else {
      vouchers = await prisma.voucher.findMany({
        where: { type: 'RECEIVABLE', retailerId: scope.retailerId, status: { not: 'PAID' } },
      });
      // A RETAILER's voucher only carries saleId directly — resolved to
      // the actual purchase via the same join GET /inventory used to do
      // for a single ?voucherId=.
      for (const v of vouchers) {
        v.purchase = v.saleId
          ? await prisma.purchase.findFirst({
              where: { linkedSaleId: v.saleId, ownerType: 'RETAILER', retailerId: scope.retailerId },
              include: { items: true },
            })
          : null;
      }
    }
  }

  // key -> Set<voucherId> for every voucher that resolved to a purchase
  // containing that product+batch, plus the purchased quantity for each
  // (voucherId, key) pair — shown alongside the picker's per-row Inventory
  // Qty, same as the old single-voucher purchasedQuantity did.
  const matchedVoucherIdsByKey = new Map();
  const purchasedQtyByVoucherAndKey = new Map();
  const unresolvedVoucherIds = [];
  for (const v of vouchers) {
    if (!v.purchase) { unresolvedVoucherIds.push(v.id); continue; }
    for (const it of v.purchase.items) {
      const key = `${it.productId}::${it.batchName || ''}`;
      if (!matchedVoucherIdsByKey.has(key)) matchedVoucherIdsByKey.set(key, new Set());
      matchedVoucherIdsByKey.get(key).add(v.id);
      const pk = `${v.id}::${key}`;
      purchasedQtyByVoucherAndKey.set(pk, (purchasedQtyByVoucherAndKey.get(pk) || 0) + it.quantity);
    }
  }

  res.json({
    items: eligible.map((r) => {
      const key = `${r.productId}::${r.batchName || ''}`;
      const matched = [...(matchedVoucherIdsByKey.get(key) || [])];
      return {
        ...r,
        approvedQuantity: approvedByInventoryId.get(r.id) || 0,
        eligibleVoucherIds: [...matched, ...unresolvedVoucherIds],
        purchasedQuantityByVoucherId: Object.fromEntries(
          matched.map((vid) => [vid, purchasedQtyByVoucherAndKey.get(`${vid}::${key}`)])
        ),
      };
    }),
  });
});

// Goods returns are a Dealer/Retailer activity only — same restriction as
// purchases.js: Admin (and any other role) is blocked from both viewing
// and recording them.
router.get('/', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);

  if (scope.ownerType === 'RETAILER') {
    const goodsReturns = await prisma.goodsReturn.findMany({
      where: { ownerType: 'RETAILER', retailerId: scope.retailerId },
      include: returnIncludeShape,
      orderBy: { date: 'desc' },
    });
    return res.json({ context: 'RETAILER', goodsReturns });
  }

  // DEALER sees both directions: their own returns to a supplier, and
  // every retailer's return TO them, which they need to review/confirm.
  const [supplierReturns, retailerReturns] = await Promise.all([
    prisma.goodsReturn.findMany({
      where: { ownerType: 'DEALER', dealerId: scope.dealerId },
      include: returnIncludeShape,
      orderBy: { date: 'desc' },
    }),
    prisma.goodsReturn.findMany({
      where: { ownerType: 'RETAILER', sourceDealerId: scope.dealerId },
      include: returnIncludeShape,
      orderBy: { date: 'desc' },
    }),
  ]);
  res.json({ context: 'DEALER', supplierReturns, retailerReturns });
});

// Create a goods return. Each line is always against a specific voucher —
// same required-voucher, capped-to-remaining-balance convention every
// other payment in this app follows (see receipts.js POST / and
// vouchers.js POST /:id/payments), since a line is a credit against that
// voucher's balance, not a free-floating adjustment — but unlike before,
// the voucher is now chosen PER LINE rather than once for the whole
// return: the picker is product-first (see GoodsReturns.jsx and GET
// /inventory above), and different products on the same return can easily
// have come in on different purchases, so they can credit different
// vouchers. The balance check below therefore runs once per distinct
// voucher referenced across the return's lines, not once for the return
// as a whole.
//
// Always starts OPEN, whichever owner type raised it — every voucher
// referenced is left untouched until CONFIRMED (see PATCH /:id/status
// below). A RETAILER can only ever return to their own primary dealer
// (derived server-side, same as purchases.js POST /), and their return
// needs that dealer's confirmation. A DEALER can return to any supplier
// under them, and — since a supplier has no login of their own in this
// system to confirm receipt — confirms their own return themselves.
router.post('/', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can record goods returns' });
  const { supplierId, items } = req.body;
  // items: [{ inventoryId, quantity, voucherId }] — voucherId is now
  // required per line (see doc comment above), not once for the return.

  if (!items || !items.length) return res.status(400).json({ error: 'No items in return' });
  for (const i of items) {
    if (!i.inventoryId) return res.status(400).json({ error: 'An inventory item is required for every line' });
    if (!i.quantity || Number(i.quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero for every line' });
    if (!i.voucherId) return res.status(400).json({ error: 'A voucher is required for every line' });
  }

  let supplierIdToUse = null;
  let sourceDealerIdToUse = null;

  if (scope.ownerType === 'DEALER') {
    if (!supplierId) return res.status(400).json({ error: 'Supplier is required' });
    supplierIdToUse = Number(supplierId);
  } else {
    // RETAILER: always returned to their own primary dealer — looked up
    // server-side rather than trusting the client, same reasoning as
    // purchases.js POST /.
    const retailer = await prisma.retailer.findUnique({ where: { id: scope.retailerId } });
    if (!retailer) return res.status(404).json({ error: 'Retailer not found' });
    sourceDealerIdToUse = retailer.primaryDealerId;
  }

  // Every returned line must be an Inventory row this owner actually
  // holds right now — a return is only ever possible against the caller's
  // own current stock, never an arbitrary product/quantity.
  const inventoryIds = items.map((i) => Number(i.inventoryId));
  const inventoryRows = await prisma.inventory.findMany({
    where: {
      id: { in: inventoryIds },
      ownerType: scope.ownerType,
      dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
      retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
    },
    include: { product: true },
  });
  if (inventoryRows.length !== new Set(inventoryIds).size) {
    return res.status(403).json({ error: 'One or more items are not in your inventory' });
  }
  const inventoryById = new Map(inventoryRows.map((r) => [r.id, r]));

  // A DEALER's return, like a purchase, is scoped to one supplier at a
  // time — every product being returned must actually belong to the
  // supplier selected for this return.
  if (scope.ownerType === 'DEALER' && inventoryRows.some((r) => r.product.supplierId !== supplierIdToUse)) {
    return res.status(403).json({ error: 'One or more products do not belong to the selected supplier' });
  }

  for (const i of items) {
    const inv = inventoryById.get(Number(i.inventoryId));
    if (Number(i.quantity) > inv.quantity) {
      return res.status(400).json({ error: `Cannot return more than the ${inv.quantity} currently in stock for batch "${inv.batchName || '—'}"` });
    }
  }

  // Every distinct voucher referenced across the return's lines must
  // belong to the right counterparty in the right direction (PAYABLE for
  // a DEALER's own return, RECEIVABLE for a RETAILER's) — checked once per
  // distinct voucher, not once per line, since several lines can share
  // the same voucher.
  const voucherIds = [...new Set(items.map((i) => Number(i.voucherId)))];
  const vouchers = await prisma.voucher.findMany({
    where: { id: { in: voucherIds } },
    include: { receipts: true, payments: true, goodsReturnItems: { include: { goodsReturn: true } } },
  });
  const voucherById = new Map(vouchers.map((v) => [v.id, v]));
  if (voucherById.size !== voucherIds.length) {
    return res.status(404).json({ error: 'One or more selected vouchers were not found' });
  }
  for (const v of vouchers) {
    const validVoucher = scope.ownerType === 'DEALER'
      ? v.type === 'PAYABLE' && v.dealerId === scope.dealerId && v.supplierId === supplierIdToUse
      : v.type === 'RECEIVABLE' && v.dealerId === sourceDealerIdToUse && v.retailerId === scope.retailerId;
    if (!validVoucher) return res.status(403).json({ error: `Voucher #${v.id} does not belong to this counterparty` });
    if (v.status === 'PAID') return res.status(400).json({ error: `Voucher #${v.id} is already fully paid` });
  }

  const returnItemsData = items.map((i) => {
    const inv = inventoryById.get(Number(i.inventoryId));
    return {
      inventoryId: inv.id,
      productId: inv.productId,
      batchName: inv.batchName,
      quantity: Number(i.quantity),
      rate: inv.rate,
      voucherId: Number(i.voucherId),
      // Left null for both owner types now — nothing is approved until
      // CONFIRMED (see GoodsReturnStatus in schema.prisma and PATCH
      // /:id/status below), whether that confirmation comes from the
      // counterparty (a RETAILER's return) or from the same dealer who
      // raised it (a DEALER's own return to a supplier, who has no
      // counterparty able to log in and do it for them).
      approvedQuantity: null,
    };
  });

  // Balance check now runs per distinct voucher, summing only the lines
  // THIS return is putting against that voucher — same "capped to
  // remaining balance" rule as before, just no longer assuming every line
  // on the return shares one voucher.
  const subtotalByVoucherId = new Map();
  for (const it of returnItemsData) {
    const line = Number(it.rate) * it.quantity;
    subtotalByVoucherId.set(it.voucherId, (subtotalByVoucherId.get(it.voucherId) || 0) + line);
  }

  for (const [vId, subtotal] of subtotalByVoucherId) {
    const voucher = voucherById.get(vId);
    const receiptsAmount = voucher.receipts.reduce((sum, r) => sum + Number(r.amount), 0);
    const paymentsAmount = voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    // Every OTHER return LINE still sitting OPEN/IN_REVIEW against this
    // same voucher — not yet a Payment, but still a pending claim on the
    // balance, so it has to count here too or several pending returns
    // could together overcommit the voucher before any is confirmed. Same
    // reasoning receipts.js gives for counting still-pending receipts, not
    // just confirmed ones — just scoped to voucher.goodsReturnItems (the
    // item-level relation) now, not a whole GoodsReturn's total.
    const pendingItemsAmount = voucher.goodsReturnItems
      .filter((gi) => gi.goodsReturn.status !== 'CONFIRMED')
      .reduce((sum, gi) => sum + Number(gi.rate) * gi.quantity, 0);
    // A DEALER's own voucher (PAYABLE) has no receipts at all, and
    // `paymentsAmount` already covers every prior GOODS_RETURN-mode credit
    // on it (those create a real Payment once CONFIRMED — see PATCH
    // /:id/status below). A RETAILER's voucher (RECEIVABLE) needs
    // `receiptsAmount` for ordinary cash/UPI/card claims (mirroring
    // receipts.js exactly) PLUS any prior CONFIRMED goods-return credit,
    // which — unlike a Receipt — has no receipt row of its own to be
    // counted by `receiptsAmount`.
    const confirmedGoodsReturnAmount = voucher.payments
      .filter((p) => p.mode === 'GOODS_RETURN')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const alreadyAccountedFor = scope.ownerType === 'RETAILER'
      ? receiptsAmount + confirmedGoodsReturnAmount + pendingItemsAmount
      : paymentsAmount + pendingItemsAmount;
    const remaining = Number(voucher.amount) - alreadyAccountedFor;
    if (subtotal > remaining) {
      return res.status(400).json({ error: `Return value for voucher #${vId} exceeds its remaining balance of ${remaining.toFixed(2)}` });
    }
  }

  // Always created OPEN now, for both owner types — see GoodsReturnStatus
  // in schema.prisma. Nothing is decremented from inventory and no Payment
  // exists yet; that only happens once CONFIRMED (PATCH /:id/status
  // below), whoever ends up doing the confirming.
  try {
    const goodsReturn = await prisma.goodsReturn.create({
      data: {
        ownerType: scope.ownerType,
        dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
        retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
        supplierId: supplierIdToUse,
        sourceDealerId: sourceDealerIdToUse,
        status: 'OPEN',
        items: { create: returnItemsData },
      },
      include: returnIncludeShape,
    });
    res.json(goodsReturn);
  } catch (err) {
    console.error('goods return creation failed:', err);
    res.status(500).json({ error: err.message || 'Failed to record goods return' });
  }
});

// Lets the owner of a still-open return correct the requested quantity on
// one or more of its lines, without touching anything else about it — same
// "quick correction before it settles" convenience purchases.js offers via
// its own PATCH /:id/quantities. For a RETAILER's own return, reachable
// while OPEN or IN_REVIEW (the same window PATCH /:id/status below allows
// CANCELLED from). For a DEALER's own return to a supplier, only while
// OPEN — there's no IN_REVIEW stage for it at all (no counterparty to put
// it in front of). Either way, once CONFIRMED, inventory/voucher/payment
// have already moved and there's nothing left to safely edit.
router.patch('/:id/quantities', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  const id = Number(req.params.id);
  const { items } = req.body; // [{ id, quantity }]

  if (!items || !items.length) return res.status(400).json({ error: 'No items to update' });
  for (const i of items) {
    if (!i.id) return res.status(400).json({ error: 'An item id is required for every line' });
    if (!i.quantity || Number(i.quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero for every line' });
  }

  const existing = await prisma.goodsReturn.findUnique({ where: { id }, include: { items: true } });
  if (!existing) return res.status(404).json({ error: 'Goods return not found' });

  if (existing.ownerType !== scope.ownerType) {
    return res.status(403).json({ error: 'You can only update your own returns' });
  }
  if (scope.ownerType === 'RETAILER') {
    if (existing.retailerId !== scope.retailerId) {
      return res.status(403).json({ error: 'You can only update your own returns' });
    }
    if (existing.status !== 'OPEN' && existing.status !== 'IN_REVIEW') {
      return res.status(400).json({ error: `Quantity can only be edited while a return is open or under review, not once it is ${existing.status}` });
    }
  } else {
    if (existing.dealerId !== scope.dealerId) {
      return res.status(403).json({ error: 'You can only update your own returns' });
    }
    if (existing.status !== 'OPEN') {
      return res.status(400).json({ error: `Quantity can only be edited while a return is open, not once it is ${existing.status}` });
    }
  }

  const existingItemIds = new Set(existing.items.map((it) => it.id));
  if (items.some((i) => !existingItemIds.has(Number(i.id)))) {
    return res.status(400).json({ error: 'One or more items do not belong to this return' });
  }

  // Re-checked against current stock — the retailer's own inventory may
  // have moved (sold, or claimed by another pending return) since this
  // return was first raised.
  const inventoryIds = existing.items.map((it) => it.inventoryId);
  const inventoryRows = await prisma.inventory.findMany({ where: { id: { in: inventoryIds } } });
  const inventoryById = new Map(inventoryRows.map((r) => [r.id, r]));

  const newQuantityById = new Map(items.map((i) => [Number(i.id), Number(i.quantity)]));
  const updatedItemsData = existing.items.map((it) => ({
    ...it,
    quantity: newQuantityById.has(it.id) ? newQuantityById.get(it.id) : it.quantity,
  }));

  for (const it of updatedItemsData) {
    const inv = inventoryById.get(it.inventoryId);
    if (!inv || it.quantity > inv.quantity) {
      return res.status(400).json({ error: `Cannot return more than the ${inv?.quantity ?? 0} currently in stock for batch "${it.batchName || '—'}"` });
    }
  }

  // Same voucher-balance guard POST / applies at creation — an edit that
  // bumps a quantity up can't push this line's voucher past what's still
  // actually left on it either. Grouped by each item's OWN voucherId now
  // (items on the same return can credit different vouchers — see
  // schema.prisma GoodsReturnItem.voucherId) rather than one shared
  // voucher for the whole return. A null voucherId (a pre-existing row
  // from before this column existed — see schema.prisma) is filtered out
  // before either query: there's no voucher to check a balance against,
  // and Voucher.id is a required Int, so a raw `null` inside an `in`
  // filter would be a Prisma validation error, not just a harmless
  // no-match.
  const voucherIdsInvolved = [...new Set(updatedItemsData.map((it) => it.voucherId).filter((v) => v != null))];
  const vouchersInvolved = voucherIdsInvolved.length
    ? await prisma.voucher.findMany({
        where: { id: { in: voucherIdsInvolved } },
        include: { receipts: true, payments: true, goodsReturnItems: { include: { goodsReturn: true } } },
      })
    : [];
  const voucherByIdInvolved = new Map(vouchersInvolved.map((v) => [v.id, v]));

  const newSubtotalByVoucherId = new Map();
  for (const it of updatedItemsData) {
    if (it.voucherId == null) continue;
    const line = Number(it.rate) * it.quantity;
    newSubtotalByVoucherId.set(it.voucherId, (newSubtotalByVoucherId.get(it.voucherId) || 0) + line);
  }

  for (const [vId, newSubtotal] of newSubtotalByVoucherId) {
    const voucher = voucherByIdInvolved.get(vId);
    if (!voucher) continue;
    // Every OTHER pending (non-CONFIRMED) return line against this same
    // voucher, from ANY return — this return's own line(s) against this
    // voucher are deliberately excluded here (via goodsReturn.id !==
    // existing.id), since they're about to be replaced by newSubtotal.
    const otherPendingAmount = voucher.goodsReturnItems
      .filter((gi) => gi.goodsReturn.id !== existing.id && gi.goodsReturn.status !== 'CONFIRMED')
      .reduce((sum, gi) => sum + Number(gi.rate) * gi.quantity, 0);
    // Same PAYABLE-vs-RECEIVABLE split POST / uses — see the comment
    // there for why a DEALER's own (PAYABLE) voucher counts every
    // Payment, while a RETAILER's (RECEIVABLE) voucher only counts
    // confirmed Receipts plus GOODS_RETURN-mode Payments.
    const alreadyAccountedFor = scope.ownerType === 'DEALER'
      ? voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0) + otherPendingAmount
      : voucher.receipts.reduce((sum, r) => sum + Number(r.amount), 0)
        + voucher.payments.filter((p) => p.mode === 'GOODS_RETURN').reduce((sum, p) => sum + Number(p.amount), 0)
        + otherPendingAmount;
    const remaining = Number(voucher.amount) - alreadyAccountedFor;
    if (newSubtotal > remaining) {
      return res.status(400).json({ error: `Updated return value for voucher #${vId} exceeds its remaining balance of ${remaining.toFixed(2)}` });
    }
  }

  await prisma.$transaction(
    items.map((i) => prisma.goodsReturnItem.update({
      where: { id: Number(i.id) },
      data: { quantity: Number(i.quantity) },
    }))
  );

  const updated = await prisma.goodsReturn.findUnique({ where: { id }, include: returnIncludeShape });
  res.json(updated);
});

// Status workflow:
//   RETAILER-owned return:
//     OPEN -> IN_REVIEW, by the retailer who raised it (same "mark for
//       review" step Purchases.jsx uses).
//     OPEN or IN_REVIEW -> CANCELLED, by the retailer who raised it — a
//       dead end, and only ever a status flip since nothing else has
//       happened to this return yet at either stage.
//     IN_REVIEW -> CONFIRMED, by the DEALER the return was made to — this
//       is the step that actually decrements the retailer's inventory,
//       raises the credit Payment(s) against them (one per distinct
//       voucher touched — see the settlement block below), and pushes
//       each of those vouchers' status forward, exactly like receipts.js
//       PATCH /:id/confirm does for an ordinary cash receipt.
//   DEALER-owned return (to a supplier):
//     No IN_REVIEW stage at all — a supplier has no login to put it in
//     front of, so the same dealer who raised it is also the one who
//     settles it:
//     OPEN -> CANCELLED, by that dealer — same dead-end reasoning as above.
//     OPEN -> CONFIRMED, by that dealer — decrements their own inventory
//       and raises the credit Payment(s) against the supplier, same as
//       the RETAILER case above just without anything to partially reject
//       (there's no separate party's request to second-guess).
router.patch('/:id/status', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  const id = Number(req.params.id);
  const { status, items: approvalInput } = req.body;
  // approvalInput (CONFIRMED step only): [{ id: <GoodsReturnItem id>,
  // approvedQuantity, note }] — any line left out, or with approvedQuantity
  // left undefined/null, defaults to approving the full requested quantity.
  // `note` is required whenever approvedQuantity differs from what was
  // requested (see the check below). In practice only ever partial for a
  // RETAILER's return being confirmed by their DEALER — a DEALER confirming
  // their OWN return has no reason to send anything but a full approval.

  const existing = await prisma.goodsReturn.findUnique({
    where: { id },
    include: { items: { include: { voucher: { include: { receipts: true, payments: true } } } } },
  });
  if (!existing) return res.status(404).json({ error: 'Goods return not found' });

  // Case A — a RETAILER managing their own return: mark for review, or
  // cancel outright before anyone ever gets to CONFIRM it.
  if (existing.ownerType === 'RETAILER' && scope.ownerType === 'RETAILER') {
    if (existing.retailerId !== scope.retailerId) {
      return res.status(403).json({ error: 'You can only update your own returns' });
    }
    if (status === 'CANCELLED') {
      if (existing.status !== 'OPEN' && existing.status !== 'IN_REVIEW') {
        return res.status(400).json({ error: `Cannot cancel a return once it is ${existing.status}` });
      }
      const cancelled = await prisma.goodsReturn.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: returnIncludeShape,
      });
      return res.json(cancelled);
    }
    if (existing.status !== 'OPEN' || status !== 'IN_REVIEW') {
      return res.status(400).json({ error: `Cannot move return from ${existing.status} to ${status}` });
    }
    const updated = await prisma.goodsReturn.update({
      where: { id },
      data: { status: 'IN_REVIEW' },
      include: returnIncludeShape,
    });
    return res.json(updated);
  }

  // Case C — a DEALER managing their OWN return to a supplier: same
  // CANCELLED handling as Case A, just from OPEN only (no IN_REVIEW stage
  // exists for it — see the workflow comment above). CONFIRMED falls
  // through to the settlement logic shared with Case B below.
  if (existing.ownerType === 'DEALER' && scope.ownerType === 'DEALER') {
    if (existing.dealerId !== scope.dealerId) {
      return res.status(403).json({ error: 'You can only update your own returns' });
    }
    if (status === 'CANCELLED') {
      if (existing.status !== 'OPEN') {
        return res.status(400).json({ error: `Cannot cancel a return once it is ${existing.status}` });
      }
      const cancelled = await prisma.goodsReturn.update({
        where: { id },
        data: { status: 'CANCELLED' },
        include: returnIncludeShape,
      });
      return res.json(cancelled);
    }
    if (existing.status !== 'OPEN' || status !== 'CONFIRMED') {
      return res.status(400).json({ error: `Cannot move return from ${existing.status} to ${status}` });
    }
    // falls through to the shared CONFIRMED settlement below
  } else if (existing.ownerType === 'RETAILER' && scope.ownerType === 'DEALER') {
    // Case B — a DEALER confirming receipt of a retailer's return made to
    // them. The dealer can approve less than what was requested per line
    // (a partial return acceptance); approvedQuantity drives both the
    // inventory decrement and the credit below, not the retailer's
    // original `quantity`.
    if (existing.sourceDealerId !== scope.dealerId) {
      return res.status(403).json({ error: 'You can only confirm returns made to you' });
    }
    if (existing.status !== 'IN_REVIEW' || status !== 'CONFIRMED') {
      return res.status(400).json({ error: `Cannot move return from ${existing.status} to ${status}` });
    }
  } else {
    return res.status(403).json({ error: 'You cannot update this return' });
  }

  // Shared CONFIRMED settlement — Case C (a DEALER's own return, always
  // approved in full — there's no separate party's request to partially
  // reject) and Case B (a RETAILER's return, confirmed by their DEALER,
  // which can be partially approved per line) both land here.
  const approvalById = new Map((approvalInput || []).map((a) => [Number(a.id), a]));
  const itemsWithApproval = [];
  for (const item of existing.items) {
    const entry = approvalById.get(item.id);
    const requested = entry && entry.approvedQuantity !== undefined && entry.approvedQuantity !== null
      ? entry.approvedQuantity
      : item.quantity;
    const approvedQuantity = Number(requested);
    if (!Number.isInteger(approvedQuantity) || approvedQuantity < 0) {
      return res.status(400).json({ error: `Approved quantity must be a whole number ≥ 0 for batch "${item.batchName || '—'}"` });
    }
    if (approvedQuantity > item.quantity) {
      return res.status(400).json({ error: `Cannot approve more than the ${item.quantity} requested for batch "${item.batchName || '—'}"` });
    }
    const note = (entry?.note || '').trim() || null;
    if (approvedQuantity !== item.quantity && !note) {
      return res.status(400).json({ error: `A note is required for batch "${item.batchName || '—'}" since the approved quantity (${approvedQuantity}) differs from the requested ${item.quantity}` });
    }
    itemsWithApproval.push({ ...item, approvedQuantity, approvalNote: approvedQuantity !== item.quantity ? note : null });
  }

  const isOwnDealerReturn = existing.ownerType === 'DEALER';

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-checked here, not just at creation — a return can sit around for
      // a while before it's confirmed, and stock that was there back then
      // may have since moved. Only the APPROVED quantity is ever
      // decremented, never the original request.
      for (const item of itemsWithApproval) {
        if (item.approvedQuantity > 0) {
          const inv = await tx.inventory.findUnique({ where: { id: item.inventoryId } });
          if (!inv || inv.quantity < item.approvedQuantity) {
            throw new Error(`Not enough stock left to return ${item.approvedQuantity} of batch "${item.batchName || '—'}" — only ${inv?.quantity ?? 0} remaining`);
          }
          await tx.inventory.update({ where: { id: item.inventoryId }, data: { quantity: { decrement: item.approvedQuantity } } });

          // Credit the goods back onto the DEALER's shelf — only for Case B
          // (a RETAILER's return confirmed by their DEALER). Case C (a
          // DEALER returning to a SUPPLIER) has no counterpart Inventory to
          // credit — a supplier isn't a first-class owner in this system,
          // same reason a PAYABLE voucher has no receiving side. Same
          // findUnique-then-update-or-create shape purchases.js uses to
          // receive a batch into Inventory (POST /:id/status), keyed on the
          // same compound unique — top up if this exact product+batch
          // already has a row for this dealer, otherwise open a new one.
          if (!isOwnDealerReturn) {
            const dealerInvWhere = {
              productId_ownerType_dealerId_retailerId_batchName: {
                productId: item.productId,
                ownerType: 'DEALER',
                dealerId: existing.sourceDealerId,
                retailerId: null,
                batchName: item.batchName || '',
              },
            };
            const existingDealerInv = await tx.inventory.findUnique({ where: dealerInvWhere }).catch(() => null);
            if (existingDealerInv) {
              await tx.inventory.update({
                where: dealerInvWhere,
                data: { quantity: { increment: item.approvedQuantity } },
              });
            } else {
              // No pricing history left for this batch on the dealer's side
              // (fully sold through before now) — fall back to the
              // retailer's own copy of this batch (`inv`, looked up above)
              // as the closest record of what it's worth.
              await tx.inventory.create({
                data: {
                  productId: item.productId,
                  ownerType: 'DEALER',
                  dealerId: existing.sourceDealerId,
                  batchName: item.batchName || '',
                  quantity: item.approvedQuantity,
                  reorderLevel: 10,
                  rate: item.rate,
                  mrp: inv.mrp,
                  sellingPrice: inv.sellingPrice,
                  discount: inv.discount,
                  dealerCommission: inv.dealerCommission,
                  manufacturingDate: inv.manufacturingDate,
                  expiryDate: inv.expiryDate,
                },
              });
            }
          }
        }
        // Persisted regardless of whether it's 0 — a full rejection is
        // still a recorded approval decision, not an unset one.
        await tx.goodsReturnItem.update({
          where: { id: item.id },
          data: { approvedQuantity: item.approvedQuantity, approvalNote: item.approvalNote },
        });
      }

      // One Payment per DISTINCT voucher touched by this return's lines —
      // no longer a single Payment/voucher update for the whole return,
      // since different lines can now credit different vouchers (see
      // schema.prisma GoodsReturnItem.voucherId). Each group's own
      // approved subtotal is what actually reduces that voucher's
      // remaining balance — this is the "product line total is reduced
      // from that voucher" behaviour. A null voucherId (a pre-existing
      // row from before this column existed — see schema.prisma) is its
      // own group but is skipped below: there's no voucher to credit, so
      // those items are approved/settled at the inventory level (already
      // done above) but never get a Payment or paymentId of their own.
      const itemsByVoucherId = new Map();
      for (const item of itemsWithApproval) {
        if (!itemsByVoucherId.has(item.voucherId)) itemsByVoucherId.set(item.voucherId, []);
        itemsByVoucherId.get(item.voucherId).push(item);
      }

      for (const [vId, groupItems] of itemsByVoucherId) {
        if (vId == null) continue;
        const groupTotal = approvedTotal(groupItems);
        const voucher = groupItems[0].voucher; // same voucher object on every item in this group

        // Every line in this group was rejected down to 0 (or the group
        // was already zero-quantity) — nothing was actually credited
        // against this voucher, so don't raise a Payment for it at all.
        // Leaves these items' paymentId null, same as any other
        // never-settled line.
        if (groupTotal <= 0) continue;

        const payment = await tx.payment.create({
          data: isOwnDealerReturn
            ? {
                dealerId: existing.dealerId,
                supplierId: existing.supplierId,
                voucherId: vId,
                amount: groupTotal,
                mode: 'GOODS_RETURN',
                reference: `Goods Return #${existing.id} (Voucher #${vId})`,
              }
            : {
                dealerId: existing.sourceDealerId,
                retailerId: existing.retailerId,
                voucherId: vId,
                amount: groupTotal,
                mode: 'GOODS_RETURN',
                reference: `Goods Return #${existing.id} (Voucher #${vId})`,
              },
        });

        await tx.goodsReturnItem.updateMany({
          where: { id: { in: groupItems.map((it) => it.id) } },
          data: { paymentId: payment.id },
        });

        if (voucher) {
          // Same PAYABLE-vs-RECEIVABLE split POST / uses for the
          // equivalent balance check at creation — see the comment there.
          // A DEALER's own (PAYABLE) voucher counts every prior Payment of
          // any mode (Payment is the only settlement record type on it, no
          // Receipt ever applies to a dealer-supplier voucher); a
          // RETAILER's (RECEIVABLE) voucher counts confirmed Receipts plus
          // prior GOODS_RETURN-mode Payments only.
          const alreadyConfirmedOnVoucher = isOwnDealerReturn
            ? voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0)
            : voucher.receipts.filter((r) => r.status !== 'TO_BE_CONFIRMED').reduce((sum, r) => sum + Number(r.amount), 0)
              + voucher.payments.filter((p) => p.mode === 'GOODS_RETURN').reduce((sum, p) => sum + Number(p.amount), 0);
          const totalConfirmed = alreadyConfirmedOnVoucher + groupTotal;
          const newStatus = totalConfirmed >= Number(voucher.amount) ? 'PAID' : 'PARTIALLY_PAID';
          await tx.voucher.update({ where: { id: voucher.id }, data: { status: newStatus } });
        }
      }

      return tx.goodsReturn.update({
        where: { id },
        data: { status: 'CONFIRMED' },
        include: returnIncludeShape,
      });
    });
    res.json(result);
  } catch (err) {
    console.error('goods return confirmation failed:', err);
    res.status(500).json({ error: err.message || 'Failed to confirm goods return' });
  }
});

export default router;