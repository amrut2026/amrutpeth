import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// Status orderings for the payment side. A retailer's payment to their
// dealer is tracked through Receipt.status (the confirmation workflow). A
// dealer's payment to a supplier has no confirmation step - it rides on the
// PAYABLE Voucher's status instead (see schema.prisma comments on
// VoucherType/Receipt).
const RETAILER_PAYMENT_STATUSES = ['TO_BE_CONFIRMED', 'PARTIALLY_PAID', 'PAID'];
const DEALER_PAYMENT_STATUSES = ['OPEN', 'PARTIALLY_PAID', 'PAID'];

function groupByStatus(rows, statuses, statusOf) {
  const groups = Object.fromEntries(statuses.map((s) => [s, []]));
  for (const row of rows) {
    const status = statusOf(row);
    if (!groups[status]) groups[status] = [];
    groups[status].push(row);
  }
  return statuses
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .map((status) => ({ status, items: groups[status] }));
}

// Products purchased/received: a retailer sees what they've ordered from
// their dealer, a dealer sees what they've ordered from their supplier.
// Returned flat (not pre-grouped by status) along with the list of
// counterparties (dealer(s) for a retailer, suppliers for a dealer) so the
// frontend can offer a counterparty dropdown and group by status within it.
router.get('/purchases', authRequired, async (req, res) => {
  if (req.user.role === 'RETAILER') {
    const purchases = await prisma.purchase.findMany({
      where: { ownerType: 'RETAILER', retailerId: req.user.retailerId },
      include: { items: { include: { product: true } }, sourceDealer: true },
      orderBy: { date: 'desc' },
    });
    // Derived from the purchase rows themselves, same as the dealer branch
    // below - not fetched separately. In practice a retailer only ever
    // purchases from their one primary dealer, so this naturally comes out
    // to a single entry once they have any purchase history.
    const dealerMap = new Map();
    for (const p of purchases) {
      if (p.sourceDealer) dealerMap.set(p.sourceDealer.id, p.sourceDealer.name);
    }
    const counterparties = [...dealerMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.json({
      context: 'RETAILER',
      counterparties,
      purchases: purchases.map((p) => ({
        id: p.id,
        date: p.date,
        status: p.status,
        counterpartyId: p.sourceDealer?.id ?? null,
        counterpartyName: p.sourceDealer?.name ?? null,
        items: p.items,
      })),
    });
  }

  if (req.user.role === 'DEALER') {
    const purchases = await prisma.purchase.findMany({
      where: { ownerType: 'DEALER', dealerId: req.user.dealerId },
      include: { items: { include: { product: true } }, supplier: true },
      orderBy: { date: 'desc' },
    });
    const supplierMap = new Map();
    for (const p of purchases) {
      if (p.supplier) supplierMap.set(p.supplier.id, p.supplier.name);
    }
    const counterparties = [...supplierMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.json({
      context: 'DEALER',
      counterparties,
      purchases: purchases.map((p) => ({
        id: p.id,
        date: p.date,
        status: p.status,
        counterpartyId: p.supplier?.id ?? null,
        counterpartyName: p.supplier?.name ?? null,
        items: p.items,
      })),
    });
  }

  // ADMIN / ORGANISATION - everything, across both dealer and supplier
  // counterparties. Prefix ids by type since a dealer id and a supplier id
  // can otherwise collide.
  const purchases = await prisma.purchase.findMany({
    include: { items: { include: { product: true } }, sourceDealer: true, supplier: true },
    orderBy: { date: 'desc' },
  });
  const counterpartyMap = new Map();
  const keyed = purchases.map((p) => {
    const isDealer = !!p.sourceDealer;
    const cp = p.sourceDealer || p.supplier;
    const counterpartyId = cp ? `${isDealer ? 'd' : 's'}:${cp.id}` : null;
    if (cp) counterpartyMap.set(counterpartyId, cp.name);
    return {
      id: p.id,
      date: p.date,
      status: p.status,
      counterpartyId,
      counterpartyName: cp?.name ?? null,
      items: p.items,
    };
  });
  res.json({
    context: 'ALL',
    counterparties: [...counterpartyMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    purchases: keyed,
  });
});

// Payments made: a retailer sees what they've paid their dealer, a dealer
// sees what they've paid their supplier. Grouped by current status (Receipt
// status for retailer->dealer, Voucher status for dealer->supplier).
router.get('/payments', authRequired, async (req, res) => {
  if (req.user.role === 'RETAILER') {
    const payments = await prisma.payment.findMany({
      where: { retailerId: req.user.retailerId },
      include: { receipt: true, voucher: true, dealer: true },
      orderBy: { date: 'desc' },
    });
    return res.json({
      context: 'RETAILER',
      groups: groupByStatus(
        payments,
        RETAILER_PAYMENT_STATUSES,
        // A goods-return credit (see goodsReturns.js) has no Receipt row —
        // it's created only once the dealer has already confirmed receipt
        // of the goods, so it's settled from the moment it exists, unlike
        // an ordinary cash/UPI/card payment which sits TO_BE_CONFIRMED
        // until the dealer separately confirms the money arrived.
        (p) => p.receipt?.status ?? (p.mode === 'GOODS_RETURN' ? 'PAID' : 'TO_BE_CONFIRMED')
      ),
    });
  }

  if (req.user.role === 'DEALER') {
    const payments = await prisma.payment.findMany({
      where: { dealerId: req.user.dealerId, supplierId: { not: null } },
      include: { voucher: true, supplier: true },
      orderBy: { date: 'desc' },
    });
    return res.json({
      context: 'DEALER',
      groups: groupByStatus(payments, DEALER_PAYMENT_STATUSES, (p) => p.voucher?.status ?? 'PAID'),
    });
  }

  // ADMIN / ORGANISATION - everything, across both status flows.
  const payments = await prisma.payment.findMany({
    include: { receipt: true, voucher: true, supplier: true, retailer: true, dealer: true },
    orderBy: { date: 'desc' },
  });
  res.json({
    context: 'ALL',
    groups: groupByStatus(
      payments,
      [...RETAILER_PAYMENT_STATUSES, ...DEALER_PAYMENT_STATUSES],
      (p) => p.receipt?.status ?? p.voucher?.status ?? 'PAID'
    ),
  });
});

// Vouchers (with their payments): a dealer sees both directions - what
// they owe suppliers (PAYABLE vouchers, dealer -> supplier) and what
// retailers owe them (RECEIVABLE vouchers, dealer -> retailer). A retailer
// only ever sees the one direction - what they owe their dealer
// (RECEIVABLE vouchers where they're the retailer). Both sides of a
// Voucher share the same VoucherStatus (OPEN/PARTIALLY_PAID/PAID), so
// vouchers and their payments are grouped by that one status on the
// frontend rather than needing separate orderings like /payments above.
function serializeVoucher(v, { includeDealer = false } = {}) {
  return {
    id: v.id,
    date: v.date,
    status: v.status,
    amount: v.amount,
    description: v.description,
    counterpartyId: v.supplierId ?? v.retailerId ?? null,
    counterpartyName: v.supplier?.name ?? v.retailer?.name ?? null,
    ...(includeDealer ? { dealerName: v.dealer?.name ?? null } : {}),
  };
}

function serializeVoucherPayment(p, { includeDealer = false } = {}) {
  return {
    id: p.id,
    date: p.date,
    amount: p.amount,
    mode: p.mode,
    reference: p.reference,
    counterpartyId: p.supplierId ?? p.retailerId ?? null,
    counterpartyName: p.supplier?.name ?? p.retailer?.name ?? null,
    voucherStatus: p.voucher?.status ?? null,
    ...(includeDealer ? { dealerName: p.dealer?.name ?? null } : {}),
  };
}

router.get('/vouchers', authRequired, async (req, res) => {
  if (req.user.role === 'DEALER') {
    const dealerId = req.user.dealerId;
    const [supplierVouchers, supplierPayments, retailerVouchers, retailerPayments] = await Promise.all([
      prisma.voucher.findMany({ where: { dealerId, type: 'PAYABLE' }, include: { supplier: true }, orderBy: { date: 'desc' } }),
      prisma.payment.findMany({ where: { dealerId, supplierId: { not: null } }, include: { supplier: true, voucher: true }, orderBy: { date: 'desc' } }),
      prisma.voucher.findMany({ where: { dealerId, type: 'RECEIVABLE' }, include: { retailer: true }, orderBy: { date: 'desc' } }),
      prisma.payment.findMany({ where: { dealerId, retailerId: { not: null } }, include: { retailer: true, voucher: true }, orderBy: { date: 'desc' } }),
    ]);

    // Flag a retailer payment that's a confirmed sold-products settlement
    // (soldProducts.js POST /pay + PATCH /pay/:paymentId/confirm — the
    // only route that creates a retailer Payment with no voucherId of its
    // own, unlike a receipts.js POST / payment which is always tied to
    // one from the start) that's never actually been applied against any
    // of this retailer's RECEIVABLE vouchers, so the frontend can
    // highlight it and offer POST /sold-products/pay/:paymentId/adjust-
    // vouchers to fix it retroactively. Only flagged when there's
    // actually an outstanding voucher to adjust against - otherwise the
    // action would be a dead end.
    const unlinkedPaymentIds = retailerPayments.filter((p) => p.voucherId == null).map((p) => p.id);
    const confirmedSoldProductPaymentIds = new Set();
    if (unlinkedPaymentIds.length) {
      const confirmedRows = await prisma.soldProduct.findMany({
        where: { paymentId: { in: unlinkedPaymentIds }, owedBy: 'RETAILER', status: 'PAID' },
        select: { paymentId: true },
      });
      for (const r of confirmedRows) confirmedSoldProductPaymentIds.add(r.paymentId);
    }
    const outstandingRetailerIds = new Set(
      retailerVouchers.filter((v) => v.status !== 'PAID').map((v) => v.retailerId)
    );

    return res.json({
      context: 'DEALER',
      supplier: {
        vouchers: supplierVouchers.map((v) => serializeVoucher(v)),
        payments: supplierPayments.map((p) => serializeVoucherPayment(p)),
      },
      retailer: {
        vouchers: retailerVouchers.map((v) => serializeVoucher(v)),
        payments: retailerPayments.map((p) => {
          const marker = `Sold Products Payment #${p.id}`;
          const alreadyAdjusted = retailerVouchers.some(
            (v) => v.retailerId === p.retailerId && v.description?.includes(marker)
          );
          const needsVoucherAdjustment =
            p.voucherId == null &&
            confirmedSoldProductPaymentIds.has(p.id) &&
            !alreadyAdjusted &&
            outstandingRetailerIds.has(p.retailerId);
          return { ...serializeVoucherPayment(p), needsVoucherAdjustment };
        }),
      },
    });
  }

  if (req.user.role === 'RETAILER') {
    const retailerId = req.user.retailerId;
    const [vouchers, payments] = await Promise.all([
      prisma.voucher.findMany({ where: { retailerId, type: 'RECEIVABLE' }, include: { dealer: true }, orderBy: { date: 'desc' } }),
      prisma.payment.findMany({ where: { retailerId }, include: { dealer: true, voucher: true }, orderBy: { date: 'desc' } }),
    ]);
    return res.json({
      context: 'RETAILER',
      dealer: {
        vouchers: vouchers.map((v) => serializeVoucher(v, { includeDealer: true })),
        payments: payments.map((p) => serializeVoucherPayment(p, { includeDealer: true })),
      },
    });
  }

  // ADMIN / ORGANISATION - everything, across every dealer, split the same
  // way as the DEALER branch (supplier side / retailer side) but with the
  // owning dealer's name attached since it now spans more than one dealer.
  const [payableVouchers, receivableVouchers, payments] = await Promise.all([
    prisma.voucher.findMany({ where: { type: 'PAYABLE' }, include: { supplier: true, dealer: true }, orderBy: { date: 'desc' } }),
    prisma.voucher.findMany({ where: { type: 'RECEIVABLE' }, include: { retailer: true, dealer: true }, orderBy: { date: 'desc' } }),
    prisma.payment.findMany({ include: { supplier: true, retailer: true, dealer: true, voucher: true }, orderBy: { date: 'desc' } }),
  ]);
  res.json({
    context: 'ALL',
    supplier: {
      vouchers: payableVouchers.map((v) => serializeVoucher(v, { includeDealer: true })),
      payments: payments.filter((p) => p.supplierId).map((p) => serializeVoucherPayment(p, { includeDealer: true })),
    },
    retailer: {
      vouchers: receivableVouchers.map((v) => serializeVoucher(v, { includeDealer: true })),
      payments: payments.filter((p) => p.retailerId).map((p) => serializeVoucherPayment(p, { includeDealer: true })),
    },
  });
});

// Inventory report (with low-stock flag) - reused by dealer or retailer
// login. Always a flat array, for every role (ADMIN/ORGANISATION included) -
// other consumers of this endpoint (e.g. dashboard widgets) rely on that
// shape, so it's left exactly as it always was. The ADMIN-only dealer/
// retailer split used by the Reports screen lives at
// /reports/inventory-by-owner below instead of changing this response.
router.get('/inventory', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { ownerType: 'DEALER', dealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: req.user.retailerId };
  const rows = await prisma.inventory.findMany({ where, include: { product: true } });
  res.json(rows.map(r => ({ ...r, lowStock: r.quantity <= r.reorderLevel })));
});

// Inventory split by owner type (dealer-owned vs retailer-owned) - used
// only by the admin/organisation Reports screen's Dealer Inventory /
// Retailer Inventory tabs. DEALER and RETAILER logins don't need this
// split (their /reports/inventory above is already scoped to just their
// own stock), so this route only serves ADMIN/ORGANISATION.
router.get('/inventory-by-owner', authRequired, async (req, res) => {
  if (req.user.role === 'DEALER' || req.user.role === 'RETAILER') {
    return res.status(403).json({ error: 'Not available for this role' });
  }

  // Retailer rows also carry their owning dealer's id/name, so the
  // frontend can offer a dealer filter over retailer inventory (mirroring
  // the dealer scoping used for retailer vouchers/payments above).
  const [dealerRows, retailerRows] = await Promise.all([
    prisma.inventory.findMany({ where: { ownerType: 'DEALER' }, include: { product: true, dealer: true } }),
    prisma.inventory.findMany({
      where: { ownerType: 'RETAILER' },
      include: { product: true, retailer: { include: { dealer: true } } },
    }),
  ]);

  const dealerMap = new Map();
  const retailerInventory = retailerRows.map((r) => {
    const dealer = r.retailer?.dealer ?? null;
    if (dealer) dealerMap.set(dealer.id, dealer.name);
    return {
      ...r,
      retailerName: r.retailer?.name ?? null,
      dealerId: dealer?.id ?? null,
      dealerName: dealer?.name ?? null,
      lowStock: r.quantity <= r.reorderLevel,
    };
  });

  res.json({
    context: 'ALL',
    dealers: [...dealerMap.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    dealerInventory: dealerRows.map((r) => ({
      ...r,
      dealerName: r.dealer?.name ?? null,
      lowStock: r.quantity <= r.reorderLevel,
    })),
    retailerInventory,
  });
});

// Sales summary (for dashboards)
router.get('/sales-summary', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { ownerType: 'DEALER', dealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: req.user.retailerId };
  const sales = await prisma.sale.findMany({ where });
  const totalRevenue = sales.reduce((s, x) => s + Number(x.totalAmount), 0);
  res.json({ count: sales.length, totalRevenue });
});

// Org-level rollup for ADMIN/ORGANISATION dashboards — dealers, retailers,
// and inventory value, grouped by organisation. ADMIN sees every
// organisation; ORGANISATION sees only their own. Deliberately different
// from every other ADMIN/ORGANISATION branch in this file (/purchases,
// /payments, /vouchers, /inventory-by-owner above), which all stay
// unscoped for both roles — here, "every organisation" is the whole point
// of what ADMIN needs, and showing every OTHER org's dealers to an
// ORGANISATION login would leak outside what they're scoped to manage
// everywhere else in the app (dealers.js, divisions.js).
router.get('/org-summary', authRequired, async (req, res) => {
  if (req.user.role === 'DEALER' || req.user.role === 'RETAILER') {
    return res.status(403).json({ error: 'Not available for this role' });
  }

  const orgWhere = req.user.role === 'ORGANISATION' ? { orgId: req.user.organisationId } : {};

  const organisations = await prisma.organisation.findMany({
    where: orgWhere,
    orderBy: { orgName: 'asc' },
    select: {
      orgId: true,
      orgName: true,
      dealers: {
        select: {
          id: true,
          name: true,
          retailers: { select: { id: true, name: true } },
          // Dealer's own inventory relation — every row here is
          // inherently ownerType DEALER, priced at `rate` (see Inventory
          // in schema.prisma).
          inventory: { select: { quantity: true, rate: true, retailerSellingPrice: true } },
        },
      },
    },
  });

  const allDealerIds = organisations.flatMap((o) => o.dealers.map((d) => d.id));

  // Every retailer-owned inventory row under any of these dealers, priced
  // at `sellingPrice` (the dealer -> retailer price, i.e. the retailer's
  // own cost) rather than `rate`, which is only ever set on a dealer's own
  // stock. Fetched separately and grouped back to its dealer via
  // Retailer.primaryDealerId, since a retailer-owned Inventory row has no
  // dealerId of its own. retailerId is selected alongside so rows can be
  // further split per-retailer below, for the dashboard's "each retailer
  // separately" breakdown.
  const retailerInventory = allDealerIds.length
    ? await prisma.inventory.findMany({
        where: { ownerType: 'RETAILER', retailer: { primaryDealerId: { in: allDealerIds } } },
        select: {
          quantity: true,
          sellingPrice: true,
          retailerSellingPrice: true,
          retailerId: true,
          retailer: { select: { primaryDealerId: true } },
        },
      })
    : [];
  const retailerInventoryByDealer = new Map();
  for (const row of retailerInventory) {
    const dealerId = row.retailer.primaryDealerId;
    if (!retailerInventoryByDealer.has(dealerId)) retailerInventoryByDealer.set(dealerId, []);
    retailerInventoryByDealer.get(dealerId).push(row);
  }

  const emptyTotals = () => ({ dealerCount: 0, retailerCount: 0, inventoryCount: 0, costValue: 0, retailerSellingValue: 0 });
  const grandTotals = { organisationCount: organisations.length, ...emptyTotals() };

  const orgRows = organisations.map((org) => {
    const orgTotals = emptyTotals();

    const dealerRows = org.dealers.map((d) => {
      const ownInventory = d.inventory;
      const retInventory = retailerInventoryByDealer.get(d.id) || [];

      // Per-retailer inventory breakdown — every one of this dealer's
      // retailers gets a row here even with zero stock, same as every
      // dealer above gets a row even with zero inventory. Cost is priced
      // at sellingPrice (the dealer -> retailer price, i.e. what the
      // retailer actually paid for it), never rate, which only ever
      // applies to a dealer's own stock — same convention as the
      // dealer-level rollup below.
      const byRetailer = new Map(
        d.retailers.map((r) => [r.id, {
          retailerId: r.id,
          retailerName: r.name,
          inventoryCount: 0,
          costValue: 0,
          retailerSellingValue: 0,
        }])
      );
      for (const row of retInventory) {
        const entry = byRetailer.get(row.retailerId);
        if (!entry) continue; // defensive — every row's retailer belongs to this dealer
        entry.inventoryCount += 1;
        entry.costValue += Number(row.sellingPrice) * row.quantity;
        entry.retailerSellingValue += Number(row.retailerSellingPrice) * row.quantity;
      }

      // Own (rate-priced) stock plus every one of this dealer's retailers'
      // (sellingPrice-priced) stock, rolled up together — from an
      // org/admin oversight view a retailer's stock is still that dealer's
      // stock in the field. Both totals are quantity-weighted (unit price
      // × quantity, summed), the number that actually represents money
      // tied up in stock, not a sum of unit prices.
      const costValue = ownInventory.reduce((sum, r) => sum + Number(r.rate) * r.quantity, 0)
        + retInventory.reduce((sum, r) => sum + Number(r.sellingPrice) * r.quantity, 0);
      const retailerSellingValue = ownInventory.reduce((sum, r) => sum + Number(r.retailerSellingPrice) * r.quantity, 0)
        + retInventory.reduce((sum, r) => sum + Number(r.retailerSellingPrice) * r.quantity, 0);

      return {
        dealerId: d.id,
        dealerName: d.name,
        retailerCount: d.retailers.length,
        inventoryCount: ownInventory.length + retInventory.length,
        costValue,
        retailerSellingValue,
        retailers: [...byRetailer.values()].sort((a, b) => a.retailerName.localeCompare(b.retailerName)),
      };
    });

    for (const d of dealerRows) {
      orgTotals.dealerCount += 1;
      orgTotals.retailerCount += d.retailerCount;
      orgTotals.inventoryCount += d.inventoryCount;
      orgTotals.costValue += d.costValue;
      orgTotals.retailerSellingValue += d.retailerSellingValue;
    }
    grandTotals.dealerCount += orgTotals.dealerCount;
    grandTotals.retailerCount += orgTotals.retailerCount;
    grandTotals.inventoryCount += orgTotals.inventoryCount;
    grandTotals.costValue += orgTotals.costValue;
    grandTotals.retailerSellingValue += orgTotals.retailerSellingValue;

    return {
      organisationId: org.orgId,
      organisationName: org.orgName,
      dealers: dealerRows,
      totals: orgTotals,
    };
  });

  res.json({ context: req.user.role, organisations: orgRows, totals: grandTotals });
});

// Status orderings for each category below, used both to decide which
// order a cell's per-state breakdown is listed in and, for
// payments (which has no status of its own), which underlying workflow to
// read a state from. Purchase/Sale/GoodsReturn/Receipt/Voucher orderings
// mirror their enums in schema.prisma; RETAILER_PAYMENT_STATUSES /
// DEALER_PAYMENT_STATUSES are the same two orderings already used by
// GET /payments above.
const PURCHASE_STATUS_ORDER = ['PENDING', 'IN_REVIEW', 'CONFIRMED', 'ORDERED', 'IN_TRANSIT', 'RECEIVED', 'MODIFIED', 'CANCELLED'];
const SALE_STATUS_ORDER = ['COMPLETED', 'IN_PENDING', 'DISPATCHED'];
const SOLD_PRODUCT_STATUS_ORDER = ['OPEN', 'TO_BE_CONFIRMED', 'PAID'];
const GOODS_RETURN_STATUS_ORDER = ['OPEN', 'IN_REVIEW', 'CONFIRMED', 'CANCELLED'];
const RECEIPT_STATUS_ORDER = ['TO_BE_CONFIRMED', 'PARTIALLY_PAID', 'PAID'];
const VOUCHER_STATUS_ORDER = ['OPEN', 'PARTIALLY_PAID', 'PAID'];

// A running { count, amount } total plus the same broken down per status —
// the shape every category below accumulates into, so the dashboard can
// show both the total and its state breakdown in one table cell.
function newBucket() {
  return { count: 0, amount: 0, byStatus: new Map() };
}
// A cancelled or still-pending row (CANCELLED, PENDING, or a
// status like IN_PENDING that's a pending variant) isn't settled activity
// yet, so it's kept out of the bucket's headline count/amount - it still
// gets its own line in byStatus below, just not folded into the total.
function isExcludedFromTotal(status) {
  return status === 'CANCELLED' || status.includes('PENDING');
}
function addToBucket(bucket, status, amount) {
  if (!bucket.byStatus.has(status)) bucket.byStatus.set(status, { status, count: 0, amount: 0 });
  const s = bucket.byStatus.get(status);
  s.count += 1;
  s.amount += amount;
  if (!isExcludedFromTotal(status)) {
    bucket.count += 1;
    bucket.amount += amount;
  }
}
// Only the statuses that actually occurred are included (in canonical
// order), so an empty/rare state doesn't clutter every cell. This always
// includes CANCELLED/PENDING-variant entries too (see addToBucket) - they're
// just excluded from the count/amount totals above, not hidden here.
function serializeBucket(bucket, order) {
  return {
    count: bucket.count,
    amount: bucket.amount,
    byStatus: order.map((s) => bucket.byStatus.get(s)).filter(Boolean),
  };
}

// Activity summary (purchases/sales/soldProducts/goodsReturns/payments/
// receipts/vouchers) grouped by dealer and by retailer, each broken down by
// status — for the Dashboard's per-dealer and per-retailer breakdown
// tables. ADMIN sees everything, ORGANISATION sees its own org (same
// scoping as /org-summary above, since a dealer/retailer listing is
// dealer/retailer-management data that stays inside its own organisation
// everywhere else in the app). DEALER is scoped to just their own dealer
// row plus their own retailers; RETAILER is scoped to their own dealer's
// row plus only their own single retailer row.
//
// Amounts are computed the same way each entity already prices things
// elsewhere in this file/schema, not a flat "amount" column that doesn't
// exist on most of these models:
//   - purchases: dealer's own = qty × PurchaseItem.rate (what they paid
//     their supplier); retailer's own = qty × PurchaseItem.sellingPrice
//     (what they paid their dealer — PurchaseItem.rate on a retailer's own
//     line is the dealer's upstream cost, not what the retailer paid, see
//     schema.prisma). Bucketed by Purchase.status.
//   - sales: Sale.totalAmount, straight off the row, bucketed by
//     Sale.status. A dealer's sales are additionally split into cash
//     (customerType CASH) vs retailer (customerType RETAILER) sub-totals —
//     a retailer's own sales aren't split, since a retailer only ever
//     sells to a cash end customer.
//   - soldProducts: no amount field of its own — settles at the linked
//     SaleItem's rate (dealer's own cash sale), sellingPrice (retailer's
//     own cash sale), or originDealerRate (the second, dealer-scoped
//     obligation raised when a retailer resells dealer-sourced stock —
//     see SoldProduct.owedBy in schema.prisma). Bucketed by
//     SoldProduct.status.
//   - goodsReturns: qty(approvedQuantity ?? quantity) × item.rate, which
//     is already always "this owner's own unit cost" regardless of
//     ownerType (see GoodsReturnItem.rate comment in schema.prisma).
//     Bucketed by GoodsReturn.status.
//   - payments: Payment.amount, but Payment has no status of its own —
//     bucketed the same way GET /payments above already groups it: a
//     dealer's own payment (to a supplier) by its Voucher's status
//     (defaulting to PAID if unlinked), a retailer's payment (to their
//     dealer) by its Receipt's status (defaulting to PAID for a
//     goods-return credit, TO_BE_CONFIRMED otherwise).
//   - receipts / vouchers: Receipt.amount / Voucher.amount, bucketed by
//     their own status directly.
router.get('/activity-summary', authRequired, async (req, res) => {
  const dealerInfo = new Map(); // dealerId -> { name, organisationId, organisationName }
  const retailerInfo = new Map(); // retailerId -> { name, dealerId }

  if (req.user.role === 'DEALER') {
    // Own dashboard row plus every one of their own retailers - same
    // dealerId/primaryDealerId scoping GET /sold-products already uses for
    // a DEALER login.
    const dealerId = req.user.dealerId;
    const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { name: true } });
    if (dealer) {
      dealerInfo.set(dealerId, { name: dealer.name, organisationId: null, organisationName: null });
      const retailers = await prisma.retailer.findMany({
        where: { primaryDealerId: dealerId },
        select: { id: true, name: true },
      });
      for (const r of retailers) retailerInfo.set(r.id, { name: r.name, dealerId });
    }
  } else if (req.user.role === 'RETAILER') {
    // Their own dealer's row plus only their own single retailer row - not
    // the dealer's other retailers, which stay out of a RETAILER login's
    // view everywhere else in this file too.
    const retailerId = req.user.retailerId;
    const retailer = await prisma.retailer.findUnique({
      where: { id: retailerId },
      select: { name: true, primaryDealerId: true },
    });
    if (retailer) {
      retailerInfo.set(retailerId, { name: retailer.name, dealerId: retailer.primaryDealerId });
      if (retailer.primaryDealerId) {
        const dealer = await prisma.dealer.findUnique({
          where: { id: retailer.primaryDealerId },
          select: { name: true },
        });
        dealerInfo.set(retailer.primaryDealerId, { name: dealer?.name ?? null, organisationId: null, organisationName: null });
      }
    }
  } else {
    const orgWhere = req.user.role === 'ORGANISATION' ? { orgId: req.user.organisationId } : {};

    const organisations = await prisma.organisation.findMany({
      where: orgWhere,
      select: {
        orgId: true,
        orgName: true,
        dealers: {
          select: { id: true, name: true, retailers: { select: { id: true, name: true } } },
        },
      },
    });

    for (const org of organisations) {
      for (const d of org.dealers) {
        dealerInfo.set(d.id, { name: d.name, organisationId: org.orgId, organisationName: org.orgName });
        for (const r of d.retailers) {
          retailerInfo.set(r.id, { name: r.name, dealerId: d.id });
        }
      }
    }
  }

  const dealerIds = [...dealerInfo.keys()];
  const retailerIds = [...retailerInfo.keys()];

  if (dealerIds.length === 0) {
    return res.json({ context: req.user.role, dealers: [], retailers: [] });
  }

  // A dealer's sale can be to a walk-in cash customer or to one of their
  // retailers (Sale.customerType) — tracked alongside the status bucket so
  // the dashboard can show both breakdowns in the same "Sales" cell. Not
  // needed on the retailer side: a retailer's own Sale is always to a CASH
  // end customer (only a dealer sale ever has customerType RETAILER — see
  // schema.prisma).
  const dealerActivity = new Map(dealerIds.map((id) => [id, {
    purchases: newBucket(),
    sales: newBucket(),
    salesByCustomer: { cash: newBucket(), retailer: newBucket() },
    soldProducts: newBucket(),
    goodsReturns: newBucket(),
    payments: newBucket(),
    receipts: newBucket(),
    payableVouchers: newBucket(),
    receivableVouchers: newBucket(),
  }]));
  const retailerActivity = new Map(retailerIds.map((id) => [id, {
    purchases: newBucket(),
    sales: newBucket(),
    soldProducts: newBucket(),
    goodsReturns: newBucket(),
    payments: newBucket(),
    vouchers: newBucket(),
  }]));

  const [
    dealerPurchases, retailerPurchases,
    dealerSales, retailerSales,
    dealerOwnSoldProducts, dealerOriginSoldProducts, retailerSoldProducts,
    dealerGoodsReturns, retailerGoodsReturns,
    payments,
    receipts,
    payableVouchers, receivableVouchers,
  ] = await Promise.all([
    prisma.purchase.findMany({
      where: { ownerType: 'DEALER', dealerId: { in: dealerIds } },
      select: { dealerId: true, status: true, items: { select: { quantity: true, rate: true } } },
    }),
    retailerIds.length
      ? prisma.purchase.findMany({
          where: { ownerType: 'RETAILER', retailerId: { in: retailerIds } },
          select: { retailerId: true, status: true, items: { select: { quantity: true, sellingPrice: true } } },
        })
      : [],
    prisma.sale.findMany({
      where: { ownerType: 'DEALER', dealerId: { in: dealerIds } },
      select: { dealerId: true, totalAmount: true, customerType: true, status: true },
    }),
    retailerIds.length
      ? prisma.sale.findMany({
          where: { ownerType: 'RETAILER', retailerId: { in: retailerIds } },
          select: { retailerId: true, totalAmount: true, status: true },
        })
      : [],
    // Dealer's own cash-sale settlement (owedBy DEALER, dealerId null —
    // see SoldProduct.owedBy in schema.prisma), settled at SaleItem.rate.
    prisma.soldProduct.findMany({
      where: { owedBy: 'DEALER', dealerId: null, sale: { ownerType: 'DEALER', dealerId: { in: dealerIds } } },
      select: { status: true, sale: { select: { dealerId: true } }, saleItem: { select: { quantity: true, rate: true } } },
    }),
    // The second, dealer-scoped obligation raised alongside a retailer's
    // own row when they resell dealer-sourced stock (owedBy DEALER,
    // dealerId set), settled at SaleItem.originDealerRate.
    prisma.soldProduct.findMany({
      where: { owedBy: 'DEALER', dealerId: { in: dealerIds } },
      select: { status: true, dealerId: true, saleItem: { select: { quantity: true, originDealerRate: true } } },
    }),
    retailerIds.length
      ? prisma.soldProduct.findMany({
          where: { owedBy: 'RETAILER', sale: { ownerType: 'RETAILER', retailerId: { in: retailerIds } } },
          select: { status: true, sale: { select: { retailerId: true } }, saleItem: { select: { quantity: true, sellingPrice: true } } },
        })
      : [],
    prisma.goodsReturn.findMany({
      where: { ownerType: 'DEALER', dealerId: { in: dealerIds } },
      select: { dealerId: true, status: true, items: { select: { quantity: true, approvedQuantity: true, rate: true } } },
    }),
    retailerIds.length
      ? prisma.goodsReturn.findMany({
          where: { ownerType: 'RETAILER', retailerId: { in: retailerIds } },
          select: { retailerId: true, status: true, items: { select: { quantity: true, approvedQuantity: true, rate: true } } },
        })
      : [],
    prisma.payment.findMany({
      where: { dealerId: { in: dealerIds } },
      select: {
        dealerId: true,
        retailerId: true,
        supplierId: true,
        amount: true,
        mode: true,
        voucher: { select: { status: true } },
        receipt: { select: { status: true } },
      },
    }),
    retailerIds.length
      ? prisma.receipt.findMany({
          where: { retailerId: { in: retailerIds } },
          select: { retailerId: true, amount: true, status: true },
        })
      : [],
    prisma.voucher.findMany({
      where: { type: 'PAYABLE', dealerId: { in: dealerIds } },
      select: { dealerId: true, amount: true, status: true },
    }),
    prisma.voucher.findMany({
      where: { type: 'RECEIVABLE', dealerId: { in: dealerIds } },
      select: { dealerId: true, retailerId: true, amount: true, status: true },
    }),
  ]);

  // ---- purchases ----
  for (const p of dealerPurchases) {
    const bucket = dealerActivity.get(p.dealerId).purchases;
    const amount = p.items.reduce((s, i) => s + (i.rate != null ? Number(i.rate) * i.quantity : 0), 0);
    addToBucket(bucket, p.status, amount);
  }
  for (const p of retailerPurchases) {
    const bucket = retailerActivity.get(p.retailerId).purchases;
    const amount = p.items.reduce((s, i) => s + (i.sellingPrice != null ? Number(i.sellingPrice) * i.quantity : 0), 0);
    addToBucket(bucket, p.status, amount);
  }

  // ---- sales ----
  for (const s of dealerSales) {
    const activity = dealerActivity.get(s.dealerId);
    const amount = Number(s.totalAmount ?? 0);
    addToBucket(activity.sales, s.status, amount);
    addToBucket(s.customerType === 'RETAILER' ? activity.salesByCustomer.retailer : activity.salesByCustomer.cash, s.status, amount);
  }
  for (const s of retailerSales) {
    const bucket = retailerActivity.get(s.retailerId).sales;
    addToBucket(bucket, s.status, Number(s.totalAmount ?? 0));
  }

  // ---- soldProducts (settlement obligations) ----
  for (const sp of dealerOwnSoldProducts) {
    const bucket = dealerActivity.get(sp.sale.dealerId)?.soldProducts;
    if (!bucket) continue;
    addToBucket(bucket, sp.status, Number(sp.saleItem.rate ?? 0) * sp.saleItem.quantity);
  }
  for (const sp of dealerOriginSoldProducts) {
    const bucket = dealerActivity.get(sp.dealerId)?.soldProducts;
    if (!bucket) continue;
    addToBucket(bucket, sp.status, Number(sp.saleItem.originDealerRate ?? 0) * sp.saleItem.quantity);
  }
  for (const sp of retailerSoldProducts) {
    const bucket = retailerActivity.get(sp.sale.retailerId)?.soldProducts;
    if (!bucket) continue;
    addToBucket(bucket, sp.status, Number(sp.saleItem.sellingPrice ?? 0) * sp.saleItem.quantity);
  }

  // ---- goods returns ----
  const returnAmount = (items) => items.reduce((s, i) => s + Number(i.rate) * (i.approvedQuantity ?? i.quantity), 0);
  for (const g of dealerGoodsReturns) {
    const bucket = dealerActivity.get(g.dealerId).goodsReturns;
    addToBucket(bucket, g.status, returnAmount(g.items));
  }
  for (const g of retailerGoodsReturns) {
    const bucket = retailerActivity.get(g.retailerId).goodsReturns;
    addToBucket(bucket, g.status, returnAmount(g.items));
  }

  // ---- payments ----
  for (const p of payments) {
    const amount = Number(p.amount);
    if (p.supplierId && dealerActivity.has(p.dealerId)) {
      const status = p.voucher?.status ?? 'PAID';
      addToBucket(dealerActivity.get(p.dealerId).payments, status, amount);
    }
    if (p.retailerId && retailerActivity.has(p.retailerId)) {
      const status = p.receipt?.status ?? (p.mode === 'GOODS_RETURN' ? 'PAID' : 'TO_BE_CONFIRMED');
      addToBucket(retailerActivity.get(p.retailerId).payments, status, amount);
    }
  }

  // ---- receipts (retailer-submitted, rolled up to their dealer) ----
  for (const r of receipts) {
    const info = retailerInfo.get(r.retailerId);
    if (!info) continue;
    const amount = Number(r.amount);
    addToBucket(dealerActivity.get(info.dealerId).receipts, r.status, amount);
  }

  // ---- vouchers ----
  for (const v of payableVouchers) {
    addToBucket(dealerActivity.get(v.dealerId).payableVouchers, v.status, Number(v.amount));
  }
  for (const v of receivableVouchers) {
    const amount = Number(v.amount);
    addToBucket(dealerActivity.get(v.dealerId).receivableVouchers, v.status, amount);
    if (v.retailerId && retailerActivity.has(v.retailerId)) {
      addToBucket(retailerActivity.get(v.retailerId).vouchers, v.status, amount);
    }
  }

  const serializeDealer = (a) => ({
    purchases: serializeBucket(a.purchases, PURCHASE_STATUS_ORDER),
    sales: { ...serializeBucket(a.sales, SALE_STATUS_ORDER), cash: serializeBucket(a.salesByCustomer.cash, SALE_STATUS_ORDER), retailer: serializeBucket(a.salesByCustomer.retailer, SALE_STATUS_ORDER) },
    soldProducts: serializeBucket(a.soldProducts, SOLD_PRODUCT_STATUS_ORDER),
    goodsReturns: serializeBucket(a.goodsReturns, GOODS_RETURN_STATUS_ORDER),
    payments: serializeBucket(a.payments, DEALER_PAYMENT_STATUSES),
    receipts: serializeBucket(a.receipts, RECEIPT_STATUS_ORDER),
    payableVouchers: serializeBucket(a.payableVouchers, VOUCHER_STATUS_ORDER),
    receivableVouchers: serializeBucket(a.receivableVouchers, VOUCHER_STATUS_ORDER),
  });
  const serializeRetailer = (a) => ({
    purchases: serializeBucket(a.purchases, PURCHASE_STATUS_ORDER),
    sales: serializeBucket(a.sales, SALE_STATUS_ORDER),
    soldProducts: serializeBucket(a.soldProducts, SOLD_PRODUCT_STATUS_ORDER),
    goodsReturns: serializeBucket(a.goodsReturns, GOODS_RETURN_STATUS_ORDER),
    payments: serializeBucket(a.payments, RETAILER_PAYMENT_STATUSES),
    vouchers: serializeBucket(a.vouchers, VOUCHER_STATUS_ORDER),
  });

  const dealers = dealerIds.map((id) => {
    const info = dealerInfo.get(id);
    return {
      dealerId: id,
      dealerName: info.name,
      organisationId: info.organisationId,
      organisationName: info.organisationName,
      ...serializeDealer(dealerActivity.get(id)),
    };
  });
  const retailers = retailerIds.map((id) => {
    const info = retailerInfo.get(id);
    const owningDealer = dealerInfo.get(info.dealerId);
    return {
      retailerId: id,
      retailerName: info.name,
      dealerId: info.dealerId,
      dealerName: owningDealer?.name ?? null,
      organisationId: owningDealer?.organisationId ?? null,
      organisationName: owningDealer?.organisationName ?? null,
      ...serializeRetailer(retailerActivity.get(id)),
    };
  });

  res.json({ context: req.user.role, dealers, retailers });
});

