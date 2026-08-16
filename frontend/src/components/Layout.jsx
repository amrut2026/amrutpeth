import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api.js';

// Each entry: [path, English label, Marathi label]
const NAV = {
  ADMIN: [
    ['/organisation', 'Organisation', 'संस्था'],
    ['/role-activity-mapping', 'Role-Activity Mapping', 'भूमिका-कार्य मॅपिंग'],
    ['/divisions', 'Divisions', 'विभाग'],
    ['/dealers', 'Dealers', 'डीलर्स'],
    ['/retailers', 'Retailers', 'किरकोळ विक्रेते'],
    ['/suppliers', 'Suppliers / Manufacturers', 'पुरवठादार / उत्पादक'],
    ['/categories', 'Categories', 'श्रेण्या'],
    ['/products', 'Products', 'उत्पादने'],
    ['/inventory', 'Inventory', 'साठा'],
    ['/sales', 'Sales (POS)', 'विक्री (पीओएस)'],
    ['/vouchers', 'Vouchers', 'व्हाउचर'],
    ['/receipts', 'Receipts', 'पावत्या'],
    ['/payments', 'Payments', 'देयके'],
    ['/reports', 'Reports', 'अहवाल'],
  ],
  DEALER: [
    ['/retailers', 'My Retailers', 'माझे किरकोळ विक्रेते'],
    ['/categories', 'Categories', 'श्रेण्या'],
    ['/products', 'Products', 'उत्पादने'],
    ['/inventory', 'Inventory', 'साठा'],
    ['/purchases', 'Purchases (Inwards)', 'खरेदी (आवक)'],
    ['/sales', 'Sales (POS)', 'विक्री (पीओएस)'],
    ['/vouchers', 'Vouchers', 'व्हाउचर'],
    ['/payments', 'Payments to Manufacturer', 'उत्पादकाला देयक'],
    ['/reports', 'Reports', 'अहवाल'],
  ],
  RETAILER: [
    ['/products', 'Products', 'उत्पादने'],
    ['/inventory', 'Inventory', 'साठा'],
    ['/purchases', 'Purchases (Inwards)', 'खरेदी (आवक)'],
    ['/sales', 'Sales (POS)', 'विक्री (पीओएस)'],
    ['/vouchers', 'Vouchers Received', 'मिळालेले व्हाउचर'],
    ['/receipts', 'Payments (Pay Dealer)', 'देयके (डीलरला पैसे द्या)'],
    ['/reports', 'Reports', 'अहवाल'],
  ],
};

// Marathi caption for each role, shown under the username
const ROLE_MR = {
  ADMIN: 'प्रशासक',
  DEALER: 'डीलर',
  RETAILER: 'किरकोळ विक्रेता',
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = NAV[user.role] || [];

  // Dealer/Retailer accounts are tied to a specific business — show that
  // business's name next to the username/role so it's clear who's logged in.
  // Admin has no such entity, so this stays empty for that role.
  const [entityName, setEntityName] = useState('');
  useEffect(() => {
    setEntityName('');
    if (user.role === 'DEALER' && user.dealerId) {
      api.get(`/dealers/${user.dealerId}`).then(({ data }) => setEntityName(data?.name || '')).catch(() => {});
    } else if (user.role === 'RETAILER' && user.retailerId) {
      api.get(`/retailers/${user.retailerId}`).then(({ data }) => setEntityName(data?.name || '')).catch(() => {});
    }
  }, [user.role, user.dealerId, user.retailerId]);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-64 bg-orange-900 text-white flex flex-col">
        <div className="p-4 border-b border-orange-700">
          <div className="text-4xl font-bold italic">Amrut Peth</div>
          <div className="text-4xl font-bold italic text-orange-200">अमृत पेठ</div>
        </div>
        <div className="p-4 text-sm text-orange-200">
          {entityName && <div className="text-base font-semibold text-white leading-tight">{entityName}</div>}
          {user.username}
          <span className="block text-xs uppercase tracking-wide">
            {user.role} · {ROLE_MR[user.role] || ''}
          </span>
        </div>
        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="mx-4 mb-4 px-3 py-2 bg-orange-700 rounded hover:bg-orange-600 text-sm">
          Log out <span className="text-orange-200">· बाहेर पडा</span>
        </button>
        <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
          {links.map(([to, label, labelMr]) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm leading-tight ${isActive ? 'bg-orange-700' : 'hover:bg-orange-800'}`}>
              <span className="block">{label}</span>
              <span className="block text-xs text-orange-200">{labelMr}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-6 overflow-y-auto">{children}</main>
    </div>
  );
}
