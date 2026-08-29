import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

function SummaryCards({ totals }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
      <div className="bg-white p-5 rounded shadow">
        <div className="text-gray-500 text-sm">Dealers <span className="text-gray-400">/ डीलर्स</span></div>
        <div className="text-3xl font-bold">{totals?.dealerCount ?? '-'}</div>
      </div>
      <div className="bg-white p-5 rounded shadow">
        <div className="text-gray-500 text-sm">Retailers <span className="text-gray-400">/ किरकोळ विक्रेते</span></div>
        <div className="text-3xl font-bold">{totals?.retailerCount ?? '-'}</div>
      </div>
      <div className="bg-white p-5 rounded shadow">
        <div className="text-gray-500 text-sm">Inventory items <span className="text-gray-400">/ साठा वस्तू</span></div>
        <div className="text-3xl font-bold">{totals?.inventoryCount ?? '-'}</div>
      </div>
      <div className="bg-white p-5 rounded shadow">
        <div className="text-gray-500 text-sm">Total cost value <span className="text-gray-400">/ एकूण खरेदी मूल्य</span></div>
        <div className="text-2xl font-bold">₹{totals?.costValue?.toFixed?.(2) ?? '0.00'}</div>
      </div>
      <div className="bg-white p-5 rounded shadow">
        <div className="text-gray-500 text-sm">Total retailer selling value <span className="text-gray-400">/ एकूण किरकोळ विक्री मूल्य</span></div>
        <div className="text-2xl font-bold">₹{totals?.retailerSellingValue?.toFixed?.(2) ?? '0.00'}</div>
      </div>
    </div>
  );
}

