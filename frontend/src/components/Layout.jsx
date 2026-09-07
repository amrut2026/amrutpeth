import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api.js';
import logo from '../assets/amrutpeth-logo.jpeg';

// Each entry: [path, English label, Marathi label]
const NAV = {
  // Ordered per the hierarchy: organisation, division, supplier, dealer,
  // retailer, product, purchase, report — anything outside that hierarchy
  // (categories) follows after, in no particular order.
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
  ],
  // READONLY is an oversight login with the same screen set as ADMIN
  // (organisation, divisions, suppliers, categories, products, dealers,
  // retailers, reports) but every one of those screens must render in
  // view-only mode for this role — see the canWrite/canCreate/editable/
  // activatable props on CrudTable. This array only controls which links
  // show up in the sidebar; it does NOT by itself stop writes. Each page
  // component (Organisation.jsx, Divisions.jsx, Categories.jsx,
  // Products.jsx, Suppliers.jsx, Dealers.jsx, Retailers.jsx) still needs
  // its own canWrite/canCreate/editable/activatable computation to treat
  // READONLY the same as "no write access", and the backend routes for
  // each of these resources need the equivalent check so the API isn't
  // reachable directly. Reports needs no changes since it's already
  // read-only for every role.
  READONLY: [
    ['/organisation', 'Organisation', 'संस्था'],
    ['/divisions', 'Divisions', 'विभाग'],
    ['/suppliers', 'Suppliers / Manufacturers', 'पुरवठादार / उत्पादक'],
    ['/categories', 'Categories', 'श्रेण्या'],
    ['/products', 'Products', 'उत्पादने'],
    ['/dealers', 'Dealers', 'डीलर्स'],
    ['/retailers', 'Retailers', 'किरकोळ विक्रेते'],
    ['/reports', 'Reports', 'अहवाल'],
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
  READONLY: 'फक्त पहा',
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

  // Sidebar is a permanent 256px column on desktop, but on a phone-width
  // screen that leaves almost no room for actual content — so below the
  // md breakpoint it becomes an off-canvas drawer instead, toggled by the
  // hamburger button in the top bar and closed by tapping the backdrop or
  // any nav link.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Backdrop — only rendered (and only clickable) while the drawer is
          open on mobile; md:hidden keeps it from ever appearing on desktop
          where the sidebar isn't an overlay. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`w-64 bg-orange-900 text-white flex flex-col fixed inset-y-0 left-0 z-30 transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:static md:z-auto`}
      >
        <div className="p-4 border-b border-orange-700 flex items-center gap-3">
          <img src={logo} alt="Amrut Peth logo" className="h-14 w-14 object-contain bg-white rounded-full p-1 shrink-0" />
          <div>
            <div className="text-2xl font-bold italic leading-tight">Amrut Peth</div>
            <div className="text-2xl font-bold italic text-orange-200 leading-tight">अमृत पेठ</div>
          </div>
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
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm leading-tight ${isActive ? 'bg-orange-700' : 'hover:bg-orange-800'}`}>
              <span className="block">{label}</span>
              <span className="block text-xs text-orange-200">{labelMr}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 flex flex-col overflow-y-auto md:ml-0">
        <div className="flex justify-between md:justify-end items-center gap-2 px-4 md:px-6 py-3 bg-white border-b">
          {/* Hamburger — hidden at md and up, where the sidebar is always
              visible and there's nothing to toggle. */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 rounded border border-gray-300 text-gray-700 hover:bg-gray-100"
            aria-label="Open menu">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
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
            <span className="hidden sm:inline">User Manual <span className="text-gray-400">· वापरकर्ता पुस्तिका</span></span>
            <span className="sm:hidden">Manual</span>
          </a>
          <button
            onClick={() => setShowChangePassword(true)}
            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-sm hover:bg-gray-100">
            <span className="hidden sm:inline">Change Password <span className="text-gray-400">· पासवर्ड बदला</span></span>
            <span className="sm:hidden">Password</span>
          </button>
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="px-3 py-1.5 bg-orange-800 text-white rounded hover:bg-orange-700 text-sm">
            <span className="hidden sm:inline">Log out <span className="text-orange-200">· बाहेर पडा</span></span>
            <span className="sm:hidden">Out</span>
          </button>
          </div>
        </div>
        <div className="flex-1 p-4 md:p-6">{children}</div>
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