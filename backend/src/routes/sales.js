import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';
import { generateSaleBillPdf } from '../lib/billPdf.js';

const router = Router();

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD'];

// Thrown from inside the createSale transaction when a guarded decrement
// finds the batch no longer has enough stock (another sale got there first
// between our read and our write). Rolls the whole sale back.
class InsufficientStockError extends Error {}

// Thrown inside a transaction when an aggregator order is no longer in the
// state the caller expected (already collected/cancelled by someone else, or
// a double-click). Rolls the transaction back and surfaces as a 409.
class OrderStateError extends Error {}

const AGGREGATOR_STATUSES = ['PENDING_COLLECTION', 'COMPLETED', 'CANCELLED'];

// What an AGGREGATOR gets back for a sale it placed. The full Sale/SaleItem
// rows carry rate (supplier cost), sellingPrice (dealer wholesale price) and
// originDealerRate — internal margin data an external site has no business
// seeing — so the aggregator path returns only what it needs to show the
// order to its own customer. status is PENDING_COLLECTION until the retailer
// confirms the customer collected and paid cash, then COMPLETED (same as any
// other CASH sale), or CANCELLED.
function toAggregatorView(sale) {
  return {
    id: sale.id,
    retailerId: sale.retailerId,
    date: sale.date,
    status: sale.status,
    totalAmount: sale.totalAmount,
    paymentMode: sale.paymentMode,
    posTransactionRef: sale.posTransactionRef,
    collectedAt: sale.collectedAt,
    cancelledAt: sale.cancelledAt,
    items: sale.items.map((i) => ({
      productId: i.productId,
      productName: i.product?.name ?? null,
      batchName: i.batchName,
      quantity: i.quantity,
      price: i.price,
      mrp: i.mrp,
    })),
  };
}

// Validates a request's items against the seller's own inventory and
// resolves them to batch rows. Each inventoryId must be a specific batch row
// that actually belongs to this seller — checked server-side so a sale can't
// be recorded against another dealer/retailer's stock.
//
// The same batch listed on more than one line is merged into a single line
// first, so the stock check compares against the TOTAL asked for from that
// batch — otherwise two lines of 3 against a batch holding 5 would each pass
// on their own and oversell it.
//
// accountForHeld: for an aggregator order (which takes no stock until
// collection), also subtract units already promised to OTHER
// PENDING_COLLECTION orders, so the same units can't be promised twice. This
// is only a check — nothing is reserved or decremented.
//
// Returns { lines: [{ inv, quantity }] } or { status, error }.
async function resolveBatchLines(scope, items, { accountForHeld = false } = {}) {
  const quantityByInventoryId = new Map();
  for (const i of items) {
    const id = Number(i.inventoryId);
    quantityByInventoryId.set(id, (quantityByInventoryId.get(id) || 0) + Number(i.quantity));
  }
  const inventoryIds = [...quantityByInventoryId.keys()];
  const invRows = await prisma.inventory.findMany({
    where: {
      id: { in: inventoryIds },
      ownerType: scope.ownerType,
      dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
      retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
    }
  });
  const invById = new Map(invRows.map((r) => [r.id, r]));

  let heldById = new Map();
  if (accountForHeld) {
    const held = await prisma.saleItem.groupBy({
      by: ['inventoryId'],
      where: { inventoryId: { in: inventoryIds }, sale: { status: 'PENDING_COLLECTION' } },
      _sum: { quantity: true },
    });
    heldById = new Map(held.map((h) => [h.inventoryId, h._sum.quantity || 0]));
  }

  const lines = [];
  for (const [inventoryId, quantity] of quantityByInventoryId) {
    const inv = invById.get(inventoryId);
    if (!inv) return { status: 403, error: `Batch ${inventoryId} does not belong to your inventory` };
    const available = inv.quantity - (heldById.get(inventoryId) || 0);
    if (available < quantity) {
      return { status: 400, error: `Insufficient stock in batch ${inv.batchName || inv.id} for product ${inv.productId}` };
    }
    lines.push({ inv, quantity });
  }
  return { lines };
}

