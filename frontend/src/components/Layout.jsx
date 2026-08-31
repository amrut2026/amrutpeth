import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api.js';

// Each entry: [path, English label, Marathi label]
const NAV = {
  // Ordered per the hierarchy: organisation, division, supplier, dealer,
  // retailer, product, purchase, report — anything outside that hierarchy
  // (role-activity-mapping, categories) follows after, in no particular
  // order.
  //
  // Sales, Inventory, Vouchers, Receipts, and Payments are deliberately
  // NOT in ADMIN's nav (nor its route protection in App.jsx) — these are
  // dealer/retailer operational screens, not an admin oversight function.
  // If admin-side visibility into these is ever needed, it belongs in
  // Reports, not by reopening these routes to ADMIN.
  ADMIN: [
    ['/organisation', 'Organisation', 'संस्था'],
    ['/divisions', 'Divisions', 'विभाग'],
    ['/suppliers', 'Suppliers / Manufacturers', 'पुरवठादार / उत्पादक'],
    ['/categories', 'Categories', 'श्रेण्या'],
    ['/products', 'Products', 'उत्पादने'],
    ['/dealers', 'Dealers', 'डीलर्स'],
    ['/retailers', 'Retailers', 'किरकोळ विक्रेते'],
    ['/reports', 'Reports', 'अहवाल'],
    ['/role-activity-mapping', 'Role-Activity Mapping', 'भूमिका-कार्य मॅपिंग'],
  ],
  // ORGANISATION manages dealers and the division master list (see
  // dealers.js / divisions.js). Suppliers/Manufacturers is read-only here —
  // creation and edits now live with DEALER (see suppliers.js), since a
  // dealer is the one actually transacting with a supplier. ADMIN keeps
  // its own read-only Suppliers entry above too, for oversight. Reports
  // comes last, same as every other role's nav.
  ORGANISATION: [
    ['/divisions', 'Divisions', 'विभाग'],
    ['/dealers', 'Dealers', 'डीलर्स'],
    ['/suppliers', 'Suppliers / Manufacturers', 'पुरवठादार / उत्पादक'],
    ['/reports', 'Reports', 'अहवाल'],
  ],
  DEALER: [
    ['/retailers', 'My Retailers', 'माझे किरकोळ विक्रेते'],
    ['/suppliers', 'Suppliers / Manufacturers', 'पुरवठादार / उत्पादक'],
    ['/categories', 'Categories', 'श्रेण्या'],
    ['/products', 'Products', 'उत्पादने'],
    ['/purchases', 'Purchases (Inwards)', 'खरेदी (आवक)'],
    ['/goods-returns', 'Goods Returned', 'मालाची परत'],
    ['/sales', 'Sales (POS)', 'विक्री (पीओएस)'],
    ['/sold-products', 'Sold Products (Pay Supplier)', 'विकलेली उत्पादने (पुरवठादाराला भरा)'],
    ['/vouchers', 'Vouchers', 'व्हाउचर'],
    // Receipts a retailer has recorded against the dealer's own RECEIVABLE
    // vouchers — i.e. the dealer's acknowledgement that a retailer paid
    // them (see receipts.js, already scoped to the dealer's own vouchers;
    // this route just wasn't reachable from the DEALER nav before).
    ['/receipts', 'Receipts (from Retailers)', 'पावत्या (किरकोळ विक्रेत्यांकडून)'],
    ['/payments', 'Payments to Manufacturer', 'उत्पादकाला देयक'],
    ['/reports', 'Reports', 'अहवाल'],
  ],
  // Note on the /receipts entry below: despite the path name, it's the
  // retailer paying their dealer (see Receipts.jsx), so it's labelled as
  // "Payments" here even though the route is /receipts.
  RETAILER: [
    ['/products', 'Products', 'उत्पादने'],
    ['/purchases', 'Purchases (Inwards)', 'खरेदी (आवक)'],
    ['/goods-returns', 'Goods Returned', 'मालाची परत'],
    ['/sales', 'Sales (POS)', 'विक्री (पीओएस)'],
    ['/sold-products', 'Sold Products (Pay Dealer)', 'विकलेली उत्पादने (डीलरला भरा)'],
    ['/vouchers', 'Vouchers Received', 'मिळालेले व्हाउचर'],
    ['/receipts', 'Payments (Pay Dealer)', 'देयके (डीलरला पैसे द्या)'],
    ['/reports', 'Reports', 'अहवाल'],
  ],
};

// Marathi caption for each role, shown under the username
const ROLE_MR = {
  ADMIN: 'प्रशासक',
  ORGANISATION: 'संस्था',
  DEALER: 'डीलर',
  RETAILER: 'किरकोळ विक्रेता',
};

