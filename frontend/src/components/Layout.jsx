import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = {
  ADMIN: [
    ['/organisation', 'Organisation'], ['/role-activity-mapping', 'Role-Activity Mapping'],
    ['/dealers', 'Dealers'], ['/retailers', 'Retailers'], ['/suppliers', 'Suppliers / Manufacturers'],
    ['/categories', 'Categories'],
    ['/products', 'Products'], ['/inventory', 'Inventory'], ['/purchases', 'Purchases'],
    ['/sales', 'Sales (POS)'], ['/vouchers', 'Vouchers'], ['/receipts', 'Receipts'],
    ['/payments', 'Payments'], ['/reports', 'Reports'],
  ],
  DEALER: [
    ['/retailers', 'My Retailers'], ['/categories', 'Categories'], ['/products', 'Products'],
    ['/inventory', 'Inventory'], ['/purchases', 'Purchases (Inwards)'], ['/sales', 'Sales (POS)'],
    ['/vouchers', 'Vouchers'], ['/payments', 'Payments to Manufacturer'], ['/reports', 'Reports'],
  ],
  RETAILER: [
    ['/products', 'Products'], ['/inventory', 'Inventory'], ['/purchases', 'Purchases (Inwards)'],
    ['/sales', 'Sales (POS)'], ['/vouchers', 'Vouchers Received'], ['/receipts', 'Receipts (Pay Dealer)'],
    ['/reports', 'Reports'],
  ],
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = NAV[user.role] || [];

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 bg-emerald-900 text-white flex flex-col">
        <div className="p-4 text-xl font-bold border-b border-emerald-700">FoodMart</div>
        <div className="p-4 text-sm text-emerald-200">
          {user.username} <span className="block text-xs uppercase tracking-wide">{user.role}</span>
        </div>
        <nav className="flex-1 px-2 space-y-1">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm ${isActive ? 'bg-emerald-700' : 'hover:bg-emerald-800'}`}>
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="m-4 px-3 py-2 bg-emerald-700 rounded hover:bg-emerald-600 text-sm">
          Log out
        </button>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