// Turns resolved batch lines into SaleItem rows. Price and productId are
// derived from the batch, never trusted from the client.
function buildResolvedItems(scope, customerType, lines) {
  return lines.map(({ inv, quantity }) => {
    const price = scope.ownerType === 'RETAILER'
      ? inv.retailerSellingPrice
      : (customerType === 'RETAILER' ? inv.sellingPrice : inv.retailerSellingPrice);
    return {
      productId: inv.productId,
      inventoryId: inv.id,
      quantity,
      price: Number(price),
      mrp: inv.mrp != null ? Number(inv.mrp) : null,
      batchName: inv.batchName || null,
      // Snapshot of this batch's rate (cost paid to supplier) and
      // sellingPrice (dealer -> retailer wholesale price) — see
      // schema.prisma SaleItem.rate/sellingPrice. Used later by
      // soldProducts.js to settle what this seller owes their own
      // upstream dealer/supplier, independent of `price` above (what the
      // end customer was actually charged).
      rate: inv.rate != null ? Number(inv.rate) : null,
      sellingPrice: inv.sellingPrice != null ? Number(inv.sellingPrice) : null,
      // Only ever populated on a RETAILER's own batch (see schema.prisma
      // Inventory.originDealerRate) — the dealer's own cost from THEIR
      // supplier, so reselling this unit can also settle what the
      // originating dealer owes their supplier.
      originDealerRate: inv.originDealerRate != null ? Number(inv.originDealerRate) : null,
    };
  });
}

// Needed only for a RETAILER's CASH sale, to raise the second
// (dealer-owed-to-supplier) SoldProduct row against the right dealer —
// sale.dealerId is null on a retailer's own Sale, so it can't be read off
// the Sale relation the way it is for a dealer's own cash sale.
async function originDealerIdFor(retailerId) {
  const retailer = await prisma.retailer.findUnique({
    where: { id: retailerId },
    select: { primaryDealerId: true },
  });
  return retailer?.primaryDealerId ?? null;
}

// A CASH sale (walk-in end customer) isn't covered by the usual RECEIVABLE
// voucher, so give each line its own SoldProduct row (OPEN) — this is what
// lets the seller pay their own dealer/supplier for exactly what's been sold
// once a settlement period is up (see soldProducts.js). Not created for a
// sale to a RETAILER customer, which already gets a voucher.
//
// A retailer's line additionally raises a SECOND, independent row when it
// carries an originDealerRate — the unit was originally dispatched from a
// dealer's own supplier-sourced batch, so that dealer now separately owes
// THEIR supplier for it too, regardless of when/whether the retailer settles
// with the dealer. See schema.prisma SoldProduct.owedBy.
//
// `sale` must include its items. For an aggregator order this runs at
// COLLECTION time, not when the order is placed.
async function recordCashSoldProducts(tx, sale, ownerType, originDealerId) {
  const rows = [];
  for (const item of sale.items) {
    rows.push({ saleId: sale.id, productId: item.productId, saleItemId: item.id, owedBy: ownerType });
    if (ownerType === 'RETAILER' && item.originDealerRate != null && originDealerId != null) {
      rows.push({
        saleId: sale.id,
        productId: item.productId,
        saleItemId: item.id,
        owedBy: 'DEALER',
        dealerId: originDealerId,
      });
    }
  }
  await tx.soldProduct.createMany({ data: rows });
}

// DEALER/RETAILER only — enforced here, not just by hiding the nav link /
// route in the frontend, since scope.ownerType is empty for ADMIN and
// ORGANISATION and would otherwise fall through to an unfiltered `where`
// below, returning every sale in the system to a non-dealer/retailer caller.
router.get('/', authRequired, requireRole('DEALER', 'RETAILER'), async (req, res) => {
  const scope = ownerScope(req);
  let where = {};
  if (scope.ownerType === 'DEALER') where = { ownerType: 'DEALER', dealerId: scope.dealerId };
  if (scope.ownerType === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: scope.retailerId };
  // Optional ?channel=AGGREGATOR — lets a retailer pull up just the orders an
  // aggregator placed on their behalf (including those still
  // PENDING_COLLECTION), separate from their own POS activity. A dealer's
  // scope is only their OWN sales, so this never shows a dealer their
  // retailers' aggregator orders.
  if (req.query.channel && ['POS', 'AGGREGATOR'].includes(req.query.channel)) {
    where.channel = req.query.channel;
  }
  const sales = await prisma.sale.findMany({
    where,
    include: {
      items: { include: { product: true } },
      // username only — role is implied by channel, and the aggregator's
      // own account details aren't this dealer/retailer's business.
      placedByUser: { select: { username: true } },
    },
    orderBy: { date: 'desc' }
  });
  res.json(sales);
});

// GET /api/sales/available-items — every in-stock batch for the seller's own
// inventory, grouped implicitly by productId. Includes each batch's mrp
// (alongside sellingPrice/retailerSellingPrice) so the sales screen can show
// MRP and the resulting savings before the line is even added. The frontend
// uses this to populate the "add product" picker: when a product has more
// than one batch with quantity > 0, show a batch selector (batchName +
// expiry + qty) so the user explicitly picks which one to add to the sale
// table. No default is pre-selected when multiple batches exist — the user
// must choose.
router.get('/available-items', authRequired, async (req, res) => {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts have a sales inventory' });

  const where = {
    ownerType: scope.ownerType,
    dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
    retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
    quantity: { gt: 0 },
  };

  const batches = await prisma.inventory.findMany({
    where,
    include: { product: true },
    orderBy: [{ productId: 'asc' }, { expiryDate: 'asc' }]
  });

  res.json(batches);
});