// Sold products report: quantity/value summary of SoldProduct rows (see
// schema.prisma), grouped primarily by the origin SUPPLIER (Product.
// supplierId) - "how much of Supplier X's stock has actually sold, and in
// what state" is the more natural top-level question at the DEALER and
// ADMIN/ORGANISATION level than "what does this one dealer's sales break
// down into". Under each supplier, a `sellers` breakdown shows exactly who
// made those sales - the dealer's own direct cash sales and/or each of
// their retailers' own cash sales (see `sellers[].type`) - so the
// supplier's own aggregate `byStatus` total can still be reconciled
// against the sum of its `sellers[].byStatus` entries for any given
// state, same reconciliation property the old dealer-then-supplier
// nesting had, just pivoted the other way around. Within a supplier or a
// seller, rows are further broken down by SoldProduct.status ("state") so
// the same line can show OPEN vs TO_BE_CONFIRMED vs PAID separately
// rather than one blended total.
//
// Pricing per state row (same for a supplier's own byStatus and each of
// its sellers' byStatus, since they're built from the same rows):
//   - quantity: sum of SaleItem.quantity across that state's SoldProduct rows.
//   - costPrice: quantity-weighted total at SaleItem.rate for a dealer's own
//     row (what the dealer paid their supplier) or SaleItem.sellingPrice for
//     a retailer's own row (what the retailer paid their dealer) - same
//     per-role field choice /activity-summary above already uses for this
//     same settlement amount.
//   - sellingPrice: quantity-weighted total at SaleItem.price (the actual
//     cash-sale price charged to the end customer, sourced from
//     Inventory.retailerSellingPrice at sale time) for BOTH a dealer's own
//     row and a retailer's own row.
//
// Only the two "own sale" SoldProduct rows are counted (owedBy DEALER with
// dealerId null, and owedBy RETAILER) - the second, dealer-scoped row
// raised when a retailer resells dealer-sourced stock (owedBy DEALER with
// dealerId set) is a separate upstream obligation, not this dealer's own
// sale, so it's left out of this report entirely.
function addSoldBucket(map, status, quantity, costPriceUnit, sellingPriceUnit) {
  if (!map.has(status)) map.set(status, { status, quantity: 0, costPrice: 0, sellingPrice: 0 });
  const b = map.get(status);
  b.quantity += quantity;
  b.costPrice += costPriceUnit * quantity;
  b.sellingPrice += sellingPriceUnit * quantity;
}
function serializeSoldBucket(map) {
  return SOLD_PRODUCT_STATUS_ORDER.map((s) => map.get(s)).filter(Boolean);
}

