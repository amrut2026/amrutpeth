import { prisma } from '../prisma.js';

// Aggregator orders sit in PENDING_COLLECTION without taking stock (stock is
// only decremented when the retailer confirms collection - see sales.js
// PATCH /:id/collect). Inventory.quantity is therefore the PHYSICAL count,
// part of which may already be promised to a customer. This adds:
//   heldQuantity      - units promised to PENDING_COLLECTION orders
//   availableQuantity - quantity - heldQuantity (never below 0)
//   lowStock          - judged on availableQuantity, since that is what can
//                       actually still be sold or promised
// Same definition of "held" that resolveBatchLines uses in sales.js.
export async function withHeldStock(rows) {
  if (!rows.length) return rows;
  const held = await prisma.saleItem.groupBy({
    by: ['inventoryId'],
    where: { inventoryId: { in: rows.map((r) => r.id) }, sale: { status: 'PENDING_COLLECTION' } },
    _sum: { quantity: true },
  });
  const heldById = new Map(held.map((h) => [h.inventoryId, h._sum.quantity || 0]));
  return rows.map((r) => {
    const heldQuantity = heldById.get(r.id) || 0;
    const availableQuantity = Math.max(0, r.quantity - heldQuantity);
    return { ...r, heldQuantity, availableQuantity, lowStock: availableQuantity <= r.reorderLevel };
  });
}