// Create a sale (bill). Body:
// { customerType: 'CASH' | 'RETAILER' (dealer only — retailer sales are always CASH),
//   customerRetailerId, paymentMode, posTransactionRef,
//   items: [{ inventoryId, quantity }] }
//
// Each line item references a specific Inventory batch row (inventoryId),
// not just a productId — this is how batch selection from the UI reaches
// the backend. Price and productId are derived from that exact batch, never
// trusted from the client:
//   - RETAILER-scoped seller: always that batch's retailerSellingPrice
//   - DEALER-scoped seller, CASH customer: that batch's retailerSellingPrice
//     (dealer selling direct to a walk-in customer, retail price)
//   - DEALER-scoped seller, RETAILER customer: that batch's sellingPrice
//     (dealer's wholesale price to a retailer)
// Discount is not applied at sale time — it was already baked into
// retailerSellingPrice at purchase time (PurchaseItem.discount).
//
// This is the ordinary POS path (a dealer or retailer's own login, scope from
// ownerScope(req)). Aggregator orders do NOT go through here — they are
// created PENDING_COLLECTION by the on-behalf/:retailerId route below and
// only take stock once the retailer confirms collection.
async function createSale(req, res) {
  try {
    const scope = ownerScope(req);
    if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can create sales' });

    const customerType = scope.ownerType === 'RETAILER' ? 'CASH' : (req.body.customerType || 'CASH');
    const { customerRetailerId, paymentMode, posTransactionRef, items } = req.body;

    if (!['CASH', 'RETAILER'].includes(customerType)) {
      return res.status(400).json({ error: 'customerType must be CASH or RETAILER' });
    }
    if (!PAYMENT_MODES.includes(paymentMode)) {
      return res.status(400).json({ error: `paymentMode must be one of ${PAYMENT_MODES.join(', ')}` });
    }
    if (customerType === 'RETAILER' && !customerRetailerId) {
      return res.status(400).json({ error: 'customerRetailerId is required when customerType is RETAILER' });
    }
    if (!items || !items.length) return res.status(400).json({ error: 'No items in sale' });
    for (const i of items) {
      if (!i.inventoryId) return res.status(400).json({ error: 'inventoryId is required for every item (select a specific batch)' });
      if (!i.quantity || Number(i.quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });
    }

    const resolvedBatches = await resolveBatchLines(scope, items);
    if (resolvedBatches.error) return res.status(resolvedBatches.status).json({ error: resolvedBatches.error });
    const { lines } = resolvedBatches;

    const resolvedItems = buildResolvedItems(scope, customerType, lines);

    const totalAmount = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const channel = 'POS';
    const placedByUserId = req.user?.id ?? null;
    const originDealerId = scope.ownerType === 'RETAILER' ? await originDealerIdFor(scope.retailerId) : null;

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          ownerType: scope.ownerType,
          dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
          retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
          customerType,
          customerRetailerId: customerType === 'RETAILER' ? Number(customerRetailerId) : null,
          status: 'COMPLETED',
          totalAmount,
          paymentMode,
          posTransactionRef: posTransactionRef || null,
          channel,
          placedByUserId,
          items: { create: resolvedItems }
        },
        include: { items: { include: { product: true } } }
      });

      // decrement the exact batch row that was sold from, inside the same
      // transaction as the sale, so a failed decrement rolls back the sale.
      // The `quantity: { gte }` guard makes the check-and-decrement a single
      // atomic statement: the stock check above ran before this transaction,
      // so a concurrent sale (POS + aggregator, or two aggregator orders)
      // could have drained the batch since. count === 0 means that happened.
      for (const { inv, quantity } of lines) {
        const { count } = await tx.inventory.updateMany({
          where: { id: inv.id, quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (count === 0) {
          throw new InsufficientStockError(`Insufficient stock in batch ${inv.batchName || inv.id} for product ${inv.productId}`);
        }
      }

      if (customerType === 'CASH') {
        await recordCashSoldProducts(tx, created, scope.ownerType, originDealerId);
      }

      // If a dealer sells to a retailer, auto-generate a receivable voucher
      if (scope.ownerType === 'DEALER' && customerType === 'RETAILER' && customerRetailerId) {
        await tx.voucher.create({
          data: {
            dealerId: scope.dealerId,
            retailerId: Number(customerRetailerId),
            saleId: created.id,
            amount: totalAmount,
            description: `Auto-voucher for Sale #${created.id}`,
          }
        });
      }

      return created;
    });

    res.json(sale);
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return res.status(409).json({ error: err.message });
    }
    console.error('createSale failed:', err);
    res.status(500).json({ error: 'Failed to create sale', detail: err.message });
  }
}