// The supplier-first pivot itself - buckets keyed by supplierId (or "none"
// for a product with no Product.supplierId set, so an unattributed row
// still counts toward reconciliation rather than being silently dropped),
// each holding both its own aggregate state buckets AND a nested map of
// sellers (dealer and/or retailer), each of which holds its own state
// buckets in exactly the same shape.
function newSupplierPivotGroup() {
  return { buckets: new Map(), names: new Map(), sellers: new Map() };
}
// `seller` is { type: 'DEALER' | 'RETAILER', id, name, parentDealerName? }
// - parentDealerName is only ever set for a RETAILER seller at the ADMIN/
// ORGANISATION level (see below), where several dealers' retailers could
// otherwise share a name with nothing to tell them apart by.
function addToSupplierPivot(group, product, seller, status, quantity, costPriceUnit, sellingPriceUnit) {
  const supplierKey = product?.supplierId ?? 'none';
  if (!group.buckets.has(supplierKey)) group.buckets.set(supplierKey, new Map());
  if (!group.names.has(supplierKey)) group.names.set(supplierKey, product?.supplier?.name ?? 'No Supplier');
  addSoldBucket(group.buckets.get(supplierKey), status, quantity, costPriceUnit, sellingPriceUnit);

  if (!group.sellers.has(supplierKey)) group.sellers.set(supplierKey, new Map());
  const sellerMap = group.sellers.get(supplierKey);
  const sellerKey = `${seller.type}-${seller.id}`;
  if (!sellerMap.has(sellerKey)) {
    sellerMap.set(sellerKey, {
      type: seller.type,
      id: seller.id,
      name: seller.name,
      parentDealerName: seller.parentDealerName ?? null,
      buckets: new Map(),
    });
  }
  addSoldBucket(sellerMap.get(sellerKey).buckets, status, quantity, costPriceUnit, sellingPriceUnit);
}
function serializeSupplierPivot(group) {
  return [...group.buckets.keys()]
    .map((key) => ({
      supplierId: key === 'none' ? null : key,
      supplierName: group.names.get(key),
      byStatus: serializeSoldBucket(group.buckets.get(key)),
      sellers: [...(group.sellers.get(key)?.values() ?? [])]
        .map((s) => ({
          type: s.type,
          id: s.id,
          name: s.name,
          parentDealerName: s.parentDealerName,
          byStatus: serializeSoldBucket(s.buckets),
        }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    }))
    .sort((a, b) => (a.supplierName || '').localeCompare(b.supplierName || ''));
}

// DEALER-context variant of the pivot above: a retailer's own sold product
// carries TWO independent settlement obligations that can each sit in a
// different state for the very same physical quantity - what the retailer
// owes THIS dealer ("paymentToDealer", SaleItem.sellingPrice, owedBy
// RETAILER) and what this dealer in turn owes THEIR OWN supplier for that
// same stock ("paymentToSupplier", SaleItem.originDealerRate, owedBy
// DEALER with dealerId set to this dealer - a separate SoldProduct row
// left out of the report entirely before this split existed). A dealer's
// own direct cash sale only ever has a paymentToSupplier leg (there's no
// retailer involved), settled at SaleItem.rate same as before. Both legs
// keep the same costPrice/sellingPrice/quantity shape as addSoldBucket
// above, just tracked in two separate maps instead of one shared one.
function newDealerSupplierPivotGroup() {
  return { toDealerBuckets: new Map(), toSupplierBuckets: new Map(), names: new Map(), sellers: new Map() };
}
function addToDealerSupplierPivot(group, kind, product, seller, status, quantity, costPriceUnit, sellingPriceUnit) {
  const bucketsKey = kind === 'toDealer' ? 'toDealerBuckets' : 'toSupplierBuckets';
  const supplierKey = product?.supplierId ?? 'none';
  if (!group[bucketsKey].has(supplierKey)) group[bucketsKey].set(supplierKey, new Map());
  if (!group.names.has(supplierKey)) group.names.set(supplierKey, product?.supplier?.name ?? 'No Supplier');
  addSoldBucket(group[bucketsKey].get(supplierKey), status, quantity, costPriceUnit, sellingPriceUnit);

  if (!group.sellers.has(supplierKey)) group.sellers.set(supplierKey, new Map());
  const sellerMap = group.sellers.get(supplierKey);
  const sellerKey = `${seller.type}-${seller.id}`;
  if (!sellerMap.has(sellerKey)) {
    sellerMap.set(sellerKey, {
      type: seller.type,
      id: seller.id,
      name: seller.name,
      toDealerBuckets: new Map(),
      toSupplierBuckets: new Map(),
    });
  }
  const sellerBucketsKey = kind === 'toDealer' ? 'toDealerBuckets' : 'toSupplierBuckets';
  addSoldBucket(sellerMap.get(sellerKey)[sellerBucketsKey], status, quantity, costPriceUnit, sellingPriceUnit);
}
function serializeDealerSupplierPivot(group) {
  const supplierKeys = new Set([...group.toDealerBuckets.keys(), ...group.toSupplierBuckets.keys()]);
  return [...supplierKeys]
    .map((key) => ({
      supplierId: key === 'none' ? null : key,
      supplierName: group.names.get(key),
      paymentToDealer: serializeSoldBucket(group.toDealerBuckets.get(key) ?? new Map()),
      paymentToSupplier: serializeSoldBucket(group.toSupplierBuckets.get(key) ?? new Map()),
      sellers: [...(group.sellers.get(key)?.values() ?? [])]
        .map((s) => ({
          type: s.type,
          id: s.id,
          name: s.name,
          paymentToDealer: serializeSoldBucket(s.toDealerBuckets),
          paymentToSupplier: serializeSoldBucket(s.toSupplierBuckets),
        }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    }))
    .sort((a, b) => (a.supplierName || '').localeCompare(b.supplierName || ''));
}

// Product select shared by every soldProduct query below - just enough to
// attribute a row to its origin supplier (see addToSupplierPivot above)
// without pulling the whole Product row.
const SOLD_PRODUCT_SUPPLIER_SELECT = { select: { supplierId: true, supplier: { select: { name: true } } } };

router.get('/sold-products', authRequired, async (req, res) => {
  if (req.user.role === 'DEALER') {
    const dealerId = req.user.dealerId;
    const [dealer, retailers] = await Promise.all([
      prisma.dealer.findUnique({ where: { id: dealerId }, select: { name: true } }),
      prisma.retailer.findMany({ where: { primaryDealerId: dealerId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const retailerIds = retailers.map((r) => r.id);
    const retailerNameById = new Map(retailers.map((r) => [r.id, r.name]));

    const [ownSold, retailerSold, retailerOriginSold] = await Promise.all([
      // Dealer's own direct cash sale - only ever owes their own supplier
      // (no retailer leg at all), settled at SaleItem.rate.
      prisma.soldProduct.findMany({
        where: { owedBy: 'DEALER', dealerId: null, sale: { ownerType: 'DEALER', dealerId } },
        select: { status: true, product: SOLD_PRODUCT_SUPPLIER_SELECT, saleItem: { select: { quantity: true, rate: true, price: true } } },
      }),
      // A retailer's own sale - what that retailer owes THIS dealer,
      // settled at SaleItem.sellingPrice (the dealer -> retailer price).
      retailerIds.length
        ? prisma.soldProduct.findMany({
            where: { owedBy: 'RETAILER', sale: { ownerType: 'RETAILER', retailerId: { in: retailerIds } } },
            select: { status: true, sale: { select: { retailerId: true } }, product: SOLD_PRODUCT_SUPPLIER_SELECT, saleItem: { select: { quantity: true, sellingPrice: true, price: true } } },
          })
        : [],
      // The second, dealer-scoped obligation raised alongside the retailer
      // row above when a retailer resells this dealer's stock (owedBy
      // DEALER, dealerId set to this dealer) - what THIS dealer in turn
      // owes THEIR OWN supplier for that same sale, settled independently
      // at SaleItem.originDealerRate and possibly sitting in a different
      // state than the retailer's own row (e.g. the retailer has already
      // paid this dealer while this dealer still owes their supplier).
      // Matched back to its retailer via the shared underlying Sale.
      retailerIds.length
        ? prisma.soldProduct.findMany({
            where: { owedBy: 'DEALER', dealerId, sale: { ownerType: 'RETAILER', retailerId: { in: retailerIds } } },
            select: { status: true, sale: { select: { retailerId: true } }, product: SOLD_PRODUCT_SUPPLIER_SELECT, saleItem: { select: { quantity: true, originDealerRate: true, price: true } } },
          })
        : [],
    ]);

    const pivot = newDealerSupplierPivotGroup();
    for (const sp of ownSold) {
      addToDealerSupplierPivot(
        pivot, 'toSupplier', sp.product, { type: 'DEALER', id: dealerId, name: dealer?.name ?? null },
        sp.status, sp.saleItem.quantity, Number(sp.saleItem.rate ?? 0), Number(sp.saleItem.price ?? 0)
      );
    }
    for (const sp of retailerSold) {
      const rId = sp.sale.retailerId;
      addToDealerSupplierPivot(
        pivot, 'toDealer', sp.product, { type: 'RETAILER', id: rId, name: retailerNameById.get(rId) ?? null },
        sp.status, sp.saleItem.quantity, Number(sp.saleItem.sellingPrice ?? 0), Number(sp.saleItem.price ?? 0)
      );
    }
    for (const sp of retailerOriginSold) {
      const rId = sp.sale.retailerId;
      addToDealerSupplierPivot(
        pivot, 'toSupplier', sp.product, { type: 'RETAILER', id: rId, name: retailerNameById.get(rId) ?? null },
        sp.status, sp.saleItem.quantity, Number(sp.saleItem.originDealerRate ?? 0), Number(sp.saleItem.price ?? 0)
      );
    }

    return res.json({ context: 'DEALER', suppliers: serializeDealerSupplierPivot(pivot) });
  }

  if (req.user.role === 'RETAILER') {
    // A retailer settles sold-product dues with their dealer only, never
    // with a supplier directly - a retailer never even sees which supplier
    // a product originated from anywhere else in this app (e.g.
    // GET /purchases above never exposes supplier to a RETAILER either).
    // So this is grouped by dealer, not supplier - and since a retailer has
    // exactly one primary dealer, that always collapses to a single,
    // non-selectable row rather than the multi-supplier pivot the DEALER/
    // ADMIN/ORGANISATION branches return. No product/supplier select at
    // all, so supplier info never even reaches this response.
    const retailerId = req.user.retailerId;
    const retailer = await prisma.retailer.findUnique({ where: { id: retailerId }, select: { name: true, primaryDealerId: true } });
    const dealer = retailer?.primaryDealerId
      ? await prisma.dealer.findUnique({ where: { id: retailer.primaryDealerId }, select: { name: true } })
      : null;
    const sold = await prisma.soldProduct.findMany({
      where: { owedBy: 'RETAILER', sale: { ownerType: 'RETAILER', retailerId } },
      select: { status: true, saleItem: { select: { quantity: true, sellingPrice: true, price: true } } },
    });
    const buckets = new Map();
    for (const sp of sold) {
      addSoldBucket(buckets, sp.status, sp.saleItem.quantity, Number(sp.saleItem.sellingPrice ?? 0), Number(sp.saleItem.price ?? 0));
    }
    return res.json({
      context: 'RETAILER',
      dealerId: retailer?.primaryDealerId ?? null,
      dealerName: dealer?.name ?? null,
      byStatus: serializeSoldBucket(buckets),
    });
  }

  // ADMIN / ORGANISATION - every supplier touched by any sale across every
  // dealer in scope (whole platform for ADMIN, just their own organisation
  // for ORGANISATION - same scoping as /activity-summary and /org-summary
  // above), each with its aggregate `byStatus` PLUS a `sellers` breakdown
  // spanning every dealer AND every retailer (across potentially several
  // different dealers) who sold that supplier's products - a RETAILER
  // seller here always carries `parentDealerName` too, since two
  // retailers under different dealers could otherwise share a name with
  // nothing in the list to tell them apart.
  const orgWhere = req.user.role === 'ORGANISATION' ? { orgId: req.user.organisationId } : {};
  const organisations = await prisma.organisation.findMany({
    where: orgWhere,
    select: {
      dealers: {
        select: { id: true, name: true, retailers: { select: { id: true, name: true } } },
      },
    },
  });
  const dealerList = organisations.flatMap((o) => o.dealers);
  const dealerIds = dealerList.map((d) => d.id);
  const dealerNameById = new Map(dealerList.map((d) => [d.id, d.name]));
  const retailerToParentDealer = new Map();
  for (const d of dealerList) {
    for (const r of d.retailers) retailerToParentDealer.set(r.id, { dealerName: d.name, retailerName: r.name });
  }
  const retailerIds = [...retailerToParentDealer.keys()];

  if (dealerIds.length === 0) return res.json({ context: 'ALL', suppliers: [] });

  const [dealerSold, retailerSold] = await Promise.all([
    prisma.soldProduct.findMany({
      where: { owedBy: 'DEALER', dealerId: null, sale: { ownerType: 'DEALER', dealerId: { in: dealerIds } } },
      select: { status: true, sale: { select: { dealerId: true } }, product: SOLD_PRODUCT_SUPPLIER_SELECT, saleItem: { select: { quantity: true, rate: true, price: true } } },
    }),
    retailerIds.length
      ? prisma.soldProduct.findMany({
          where: { owedBy: 'RETAILER', sale: { ownerType: 'RETAILER', retailerId: { in: retailerIds } } },
          select: { status: true, sale: { select: { retailerId: true } }, product: SOLD_PRODUCT_SUPPLIER_SELECT, saleItem: { select: { quantity: true, sellingPrice: true, price: true } } },
        })
      : [],
  ]);

  const pivot = newSupplierPivotGroup();
  for (const sp of dealerSold) {
    const dId = sp.sale.dealerId;
    addToSupplierPivot(
      pivot, sp.product, { type: 'DEALER', id: dId, name: dealerNameById.get(dId) ?? null },
      sp.status, sp.saleItem.quantity, Number(sp.saleItem.rate ?? 0), Number(sp.saleItem.price ?? 0)
    );
  }
  for (const sp of retailerSold) {
    const rId = sp.sale.retailerId;
    const parent = retailerToParentDealer.get(rId);
    addToSupplierPivot(
      pivot, sp.product,
      { type: 'RETAILER', id: rId, name: parent?.retailerName ?? null, parentDealerName: parent?.dealerName ?? null },
      sp.status, sp.saleItem.quantity, Number(sp.saleItem.sellingPrice ?? 0), Number(sp.saleItem.price ?? 0)
    );
  }

  res.json({ context: 'ALL', suppliers: serializeSupplierPivot(pivot) });
});

export default router;

