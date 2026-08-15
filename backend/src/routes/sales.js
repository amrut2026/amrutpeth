import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope } from '../middleware/auth.js';
import { generateSaleBillPdf } from '../lib/billPdf.js';

const router = Router();

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD'];

router.get('/', authRequired, async (req, res) => {
  const scope = ownerScope(req);
  let where = {};
  if (scope.ownerType === 'DEALER') where = { ownerType: 'DEALER', dealerId: scope.dealerId };
  if (scope.ownerType === 'RETAILER') where = { ownerType: 'RETAILER', retailerId: scope.retailerId };
  const sales = await prisma.sale.findMany({ where, include: { items: { include: { product: true } } }, orderBy: { date: 'desc' } });
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

    // Each inventoryId must be a specific batch row that actually belongs to
    // this seller — checked server-side so a sale can't be recorded against
    // another dealer/retailer's stock.
    const inventoryIds = items.map((i) => Number(i.inventoryId));
    const invRows = await prisma.inventory.findMany({
      where: {
        id: { in: inventoryIds },
        ownerType: scope.ownerType,
        dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
        retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
      }
    });
    const invById = new Map(invRows.map((r) => [r.id, r]));

    const lines = [];
    for (const i of items) {
      const inv = invById.get(Number(i.inventoryId));
      if (!inv) return res.status(403).json({ error: `Batch ${i.inventoryId} does not belong to your inventory` });
      if (inv.quantity < Number(i.quantity)) {
        return res.status(400).json({ error: `Insufficient stock in batch ${inv.batchName || inv.id} for product ${inv.productId}` });
      }
      lines.push({ inv, quantity: Number(i.quantity) });
    }

    const resolvedItems = lines.map(({ inv, quantity }) => {
      const price = scope.ownerType === 'RETAILER'
        ? inv.retailerSellingPrice
        : (customerType === 'RETAILER' ? inv.sellingPrice : inv.retailerSellingPrice);
      return {
        productId: inv.productId,
        quantity,
        price: Number(price),
        mrp: inv.mrp != null ? Number(inv.mrp) : null,
        batchName: inv.batchName || null,
      };
    });

    const totalAmount = resolvedItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          ownerType: scope.ownerType,
          dealerId: scope.ownerType === 'DEALER' ? scope.dealerId : null,
          retailerId: scope.ownerType === 'RETAILER' ? scope.retailerId : null,
          customerType,
          customerRetailerId: customerType === 'RETAILER' ? Number(customerRetailerId) : null,
          totalAmount,
          paymentMode,
          posTransactionRef: posTransactionRef || null,
          items: { create: resolvedItems }
        },
        include: { items: { include: { product: true } } }
      });

      // decrement the exact batch row that was sold from, inside the same
      // transaction as the sale, so a failed decrement rolls back the sale
      for (const { inv, quantity } of lines) {
        await tx.inventory.update({ where: { id: inv.id }, data: { quantity: { decrement: quantity } } });
      }

      // If a dealer sells to a retailer, auto-generate a receivable voucher
      if (scope.ownerType === 'DEALER' && customerType === 'RETAILER' && customerRetailerId) {
        await tx.voucher.create({
          data: {
            dealerId: scope.dealerId,
            retailerId: Number(customerRetailerId),
            amount: totalAmount,
            description: `Auto-voucher for Sale #${created.id}`,
          }
        });
      }

      return created;
    });

    res.json(sale);
  } catch (err) {
    console.error('createSale failed:', err);
    res.status(500).json({ error: 'Failed to create sale', detail: err.message });
  }
}

router.post('/', authRequired, createSale);

// POS webhook: external POS/card machine posts completed transaction here.
// This lets a physical POS terminal push a paid bill straight into the sales module
// (e.g. the terminal's integration software calls this endpoint once payment clears).
router.post('/pos-webhook', authRequired, (req, res) => {
  req.body.posTransactionRef = req.body.posTransactionRef || `POS-${Date.now()}`;
  return createSale(req, res);
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
