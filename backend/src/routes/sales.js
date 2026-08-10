import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope } from '../middleware/auth.js';

const router = Router();

router.get('/', authRequired, async (req, res) => {
  const scope = ownerScope(req);
  let where = {};
  if (scope.ownerType === 'DEALER') where = { ownerType: 'DEALER', dealerId: scope.dealerId };
  if (scope.ownerType === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: scope.retailerId };
  const sales = await prisma.sale.findMany({ where, include: { items: { include: { product: true } } }, orderBy: { date: 'desc' } });
  res.json(sales);
});

async function createSale(req, res) {
  const scope = ownerScope(req);
  if (!scope.ownerType) return res.status(403).json({ error: 'Only dealer/retailer accounts can create sales' });
  const { customerType, customerRetailerId, paymentMode, posTransactionRef, items } = req.body;

  if (!items || !items.length) return res.status(400).json({ error: 'No items in sale' });

  // validate stock
  for (const i of items) {
    const invWhere = {
      productId_ownerType_dealerId_retailerId: {
        productId: Number(i.productId),
        ownerType: scope.ownerType,
        dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
        retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
      }
    };
    const inv = await prisma.inventory.findUnique({ where: invWhere }).catch(() => null);
    if (!inv || inv.quantity < Number(i.quantity)) {
      return res.status(400).json({ error: `Insufficient stock for product ${i.productId}` });
    }
  }

  const totalAmount = items.reduce((sum, i) => sum + (Number(i.price) - Number(i.discount || 0)) * Number(i.quantity), 0);

  const sale = await prisma.sale.create({
    data: {
      ownerType: scope.ownerType,
      dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
      retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
      customerType,
      customerRetailerId: customerType === 'RETAILER' ? Number(customerRetailerId) : null,
      totalAmount,
      paymentMode,
      posTransactionRef: posTransactionRef || null,
      items: {
        create: items.map(i => ({
          productId: Number(i.productId), quantity: Number(i.quantity),
          price: i.price, discount: i.discount || 0
        }))
      }
    },
    include: { items: { include: { product: true } } }
  });

  // decrement inventory
  for (const i of items) {
    const invWhere = {
      productId_ownerType_dealerId_retailerId: {
        productId: Number(i.productId),
        ownerType: scope.ownerType,
        dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
        retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
      }
    };
    await prisma.inventory.update({ where: invWhere, data: { quantity: { decrement: Number(i.quantity) } } });
  }

  // If a dealer sells to a retailer, auto-generate a receivable voucher
  if (scope.ownerType === 'DEALER' && customerType === 'RETAILER' && customerRetailerId) {
    await prisma.voucher.create({
      data: {
        dealerId: scope.dealerId,
        retailerId: Number(customerRetailerId),
        amount: totalAmount,
        description: `Auto-voucher for Sale #${sale.id}`,
      }
    });
  }

  res.json(sale);
}

// Create a sale (bill). Body:
// { customerType: 'CASH' | 'RETAILER', customerRetailerId, paymentMode, posTransactionRef, items: [{productId, quantity, price, discount}] }
router.post('/', authRequired, createSale);

// POS webhook: external POS/card machine posts completed transaction here.
// This lets a physical POS terminal push a paid bill straight into the sales module
// (e.g. the terminal's integration software calls this endpoint once payment clears).
router.post('/pos-webhook', authRequired, (req, res) => {
  req.body.posTransactionRef = req.body.posTransactionRef || `POS-${Date.now()}`;
  return createSale(req, res);
});

export default router;
