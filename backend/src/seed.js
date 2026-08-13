import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma.js';

async function main() {
  const hash = (pwd) => bcrypt.hashSync(pwd, 10);

  // Admin (manufacturer / platform owner)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', password: hash('admin123'), role: 'ADMIN' }
  });

  // Organisation (Mahamandal) must exist before any Dealer, since Dealer.organizationId
  // is a required FK (defaulting to 1). orgName has no unique constraint, so this is a
  // manual find-or-create rather than an upsert.
  let organisation = await prisma.organisation.findFirst({ where: { orgName: 'State Food Distributors Mahamandal' } });
  if (!organisation) {
    organisation = await prisma.organisation.create({
      data: {
        orgName: 'State Food Distributors Mahamandal',
        orgAddress: 'Shivaji Nagar, Pune, Maharashtra',
        orgContact: '9800011122',
        orgType: 'MAHAMANDAL'
      }
    });
  }

  const division = await prisma.division.upsert({
    where: { name: 'Pune Division' },
    update: {},
    create: { name: 'Pune Division', description: 'Pune and surrounding areas' }
  });

  const dealer = await prisma.dealer.create({
    data: {
      name: 'Sunrise Foods Distributors',
      address: 'MIDC, Pune, Maharashtra',
      contactNumber: '9876543210',
      gstNumber: '27ABCDE1234F1Z5',
      divisionId: division.id,
      organizationId: organisation.orgId,
      bankAccounts: { create: [{ accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' }] }
    }
  });

  await prisma.user.upsert({
    where: { username: 'dealer1' },
    update: {},
    create: { username: 'dealer1', password: hash('dealer123'), role: 'DEALER', dealerId: dealer.id }
  });

  const retailer = await prisma.retailer.create({
    data: {
      name: 'Green Mart Retail',
      address: 'FC Road, Pune, Maharashtra',
      contactNumber: '9123456780',
      gstNumber: '27XYZAB5678G1Z2',
      primaryDealerId: dealer.id,
      bankAccounts: { create: [{ accountNumber: '987654321098', ifsc: 'ICIC0005678', bankName: 'ICICI Bank' }] }
    }
  });

  await prisma.user.upsert({
    where: { username: 'retailer1' },
    update: {},
    create: { username: 'retailer1', password: hash('retailer123'), role: 'RETAILER', retailerId: retailer.id }
  });

  const category = await prisma.productCategory.create({
    data: { name: 'Snacks', description: 'Packaged snack foods' }
  });

  // ---- RBAC reference data: user_roles.json + activities.json ----
  // Activity names are kept in sync with the labels in Layout.jsx's ADMIN nav,
  // so Role-Activity Mapping reads as a direct on/off switch for each sidebar item.
  const roleNames = ['Super User', 'Administrator', 'Owner', 'User'];

  // Renames applied to any activities seeded under the old naming convention
  // (e.g. from before this list was aligned to the sidebar). Renaming in place
  // preserves activityId, so any existing RoleActivityMapping rows stay intact.
  // 'User Management' has no sidebar equivalent (login credentials are managed
  // inline on the Dealers/Retailers pages), so it's left as-is rather than renamed.
  const activityRenames = {
    'Purchase': 'Purchases',
    'Sales': 'Sales (POS)',
    'Retailer Management': 'Retailers',
    'Dealer Management': 'Dealers',
    'Product Category Management': 'Categories',
    'Product Management': 'Products',
    'Supplier Management': 'Suppliers / Manufacturers',
    'Division Management': 'Divisions',
    'Inventory Management': 'Inventory',
    'Voucher Management': 'Vouchers',
    'Receipt Management': 'Receipts',
    'Payment Management': 'Payments',
    'Organisation Management': 'Organisation',
  };
  for (const [oldName, newName] of Object.entries(activityRenames)) {
    const existing = await prisma.activity.findUnique({ where: { activityName: oldName } });
    if (existing) {
      await prisma.activity.update({ where: { activityId: existing.activityId }, data: { activityName: newName } });
    }
  }

  // Final activity list, matching Layout.jsx's ADMIN nav labels and order
  const activityNames = [
    'Organisation', 'Role-Activity Mapping', 'Divisions', 'Dealers', 'Retailers',
    'Suppliers / Manufacturers', 'Categories', 'Products', 'Inventory', 'Purchases',
    'Sales (POS)', 'Vouchers', 'Receipts', 'Payments', 'Reports'
  ];

  for (const roleName of roleNames) {
    await prisma.userRole.upsert({ where: { roleName }, update: {}, create: { roleName } });
  }
  for (const activityName of activityNames) {
    await prisma.activity.upsert({ where: { activityName }, update: {}, create: { activityName } });
  }

  // Default mapping: Super User gets every activity active
  const superUser = await prisma.userRole.findUnique({ where: { roleName: 'Super User' } });
  const allActivities = await prisma.activity.findMany();
  for (const act of allActivities) {
    await prisma.roleActivityMapping.upsert({
      where: { roleId_activityId: { roleId: superUser.roleId, activityId: act.activityId } },
      update: {},
      create: { roleId: superUser.roleId, activityId: act.activityId, iactive: true }
    });
  }

  // Sample suppliers/manufacturers
  await prisma.supplier.createMany({
    data: [
      { name: 'National Snacks Manufacturing Co.', address: 'MIDC, Nashik, Maharashtra', contactNumber: '9822011223', gstNumber: '27NSMCO1234H1Z1', divisionId: division.id },
      { name: 'Golden Grains Pvt Ltd', address: 'Ambad Industrial Area, Nashik', contactNumber: '9822033445', gstNumber: '27GGPL5566K1Z9', divisionId: division.id },
    ]
  });

  console.log('Seed complete.');
  console.log('Logins: admin/admin123, dealer1/dealer123, retailer1/retailer123');
  console.log({ organisationId: organisation.orgId, dealerId: dealer.id, retailerId: retailer.id, categoryId: category.id });
}

main().catch(console.error).finally(() => prisma.$disconnect());