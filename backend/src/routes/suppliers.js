import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Any logged-in dealer/retailer needs to see suppliers to record purchases
// against them. DEALER accounts only see suppliers in their own division;
// everyone else (ADMIN, ORGANISATION, RETAILER) sees the full master list —
// same shared-master-data shape as Divisions, since a supplier/manufacturer
// isn't owned by any one organisation the way a Dealer is.
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') {
    const dealer = await prisma.dealer.findUnique({ where: { id: req.user.dealerId } });
    where = { divisionId: dealer?.divisionId ?? -1 }; // -1 matches nothing if the dealer has no division set
  }
  res.json(await prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, include: { bankAccounts: true, division: true } }));
});

router.get('/:id', authRequired, async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id: Number(req.params.id) },
    include: { bankAccounts: true, division: true }
  });
  res.json(supplier);
});

// DEALER is the one actually transacting with a supplier, so write access
// moved here from ORGANISATION (which now only sees the read-only master
// list, same as ADMIN). Scoped to the dealer's own division — a dealer may
// only create/edit/delete suppliers within that division, never another
// one, so this stays a real access boundary and not just a UI convenience.
async function dealerDivisionId(req) {
  const dealer = await prisma.dealer.findUnique({ where: { id: req.user.dealerId } });
  return dealer?.divisionId ?? null;
}

router.post('/', authRequired, requireRole('DEALER'), async (req, res) => {
  const divisionId = await dealerDivisionId(req);
  if (!divisionId) {
    return res.status(400).json({ error: 'Your dealer account has no division assigned — contact your organisation' });
  }

  const { name, address, contactNumber, gstNumber, bankAccounts } = req.body;
  // divisionId is never taken from the client — always the dealer's own,
  // so a newly created supplier is guaranteed to show up in this same
  // dealer's own GET / list above.
  const supplier = await prisma.supplier.create({
    data: {
      name, address, contactNumber,
      gstNumber: gstNumber ? gstNumber.trim() || null : null,
      divisionId,
      bankAccounts: { create: (bankAccounts || []).map(b => ({
        accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
      })) }
    },
    include: { bankAccounts: true, division: true }
  });
  res.json(supplier);
});

router.post('/:id/bank-accounts', authRequired, requireRole('DEALER'), async (req, res) => {
  const supplierId = Number(req.params.id);
  const divisionId = await dealerDivisionId(req);
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.divisionId !== divisionId) {
    return res.status(403).json({ error: 'You can only manage suppliers in your own division' });
  }

  const { accountNumber, ifsc, bankName } = req.body;
  const acc = await prisma.supplierBankAccount.create({ data: { supplierId, accountNumber, ifsc, bankName } });
  res.json(acc);
});

router.put('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const supplierId = Number(req.params.id);
  const divisionId = await dealerDivisionId(req);
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!existing || existing.divisionId !== divisionId) {
    return res.status(403).json({ error: 'You can only manage suppliers in your own division' });
  }

  // divisionId itself is intentionally not editable here — a dealer moving
  // a supplier out of their own division would immediately lock themselves
  // out of managing it, and moving one in would reach into another
  // dealer's division. If a supplier needs to change division, that's an
  // ORGANISATION-level master-data fix, not a dealer action.
  const { name, address, contactNumber, gstNumber } = req.body;
  const supplier = await prisma.supplier.update({
    where: { id: supplierId },
    data: { name, address, contactNumber, gstNumber: gstNumber ? gstNumber.trim() || null : null }
  });
  res.json(supplier);
});

router.delete('/:id', authRequired, requireRole('DEALER'), async (req, res) => {
  const supplierId = Number(req.params.id);
  const divisionId = await dealerDivisionId(req);
  const existing = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!existing || existing.divisionId !== divisionId) {
    return res.status(403).json({ error: 'You can only manage suppliers in your own division' });
  }

  await prisma.supplier.delete({ where: { id: supplierId } });
  res.json({ ok: true });
});

export default router;
