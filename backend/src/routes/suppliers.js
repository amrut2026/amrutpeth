import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Supplier catalog is owned by dealers: each supplier belongs to exactly
// one dealer (the one that created it) — same exclusive-ownership pattern
// as Product/ProductCategory, replacing the previous division-shared model.
// A DEALER only sees their own suppliers; a RETAILER only sees suppliers
// belonging to their primary dealer — this is what keeps purchases scoped
// to "your own dealer's suppliers" downstream. ADMIN/ORGANISATION see
// everything, for oversight.
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') {
    where = { dealerId: req.user.dealerId };
  } else if (req.user.role === 'RETAILER') {
    const retailer = await prisma.retailer.findUnique({ where: { id: req.user.retailerId } });
    where = { dealerId: retailer?.primaryDealerId ?? -1 }; // -1 matches nothing if somehow unset
  }
  res.json(await prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, include: { bankAccounts: true, dealer: true } }));
});

router.get('/:id', authRequired, async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id: Number(req.params.id) },
    include: { bankAccounts: true, dealer: true }
  });
  res.json(supplier);
});

// Create supplier - DEALER only. Every supplier is automatically tagged
// with the creating dealer's own id (never taken from the client) — this
// is what scopes the supplier to that dealer for purchases downstream, and
// what a dealer can later edit/delete (see ownership check below).
router.post('/', authRequired, requireRole('DEALER'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, bankAccounts } = req.body;
  const supplier = await prisma.supplier.create({
    data: {
      name, address, contactNumber,
      gstNumber: gstNumber ? gstNumber.trim() || null : null,
      dealerId: req.user.dealerId,
      bankAccounts: { create: (bankAccounts || []).map(b => ({
        accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
      })) }
    },
    include: { bankAccounts: true, dealer: true }
  });
  res.json(supplier);
});

router.post('/:id/bank-accounts', authRequired, requireRole('DEALER'), async (req, res) => {
  const supplierId = Number(req.params.id);
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only manage your own suppliers' });
  }

  const { accountNumber, ifsc, bankName } = req.body;
  const acc = await prisma.supplierBankAccount.create({ data: { supplierId, accountNumber, ifsc, bankName } });
  res.json(acc);
});

router.put('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const supplierId = Number(req.params.id);
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!existing || existing.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only manage your own suppliers' });
  }

  // dealerId itself is intentionally not editable here — a dealer moving a
  // supplier to another dealer would immediately lock themselves out of
  // managing it. If a supplier needs to change owning dealer, that's an
  // ADMIN-level master-data fix, not a dealer action.
  const { name, address, contactNumber, gstNumber } = req.body;
  const supplier = await prisma.supplier.update({
    where: { id: supplierId },
    data: { name, address, contactNumber, gstNumber: gstNumber ? gstNumber.trim() || null : null }
  });
  res.json(supplier);
});

router.delete('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const supplierId = Number(req.params.id);
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!existing || existing.dealerId !== req.user.dealerId) {
    return res.status(403).json({ error: 'You can only manage your own suppliers' });
  }

  await prisma.supplier.delete({ where: { id: supplierId } });
  res.json({ ok: true });
});

export default router;