router.post('/', authRequired, (req, res) => createSale(req, res));

// POS webhook: external POS/card machine posts completed transaction here.
// This lets a physical POS terminal push a paid bill straight into the sales module
// (e.g. the terminal's integration software calls this endpoint once payment clears).
router.post('/pos-webhook', authRequired, (req, res) => {
  req.body.posTransactionRef = req.body.posTransactionRef || `POS-${Date.now()}`;
  return createSale(req, res);
});

// POST /api/sales/on-behalf/:retailerId — AGGREGATOR only. Places an order
// against a SPECIFIC retailer's inventory — chosen by the external site's
// customer, not derived from who is logged in (the aggregator authenticates
// with its own dedicated AGGREGATOR-role login, which is not tied to any one
// dealer — see schema.prisma Role.AGGREGATOR).
//
// This does NOT create a finished CASH sale. The customer has to collect the
// goods from the retailer in person and pay cash there, so the order is
// recorded as PENDING_COLLECTION: price/batch are snapshotted, but NO stock
// is decremented and no settlement (SoldProduct) rows are raised yet. Both
// happen when the retailer confirms collection (PATCH /:id/collect below),
// at which point it becomes a normal COMPLETED CASH sale. A retailer who
// never sees the customer can cancel it (PATCH /:id/cancel), and the
// aggregator can cancel its own order too (PATCH /aggregator/:id/cancel),
// with nothing to undo either way. The aggregator follows the status through
// GET /sales/aggregator.
//
// Units already promised to other pending orders are excluded from what's
// considered available, so the same stock can't be promised twice.
//
// Only checks that the retailer exists — an aggregator may act on behalf of
// ANY retailer on the platform, not just one dealer's own.
//
// posTransactionRef is required and doubles as the aggregator's idempotency
// key: unique per order on the aggregator's side. A retry with the same ref
// (e.g. after a timeout) returns the order already recorded (200,
// Idempotent-Replay: true) instead of creating a second one. Scoped to this
// aggregator login + this retailer. (Check-then-create, not a DB unique
// constraint — two retries arriving at the exact same instant could still
// both get through.)
router.post('/on-behalf/:retailerId', authRequired, requireRole('AGGREGATOR'), async (req, res) => {
  try {
    const retailerId = Number(req.params.retailerId);
    const retailer = await prisma.retailer.findUnique({ where: { id: retailerId } });
    if (!retailer) {
      return res.status(404).json({ error: 'Retailer not found' });
    }

    const ref = typeof req.body.posTransactionRef === 'string' ? req.body.posTransactionRef.trim() : '';
    if (!ref) {
      return res.status(400).json({ error: 'posTransactionRef is required (unique per order — used to prevent duplicate orders on retry)' });
    }
    const existing = await prisma.sale.findFirst({
      where: { channel: 'AGGREGATOR', placedByUserId: req.user.id, retailerId, posTransactionRef: ref },
      include: { items: { include: { product: true } } },
    });
    if (existing) {
      res.set('Idempotent-Replay', 'true');
      return res.json(toAggregatorView(existing));
    }

    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items in order' });
    for (const i of items) {
      if (!i.inventoryId) return res.status(400).json({ error: 'inventoryId is required for every item (select a specific batch)' });
      if (!i.quantity || Number(i.quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });
    }

    const scope = { ownerType: 'RETAILER', retailerId, dealerId: null };
    const resolvedBatches = await resolveBatchLines(scope, items, { accountForHeld: true });
    if (resolvedBatches.error) return res.status(resolvedBatches.status).json({ error: resolvedBatches.error });

    const resolvedItems = buildResolvedItems(scope, 'CASH', resolvedBatches.lines);
    const totalAmount = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const order = await prisma.sale.create({
      data: {
        ownerType: 'RETAILER',
        retailerId,
        customerType: 'CASH',
        status: 'PENDING_COLLECTION',
        totalAmount,
        // Always cash — the customer pays the retailer in person on pickup.
        paymentMode: 'CASH',
        posTransactionRef: ref,
        channel: 'AGGREGATOR',
        placedByUserId: req.user.id,
        items: { create: resolvedItems },
      },
      include: { items: { include: { product: true } } },
    });
    res.json(toAggregatorView(order));
  } catch (err) {
    console.error('aggregator order failed:', err);
    res.status(500).json({ error: 'Failed to place order', detail: err.message });
  }
});

