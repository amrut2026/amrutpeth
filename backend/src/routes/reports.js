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
        (p) => p.receipt?.status ?? 'TO_BE_CONFIRMED'
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

// Inventory report (with low-stock flag) - reused by dealer or retailer login
router.get('/inventory', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { ownerType: 'DEALER', dealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: req.user.retailerId };
  const rows = await prisma.inventory.findMany({ where, include: { product: true } });
  res.json(rows.map(r => ({ ...r, lowStock: r.quantity <= r.reorderLevel })));
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

export default router;
