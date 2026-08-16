import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, ownerScope, requireRole } from '../middleware/auth.js';
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
          status: 'COMPLETED',
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
    if (!items || !items.length) return res.status(400).json({ error: 'No items to dispatch' });

    const sale = await prisma.sale.findUnique({
      where: { id },
      include: { items: true, linkedPurchase: true }
    });
    if (!sale) return res.status(404).json({ error: 'Sale not found' });
    if (sale.dealerId !== scope.dealerId) return res.status(403).json({ error: 'You can only dispatch your own sales' });
    if (sale.status !== 'IN_PENDING') return res.status(400).json({ error: 'Only a pending order can be dispatched' });

    // A batch must be chosen for every line on the order — no partial dispatch.
    const chosenBySaleItemId = new Map(items.map((i) => [Number(i.saleItemId), Number(i.inventoryId)]));
    if (sale.items.some((si) => !chosenBySaleItemId.has(si.id))) {
      return res.status(400).json({ error: 'A batch must be chosen for every item' });
    }

    const inventoryIds = [...chosenBySaleItemId.values()];
    const invRows = await prisma.inventory.findMany({
      where: { id: { in: inventoryIds }, ownerType: 'DEALER', dealerId: scope.dealerId }
    });
    const invById = new Map(invRows.map((r) => [r.id, r]));

    const resolved = [];
    for (const saleItem of sale.items) {
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
          data: { price: inv.sellingPrice, mrp: inv.mrp, batchName: inv.batchName }
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
    if (!i.quantity || Number(i.quantity) <= 0) return res.status(400).json({ error: 'Quantity must be greater than zero' });
    // A dealer can fulfil for less than what the retailer ordered (partial
    // fulfilment), but never more — originalQuantity is the ceiling.
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
