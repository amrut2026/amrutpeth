import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Dealers from './pages/Dealers.jsx';
import Retailers from './pages/Retailers.jsx';
import Categories from './pages/Categories.jsx';
import Products from './pages/Products.jsx';
import Inventory from './pages/Inventory.jsx';
import Purchases from './pages/Purchases.jsx';
import Sales from './pages/Sales.jsx';
import Vouchers from './pages/Vouchers.jsx';
import Receipts from './pages/Receipts.jsx';
import Payments from './pages/Payments.jsx';
import Reports from './pages/Reports.jsx';
import Organisation from './pages/Organisation.jsx';
import RoleActivityMapping from './pages/RoleActivityMapping.jsx';
import Suppliers from './pages/Suppliers.jsx';

function Protected({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/organisation" element={<Protected><Organisation /></Protected>} />
      <Route path="/role-activity-mapping" element={<Protected><RoleActivityMapping /></Protected>} />
      <Route path="/suppliers" element={<Protected><Suppliers /></Protected>} />
      <Route path="/dealers" element={<Protected><Dealers /></Protected>} />
      <Route path="/retailers" element={<Protected><Retailers /></Protected>} />
      <Route path="/categories" element={<Protected><Categories /></Protected>} />
      <Route path="/products" element={<Protected><Products /></Protected>} />
      <Route path="/inventory" element={<Protected><Inventory /></Protected>} />
      <Route path="/purchases" element={<Protected><Purchases /></Protected>} />
      <Route path="/sales" element={<Protected><Sales /></Protected>} />
      <Route path="/vouchers" element={<Protected><Vouchers /></Protected>} />
      <Route path="/receipts" element={<Protected><Receipts /></Protected>} />
      <Route path="/payments" element={<Protected><Payments /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
