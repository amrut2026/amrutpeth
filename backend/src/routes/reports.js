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
    return res.json({
      context: 'DEALER',
      supplier: {
        vouchers: supplierVouchers.map((v) => serializeVoucher(v)),
        payments: supplierPayments.map((p) => serializeVoucherPayment(p)),
      },
      retailer: {
        vouchers: retailerVouchers.map((v) => serializeVoucher(v)),
        payments: retailerPayments.map((p) => serializeVoucherPayment(p)),
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

// Activity summary (purchases/sales/soldProducts/goodsReturns/payments/
// receipts/vouchers) grouped by dealer and by retailer — for the
// ADMIN/ORGANISATION Dashboard's per-dealer and per-retailer breakdown
// tables. Same ADMIN-sees-everything / ORGANISATION-sees-its-own-org
// scoping as /org-summary above, for the same reason (a dealer/retailer
// listing is dealer/retailer-management data, which stays inside its own
// organisation everywhere else in the app).
//
// Amounts are computed the same way each entity already prices things
// elsewhere in this file/schema, not a flat "amount" column that doesn't
// exist on most of these models:
//   - purchases: dealer's own = qty × PurchaseItem.rate (what they paid
//     their supplier); retailer's own = qty × PurchaseItem.sellingPrice
//     (what they paid their dealer — PurchaseItem.rate on a retailer's own
//     line is the dealer's upstream cost, not what the retailer paid, see
//     schema.prisma).
//   - sales: Sale.totalAmount, straight off the row. A dealer's sales are
//     additionally split into cash (customerType CASH) vs retailer
//     (customerType RETAILER) sub-totals — a retailer's own sales aren't
//     split, since a retailer only ever sells to a cash end customer.
//   - soldProducts: no amount field of its own — settles at the linked
//     SaleItem's rate (dealer's own cash sale), sellingPrice (retailer's
//     own cash sale), or originDealerRate (the second, dealer-scoped
//     obligation raised when a retailer resells dealer-sourced stock —
//     see SoldProduct.owedBy in schema.prisma).
//   - goodsReturns: qty(approvedQuantity ?? quantity) × item.rate, which
//     is already always "this owner's own unit cost" regardless of
//     ownerType (see GoodsReturnItem.rate comment in schema.prisma).
//   - payments / receipts / vouchers: read straight off their own amount
//     field.
router.get('/activity-summary', authRequired, async (req, res) => {
  if (req.user.role === 'DEALER' || req.user.role === 'RETAILER') {
    return res.status(403).json({ error: 'Not available for this role' });
  }

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

  const dealerInfo = new Map(); // dealerId -> { name, organisationId, organisationName }
  const retailerInfo = new Map(); // retailerId -> { name, dealerId }
  for (const org of organisations) {
    for (const d of org.dealers) {
      dealerInfo.set(d.id, { name: d.name, organisationId: org.orgId, organisationName: org.orgName });
      for (const r of d.retailers) {
        retailerInfo.set(r.id, { name: r.name, dealerId: d.id });
      }
    }
  }

  const dealerIds = [...dealerInfo.keys()];
  const retailerIds = [...retailerInfo.keys()];

  if (dealerIds.length === 0) {
    return res.json({ context: req.user.role, dealers: [], retailers: [] });
  }

  const emptyActivity = () => ({ count: 0, amount: 0 });
  const emptySettlement = () => ({ count: 0, amount: 0, paidAmount: 0, pendingAmount: 0 });
  const emptyVoucher = () => ({ count: 0, amount: 0, openAmount: 0 });
  // A dealer's sale can be to a walk-in cash customer or to one of their
  // retailers (Sale.customerType) — split out here so the dashboard can
  // show both in the same "Sales" cell. Not needed on the retailer side:
  // a retailer's own Sale is always to a CASH end customer (only a dealer
  // sale ever has customerType RETAILER — see schema.prisma).
  const emptySalesSplit = () => ({ count: 0, amount: 0, cash: emptyActivity(), retailer: emptyActivity() });

  const dealerActivity = new Map(dealerIds.map((id) => [id, {
    purchases: emptyActivity(),
    sales: emptySalesSplit(),
    soldProducts: emptySettlement(),
    goodsReturns: emptyActivity(),
    payments: emptyActivity(),
    receipts: { count: 0, amount: 0, pendingAmount: 0 },
    payableVouchers: emptyVoucher(),
    receivableVouchers: emptyVoucher(),
  }]));
  const retailerActivity = new Map(retailerIds.map((id) => [id, {
    purchases: emptyActivity(),
    sales: emptyActivity(),
    soldProducts: emptySettlement(),
    goodsReturns: emptyActivity(),
    payments: emptyActivity(),
    receipts: { count: 0, amount: 0, pendingAmount: 0 },
    vouchers: emptyVoucher(),
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
      select: { dealerId: true, items: { select: { quantity: true, rate: true } } },
    }),
    retailerIds.length
      ? prisma.purchase.findMany({
          where: { ownerType: 'RETAILER', retailerId: { in: retailerIds } },
          select: { retailerId: true, items: { select: { quantity: true, sellingPrice: true } } },
        })
      : [],
    prisma.sale.findMany({
      where: { ownerType: 'DEALER', dealerId: { in: dealerIds } },
      select: { dealerId: true, totalAmount: true, customerType: true },
    }),
    retailerIds.length
      ? prisma.sale.findMany({
          where: { ownerType: 'RETAILER', retailerId: { in: retailerIds } },
          select: { retailerId: true, totalAmount: true },
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
      select: { dealerId: true, items: { select: { quantity: true, approvedQuantity: true, rate: true } } },
    }),
    retailerIds.length
      ? prisma.goodsReturn.findMany({
          where: { ownerType: 'RETAILER', retailerId: { in: retailerIds } },
          select: { retailerId: true, items: { select: { quantity: true, approvedQuantity: true, rate: true } } },
        })
      : [],
    prisma.payment.findMany({
      where: { dealerId: { in: dealerIds } },
      select: { dealerId: true, retailerId: true, supplierId: true, amount: true },
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

  const OPEN_VOUCHER_STATUSES = ['OPEN', 'PARTIALLY_PAID'];
  const addSettlement = (bucket, amount, status) => {
    bucket.count += 1;
    bucket.amount += amount;
    if (status === 'PAID') bucket.paidAmount += amount; else bucket.pendingAmount += amount;
  };

  // ---- purchases ----
  for (const p of dealerPurchases) {
    const a = dealerActivity.get(p.dealerId).purchases;
    a.count += 1;
    a.amount += p.items.reduce((s, i) => s + (i.rate != null ? Number(i.rate) * i.quantity : 0), 0);
  }
  for (const p of retailerPurchases) {
    const a = retailerActivity.get(p.retailerId).purchases;
    a.count += 1;
    a.amount += p.items.reduce((s, i) => s + (i.sellingPrice != null ? Number(i.sellingPrice) * i.quantity : 0), 0);
  }

  // ---- sales ----
  for (const s of dealerSales) {
    const bucket = dealerActivity.get(s.dealerId).sales;
    const amount = Number(s.totalAmount ?? 0);
    bucket.count += 1;
    bucket.amount += amount;
    const sub = s.customerType === 'RETAILER' ? bucket.retailer : bucket.cash;
    sub.count += 1;
    sub.amount += amount;
  }
  for (const s of retailerSales) {
    const a = retailerActivity.get(s.retailerId).sales;
    a.count += 1;
    a.amount += Number(s.totalAmount ?? 0);
  }

  // ---- soldProducts (settlement obligations) ----
  for (const sp of dealerOwnSoldProducts) {
    const bucket = dealerActivity.get(sp.sale.dealerId)?.soldProducts;
    if (!bucket) continue;
    addSettlement(bucket, Number(sp.saleItem.rate ?? 0) * sp.saleItem.quantity, sp.status);
  }
  for (const sp of dealerOriginSoldProducts) {
    const bucket = dealerActivity.get(sp.dealerId)?.soldProducts;
    if (!bucket) continue;
    addSettlement(bucket, Number(sp.saleItem.originDealerRate ?? 0) * sp.saleItem.quantity, sp.status);
  }
  for (const sp of retailerSoldProducts) {
    const bucket = retailerActivity.get(sp.sale.retailerId)?.soldProducts;
    if (!bucket) continue;
    addSettlement(bucket, Number(sp.saleItem.sellingPrice ?? 0) * sp.saleItem.quantity, sp.status);
  }

  // ---- goods returns ----
  const returnAmount = (items) => items.reduce((s, i) => s + Number(i.rate) * (i.approvedQuantity ?? i.quantity), 0);
  for (const g of dealerGoodsReturns) {
    const a = dealerActivity.get(g.dealerId).goodsReturns;
    a.count += 1;
    a.amount += returnAmount(g.items);
  }
  for (const g of retailerGoodsReturns) {
    const a = retailerActivity.get(g.retailerId).goodsReturns;
    a.count += 1;
    a.amount += returnAmount(g.items);
  }

  // ---- payments ----
  for (const p of payments) {
    if (p.supplierId && dealerActivity.has(p.dealerId)) {
      const a = dealerActivity.get(p.dealerId).payments;
      a.count += 1;
      a.amount += Number(p.amount);
    }
    if (p.retailerId && retailerActivity.has(p.retailerId)) {
      const a = retailerActivity.get(p.retailerId).payments;
      a.count += 1;
      a.amount += Number(p.amount);
    }
  }

  // ---- receipts (retailer-submitted, rolled up to their dealer) ----
  for (const r of receipts) {
    const info = retailerInfo.get(r.retailerId);
    if (!info) continue;
    const amount = Number(r.amount);
    const pending = r.status === 'TO_BE_CONFIRMED';

    const ra = retailerActivity.get(r.retailerId).receipts;
    ra.count += 1;
    ra.amount += amount;
    if (pending) ra.pendingAmount += amount;

    const da = dealerActivity.get(info.dealerId).receipts;
    da.count += 1;
    da.amount += amount;
    if (pending) da.pendingAmount += amount;
  }

  // ---- vouchers ----
  for (const v of payableVouchers) {
    const a = dealerActivity.get(v.dealerId).payableVouchers;
    a.count += 1;
    a.amount += Number(v.amount);
    if (OPEN_VOUCHER_STATUSES.includes(v.status)) a.openAmount += Number(v.amount);
  }
  for (const v of receivableVouchers) {
    const amount = Number(v.amount);
    const open = OPEN_VOUCHER_STATUSES.includes(v.status);

    const da = dealerActivity.get(v.dealerId).receivableVouchers;
    da.count += 1;
    da.amount += amount;
    if (open) da.openAmount += amount;

    if (v.retailerId && retailerActivity.has(v.retailerId)) {
      const ra = retailerActivity.get(v.retailerId).vouchers;
      ra.count += 1;
      ra.amount += amount;
      if (open) ra.openAmount += amount;
    }
  }

  const dealers = dealerIds.map((id) => {
    const info = dealerInfo.get(id);
    return {
      dealerId: id,
      dealerName: info.name,
      organisationId: info.organisationId,
      organisationName: info.organisationName,
      ...dealerActivity.get(id),
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
      ...retailerActivity.get(id),
    };
  });

  res.json({ context: req.user.role, dealers, retailers });
});

export default router;