// GET /api/sales/aggregator — AGGREGATOR only. The orders THIS aggregator
// login has placed, newest first, with their current status
// (PENDING_COLLECTION -> COMPLETED once collected and paid, or CANCELLED).
// Optional filters: ?status=, ?retailerId=, ?from= / ?to= (ISO dates, applied
// to the order date, `to` inclusive of that whole day), and ?limit= (default
// 100, max 500) / ?offset= for paging. The total number of matching orders is
// returned in the X-Total-Count header.
router.get('/aggregator', authRequired, requireRole('AGGREGATOR'), async (req, res) => {
  const where = { channel: 'AGGREGATOR', placedByUserId: req.user.id };
  if (req.query.status) {
    if (!AGGREGATOR_STATUSES.includes(req.query.status)) {
      return res.status(400).json({ error: `status must be one of ${AGGREGATOR_STATUSES.join(', ')}` });
    }
    where.status = req.query.status;
  }
  if (req.query.retailerId) {
    const rid = Number(req.query.retailerId);
    if (!Number.isInteger(rid)) return res.status(400).json({ error: 'retailerId must be a number' });
    where.retailerId = rid;
  }
  const dateRange = {};
  if (req.query.from) {
    const from = new Date(req.query.from);
    if (Number.isNaN(from.getTime())) return res.status(400).json({ error: 'from must be a valid date (YYYY-MM-DD)' });
    dateRange.gte = from;
  }
  if (req.query.to) {
    const to = new Date(req.query.to);
    if (Number.isNaN(to.getTime())) return res.status(400).json({ error: 'to must be a valid date (YYYY-MM-DD)' });
    // A bare date means the whole of that day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))) to.setUTCHours(23, 59, 59, 999);
    dateRange.lte = to;
  }
  if (Object.keys(dateRange).length) where.date = dateRange;

  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return res.status(400).json({ error: 'limit must be a whole number between 1 and 500' });
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return res.status(400).json({ error: 'offset must be a whole number, 0 or more' });
  }

  const [total, sales] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      include: { items: { include: { product: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
      skip: offset,
    }),
  ]);
  res.set('X-Total-Count', String(total));
  res.json(sales.map(toAggregatorView));
});

router.get('/aggregator/:id', authRequired, requireRole('AGGREGATOR'), async (req, res) => {
  const sale = await prisma.sale.findFirst({
    where: { id: Number(req.params.id), channel: 'AGGREGATOR', placedByUserId: req.user.id },
    include: { items: { include: { product: true } } },
  });
  if (!sale) return res.status(404).json({ error: 'Order not found' });
  res.json(toAggregatorView(sale));
});

