import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.js';
import dealerRoutes from './routes/dealers.js';
import retailerRoutes from './routes/retailers.js';
import categoryRoutes from './routes/categories.js';
import productRoutes from './routes/products.js';
import inventoryRoutes from './routes/inventory.js';
import purchaseRoutes from './routes/purchases.js';
import saleRoutes from './routes/sales.js';
import voucherRoutes from './routes/vouchers.js';
import receiptRoutes from './routes/receipts.js';
import paymentRoutes from './routes/payments.js';
import reportRoutes from './routes/reports.js';
import organisationRoutes from './routes/organisations.js';
import userRoleRoutes from './routes/userRoles.js';
import activityRoutes from './routes/activities.js';
import roleActivityMappingRoutes from './routes/roleActivityMapping.js';
import supplierRoutes from './routes/suppliers.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.use('/api/auth', authRoutes);
app.use('/api/dealers', dealerRoutes);
app.use('/api/retailers', retailerRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/receipts', receiptRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/organisations', organisationRoutes);
app.use('/api/user-roles', userRoleRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/role-activity-mapping', roleActivityMappingRoutes);
app.use('/api/suppliers', supplierRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`FoodMart API listening on port ${PORT}`));