export default function Layout({ children }) {
  const { user, logout, changePassword } = useAuth();
  const navigate = useNavigate();
  const links = NAV[user.role] || [];

  // Dealer/Retailer/Organisation accounts are each tied to a specific
  // entity — show that entity's name next to the username/role so it's
  // clear who's logged in. Admin has no such entity, so this stays empty
  // for that role.
  const [entityName, setEntityName] = useState('');
  useEffect(() => {
    setEntityName('');
    if (user.role === 'DEALER' && user.dealerId) {
      api.get(`/dealers/${user.dealerId}`).then(({ data }) => setEntityName(data?.name || '')).catch(() => {});
    } else if (user.role === 'RETAILER' && user.retailerId) {
      api.get(`/retailers/${user.retailerId}`).then(({ data }) => setEntityName(data?.name || '')).catch(() => {});
    } else if (user.role === 'ORGANISATION' && user.organisationId) {
      api.get(`/organisations/${user.organisationId}`).then(({ data }) => setEntityName(data?.orgName || '')).catch(() => {});
    }
  }, [user.role, user.dealerId, user.retailerId, user.organisationId]);

  // Change Password modal — same flow for every role (ADMIN, ORGANISATION,
  // DEALER, RETAILER), since it lives in Layout rather than a per-role page.
  const [showChangePassword, setShowChangePassword] = useState(false);

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
      <main className="flex-1 flex flex-col overflow-y-auto">
        <div className="flex justify-end items-center gap-2 px-6 py-3 bg-white border-b">
          {/* Lives in the top bar (not the role-specific nav) so every role —
              ADMIN, ORGANISATION, DEALER, RETAILER — can reach it. Opens in a
              new tab so it never interrupts whatever the user is doing. The
              PDF itself is a static asset (see /public/user-manual.pdf), not
              an API-served file, since its content never depends on who's
              logged in. */}
          <a
            href="/user-manual.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-sm hover:bg-gray-100">
            User Manual <span className="text-gray-400">· वापरकर्ता पुस्तिका</span>
          </a>
          <button
            onClick={() => setShowChangePassword(true)}
            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-sm hover:bg-gray-100">
            Change Password <span className="text-gray-400">· पासवर्ड बदला</span>
          </button>
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="px-3 py-1.5 bg-orange-800 text-white rounded hover:bg-orange-700 text-sm">
            Log out <span className="text-orange-200">· बाहेर पडा</span>
          </button>
        </div>
        <div className="flex-1 p-6">{children}</div>
      </main>
      {showChangePassword && (
        <ChangePasswordModal
          changePassword={changePassword}
          onClose={() => setShowChangePassword(false)}
        />
      )}
    </div>
  );
}

// Standalone so its own form state resets cleanly each time it's opened
// (Layout only mounts it while showChangePassword is true).
function ChangePasswordModal({ changePassword, onClose }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match / नवीन पासवर्ड जुळत नाहीत');
      return;
    }
    if (form.newPassword.length < 6) {
      setError('New password must be at least 6 characters / नवीन पासवर्ड किमान ६ अक्षरांचा असावा');
      return;
    }
    setLoading(true);
    try {
      await changePassword(form.currentPassword, form.newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password / पासवर्ड बदलण्यात अयशस्वी');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded shadow-lg w-full max-w-sm p-5">
        <h2 className="text-lg font-semibold mb-4">
          Change Password <span className="text-sm font-normal text-gray-500">/ पासवर्ड बदला</span>
        </h2>

        {success ? (
          <div>
            <p className="text-emerald-700 text-sm mb-4">
              Password changed successfully. / पासवर्ड यशस्वीरित्या बदलला.
            </p>
            <button
              onClick={onClose}
              className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800 text-sm">
              Close / बंद करा
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">Current Password / सध्याचा पासवर्ड</label>
              <input
                type="password"
                className="border rounded px-2 py-1"
                value={form.currentPassword}
                onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">New Password / नवीन पासवर्ड</label>
              <input
                type="password"
                className="border rounded px-2 py-1"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-gray-500 mb-1">Confirm New Password / नवीन पासवर्डची पुष्टी करा</label>
              <input
                type="password"
                className="border rounded px-2 py-1"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                required
              />
            </div>
            {error && <span className="text-red-600 text-sm">{error}</span>}
            <div className="flex items-center gap-3 mt-2">
              <button
                disabled={loading}
                className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800 text-sm disabled:opacity-50">
                {loading ? 'Saving... / जतन करत आहे...' : 'Save / जतन करा'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-600 text-sm px-3 py-2 rounded hover:bg-gray-100">
                Cancel / रद्द करा
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
