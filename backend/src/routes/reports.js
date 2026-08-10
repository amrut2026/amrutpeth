import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// Products dispatched by dealer to retailers
router.get('/dispatch', authRequired, async (req, res) => {
  const where = req.user.role === 'DEALER'
    ? { ownerType: 'DEALER', dealerId: req.user.dealerId, customerType: 'RETAILER' }
    : { customerType: 'RETAILER' };
  const sales = await prisma.sale.findMany({
    where, include: { items: { include: { product: true } } }, orderBy: { date: 'desc' }
  });
  res.json(sales);
});

// Money receivable from retailers (open/partial vouchers)
router.get('/receivables', authRequired, async (req, res) => {
  const where = req.user.role === 'DEALER'
    ? { dealerId: req.user.dealerId, status: { in: ['OPEN', 'PARTIALLY_PAID'] } }
    : { status: { in: ['OPEN', 'PARTIALLY_PAID'] } };
  const vouchers = await prisma.voucher.findMany({ where, include: { retailer: true, receipts: true } });
  const result = vouchers.map(v => ({
    ...v,
    received: v.receipts.reduce((s, r) => s + Number(r.amount), 0),
    outstanding: Number(v.amount) - v.receipts.reduce((s, r) => s + Number(r.amount), 0)
  }));
  res.json(result);
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
