import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// Any logged-in dealer/retailer needs to see suppliers to record purchases against them.
// DEALER accounts only see suppliers in their own division; ADMIN sees everything
// (needed to manage the master list under Suppliers).
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

// Only ADMIN manages the supplier/manufacturer master list
router.post('/', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, divisionId, bankAccounts } = req.body;
  const supplier = await prisma.supplier.create({
    data: {
      name, address, contactNumber, gstNumber,
      divisionId: divisionId ? Number(divisionId) : null,
      bankAccounts: { create: (bankAccounts || []).map(b => ({
        accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
      })) }
    },
    include: { bankAccounts: true, division: true }
  });
  res.json(supplier);
});

router.post('/:id/bank-accounts', authRequired, requireRole('ADMIN'), async (req, res) => {
  const supplierId = Number(req.params.id);
  const { accountNumber, ifsc, bankName } = req.body;
  const acc = await prisma.supplierBankAccount.create({ data: { supplierId, accountNumber, ifsc, bankName } });
  res.json(acc);
});

router.put('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, divisionId } = req.body;
  const data = { name, address, contactNumber, gstNumber };
  if (divisionId !== undefined) data.divisionId = divisionId ? Number(divisionId) : null;
  const supplier = await prisma.supplier.update({
    where: { id: Number(req.params.id) },
    data
  });
  res.json(supplier);
});

router.delete('/:id', authRequired, requireRole('ADMIN'), async (req, res) => {
  await prisma.supplier.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
