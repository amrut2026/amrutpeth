import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';

const router = Router();

const returnIncludeShape = {
  items: { include: { product: true } },
  supplier: true,
  sourceDealer: true,
  retailer: true,
  dealer: true,
  payment: true,
  voucher: true,
};

function itemsTotal(items) {
  return items.reduce((sum, it) => sum + Number(it.rate) * it.quantity, 0);
}

function approvedTotal(items) {
  return items.reduce((sum, it) => sum + Number(it.rate) * (it.approvedQuantity ?? 0), 0);
}

// GET /goods-returns/inventory — the exact batches this dealer/retailer
// can currently return from (quantity > 0 only). Kept local to this
// router, rather than assumed from whatever other inventory listing
// exists elsewhere, so this feature is self-contained regardless of what
// else is in the app. RETURNS are only ever possible against one of
// these rows — never an arbitrary product/quantity.
router.get('/inventory', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  const where = scope.ownerType === 'DEALER'
    ? { ownerType: 'DEALER', dealerId: scope.dealerId }
    : { ownerType: 'RETAILER', retailerId: scope.retailerId };
  const rows = await prisma.inventory.findMany({ where, include: { product: true }, orderBy: { updatedAt: 'desc' } });
  let eligible = rows.filter((r) => r.quantity > 0);

  // ?voucherId= — narrow the picker down to exactly the products that
  // came in on the purchase this voucher was raised for, so a return
  // raised against a specific voucher is a return against that delivery,
  // not a free pick across everything on hand. Every eligible row is also
  // tagged with purchasedQuantity — how much of that product+batch came in
  // on the purchase — alongside its own (unfiltered) current `quantity`,
  // so the picker can show both what was originally bought and what's
  // actually still on the shelf. If the voucher can't be resolved to a
  // purchase (a legacy voucher, or one never raised from one),
  // scopedToPurchase comes back false and every row is left exactly as it
  // would be unscoped — never a silently empty picker.
  //
  // The two owner types resolve "the purchase this voucher was for"
  // differently:
  //   - RETAILER: a RECEIVABLE voucher raised off the mirror Sale on the
  //     dealer's side (Voucher.saleId, schema.prisma) — the same Sale this
  //     retailer's own Purchase points to once placed (Purchase.linkedSaleId,
  //     see purchases.js) — so the purchase has to be looked up via that join.
  //   - DEALER: a PAYABLE voucher auto-raised directly from their own
  //     purchase (Voucher.purchaseId, schema.prisma) — no join needed, the
  //     purchase id is right there on the voucher.
  let scopedToPurchase = false;
  if (req.query.voucherId) {
    const voucher = await prisma.voucher.findUnique({ where: { id: Number(req.query.voucherId) } });
    if (!voucher) return res.status(404).json({ error: 'Voucher not found' });

    let purchase = null;
    if (scope.ownerType === 'RETAILER') {
      if (voucher.retailerId !== scope.retailerId) {
        return res.status(403).json({ error: 'Voucher does not belong to you' });
      }
      purchase = voucher.saleId
        ? await prisma.purchase.findFirst({
            where: { linkedSaleId: voucher.saleId, ownerType: 'RETAILER', retailerId: scope.retailerId },
            include: { items: true },
          })
        : null;
    } else {
      if (voucher.dealerId !== scope.dealerId) {
        return res.status(403).json({ error: 'Voucher does not belong to you' });
      }
      purchase = voucher.purchaseId
        ? await prisma.purchase.findUnique({ where: { id: voucher.purchaseId }, include: { items: true } })
        : null;
    }

    if (purchase) {
      scopedToPurchase = true;
      const purchasedByKey = new Map();
      for (const it of purchase.items) {
        const key = `${it.productId}::${it.batchName || ''}`;
        purchasedByKey.set(key, (purchasedByKey.get(key) || 0) + it.quantity);
      }
      eligible = eligible
        .filter((r) => purchasedByKey.has(`${r.productId}::${r.batchName || ''}`))
        .map((r) => ({ ...r, purchasedQuantity: purchasedByKey.get(`${r.productId}::${r.batchName || ''}`) }));
    }
  }

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

  res.json({
    items: eligible.map((r) => ({
      ...r,
      approvedQuantity: approvedByInventoryId.get(r.id) || 0,
      purchasedQuantity: r.purchasedQuantity ?? null,
    })),
    scopedToPurchase,
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

// Create a goods return, always against a specific voucher — same
// required-voucher, capped-to-remaining-balance convention every other
// payment in this app follows (see receipts.js POST / and vouchers.js
// POST /:id/payments), since this return is a credit against that
// voucher's balance, not a free-floating adjustment.
//
// Always starts OPEN, whichever owner type raised it — the voucher itself
// is left untouched until CONFIRMED (see PATCH /:id/status below). A
// RETAILER can only ever return to their own primary dealer (derived
// server-side, same as purchases.js POST /), and their return needs that
// dealer's confirmation. A DEALER can return to any supplier under them,
// and — since a supplier has no login of their own in this system to
// confirm receipt — confirms their own return themselves.
router.post('/', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can record goods returns' });
  const { supplierId, voucherId, items } = req.body;
  // items: [{ inventoryId, quantity }]

  if (!items || !items.length) return res.status(400).json({ error: 'No items in return' });
  for (const i of items) {
    if (!i.inventoryId) return res.status(400).json({ error: 'An inventory item is required for every line' });
    if (!i.quantity || Number(i.quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero for every line' });
  }
  if (!voucherId) return res.status(400).json({ error: 'Voucher is required' });

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

  const returnItemsData = items.map((i) => {
    const inv = inventoryById.get(Number(i.inventoryId));
    return {
      inventoryId: inv.id,
      productId: inv.productId,
      batchName: inv.batchName,
      quantity: Number(i.quantity),
      rate: inv.rate,
      // Left null for both owner types now — nothing is approved until
      // CONFIRMED (see GoodsReturnStatus in schema.prisma and PATCH
      // /:id/status below), whether that confirmation comes from the
      // counterparty (a RETAILER's return) or from the same dealer who
      // raised it (a DEALER's own return to a supplier, who has no
      // counterparty able to log in and do it for them).
      approvedQuantity: null,
    };
  });
  const returnTotal = itemsTotal(returnItemsData);

  // Voucher must belong to the right counterparty in the right direction
  // (PAYABLE for a DEALER's own return, RECEIVABLE for a RETAILER's), and
  // the return can't exceed what's actually still outstanding on it.
  const voucher = await prisma.voucher.findUnique({
    where: { id: Number(voucherId) },
    include: { receipts: true, payments: true, goodsReturns: { include: { items: true } } },
  });
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });

  const validVoucher = scope.ownerType === 'DEALER'
    ? voucher.type === 'PAYABLE' && voucher.dealerId === scope.dealerId && voucher.supplierId === supplierIdToUse
    : voucher.type === 'RECEIVABLE' && voucher.dealerId === sourceDealerIdToUse && voucher.retailerId === scope.retailerId;
  if (!validVoucher) return res.status(403).json({ error: 'Voucher does not belong to this counterparty' });
  if (voucher.status === 'PAID') return res.status(400).json({ error: 'This voucher is already fully paid' });

  const receiptsAmount = voucher.receipts.reduce((sum, r) => sum + Number(r.amount), 0);
  const paymentsAmount = voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  // Every OTHER goods return still sitting OPEN/IN_REVIEW against this
  // same voucher — not yet a Payment, but still a pending claim on the
  // balance, so it has to count here too or either side could stack up
  // several pending returns that would together overcommit the voucher
  // before any of them is actually confirmed. Same reasoning receipts.js
  // gives for counting still-pending receipts, not just confirmed ones.
  const pendingReturnsAmount = voucher.goodsReturns
    .filter((gr) => gr.status !== 'CONFIRMED')
    .reduce((sum, gr) => sum + itemsTotal(gr.items), 0);
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
    ? receiptsAmount + confirmedGoodsReturnAmount + pendingReturnsAmount
    : paymentsAmount + pendingReturnsAmount;
  const remaining = Number(voucher.amount) - alreadyAccountedFor;
  if (returnTotal > remaining) {
    return res.status(400).json({ error: `Return value exceeds the remaining balance of ${remaining.toFixed(2)} on this voucher` });
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
        voucherId: voucher.id,
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
  // bumps a quantity up can't push this return's own total past what's
  // still actually left on the voucher either.
  if (existing.voucherId) {
    const voucher = await prisma.voucher.findUnique({
      where: { id: existing.voucherId },
      include: { receipts: true, payments: true, goodsReturns: { include: { items: true } } },
    });
    if (voucher) {
      // Every OTHER pending (non-CONFIRMED) return against this voucher —
      // this return's own OLD total is deliberately excluded here, since
      // it's about to be replaced by the new total being validated below.
      const otherPendingAmount = voucher.goodsReturns
        .filter((gr) => gr.id !== existing.id && gr.status !== 'CONFIRMED')
        .reduce((sum, gr) => sum + itemsTotal(gr.items), 0);
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
      const newTotal = itemsTotal(updatedItemsData);
      if (newTotal > remaining) {
        return res.status(400).json({ error: `Updated return value exceeds the remaining balance of ${remaining.toFixed(2)} on this voucher` });
      }
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
//       raises the credit Payment against them, and pushes the linked
//       voucher's status forward, exactly like receipts.js PATCH
//       /:id/confirm does for an ordinary cash receipt.
//   DEALER-owned return (to a supplier):
//     No IN_REVIEW stage at all — a supplier has no login to put it in
//     front of, so the same dealer who raised it is also the one who
//     settles it:
//     OPEN -> CANCELLED, by that dealer — same dead-end reasoning as above.
//     OPEN -> CONFIRMED, by that dealer — decrements their own inventory
//       and raises the credit Payment against the supplier, same as the
//       RETAILER case above just without anything to partially reject
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
    include: { items: true, voucher: { include: { receipts: true, payments: true } } },
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

  const returnTotal = approvedTotal(itemsWithApproval);
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
        }
        // Persisted regardless of whether it's 0 — a full rejection is
        // still a recorded approval decision, not an unset one.
        await tx.goodsReturnItem.update({
          where: { id: item.id },
          data: { approvedQuantity: item.approvedQuantity, approvalNote: item.approvalNote },
        });
      }

      const payment = await tx.payment.create({
        data: isOwnDealerReturn
          ? {
              dealerId: existing.dealerId,
              supplierId: existing.supplierId,
              voucherId: existing.voucherId,
              amount: returnTotal,
              mode: 'GOODS_RETURN',
              reference: `Goods Return #${existing.id}`,
            }
          : {
              dealerId: existing.sourceDealerId,
              retailerId: existing.retailerId,
              voucherId: existing.voucherId,
              amount: returnTotal,
              mode: 'GOODS_RETURN',
              reference: `Goods Return #${existing.id}`,
            },
      });

      if (existing.voucher) {
        // Same PAYABLE-vs-RECEIVABLE split POST / uses for the equivalent
        // balance check at creation — see the comment there. A DEALER's
        // own (PAYABLE) voucher counts every prior Payment of any mode
        // (Payment is the only settlement record type on it, no Receipt
        // ever applies to a dealer-supplier voucher); a RETAILER's
        // (RECEIVABLE) voucher counts confirmed Receipts plus prior
        // GOODS_RETURN-mode Payments only.
        const alreadyConfirmedOnVoucher = isOwnDealerReturn
          ? existing.voucher.payments.reduce((sum, p) => sum + Number(p.amount), 0)
          : existing.voucher.receipts.filter((r) => r.status !== 'TO_BE_CONFIRMED').reduce((sum, r) => sum + Number(r.amount), 0)
            + existing.voucher.payments.filter((p) => p.mode === 'GOODS_RETURN').reduce((sum, p) => sum + Number(p.amount), 0);
        const totalConfirmed = alreadyConfirmedOnVoucher + returnTotal;
        const newStatus = totalConfirmed >= Number(existing.voucher.amount) ? 'PAID' : 'PARTIALLY_PAID';
        await tx.voucher.update({ where: { id: existing.voucher.id }, data: { status: newStatus } });
      }

      return tx.goodsReturn.update({
        where: { id },
        data: { status: 'CONFIRMED', paymentId: payment.id },
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