// PATCH /api/sales/aggregator/:id/cancel — AGGREGATOR only. The aggregator's
// customer changed their mind before collecting, so the aggregator cancels
// the order it placed. Only the login that placed the order can cancel it,
// and only while it is still PENDING_COLLECTION — once the retailer has
// confirmed collection and payment it is a completed cash sale and can't be
// cancelled here (409). No stock was ever taken, so nothing is restored.
// Cancelling an already-cancelled order just returns it (safe to retry). The
// status-guarded update means a retailer confirming collection at the same
// moment can't also be cancelled: whichever lands first wins, and the other
// gets a 409 / sees the final state.
router.patch('/aggregator/:id/cancel', authRequired, requireRole('AGGREGATOR'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const where = { id, channel: 'AGGREGATOR', placedByUserId: req.user.id };
    const order = await prisma.sale.findFirst({ where, include: { items: { include: { product: true } } } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'CANCELLED') return res.json(toAggregatorView(order));
    if (order.status !== 'PENDING_COLLECTION') {
      return res.status(409).json({ error: 'This order has already been collected and paid, so it can no longer be cancelled' });
    }
    const { count } = await prisma.sale.updateMany({
      where: { ...where, status: 'PENDING_COLLECTION' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (count === 0) {
      return res.status(409).json({ error: 'This order is no longer awaiting collection' });
    }
    const fresh = await prisma.sale.findUnique({ where: { id }, include: { items: { include: { product: true } } } });
    res.json(toAggregatorView(fresh));
  } catch (err) {
    console.error('aggregator cancel failed:', err);
    res.status(500).json({ error: 'Failed to cancel order', detail: err.message });
  }
});

// Loads an aggregator-channel sale belonging to the logged-in RETAILER, for
// the collect/cancel actions below. Returns the sale, or sends the error.
async function loadOwnAggregatorSale(req, res) {
  const sale = await prisma.sale.findUnique({ where: { id: Number(req.params.id) }, include: { items: true } });
  if (!sale || sale.channel !== 'AGGREGATOR') {
    res.status(404).json({ error: 'Order not found' });
    return null;
  }
  if (sale.retailerId !== req.user.retailerId) {
    res.status(403).json({ error: 'You can only manage your own orders' });
    return null;
  }
  return sale;
}

// PATCH /api/sales/:id/collect — RETAILER only. The customer has picked up
// the goods and paid cash: THIS is the moment the sale becomes real. In one
// transaction the order is claimed (PENDING_COLLECTION -> COMPLETED, so a
// double click or a concurrent cancel can't also act on it), each batch is
// decremented with the same guarded decrement as a POS sale, and the
// SoldProduct settlement rows a CASH sale gets are raised. If any batch no
// longer has enough stock (it was sold at the counter in the meantime) the
// whole thing rolls back, the order stays PENDING_COLLECTION, and the
// retailer gets a 409 telling them which batch — they can cancel it.
router.patch('/:id/collect', authRequired, requireRole('RETAILER'), async (req, res) => {
  try {
    const sale = await loadOwnAggregatorSale(req, res);
    if (!sale) return;
    if (sale.status !== 'PENDING_COLLECTION') {
      return res.status(400).json({ error: 'Only an order awaiting collection can be marked collected' });
    }
    const originDealerId = await originDealerIdFor(sale.retailerId);

    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.sale.updateMany({
        where: { id: sale.id, status: 'PENDING_COLLECTION' },
        data: { status: 'COMPLETED', collectedAt: new Date() },
      });
      if (claimed.count === 0) throw new OrderStateError('This order is no longer awaiting collection');

      for (const item of sale.items) {
        if (!item.inventoryId) throw new OrderStateError(`Order line ${item.id} has no batch recorded`);
        const { count } = await tx.inventory.updateMany({
          where: { id: item.inventoryId, ownerType: 'RETAILER', retailerId: sale.retailerId, quantity: { gte: item.quantity } },
          data: { quantity: { decrement: item.quantity } },
        });
        if (count === 0) {
          throw new InsufficientStockError(`Insufficient stock in batch ${item.batchName || item.inventoryId} for product ${item.productId}`);
        }
      }

      const fresh = await tx.sale.findUnique({
        where: { id: sale.id },
        include: { items: { include: { product: true } }, placedByUser: { select: { username: true } } },
      });
      await recordCashSoldProducts(tx, fresh, 'RETAILER', originDealerId);
      return fresh;
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof InsufficientStockError || err instanceof OrderStateError) {
      return res.status(409).json({ error: err.message });
    }
    console.error('collect failed:', err);
    res.status(500).json({ error: 'Failed to mark order collected', detail: err.message });
  }
});

// PATCH /api/sales/:id/cancel — RETAILER only. The customer never came (or
// the retailer can't fulfil it). No stock was ever taken, so there is nothing
// to restore — the order just moves PENDING_COLLECTION -> CANCELLED.
router.patch('/:id/cancel', authRequired, requireRole('RETAILER'), async (req, res) => {
  try {
    const sale = await loadOwnAggregatorSale(req, res);
    if (!sale) return;
    if (sale.status !== 'PENDING_COLLECTION') {
      return res.status(400).json({ error: 'Only an order awaiting collection can be cancelled' });
    }
    const { count } = await prisma.sale.updateMany({
      where: { id: sale.id, status: 'PENDING_COLLECTION' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (count === 0) return res.status(409).json({ error: 'This order is no longer awaiting collection' });
    const fresh = await prisma.sale.findUnique({
      where: { id: sale.id },
      include: { items: { include: { product: true } }, placedByUser: { select: { username: true } } },
    });
    res.json(fresh);
  } catch (err) {
    console.error('cancel failed:', err);
    res.status(500).json({ error: 'Failed to cancel order', detail: err.message });
  }
});

// PATCH /api/sales/:id/dispatch — a dealer fulfils a retailer's purchase
// order (a Sale in IN_PENDING status, auto-created by purchases.js when the
// retailer placed it — see PATCH /purchases/:id/status). Body:
// { paymentMode, items: [{ saleItemId, inventoryId }] }
//
// For each line the dealer picks which of their own Inventory batches to
// fulfil it from — same price rule as a direct dealer -> retailer POS sale
// (wholesale sellingPrice, never trusted from the client, always resolved
// from the chosen batch). That batch is decremented, the Sale is marked
// DISPATCHED with a real total, the usual receivable voucher is raised
// (this is a dealer -> retailer sale either way), and — if this Sale is
// linked to a retailer purchase order — that order's PurchaseItem rows are
// backfilled with the batch's pricing/dates/batchName and the order itself
// is moved to IN_TRANSIT, ready for the retailer to mark RECEIVED.
router.patch('/:id/dispatch', authRequired, requireRole('DEALER'), async (req, res) => {
  try {
    const scope = ownerScope(req);
    const id = Number(req.params.id);
    const { paymentMode, items } = req.body;

    if (!PAYMENT_MODES.includes(paymentMode)) {
      return res.status(400).json({ error: `paymentMode must be one of ${PAYMENT_MODES.join(', ')}` });
    }
    // Not required to be non-empty here — an order where every line ended up
    // zeroed out (no stock for any of it) legitimately has nothing to pick a
    // batch for, and is still a valid (if empty) dispatch. See `toDeliver`
    // below for the actual per-line requirement.
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be an array' });

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true, linkedPurchase: true }
    });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (sale.dealerId !== scope.dealerId) return res.status(403).json({ error: 'You can only dispatch your own sales' });
    if (sale.status !== 'IN_PENDING') return res.status(400).json({ error: 'Only a pending order can be dispatched' });

    // A batch must be chosen for every line the dealer is actually
    // delivering. A line the dealer has already zeroed out via PATCH
    // /:id/items (no stock left at all for that product) is exempt — there's
    // nothing to pick a batch from, and nothing to dispatch for it.
    const toDeliver = sale.items.filter((si) => si.quantity > 0);
    const chosenBySaleItemId = new Map(items.map((i) => [Number(i.saleItemId), Number(i.inventoryId)]));
    if (toDeliver.some((si) => !chosenBySaleItemId.has(si.id))) {
      return res.status(400).json({ error: 'A batch must be chosen for every item being delivered' });
    }

    const inventoryIds = toDeliver.map((si) => chosenBySaleItemId.get(si.id));
    const invRows = await prisma.inventory.findMany({
      where: { id: { in: inventoryIds }, ownerType: 'DEALER', dealerId: scope.dealerId }
    });
    const invById = new Map(invRows.map((r) => [r.id, r]));

    const resolved = [];
    for (const saleItem of toDeliver) {
      const inv = invById.get(chosenBySaleItemId.get(saleItem.id));
      if (!inv) return res.status(403).json({ error: `Batch ${chosenBySaleItemId.get(saleItem.id)} does not belong to your inventory` });
      if (inv.productId !== saleItem.productId) return res.status(400).json({ error: 'Chosen batch does not match the ordered product' });
      if (inv.quantity < saleItem.quantity) {
        return res.status(400).json({ error: `Insufficient stock in batch ${inv.batchName || inv.id} for product ${inv.productId}` });
      }
      resolved.push({ saleItem, inv });
    }

    const totalAmount = resolved.reduce((sum, { saleItem, inv }) => sum + Number(inv.sellingPrice) * saleItem.quantity, 0);

    const updatedSale = await prisma.$transaction(async (tx) => {
      for (const { saleItem, inv } of resolved) {
        await tx.saleItem.update({
          where: { id: saleItem.id },
          data: {
            price: inv.sellingPrice,
            mrp: inv.mrp,
            batchName: inv.batchName,
            rate: inv.rate,
            sellingPrice: inv.sellingPrice,
          }
        });
        await tx.inventory.update({ where: { id: inv.id }, data: { quantity: { decrement: saleItem.quantity } } });
      }

      const s = await tx.sale.update({
        where: { id },
        data: { status: 'DISPATCHED', totalAmount, paymentMode },
        include: { items: { include: { product: true } } }
      });

      // Same auto-voucher a direct dealer -> retailer POS sale would raise.
      if (sale.customerRetailerId) {
        await tx.voucher.create({
          data: {
            dealerId: scope.dealerId,
            retailerId: sale.customerRetailerId,
            saleId: sale.id,
            amount: totalAmount,
            description: `Auto-voucher for Sale #${sale.id}`,
          }
        });
      }

      // Backfill the linked purchase order's items with this batch's
      // pricing/dates so the retailer's inventory-crediting step (once
      // they mark it RECEIVED) has real values to work with — exactly
      // like a dealer's own purchase from a supplier would.
      if (sale.linkedPurchase) {
        for (const { saleItem, inv } of resolved) {
          if (!saleItem.purchaseItemId) continue;
          await tx.purchaseItem.update({
            where: { id: saleItem.purchaseItemId },
            data: {
              rate: inv.sellingPrice, // dealer's wholesale price becomes the retailer's cost
              dealerCommission: 0,    // not meaningful further down the chain
              sellingPrice: inv.sellingPrice,
              discount: inv.discount,
              mrp: inv.mrp,
              retailerSellingPrice: inv.retailerSellingPrice, // retailer's resale price to their own customer
              manufacturingDate: inv.manufacturingDate,
              expiryDate: inv.expiryDate,
              batchName: inv.batchName,
              // The dealer's own cost from THEIR supplier — carried through
              // so once the retailer resells this unit, the dealer's
              // obligation to their supplier can be settled too (see
              // schema.prisma SoldProduct.owedBy).
              originDealerRate: inv.rate,
            }
          });
        }
        await tx.purchase.update({ where: { id: sale.linkedPurchase.id }, data: { status: 'IN_TRANSIT' } });
      }

      return s;
    });

    res.json(updatedSale);
  } catch (err) {
    console.error('dispatch failed:', err);
    res.status(500).json({ error: 'Failed to dispatch order', detail: err.message });
  }
});

// PATCH /api/sales/:id/items — DEALER only. Edit the ordered quantity of
// one or more lines on a retailer's pending order (a Sale in IN_PENDING
// status), before batches are chosen and it's dispatched. Mirrors
// purchases.js PATCH /:id/quantities on the buyer's side of the same order.
// Body: { items: [{ id: saleItemId, quantity }] }
//
// If this Sale is linked to a retailer's Purchase (Purchase.linkedSaleId),
// the matching PurchaseItem's quantity is kept in sync too, via
// SaleItem.purchaseItemId — otherwise the dealer's fulfilled quantity and
// the retailer's ordered quantity would silently disagree once the order
// moves to IN_TRANSIT/RECEIVED. Locked once DISPATCHED (batches/pricing are
// already committed) or for an ordinary completed POS sale (inventory has
// already been decremented) — see Sales.jsx for the read-only view in
// those cases.
router.patch('/:id/items', authRequired, requireRole('DEALER'), async (req, res) => {
  const scope = ownerScope(req);
  const id = Number(req.params.id);
  const { items } = req.body; // [{ id: saleItemId, quantity }]

  const sale = await prisma.sale.findUnique({ where: { id }, include: { items: true } });
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (sale.dealerId !== scope.dealerId) return res.status(403).json({ error: 'You can only edit your own sales' });
  if (sale.status !== 'IN_PENDING') return res.status(400).json({ error: 'Only a pending order can be edited' });

  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'No items to update' });

  const validItemById = new Map(sale.items.map((i) => [i.id, i]));
  for (const i of items) {
    const saleItem = validItemById.get(Number(i.id));
    if (!saleItem) return res.status(400).json({ error: 'Item does not belong to this sale' });
    // 0 is deliberately allowed here, not just a smaller positive number —
    // it's how a dealer marks a line as "not delivering" when they have no
    // stock left at all for that product (see PATCH /:id/dispatch below,
    // which skips batch selection and inventory decrement entirely for any
    // line left at 0). Only a genuinely negative or missing value is
    // rejected.
    if (i.quantity === undefined || i.quantity === null || i.quantity === '' || Number(i.quantity) < 0) {
      return res.status(400).json({ error: 'Quantity cannot be negative' });
    }
    // A dealer can fulfil for less than what the retailer ordered (partial
    // fulfilment, all the way down to 0 — not delivering it at all), but
    // never more — originalQuantity is the ceiling.
    if (saleItem.originalQuantity != null && Number(i.quantity) > saleItem.originalQuantity) {
      return res.status(400).json({ error: `Quantity cannot exceed the ordered amount (${saleItem.originalQuantity})` });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const i of items) {
      const saleItem = validItemById.get(Number(i.id));
      await tx.saleItem.update({ where: { id: saleItem.id }, data: { quantity: Number(i.quantity) } });
      if (saleItem.purchaseItemId) {
        await tx.purchaseItem.update({ where: { id: saleItem.purchaseItemId }, data: { quantity: Number(i.quantity) } });
      }
    }
  });

  const updated = await prisma.sale.findUnique({
    where: { id },
    include: { items: { include: { product: true } } }
  });
  res.json(updated);
});

