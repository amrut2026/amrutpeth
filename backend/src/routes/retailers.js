import { Router } from 'express';
import { prisma } from '../prisma.js';
import { authRequired, requireRole } from '../middleware/auth.js';

const router = Router();

// List retailers - ADMIN sees all, DEALER sees own retailers, RETAILER sees self
router.get('/', authRequired, async (req, res) => {
  let where = {};
  if (req.user.role === 'DEALER') where = { primaryDealerId: req.user.dealerId };
  if (req.user.role === 'RETAILER') where = { id: req.user.retailerId };
  const retailers = await prisma.retailer.findMany({ where, include: { bankAccounts: true } });
  res.json(retailers);
});

router.get('/:id', authRequired, async (req, res) => {
  const retailer = await prisma.retailer.findUnique({
    where: { id: Number(req.params.id) },
    include: { bankAccounts: true }
  });
  res.json(retailer);
});

// Create retailer - DEALER (or ADMIN) creates a retailer under a dealer
router.post('/', authRequired, requireRole('ADMIN', 'DEALER'), async (req, res) => {
  const { name, address, contactNumber, gstNumber, bankAccounts } = req.body;
  const primaryDealerId = req.user.role === 'DEALER' ? req.user.dealerId : req.body.primaryDealerId;
  const retailer = await prisma.retailer.create({
    data: {
      name, address, contactNumber, gstNumber, primaryDealerId,
      bankAccounts: { create: (bankAccounts || []).map(b => ({
        accountNumber: b.accountNumber, ifsc: b.ifsc, bankName: b.bankName
      })) }
    },
    include: { bankAccounts: true }
  });
  res.json(retailer);
});

router.put('/:id', authRequired, requireRole('ADMIN', 'DEALER'), async (req, res) => {
  const id = Number(req.params.id);
  const { name, address, contactNumber, gstNumber } = req.body;
  const retailer = await prisma.retailer.update({ where: { id }, data: { name, address, contactNumber, gstNumber } });
  res.json(retailer);
});

router.post('/:id/bank-accounts', authRequired, requireRole('ADMIN', 'DEALER', 'RETAILER'), async (req, res) => {
  const retailerId = Number(req.params.id);
  const { accountNumber, ifsc, bankName } = req.body;
  const acc = await prisma.retailerBankAccount.create({ data: { retailerId, accountNumber, ifsc, bankName } });
  res.json(acc);
});

router.delete('/:id', authRequired, requireRole('ADMIN', 'DEALER'), async (req, res) => {
  await prisma.retailer.delete({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

export default router;