function DealerTable({ dealers }) {
  return (
    <div className="bg-white rounded shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left p-2">Dealer <span className="text-gray-400 font-normal">/ डीलर</span></th>
            <th className="text-right p-2">Retailers <span className="text-gray-400 font-normal">/ किरकोळ विक्रेते</span></th>
            <th className="text-right p-2">Inventory items <span className="text-gray-400 font-normal">/ साठा वस्तू</span></th>
            {/* Own (rate-priced) stock plus every retailer under this
                dealer's own (sellingPrice-priced) stock — see
                reports.js GET /org-summary for the exact split. */}
            <th className="text-right p-2">Cost value <span className="text-gray-400 font-normal">/ खरेदी मूल्य</span></th>
            <th className="text-right p-2">Retailer selling value <span className="text-gray-400 font-normal">/ किरकोळ विक्री मूल्य</span></th>
          </tr>
        </thead>
        <tbody>
          {dealers.map((d) => (
            <tr key={d.dealerId} className="border-t">
              <td className="p-2">{d.dealerName}</td>
              <td className="p-2 text-right">{d.retailerCount}</td>
              <td className="p-2 text-right">{d.inventoryCount}</td>
              <td className="p-2 text-right">₹{Number(d.costValue).toFixed(2)}</td>
              <td className="p-2 text-right">₹{Number(d.retailerSellingValue).toFixed(2)}</td>
            </tr>
          ))}
          {dealers.length === 0 && (
            <tr><td colSpan={5} className="p-4 text-center text-gray-400 italic">No dealers yet / अजून कोणतेही डीलर नाहीत</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatMoney(n) {
  return `₹${Number(n ?? 0).toFixed(2)}`;
}

// Each dealer's retailer inventory rows, flattened with the dealer name
// attached — "each retailer separately" from reports.js GET /org-summary's
// dealers[].retailers (cost priced at sellingPrice, i.e. what the retailer
// actually paid their dealer, same convention DealerTable's cost column
// uses for retailer-owned stock).
function RetailerInventoryTable({ dealers }) {
  const rows = dealers.flatMap((d) => d.retailers.map((r) => ({ ...r, dealerName: d.dealerName })));
  return (
    <div className="bg-white rounded shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left p-2">Dealer <span className="text-gray-400 font-normal">/ डीलर</span></th>
            <th className="text-left p-2">Retailer <span className="text-gray-400 font-normal">/ किरकोळ विक्रेता</span></th>
            <th className="text-right p-2">Inventory items <span className="text-gray-400 font-normal">/ साठा वस्तू</span></th>
            <th className="text-right p-2">Cost value <span className="text-gray-400 font-normal">/ खरेदी मूल्य</span></th>
            <th className="text-right p-2">Retailer selling value <span className="text-gray-400 font-normal">/ किरकोळ विक्री मूल्य</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.retailerId} className="border-t">
              <td className="p-2">{r.dealerName}</td>
              <td className="p-2">{r.retailerName}</td>
              <td className="p-2 text-right">{r.inventoryCount}</td>
              <td className="p-2 text-right">{formatMoney(r.costValue)}</td>
              <td className="p-2 text-right">{formatMoney(r.retailerSellingValue)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="p-4 text-center text-gray-400 italic">No retailers yet / अजून कोणतेही किरकोळ विक्रेते नाहीत</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// One amount+count pair from reports.js GET /reports/activity-summary,
// e.g. { count, amount } or the richer { count, amount, openAmount } /
// { count, amount, paidAmount, pendingAmount } shapes for vouchers/
// receipts/soldProducts. `sub` picks which secondary field (if any) to
// show under the amount, so each table can surface what actually matters
// for that column (outstanding for vouchers, pending for receipts/sold
// products) without every column needing the same shape.
function ActivityCell({ activity, sub }) {
  if (!activity) return <td className="p-2 text-right text-gray-300">-</td>;
  const subValue = sub ? activity[sub.key] : null;
  return (
    <td className="p-2 text-right">
      <div>{formatMoney(activity.amount)}</div>
      <div className="text-xs text-gray-400">
        {activity.count} {activity.count === 1 ? 'txn' : 'txns'}
        {sub && subValue > 0 && <> · {sub.label} {formatMoney(subValue)}</>}
      </div>
    </td>
  );
}

const OPEN_SUB = { key: 'openAmount', label: 'open' };
const PENDING_SUB = { key: 'pendingAmount', label: 'pending' };

// A dealer's Sales cell — cash and retailer sales shown separately in the
// same cell (Sale.customerType split from reports.js GET
// /reports/activity-summary). Retailer's own sales don't need this split,
// since a retailer only ever sells to a cash end customer — that column
// keeps using the plain ActivityCell below.
function SalesCell({ sales }) {
  if (!sales) return <td className="p-2 text-right text-gray-300">-</td>;
  return (
    <td className="p-2 text-right">
      <div>{formatMoney(sales.amount)}</div>
      <div className="text-xs text-gray-400">
        Cash / रोख {formatMoney(sales.cash.amount)} ({sales.cash.count}) · Retailer / किरकोळ {formatMoney(sales.retailer.amount)} ({sales.retailer.count})
      </div>
    </td>
  );
}

// Purchase/sale/soldProducts/goodsReturn/payment/receipt/voucher summary,
// one row per dealer — from reports.js GET /reports/activity-summary.
function DealerActivityTable({ rows }) {
  return (
    <div className="bg-white rounded shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left p-2">Dealer <span className="text-gray-400 font-normal">/ डीलर</span></th>
            <th className="text-right p-2">Purchases <span className="text-gray-400 font-normal">/ खरेदी</span></th>
            <th className="text-right p-2">Sales <span className="text-gray-400 font-normal">/ विक्री</span></th>
            <th className="text-right p-2">Sold products <span className="text-gray-400 font-normal">/ विकलेली उत्पादने</span></th>
            <th className="text-right p-2">Goods returns <span className="text-gray-400 font-normal">/ माल परत</span></th>
            <th className="text-right p-2">Payments (to supplier) <span className="text-gray-400 font-normal">/ देयके</span></th>
            <th className="text-right p-2">Receipts (from retailers) <span className="text-gray-400 font-normal">/ पावत्या</span></th>
            <th className="text-right p-2">Payable vouchers <span className="text-gray-400 font-normal">/ देय व्हाउचर</span></th>
            <th className="text-right p-2">Receivable vouchers <span className="text-gray-400 font-normal">/ प्राप्य व्हाउचर</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.dealerId} className="border-t">
              <td className="p-2">{d.dealerName}</td>
              <ActivityCell activity={d.purchases} />
              <SalesCell sales={d.sales} />
              <ActivityCell activity={d.soldProducts} sub={PENDING_SUB} />
              <ActivityCell activity={d.goodsReturns} />
              <ActivityCell activity={d.payments} />
              <ActivityCell activity={d.receipts} sub={PENDING_SUB} />
              <ActivityCell activity={d.payableVouchers} sub={OPEN_SUB} />
              <ActivityCell activity={d.receivableVouchers} sub={OPEN_SUB} />
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={9} className="p-4 text-center text-gray-400 italic">No dealers yet / अजून कोणतेही डीलर नाहीत</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Same summary, one row per retailer — from reports.js GET
// /reports/activity-summary. No Receipts column here: raising/confirming a
// Receipt is the dealer's action against a retailer's payment, so it's
// shown on the dealer table (rolled up across their retailers) rather than
// duplicated per-retailer here.
function RetailerActivityTable({ rows }) {
  return (
    <div className="bg-white rounded shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="text-left p-2">Dealer <span className="text-gray-400 font-normal">/ डीलर</span></th>
            <th className="text-left p-2">Retailer <span className="text-gray-400 font-normal">/ किरकोळ विक्रेता</span></th>
            <th className="text-right p-2">Purchases <span className="text-gray-400 font-normal">/ खरेदी</span></th>
            <th className="text-right p-2">Sales <span className="text-gray-400 font-normal">/ विक्री</span></th>
            <th className="text-right p-2">Sold products <span className="text-gray-400 font-normal">/ विकलेली उत्पादने</span></th>
            <th className="text-right p-2">Goods returns <span className="text-gray-400 font-normal">/ माल परत</span></th>
            <th className="text-right p-2">Payments <span className="text-gray-400 font-normal">/ देयके</span></th>
            <th className="text-right p-2">Vouchers <span className="text-gray-400 font-normal">/ व्हाउचर</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.retailerId} className="border-t">
              <td className="p-2">{r.dealerName}</td>
              <td className="p-2">{r.retailerName}</td>
              <ActivityCell activity={r.purchases} />
              <ActivityCell activity={r.sales} />
              <ActivityCell activity={r.soldProducts} sub={PENDING_SUB} />
              <ActivityCell activity={r.goodsReturns} />
              <ActivityCell activity={r.payments} />
              <ActivityCell activity={r.vouchers} sub={OPEN_SUB} />
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={8} className="p-4 text-center text-gray-400 italic">No retailers yet / अजून कोणतेही किरकोळ विक्रेते नाहीत</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ADMIN sees every organisation, each broken down by dealer; ORGANISATION
// sees only their own single organisation (see reports.js GET
// /org-summary) — same organisation scoping Layout.jsx's ORGANISATION nav
// comment describes for dealers.js elsewhere in the app.
function OrgDashboard() {
  const [data, setData] = useState(null);
  const [activity, setActivity] = useState(null);

  useEffect(() => {
    api.get('/reports/org-summary').then((r) => setData(r.data));
    api.get('/reports/activity-summary').then((r) => setActivity(r.data));
  }, []);

  const organisations = data?.organisations || [];
  const activityDealers = activity?.dealers || [];
  const activityRetailers = activity?.retailers || [];
  // Grand total across every organisation only makes sense — and only
  // shows up — once there's more than one to sum across (ADMIN). An
  // ORGANISATION login always gets exactly one, where it'd just repeat that
  // org's own totals below.
  const showGrandTotal = organisations.length > 1;

  return (
    <div>
      {showGrandTotal && (
        <div className="mb-6">
          <h2 className="font-semibold text-gray-700 mb-2">
            All organisations ({data.totals.organisationCount}) <span className="text-gray-400 font-normal">/ सर्व संस्था</span>
          </h2>
          <SummaryCards totals={data.totals} />
        </div>
      )}

      {organisations.map((org) => {
        const orgActivityDealers = activityDealers.filter((d) => d.organisationId === org.organisationId);
        const orgActivityRetailers = activityRetailers.filter((r) => r.organisationId === org.organisationId);

        return (
          <div key={org.organisationId} className="mb-10">
            <h2 className="font-semibold text-gray-700 mb-2">
              {org.organisationName} <span className="text-gray-400 font-normal">/ संस्था</span>
            </h2>
            <SummaryCards totals={org.totals} />

            <h3 className="text-sm font-semibold text-gray-600 mb-2">Inventory by dealer <span className="text-gray-400 font-normal">/ डीलरनुसार साठा</span></h3>
            <DealerTable dealers={org.dealers} />

            <h3 className="text-sm font-semibold text-gray-600 mb-2 mt-4">Inventory by retailer <span className="text-gray-400 font-normal">/ किरकोळ विक्रेत्यानुसार साठा</span></h3>
            <RetailerInventoryTable dealers={org.dealers} />

            <h3 className="text-sm font-semibold text-gray-600 mb-2 mt-4">Activity summary by dealer <span className="text-gray-400 font-normal">/ डीलरनुसार व्यवहार सारांश</span></h3>
            <DealerActivityTable rows={orgActivityDealers} />

            <h3 className="text-sm font-semibold text-gray-600 mb-2 mt-4">Activity summary by retailer <span className="text-gray-400 font-normal">/ किरकोळ विक्रेत्यानुसार व्यवहार सारांश</span></h3>
            <RetailerActivityTable rows={orgActivityRetailers} />
          </div>
        );
      })}

      {organisations.length === 0 && (
        <div className="bg-white rounded shadow p-4 text-sm text-gray-400 italic">No organisations yet / अजून कोणतीही संस्था नाही</div>
      )}
    </div>
  );
}

// Unchanged DEALER/RETAILER dashboard — own sales summary + own low-stock
// alerts, exactly as before.
function OperationalDashboard() {
  const [summary, setSummary] = useState(null);
  const [inventory, setInventory] = useState([]);

  useEffect(() => {
    api.get('/reports/sales-summary').then((r) => setSummary(r.data));
    api.get('/reports/inventory').then((r) => setInventory(r.data));
  }, []);

  const lowStock = inventory.filter((i) => i.lowStock);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Total sales / एकूण विक्री</div>
          <div className="text-3xl font-bold">{summary?.count ?? '-'}</div>
        </div>
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Revenue / महसूल</div>
          <div className="text-3xl font-bold">₹{summary?.totalRevenue?.toFixed?.(2) ?? '0.00'}</div>
        </div>
        <div className="bg-white p-5 rounded shadow">
          <div className="text-gray-500 text-sm">Low stock items / कमी साठा असलेल्या वस्तू</div>
          <div className="text-3xl font-bold text-red-600">{lowStock.length}</div>
        </div>
      </div>

      {lowStock.length > 0 && (
        <div>
          <h2 className="font-semibold text-red-700 mb-2">⚠ Reorder needed / पुनर्क्रम आवश्यक</h2>
          <div className="bg-white rounded shadow overflow-x-auto overflow-y-auto max-h-[75vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th className="text-left p-2">Product <span className="text-gray-400 font-normal">/ उत्पादन</span></th>
                  <th className="text-left p-2">Barcode <span className="text-gray-400 font-normal">/ बारकोड</span></th>
                  <th className="text-left p-2">Batch <span className="text-gray-400 font-normal">/ बॅच</span></th>
                  <th className="text-left p-2">Expiry <span className="text-gray-400 font-normal">/ एक्सपायरी</span></th>
                  <th className="text-left p-2">MRP <span className="text-gray-400 font-normal">/ एमआरपी</span></th>
                  <th className="text-left p-2">Quantity <span className="text-gray-400 font-normal">/ प्रमाण</span></th>
                  <th className="text-left p-2">Reorder Level <span className="text-gray-400 font-normal">/ पुनर्क्रम पातळी</span></th>
                  <th className="text-left p-2">Status <span className="text-gray-400 font-normal">/ स्थिती</span></th>
                </tr>
              </thead>
              <tbody>
                {lowStock.map((r) => (
                  <tr key={r.id} className="border-t bg-red-50">
                    <td className="p-2">{r.product?.name} ({r.product?.sizeWeight})</td>
                    <td className="p-2">{r.product?.barcode}</td>
                    <td className="p-2">{r.batchName || '-'}</td>
                    <td className="p-2">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : '-'}</td>
                    <td className="p-2">{r.mrp != null ? `₹${Number(r.mrp).toFixed(2)}` : '-'}</td>
                    <td className="p-2">{r.quantity}</td>
                    <td className="p-2">{r.reorderLevel}</td>
                    <td className="p-2"><span className="text-red-600 font-semibold">⚠ Reorder now / आता पुन्हा मागवा</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// showWelcome is false when this is embedded as a tab inside Reports.jsx,
// which already has its own page heading - the "Welcome, {username}" header
// only makes sense on Dashboard's own standalone page.
export default function Dashboard({ showWelcome = true }) {
  const { user } = useAuth();
  const isOrgLevel = user.role === 'ADMIN' || user.role === 'ORGANISATION';

  return (
    <div>
      {showWelcome && (
        <>
          <h1 className="text-2xl font-semibold mb-1">
            Welcome / स्वागत आहे, {user.username}
          </h1>
          <p className="text-gray-500 mb-6">Role / भूमिका: {user.role}</p>
        </>
      )}

      {isOrgLevel ? <OrgDashboard /> : <OperationalDashboard />}
    </div>
  );
}