// GET /api/sales/:id/bill — standard printable PDF bill. Header shows the
// logged-in seller's own details, product lines (including which batch each
// line was sold from) with running total across pages, and a grand total at
// the bottom of the last page.
router.get('/:id/bill', authRequired, async (req, res) => {
  try {
    const scope = ownerScope(req);
    const id = Number(req.params.id);
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: { include: { product: true } }, dealer: true, retailer: true }
    });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });

    const owns = (scope.ownerType === 'DEALER' && sale.dealerId === scope.dealerId) ||
      (scope.ownerType === 'RETAILER' && sale.retailerId === scope.retailerId);
    if (!owns) return res.status(403).json({ error: 'Forbidden' });
    // An aggregator order that hasn't been collected/paid yet (or was
    // cancelled) isn't a sale yet — no bill until it's COMPLETED.
    if (sale.status === 'PENDING_COLLECTION' || sale.status === 'CANCELLED') {
      return res.status(400).json({ error: 'A bill is only available once the order has been collected and paid' });
    }

    // No relation exists from Sale -> customer Retailer in the schema
    // (customerRetailerId is a plain Int, not an FK), so look it up
    // manually for the bill's "Customer:" line when relevant.
    let customerRetailer = null;
    if (sale.customerType === 'RETAILER' && sale.customerRetailerId) {
      customerRetailer = await prisma.retailer.findUnique({ where: { id: sale.customerRetailerId } });
    }

    const party = sale.dealer || sale.retailer; // header party = whoever made the sale
    const pdfBuffer = await generateSaleBillPdf({ ...sale, customerRetailer }, party);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bill-${sale.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('bill generation failed:', err);
    res.status(500).json({ error: 'Failed to generate bill', detail: err.message });
  }
});

export default router;
