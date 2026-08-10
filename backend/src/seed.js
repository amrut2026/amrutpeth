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

  const dealer = await prisma.dealer.create({
    data: {
      name: 'Sunrise Foods Distributors',
      address: 'MIDC, Pune, Maharashtra',
      contactNumber: '9876543210',
      gstNumber: '27ABCDE1234F1Z5',
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
  const roleNames = ['Super User', 'Administrator', 'Owner', 'User'];
  const activityNames = [
    'Purchase', 'Sales', 'Reports', 'User Management', 'Retailer Management',
    'Dealer Management', 'Product Category Management', 'Product Management'
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

  // Sample Mahamandal organisation record
  await prisma.organisation.create({
    data: {
      orgName: 'State Food Distributors Mahamandal',
      orgAddress: 'Shivaji Nagar, Pune, Maharashtra',
      orgContact: '9800011122',
      orgType: 'MAHAMANDAL'
    }
  });

  // Sample suppliers/manufacturers
  await prisma.supplier.createMany({
    data: [
      { name: 'National Snacks Manufacturing Co.', address: 'MIDC, Nashik, Maharashtra', contactNumber: '9822011223', gstNumber: '27NSMCO1234H1Z1' },
      { name: 'Golden Grains Pvt Ltd', address: 'Ambad Industrial Area, Nashik', contactNumber: '9822033445', gstNumber: '27GGPL5566K1Z9' },
    ]
  });

  console.log('Seed complete.');
  console.log('Logins: admin/admin123, dealer1/dealer123, retailer1/retailer123');
  console.log({ dealerId: dealer.id, retailerId: retailer.id, categoryId: category.id });
}

main().catch(console.error).finally(() => prisma.$disconnect());
