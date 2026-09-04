import { Fragment, useEffect, useState } from 'react';
import api from '../api.js';
import Dashboard from './Dashboard.jsx';

const STATUS_LABELS = {
  PENDING: 'Pending / प्रलंबित',
  IN_REVIEW: 'In Review / पुनरावलोकनात',
  CONFIRMED: 'Confirmed / पुष्टी झाली',
  // MODIFIED is never its own group below (see groupPurchasesByStatus) —
  // this entry only exists as a fallback in case a MODIFIED purchase ever
  // renders somewhere that shows p.status directly rather than a group
  // label.
  MODIFIED: 'Confirmed / पुष्टी झाली',
  ORDERED: 'Ordered / ऑर्डर केले',
  IN_TRANSIT: 'In Transit / वाहतुकीत',
  RECEIVED: 'Received / प्राप्त झाले',
  CANCELLED: 'Cancelled / रद्द केले',
  TO_BE_CONFIRMED: 'To Be Confirmed / पुष्टीकरण प्रलंबित',
  PARTIALLY_PAID: 'Partially Paid / अंशतः दिले',
  PAID: 'Paid / दिले',
  OPEN: 'Open / खुले',
};

const PURCHASES_TEXT = {
  RETAILER: { title: 'Products Received from Dealer', titleMr: 'डीलरकडून मिळालेली उत्पादने', counterparty: 'Dealer / डीलर' },
  DEALER: { title: 'Products Received from Supplier', titleMr: 'पुरवठादाराकडून मिळालेली उत्पादने', counterparty: 'Supplier / पुरवठादार' },
  ALL: { title: 'Products Purchased', titleMr: 'खरेदी केलेली उत्पादने', counterparty: 'From / कडून' },
};

// Voucher/payment status is the single VoucherStatus enum
// (OPEN/PARTIALLY_PAID/PAID) on both the supplier and retailer side, so
// unlike purchases there's one fixed order for every context.
const VOUCHER_STATUS_ORDER = ['OPEN', 'PARTIALLY_PAID', 'PAID'];

function groupByVoucherStatus(rows, statusOf) {
  const groups = Object.fromEntries(VOUCHER_STATUS_ORDER.map((s) => [s, []]));
  for (const row of rows) {
    const status = statusOf(row);
    if (!groups[status]) groups[status] = [];
    groups[status].push(row);
  }
  return VOUCHER_STATUS_ORDER.map((status) => ({ status, items: groups[status] }));
}

// CANCELLED sits at the end of both — it's a terminal state reachable only
// from PENDING/IN_REVIEW (see purchases.js PATCH /:id/status), so without
// its own bucket here a cancelled purchase would silently disappear from
// this report instead of showing up in a group of its own.
const RETAILER_PURCHASE_STATUS_ORDER = ['PENDING', 'IN_REVIEW', 'ORDERED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'];
const DEALER_PURCHASE_STATUS_ORDER = ['PENDING', 'IN_REVIEW', 'CONFIRMED', 'CANCELLED'];

function purchaseStatusOrder(context) {
  if (context === 'DEALER') return DEALER_PURCHASE_STATUS_ORDER;
  if (context === 'RETAILER') return RETAILER_PURCHASE_STATUS_ORDER;
  return [...new Set([...RETAILER_PURCHASE_STATUS_ORDER, ...DEALER_PURCHASE_STATUS_ORDER])];
}

function groupPurchasesByStatus(purchases, context) {
  const order = purchaseStatusOrder(context);
  const groups = Object.fromEntries(order.map((s) => [s, []]));
  for (const p of purchases) {
    // MODIFIED only ever happens to an already-CONFIRMED dealer purchase
    // that's had its pricing corrected (see purchases.js PATCH
    // /:id/prices) — it's the same purchase in the same terminal state,
    // just flagged. DEALER_PURCHASE_STATUS_ORDER above has no MODIFIED
    // entry of its own, so without this it would silently vanish from
    // this report instead of counting as CONFIRMED.
    const bucketStatus = p.status === 'MODIFIED' ? 'CONFIRMED' : p.status;
    if (!groups[bucketStatus]) groups[bucketStatus] = [];
    groups[bucketStatus].push(p);
  }
  return order.map((status) => ({ status, items: groups[status] }));
}

function StatusGroup({ label, count, children }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-xs text-gray-500">({count})</span>
      </div>
      {count === 0 ? (
        <div className="bg-white rounded shadow p-3 text-gray-400 text-sm">
          None yet. / अद्याप काहीही नाही.
        </div>
      ) : (
        <div className="bg-white rounded shadow overflow-x-auto">{children}</div>
      )}
    </div>
  );
}

// Same sizeWeight/flavour/brand join and product cell used in
// Purchases.jsx, so a product looks identical wherever it's shown.
function productDetails(product) {
  return [product?.sizeWeight, product?.flavour, product?.brand].filter(Boolean).join(' · ');
}

function ProductCell({ product }) {
  if (!product) return '—';
  const details = productDetails(product);
  return (
    <>
      <div>{product.name}</div>
      {details && <div className="text-xs text-gray-400">{details}</div>}
    </>
  );
}

// Extra price columns for the admin/organisation Dealer Inventory tab -
// dealer's cost price (rate), the dealer -> retailer selling price
// (labelled "retailer cost price" since that's what it becomes on the
// retailer's side), and the end-customer retailer selling price.
const DEALER_INVENTORY_PRICE_COLUMNS = [
  { key: 'costPrice', label: 'Cost Price', labelMr: 'खरेदी किंमत', render: (r) => formatMoney(r.rate) },
  { key: 'sellingPrice', label: 'Selling Price (Retailer Cost Price)', labelMr: 'विक्री किंमत (किरकोळ विक्रेता खरेदी किंमत)', render: (r) => formatMoney(r.sellingPrice) },
  { key: 'retailerSellingPrice', label: 'Retailer Selling Price', labelMr: 'किरकोळ विक्रेता विक्री किंमत', render: (r) => formatMoney(r.retailerSellingPrice) },
];

// Extra price columns for the admin/organisation Retailer Inventory tab -
// the retailer's own cost price (Inventory.sellingPrice, i.e. what they
// paid their dealer) and their end-customer selling price.
const RETAILER_INVENTORY_PRICE_COLUMNS = [
  { key: 'retailerCostPrice', label: 'Retailer Cost Price', labelMr: 'किरकोळ विक्रेता खरेदी किंमत', render: (r) => formatMoney(r.sellingPrice) },
  { key: 'retailerSellingPrice', label: 'Retailer Selling Price', labelMr: 'किरकोळ विक्रेता विक्री किंमत', render: (r) => formatMoney(r.retailerSellingPrice) },
];

function InventoryTable({ rows, extraColumns = [] }) {
  return (
    <div className="bg-white rounded shadow overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 sticky top-0 z-10">
          <tr>
            <th className="text-left p-2">Product <span className="text-gray-400 font-normal">/ उत्पादन</span></th>
            {extraColumns.map((c) => (
              <th key={c.key} className="text-left p-2">{c.label} <span className="text-gray-400 font-normal">/ {c.labelMr}</span></th>
            ))}
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
          {rows.map((r) => (
            <tr key={r.id} className={`border-t ${r.lowStock ? 'bg-red-50' : ''}`}>
              <td className="p-2"><ProductCell product={r.product} /></td>
              {extraColumns.map((c) => (
                <td key={c.key} className="p-2">{c.render(r)}</td>
              ))}
              <td className="p-2">{r.product?.barcode}</td>
              <td className="p-2">{r.batchName || '-'}</td>
              <td className="p-2">{r.expiryDate ? new Date(r.expiryDate).toLocaleDateString() : '-'}</td>
              <td className="p-2">{r.mrp != null ? `₹${Number(r.mrp).toFixed(2)}` : '-'}</td>
              <td className="p-2">{r.quantity}</td>
              <td className="p-2">{r.reorderLevel}</td>
              <td className="p-2">
                {r.lowStock
                  ? <span className="text-red-600 font-semibold">⚠ Reorder now / आता पुन्हा मागवा</span>
                  : <span className="text-green-600">OK / ठीक आहे</span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td className="p-3 text-gray-400" colSpan={8 + extraColumns.length}>No inventory yet. / अद्याप साठा नाही.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Distinct {id, name} pairs for a dealer dropdown, derived straight from
// inventory rows rather than a separate fetch.
function uniqueDealers(rows) {
  const map = new Map();
  for (const r of rows) {
    if (r.dealerId != null) map.set(r.dealerId, r.dealerName || '-');
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// Splits rows into groups by an id field, sorted by name, keeping the raw
// rows per group so the detail table underneath each summary header has
// something to show.
function groupRows(rows, { idKey, nameKey }) {
  const groups = new Map();
  for (const r of rows) {
    const id = r[idKey];
    if (id == null) continue;
    if (!groups.has(id)) groups.set(id, { id, name: r[nameKey] || '-', rows: [] });
    groups.get(id).rows.push(r);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Summary numbers (distinct product count, total quantity, total value) for
// a set of rows that already belong to one group.
function summarizeRows(rows, priceKey) {
  const productIds = new Set();
  let quantity = 0;
  let value = 0;
  for (const r of rows) {
    if (r.product?.id != null) productIds.add(r.product.id);
    quantity += Number(r.quantity || 0);
    value += Number(r.quantity || 0) * Number(r[priceKey] || 0);
  }
  return { productCount: productIds.size, quantity, value };
}

// One group's summary strip (product count / total quantity / total value)
// followed by its full item-level inventory table.
function GroupedInventorySection({ name, rows, priceKey, priceLabel, priceLabelMr, extraColumns = [] }) {
  const summary = summarizeRows(rows, priceKey);
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-orange-50 border border-orange-100 rounded px-3 py-2 mb-2">
        <div className="font-semibold text-sm text-orange-900">{name}</div>
        <div className="text-xs text-gray-600 flex gap-4">
          <span>Products / उत्पादने: <b>{summary.productCount}</b></span>
          <span>Total Quantity / एकूण प्रमाण: <b>{summary.quantity}</b></span>
          <span>{priceLabel} / {priceLabelMr}: <b>{formatMoney(summary.value)}</b></span>
        </div>
      </div>
      <InventoryTable rows={rows} extraColumns={extraColumns} />
    </div>
  );
}

// Admin/Organisation-only: dealer inventory grouped by dealer - each
// dealer's aggregate (product count, total quantity, total cost value)
// with that dealer's full item-level inventory underneath it. Dealer
// filter above defaults to All. Own local selection state so switching
// away from and back to this tab resets the filter to All.
function DealerInventoryPanel({ rows }) {
  const [selectedDealer, setSelectedDealer] = useState('ALL');
  const dealers = uniqueDealers(rows);
  const filtered = selectedDealer === 'ALL' ? rows : rows.filter((r) => String(r.dealerId) === String(selectedDealer));
  const groups = groupRows(filtered, { idKey: 'dealerId', nameKey: 'dealerName' });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <label className="text-sm font-medium">Dealer / डीलर:</label>
        <select
          className="border rounded px-2 py-1 text-sm bg-white"
          value={selectedDealer}
          onChange={(e) => setSelectedDealer(e.target.value)}
        >
          <option value="ALL">All / सर्व</option>
          {dealers.map((d) => (
            <option key={d.id} value={String(d.id)}>{d.name}</option>
          ))}
        </select>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white rounded shadow p-3 text-gray-400 text-sm">
          No dealer inventory yet. / अद्याप डीलर साठा नाही.
        </div>
      ) : (
        groups.map((g) => (
          <GroupedInventorySection
            key={g.id}
            name={g.name}
            rows={g.rows}
            priceKey="rate"
            priceLabel="Total Cost Price"
            priceLabelMr="एकूण खरेदी किंमत"
            extraColumns={DEALER_INVENTORY_PRICE_COLUMNS}
          />
        ))
      )}
    </div>
  );
}

// Admin/Organisation-only: retailer inventory grouped by dealer, then by
// retailer within each dealer - the retailer is the aggregation sub-level
// (product count, total quantity, total selling-price value) with that
// retailer's full item-level inventory underneath it. Dealer filter above
// defaults to All. `dealers` comes from the backend (derived from retailer
// inventory rows), so it only lists dealers that actually have retailers
// carrying stock.
function RetailerInventoryPanel({ dealers, rows }) {
  const [selectedDealer, setSelectedDealer] = useState('ALL');
  const filtered = selectedDealer === 'ALL' ? rows : rows.filter((r) => String(r.dealerId) === String(selectedDealer));
  const dealerGroups = groupRows(filtered, { idKey: 'dealerId', nameKey: 'dealerName' });

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <label className="text-sm font-medium">Dealer / डीलर:</label>
        <select
          className="border rounded px-2 py-1 text-sm bg-white"
          value={selectedDealer}
          onChange={(e) => setSelectedDealer(e.target.value)}
        >
          <option value="ALL">All / सर्व</option>
          {dealers.map((d) => (
            <option key={d.id} value={String(d.id)}>{d.name}</option>
          ))}
        </select>
      </div>

      {dealerGroups.length === 0 ? (
        <div className="bg-white rounded shadow p-3 text-gray-400 text-sm">
          No retailer inventory yet. / अद्याप किरकोळ विक्रेता साठा नाही.
        </div>
      ) : (
        dealerGroups.map((dg) => (
          <div key={dg.id} className="mb-8">
            <h3 className="text-base font-semibold mb-3 text-orange-800">{dg.name}</h3>
            <div className="pl-2 border-l-2 border-orange-100">
              {groupRows(dg.rows, { idKey: 'retailerId', nameKey: 'retailerName' }).map((rg) => (
                <GroupedInventorySection
                  key={rg.id}
                  name={rg.name}
                  rows={rg.rows}
                  priceKey="sellingPrice"
                  priceLabel="Total Retailer Cost Price"
                  priceLabelMr="एकूण किरकोळ विक्रेता खरेदी किंमत"
                  extraColumns={RETAILER_INVENTORY_PRICE_COLUMNS}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatMoney(value) {
  return value != null ? `₹${Number(value).toFixed(2)}` : '-';
}

// Fixed left-to-right state order for the pivoted sold-products table below
// - every row shows all three, in this order, regardless of which ones
// actually occurred for that dealer/retailer.
const SOLD_PRODUCT_STATES = ['OPEN', 'TO_BE_CONFIRMED', 'PAID'];

// Looks up one state's entry within a byStatus array (see
// /reports/sold-products in reports.js), or null if that dealer/retailer
// had no sold products in that state at all.
function findStateEntry(byStatus, status) {
  return (byStatus || []).find((s) => s.status === status) || null;
}

// DEALER context only: under each state, the two settlement legs -
// what this dealer in turn owes THEIR OWN supplier for that stock ("Dealer",
// backed by paymentToSupplier) and what a retailer owes THIS dealer for it
// ("Retailer", backed by paymentToDealer, see reports.js GET /sold-products
// DEALER branch) - are rendered as real Qty/Cost/Selling column triplets
// (6 columns per state) rather than stacked lines in one cell, because the
// two legs can each sit in a different state for the same physical
// quantity. A dealer's own direct-sale row only ever has a "Dealer" leg
// (there's no retailer involved), so its "Retailer" columns show "--".
function DealerObligationCells({ dealerLeg, retailerLeg }) {
  const legCells = (entry) => (
    <>
      <td className="p-2 border-l font-normal">{entry ? entry.quantity : 0}</td>
      <td className="p-2 font-normal">{entry ? formatMoney(entry.costPrice) : '--'}</td>
      <td className="p-2 font-normal">{entry ? formatMoney(entry.sellingPrice) : '--'}</td>
    </>
  );
  return (
    <>
      {legCells(dealerLeg)}
      {legCells(retailerLeg)}
    </>
  );
}

// DEALER-context sold-products table: one row per dealer/retailer, one
// column GROUP per state, each group split into Dealer/Retailer legs and
// each leg split into Qty/Cost/Selling (6 columns per state) via
// DealerObligationCells above, instead of the plain Qty/Cost/Selling
// column triplet SoldProductsTable uses for RETAILER/ADMIN/ORGANISATION.
function DealerSoldProductsTable({ rows }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-100 sticky top-0 z-10">
        <tr>
          <th rowSpan={3} className="text-left p-2 align-bottom">Dealer / Retailer <span className="text-gray-400 font-normal">/ डीलर / किरकोळ विक्रेता</span></th>
          {SOLD_PRODUCT_STATES.map((s) => (
            <th key={s} colSpan={6} className="text-center p-2 border-l">{STATUS_LABELS[s] || s}</th>
          ))}
        </tr>
        <tr>
          {SOLD_PRODUCT_STATES.map((s) => (
            <Fragment key={s}>
              <th colSpan={3} className="text-center p-2 border-l text-xs font-normal text-gray-500">Dealer <span className="text-gray-400">/ डीलर</span></th>
              <th colSpan={3} className="text-center p-2 border-l text-xs font-normal text-gray-500">Retailer <span className="text-gray-400">/ किरकोळ विक्रेता</span></th>
            </Fragment>
          ))}
        </tr>
        <tr>
          {SOLD_PRODUCT_STATES.map((s) => (
            <Fragment key={s}>
              <th className="text-left p-2 border-l text-xs font-normal text-gray-500">Qty <span className="text-gray-400">/ प्रमाण</span></th>
              <th className="text-left p-2 text-xs font-normal text-gray-500">Cost <span className="text-gray-400">/ खरेदी</span></th>
              <th className="text-left p-2 text-xs font-normal text-gray-500">Selling <span className="text-gray-400">/ विक्री</span></th>
              <th className="text-left p-2 border-l text-xs font-normal text-gray-500">Qty <span className="text-gray-400">/ प्रमाण</span></th>
              <th className="text-left p-2 text-xs font-normal text-gray-500">Cost <span className="text-gray-400">/ खरेदी</span></th>
              <th className="text-left p-2 text-xs font-normal text-gray-500">Selling <span className="text-gray-400">/ विक्री</span></th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={`border-t ${row.indent ? '' : 'bg-orange-50/40 font-semibold'}`}>
            <td className={`p-2 align-top ${row.indent ? 'pl-6 font-normal text-gray-700' : ''}`}>{row.name}</td>
            {SOLD_PRODUCT_STATES.map((s) => (
              <DealerObligationCells
                key={s}
                dealerLeg={findStateEntry(row.paymentToSupplier, s)}
                retailerLeg={findStateEntry(row.paymentToDealer, s)}
              />
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td className="p-3 text-gray-400" colSpan={1 + SOLD_PRODUCT_STATES.length * 6}>
              No sold products yet. / अद्याप विकलेली उत्पादने नाहीत.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// One dealer's or retailer's sold-products summary, one row, with every
// state (Open/To Be Confirmed/Paid) shown side by side as its own group of
// Sold Quantity / Cost Price / Selling Price columns - rather than one row
// per state. A state with no sold products at all for this dealer/retailer
// shows 0 for quantity and "--" for the two price columns instead of being
// left out, so every row lines up under the same fixed set of columns.
function SoldProductsTable({ rows }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-100 sticky top-0 z-10">
        <tr>
          <th rowSpan={2} className="text-left p-2 align-bottom">Dealer / Retailer <span className="text-gray-400 font-normal">/ डीलर / किरकोळ विक्रेता</span></th>
          {SOLD_PRODUCT_STATES.map((s) => (
            <th key={s} colSpan={3} className="text-center p-2 border-l">{STATUS_LABELS[s] || s}</th>
          ))}
        </tr>
        <tr>
          {SOLD_PRODUCT_STATES.map((s) => (
            <Fragment key={s}>
              <th className="text-left p-2 border-l text-xs font-normal text-gray-500">Qty <span className="text-gray-400">/ प्रमाण</span></th>
              <th className="text-left p-2 text-xs font-normal text-gray-500">Cost <span className="text-gray-400">/ खरेदी</span></th>
              <th className="text-left p-2 text-xs font-normal text-gray-500">Selling <span className="text-gray-400">/ विक्री</span></th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className={`border-t ${row.indent ? '' : 'bg-orange-50/40 font-semibold'}`}>
            <td className={`p-2 ${row.indent ? 'pl-6 font-normal text-gray-700' : ''}`}>{row.name}</td>
            {SOLD_PRODUCT_STATES.map((s) => {
              const entry = findStateEntry(row.byStatus, s);
              return (
                <Fragment key={s}>
                  <td className="p-2 border-l font-normal">{entry ? entry.quantity : 0}</td>
                  <td className="p-2 font-normal">{entry ? formatMoney(entry.costPrice) : '--'}</td>
                  <td className="p-2 font-normal">{entry ? formatMoney(entry.sellingPrice) : '--'}</td>
                </Fragment>
              );
            })}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td className="p-3 text-gray-400" colSpan={1 + SOLD_PRODUCT_STATES.length * 3}>
              No sold products yet. / अद्याप विकलेली उत्पादने नाहीत.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// Sold Products tab: grouped by origin SUPPLIER first - each supplier's
// own summary row followed immediately by a "Sold By" breakdown of which
// dealer and/or retailer actually made those sales (a DEALER's own direct
// cash sales, and/or each of their retailers' own cash sales; at the
// ADMIN/ORGANISATION level, potentially several different dealers and
// their retailers at once). Nesting the "Sold By" breakdown directly under
// its own supplier's summary row (rather than pulling it out into one
// combined section) is what makes it useful for reconciliation: summing a
// supplier's own "Sold By" rows for any given state should reproduce that
// supplier's own byStatus total shown just above it - a quick visual check
// that the two add up. A RETAILER login only ever has one seller -
// themselves - so their "Sold By" row would just repeat the supplier row
// above it; it's left out for them (see showSellers below). Supplier
// filter defaults to All, same pattern as the inventory panels (own local
// state so leaving and returning to the tab resets it).
function buildSoldPivotHtml(rows, firstColumnLabel) {
  if (rows.length === 0) return '<p class="muted">None yet.</p>';
  const stateHeaderCells = SOLD_PRODUCT_STATES.map((s) => `<th colspan="3">${escapeHtml(STATUS_LABELS[s] || s)}</th>`).join('');
  const subHeaderCells = SOLD_PRODUCT_STATES.map(() => '<th>Qty</th><th>Cost</th><th>Selling</th>').join('');
  const bodyRows = rows.map((row) => {
    const cells = SOLD_PRODUCT_STATES.map((s) => {
      const entry = findStateEntry(row.byStatus, s);
      return `<td>${entry ? entry.quantity : 0}</td><td>${escapeHtml(entry ? formatMoney(entry.costPrice) : '--')}</td><td>${escapeHtml(entry ? formatMoney(entry.sellingPrice) : '--')}</td>`;
    }).join('');
    return `<tr><td class="${row.indent ? 'indent' : 'bold'}">${escapeHtml(row.name)}</td>${cells}</tr>`;
  }).join('');
  return `<table>
    <thead>
      <tr><th rowspan="2">${escapeHtml(firstColumnLabel)}</th>${stateHeaderCells}</tr>
      <tr>${subHeaderCells}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

// One supplier "block" for print: its own summary row (as a one-row pivot
// table) immediately followed by its own "Sold By" breakdown - same
// nesting as the on-screen SupplierSection below. `sellers` is already
// pre-labeled (see sellerLabel below) by the time it reaches here.
function buildSupplierBlockHtml({ name, byStatus, sellers }) {
  const sellerRows = (sellers || []).map((s) => ({ id: 'x', name: s.name, byStatus: s.byStatus, indent: false }));
  return `
    <div style="margin-bottom:16px;">
      <h3 style="font-size:13px;margin:10px 0 4px;">${escapeHtml(name)}</h3>
      ${buildSoldPivotHtml([{ id: 'x', name, byStatus, indent: false }], 'Total')}
      ${sellerRows.length > 0 ? `
      <div style="margin-left:16px;">
        <div style="font-size:11px;color:#666;margin:2px 0;">Sold By</div>
        ${buildSoldPivotHtml(sellerRows, 'Sold By')}
      </div>` : ''}
    </div>
  `;
}

// DEALER-context variant of buildSoldPivotHtml: each state column group
// mirrors the on-screen DealerSoldProductsTable's 3-row header - state,
// then Dealer/Retailer leg, then Qty/Cost/Selling under each leg - since
// the two settlements can sit in different states for the same quantity
// (see reports.js GET /sold-products DEALER branch).
function buildDealerSoldPivotHtml(rows, firstColumnLabel) {
  if (rows.length === 0) return '<p class="muted">None yet.</p>';
  const stateHeaderCells = SOLD_PRODUCT_STATES.map((s) => `<th colspan="6">${escapeHtml(STATUS_LABELS[s] || s)}</th>`).join('');
  const legHeaderCells = SOLD_PRODUCT_STATES.map(() => '<th colspan="3">Dealer</th><th colspan="3">Retailer</th>').join('');
  const subHeaderCells = SOLD_PRODUCT_STATES.map(() => '<th>Qty</th><th>Cost</th><th>Selling</th><th>Qty</th><th>Cost</th><th>Selling</th>').join('');
  const renderLegCells = (entry) => `<td>${entry ? entry.quantity : 0}</td><td>${escapeHtml(entry ? formatMoney(entry.costPrice) : '--')}</td><td>${escapeHtml(entry ? formatMoney(entry.sellingPrice) : '--')}</td>`;
  const bodyRows = rows.map((row) => {
    const cells = SOLD_PRODUCT_STATES.map((s) => {
      const dealerLeg = findStateEntry(row.paymentToSupplier, s);
      const retailerLeg = findStateEntry(row.paymentToDealer, s);
      return `${renderLegCells(dealerLeg)}${renderLegCells(retailerLeg)}`;
    }).join('');
    return `<tr><td class="${row.indent ? 'indent' : 'bold'}">${escapeHtml(row.name)}</td>${cells}</tr>`;
  }).join('');
  return `<table>
    <thead>
      <tr><th rowspan="3">${escapeHtml(firstColumnLabel)}</th>${stateHeaderCells}</tr>
      <tr>${legHeaderCells}</tr>
      <tr>${subHeaderCells}</tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

// DEALER-context variant of buildSupplierBlockHtml, using
// buildDealerSoldPivotHtml above for the split payment legs.
function buildDealerSupplierBlockHtml({ name, paymentToDealer, paymentToSupplier, sellers }) {
  const sellerRows = (sellers || []).map((s) => ({ id: 'x', name: s.name, paymentToDealer: s.paymentToDealer, paymentToSupplier: s.paymentToSupplier, indent: false }));
  return `
    <div style="margin-bottom:16px;">
      <h3 style="font-size:13px;margin:10px 0 4px;">${escapeHtml(name)}</h3>
      ${buildDealerSoldPivotHtml([{ id: 'x', name, paymentToDealer, paymentToSupplier, indent: false }], 'Total')}
      ${sellerRows.length > 0 ? `
      <div style="margin-left:16px;">
        <div style="font-size:11px;color:#666;margin:2px 0;">Sold By</div>
        ${buildDealerSoldPivotHtml(sellerRows, 'Sold By')}
      </div>` : ''}
    </div>
  `;
}

// Builds a standalone printable HTML document with every dealer/retailer
// block currently on screen, same "print exactly what's on screen"
// approach as buildVoucherPrintHtml above - blocks already reflects
// whichever dealer filter is currently selected. `blockBuilder` picks
// between the plain byStatus blocks (RETAILER/ADMIN/ORGANISATION) and the
// split-leg DEALER blocks above.
function buildSoldProductsPrintHtml({ title, subtitle, blocks, blockBuilder = buildSupplierBlockHtml }) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 12px; color: #555; margin-bottom: 20px; }
  h3 { font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  th { background: #f3f3f3; }
  td.indent { padding-left: 18px; }
  td.bold { font-weight: bold; }
  .muted { color: #999; font-size: 12px; margin: 4px 0 12px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(subtitle)}${subtitle ? ' &middot; ' : ''}Printed ${escapeHtml(new Date().toLocaleString())}</div>
  ${blocks.map(blockBuilder).join('')}
</body>
</html>`;
}

// Labels one "Sold By" row so a DEALER's own direct sales are told apart
// from their retailers' sales, and - at the ADMIN/ORGANISATION level,
// where sellers under one supplier can span several different dealers -
// so a retailer is told apart from a same-named retailer under a
// different dealer (parentDealerName is only ever set there, see
// reports.js /sold-products).
function sellerLabel(seller, context) {
  if (seller.type === 'DEALER') {
    return context === 'DEALER' ? `${seller.name} (Direct Sales / थेट विक्री)` : `${seller.name} (Dealer / डीलर)`;
  }
  return seller.parentDealerName
    ? `${seller.name} (Retailer / किरकोळ विक्रेता · ${seller.parentDealerName})`
    : `${seller.name} (Retailer / किरकोळ विक्रेता)`;
}

// DEALER-context variant of SupplierSection above, using
// DealerSoldProductsTable so each state cell shows the split "To Dealer" /
// "To Supplier" legs instead of one blended Cost Price. Always shows the
// "Sold By" breakdown - a DEALER login always has at least their own
// direct-sale row to show there, unlike the RETAILER case SupplierSection
// hides it for.
function DealerSupplierSection({ id, name, paymentToDealer, paymentToSupplier, sellers }) {
  const ownRow = [{ id, name, paymentToDealer, paymentToSupplier, indent: false }];
  const sellerRows = (sellers || []).map((s) => ({
    id: `${id}-${s.type}-${s.id}`,
    name: sellerLabel(s, 'DEALER'),
    paymentToDealer: s.paymentToDealer,
    paymentToSupplier: s.paymentToSupplier,
    indent: false,
  }));

  return (
    <div className="mb-4">
      <div className="rounded shadow overflow-x-auto mb-1 bg-orange-50/40">
        <DealerSoldProductsTable rows={ownRow} />
      </div>
      <div className="pl-4">
        <div className="text-xs font-medium text-gray-500 mb-1">Sold By <span className="text-gray-400 font-normal">/ कोणी विकले</span></div>
        <div className="bg-white rounded shadow overflow-x-auto">
          <DealerSoldProductsTable rows={sellerRows} />
        </div>
      </div>
    </div>
  );
}

// One supplier's own summary row plus its own nested "Sold By" breakdown
// underneath - see the reconciliation note on SoldProductsPanel above for
// why it's nested here rather than pulled out into one combined section.
// showSellers is false only for a RETAILER login (see SoldProductsPanel
// below) - their one and only seller is always themselves, so the
// breakdown would just repeat this same row a second time.
function SupplierSection({ id, name, byStatus, sellers, context, showSellers }) {
  const ownRow = [{ id, name, byStatus, indent: false }];
  const sellerRows = (sellers || []).map((s) => ({
    id: `${id}-${s.type}-${s.id}`,
    name: sellerLabel(s, context),
    byStatus: s.byStatus,
    indent: false,
  }));

  return (
    <div className="mb-4">
      <div className="rounded shadow overflow-x-auto mb-1 bg-orange-50/40">
        <SoldProductsTable rows={ownRow} />
      </div>
      {showSellers && (
        <div className="pl-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Sold By <span className="text-gray-400 font-normal">/ कोणी विकले</span></div>
          <div className="bg-white rounded shadow overflow-x-auto">
            <SoldProductsTable rows={sellerRows} />
          </div>
        </div>
      )}
    </div>
  );
}

// RETAILER's own sold-products view: settled with their one primary dealer
// only, never a supplier directly (see reports.js GET /sold-products -
// supplier is never even fetched for a RETAILER login), so this is a
// single locked block - no dropdown, since there's nothing to pick between
// - labeled with the dealer's name instead of a supplier's, and with no
// "Sold By" breakdown (that's only meaningful when a supplier's sales can
// span more than one seller).
function RetailerSoldProductsPanel({ data }) {
  const handlePrint = () => {
    const html = buildSoldProductsPrintHtml({
      title: 'Sold Products',
      subtitle: '',
      blocks: [{ name: data.dealerName || 'Dealer', byStatus: data.byStatus, sellers: [] }],
    });
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="text-sm font-medium text-gray-600">
          Dealer / डीलर: <span className="font-semibold text-gray-800">{data.dealerName || '-'}</span>
        </div>
        <button
          onClick={handlePrint}
          className="px-3 py-1.5 rounded text-sm bg-white border hover:bg-gray-50"
        >
          🖨 Print / छापा
        </button>
      </div>
      <div className="rounded shadow overflow-x-auto bg-orange-50/40">
        <SoldProductsTable rows={[{ id: 'own', name: data.dealerName || 'Dealer', byStatus: data.byStatus, indent: false }]} />
      </div>
    </div>
  );
}

// DEALER-context sold-products panel: same supplier-pivot/dropdown
// scaffolding as the shared panel below, but using DealerSupplierSection
// (split "To Dealer" / "To Supplier" legs) instead of the plain
// byStatus-based SupplierSection.
function DealerSoldProductsPanel({ data }) {
  const [selectedSupplier, setSelectedSupplier] = useState('ALL');
  const suppliers = data.suppliers || [];
  const supplierKey = (s) => String(s.supplierId ?? 'none');
  const filteredSuppliers = selectedSupplier === 'ALL'
    ? suppliers
    : suppliers.filter((s) => supplierKey(s) === selectedSupplier);

  const handlePrint = () => {
    const selectedSupplierName = selectedSupplier === 'ALL'
      ? 'All'
      : (suppliers.find((s) => supplierKey(s) === selectedSupplier)?.supplierName || selectedSupplier);
    const subtitle = suppliers.length > 1 ? `Supplier: ${selectedSupplierName}` : '';

    const blocks = filteredSuppliers.map((s) => ({
      name: s.supplierName,
      paymentToDealer: s.paymentToDealer,
      paymentToSupplier: s.paymentToSupplier,
      sellers: (s.sellers || []).map((seller) => ({ name: sellerLabel(seller, 'DEALER'), paymentToDealer: seller.paymentToDealer, paymentToSupplier: seller.paymentToSupplier })),
    }));

    const html = buildSoldProductsPrintHtml({ title: 'Sold Products', subtitle, blocks, blockBuilder: buildDealerSupplierBlockHtml });
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        {suppliers.length > 1 ? (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Supplier / पुरवठादार:</label>
            <select
              className="border rounded px-2 py-1 text-sm bg-white"
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
            >
              <option value="ALL">All / सर्व</option>
              {suppliers.map((s) => (
                <option key={supplierKey(s)} value={supplierKey(s)}>{s.supplierName}</option>
              ))}
            </select>
          </div>
        ) : <div />}
        <button
          onClick={handlePrint}
          className="px-3 py-1.5 rounded text-sm bg-white border hover:bg-gray-50"
        >
          🖨 Print / छापा
        </button>
      </div>

      {filteredSuppliers.length === 0 ? (
        <div className="bg-white rounded shadow p-3 text-gray-400 text-sm">
          No sold products yet. / अद्याप विकलेली उत्पादने नाहीत.
        </div>
      ) : (
        filteredSuppliers.map((s) => (
          <DealerSupplierSection
            key={supplierKey(s)}
            id={`s-${supplierKey(s)}`}
            name={s.supplierName}
            paymentToDealer={s.paymentToDealer}
            paymentToSupplier={s.paymentToSupplier}
            sellers={s.sellers}
          />
        ))
      )}
    </div>
  );
}

function SoldProductsPanel({ data }) {
  // Own local selection state, same pattern as the other panels' dealer/
  // status filters - resets to All whenever the tab is left and returned to.
  const [selectedSupplier, setSelectedSupplier] = useState('ALL');
  if (!data) return null;

  if (data.context === 'RETAILER') return <RetailerSoldProductsPanel data={data} />;
  if (data.context === 'DEALER') return <DealerSoldProductsPanel data={data} />;

  const showSellers = true;
  const suppliers = data.suppliers || [];
  // <select> values are always strings, and a "No Supplier" bucket carries
  // a null supplierId (see reports.js), so it's keyed here as the literal
  // string 'none' rather than 'null' to stay unambiguous either way.
  const supplierKey = (s) => String(s.supplierId ?? 'none');
  const filteredSuppliers = selectedSupplier === 'ALL'
    ? suppliers
    : suppliers.filter((s) => supplierKey(s) === selectedSupplier);

  // Prints exactly what's on screen right now - every supplier block as
  // narrowed by whichever supplier dropdown is set - in a separate window
  // so the rest of the app UI doesn't end up on the page.
  const handlePrint = () => {
    const selectedSupplierName = selectedSupplier === 'ALL'
      ? 'All'
      : (suppliers.find((s) => supplierKey(s) === selectedSupplier)?.supplierName || selectedSupplier);
    const subtitle = suppliers.length > 1 ? `Supplier: ${selectedSupplierName}` : '';

    const blocks = filteredSuppliers.map((s) => ({
      name: s.supplierName,
      byStatus: s.byStatus,
      sellers: showSellers ? (s.sellers || []).map((seller) => ({ name: sellerLabel(seller, data.context), byStatus: seller.byStatus })) : [],
    }));

    const html = buildSoldProductsPrintHtml({ title: 'Sold Products', subtitle, blocks });
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return; // popup blocked - nothing else to fall back to here
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        {suppliers.length > 1 ? (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Supplier / पुरवठादार:</label>
            <select
              className="border rounded px-2 py-1 text-sm bg-white"
              value={selectedSupplier}
              onChange={(e) => setSelectedSupplier(e.target.value)}
            >
              <option value="ALL">All / सर्व</option>
              {suppliers.map((s) => (
                <option key={supplierKey(s)} value={supplierKey(s)}>{s.supplierName}</option>
              ))}
            </select>
          </div>
        ) : <div />}
        <button
          onClick={handlePrint}
          className="px-3 py-1.5 rounded text-sm bg-white border hover:bg-gray-50"
        >
          🖨 Print / छापा
        </button>
      </div>

      {filteredSuppliers.length === 0 ? (
        <div className="bg-white rounded shadow p-3 text-gray-400 text-sm">
          No sold products yet. / अद्याप विकलेली उत्पादने नाहीत.
        </div>
      ) : (
        filteredSuppliers.map((s) => (
          <SupplierSection
            key={supplierKey(s)}
            id={`s-${supplierKey(s)}`}
            name={s.supplierName}
            byStatus={s.byStatus}
            sellers={s.sellers}
            context={data.context}
            showSellers={showSellers}
          />
        ))
      )}
    </div>
  );
}

// Sum of quantity × unit price across an order's items. Same price field
// PurchasesPanel already keys off of: cost price (rate) for a dealer's
// purchase from a supplier, selling price for a retailer's purchase from
// their dealer.
function purchaseTotal(purchase, context) {
  const priceKey = context === 'DEALER' ? 'rate' : 'sellingPrice';
  return purchase.items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i[priceKey] || 0), 0);
}

function PurchasesPanel({ data, selectedCounterparty, onSelectCounterparty }) {
  // Own local selection state, same pattern as DealerInventoryPanel's
  // selectedDealer - so switching away from and back to this tab resets
  // the filter to All rather than persisting a stale status filter.
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  if (!data) return null;
  const context = data.context;
  const dropdownLabel = context === 'DEALER' ? 'Supplier / पुरवठादार' : 'Dealer / डीलर';
  const priceLabel = context === 'DEALER' ? 'Cost Price / खरेदी किंमत' : 'Selling Price / विक्री किंमत';
  const counterparties = data.counterparties || [];
  const statusOptions = purchaseStatusOrder(context);
  // RETAILER only ever has the one primary dealer (see /reports/purchases
  // comments), so there's nothing for an "All" option to add there - keep
  // it DEALER/ADMIN-ORGANISATION only, where there can be several
  // suppliers (or, for ALL, several dealers/suppliers combined).
  const showAllOption = context !== 'RETAILER';
  // <select> values are always strings, so compare/select on the string
  // form of the id to avoid a number/string mismatch once the user changes
  // the dropdown themselves.
  const filtered = selectedCounterparty === 'ALL'
    ? data.purchases
    : data.purchases.filter((p) => String(p.counterpartyId) === String(selectedCounterparty));
  const groups = groupPurchasesByStatus(filtered, context)
    .filter((g) => selectedStatus === 'ALL' || g.status === selectedStatus);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{dropdownLabel}:</label>
          <select
            className="border rounded px-2 py-1 text-sm bg-white"
            value={selectedCounterparty != null ? String(selectedCounterparty) : ''}
            disabled={!showAllOption && counterparties.length <= 1}
            onChange={(e) => onSelectCounterparty(e.target.value)}
          >
            {showAllOption && <option value="ALL">All / सर्व</option>}
            {counterparties.length === 0 && !showAllOption && <option value="">-</option>}
            {counterparties.map((c) => (
              <option key={c.id} value={String(c.id)}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Status / स्थिती:</label>
          <select
            className="border rounded px-2 py-1 text-sm bg-white"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="ALL">All / सर्व</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
            ))}
          </select>
        </div>
      </div>

      {counterparties.length === 0 && (
        <div className="bg-white rounded shadow p-3 text-gray-400 text-sm">
          {context === 'DEALER'
            ? 'No suppliers purchased from yet. / अद्याप कोणत्याही पुरवठादाराकडून खरेदी नाही.'
            : 'No purchases from your dealer yet. / डीलरकडून अद्याप कोणतीही खरेदी नाही.'}
        </div>
      )}

      {counterparties.length > 0 && groups.map((g) => (
        <StatusGroup key={g.status} label={STATUS_LABELS[g.status] || g.status} count={g.items.length}>
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">Order # / ऑर्डर क्र.</th>
                <th className="text-left p-2">{dropdownLabel}</th>
                <th className="text-left p-2">Date / दिनांक</th>
                <th className="text-left p-2">Items / वस्तू</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="p-2">
                    <div className="flex items-center gap-1.5">
                      <span>{p.id}</span>
                      {p.status === 'MODIFIED' && (
                        <span
                          title="Pricing corrected after confirmation / पुष्टीनंतर किंमत दुरुस्त केली"
                          className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5"
                        >
                          Modified / सुधारित
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 font-medium">{formatMoney(purchaseTotal(p, context))}</div>
                  </td>
                  <td className="p-2">{p.counterpartyName || '-'}</td>
                  <td className="p-2">{new Date(p.date).toLocaleDateString()}</td>
                  <td className="p-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-500">
                          <th className="text-left pr-2 py-1">Product / उत्पादन</th>
                          <th className="text-left pr-2 py-1">Batch / बॅच</th>
                          <th className="text-left pr-2 py-1">Qty / प्रमाण</th>
                          <th className="text-left pr-2 py-1">{priceLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.items.map((i) => (
                          <tr key={i.id} className="border-t">
                            <td className="pr-2 py-1"><ProductCell product={i.product} /></td>
                            <td className="pr-2 py-1">{i.batchName || '-'}</td>
                            <td className="pr-2 py-1">{i.quantity}</td>
                            <td className="pr-2 py-1">
                              {formatMoney(context === 'DEALER' ? i.rate : i.sellingPrice)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StatusGroup>
      ))}
    </div>
  );
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Builds a standalone printable HTML document for one VoucherSection's
// currently filtered vouchers/payments (same grouping and totals as shown
// on screen), so "Print" reflects whatever the counterparty/state
// dropdowns are set to at the moment it's clicked.
function buildVoucherPrintHtml({ title, subtitle, counterpartyLabel, showDealerColumn, voucherGroups, paymentGroups, openVoucherTotal, paidPaymentTotal }) {
  const renderGroups = (groups, columns, rowFn) => groups.map((g) => `
    <h3>${escapeHtml(STATUS_LABELS[g.status] || g.status)} (${g.items.length})</h3>
    ${g.items.length === 0
      ? '<p class="muted">None yet.</p>'
      : `<table>
          <thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
          <tbody>${g.items.map((row) => `<tr>${rowFn(row).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>`}
  `).join('');

  const voucherColumns = ['Voucher #', 'Date', counterpartyLabel, ...(showDealerColumn ? ['Dealer'] : []), 'Amount', 'Description'];
  const voucherHtml = renderGroups(voucherGroups, voucherColumns, (v) => [
    escapeHtml(v.id),
    escapeHtml(new Date(v.date).toLocaleDateString()),
    escapeHtml(v.counterpartyName || v.dealerName || '-'),
    ...(showDealerColumn ? [escapeHtml(v.dealerName || '-')] : []),
    escapeHtml(formatMoney(v.amount)),
    escapeHtml(v.description || '-'),
  ]);

  const paymentColumns = ['Payment #', 'Date', counterpartyLabel, ...(showDealerColumn ? ['Dealer'] : []), 'Amount', 'Mode', 'Reference'];
  const paymentHtml = renderGroups(paymentGroups, paymentColumns, (p) => [
    escapeHtml(p.id),
    escapeHtml(new Date(p.date).toLocaleDateString()),
    escapeHtml(p.counterpartyName || p.dealerName || '-'),
    ...(showDealerColumn ? [escapeHtml(p.dealerName || '-')] : []),
    escapeHtml(formatMoney(p.amount)),
    escapeHtml(p.mode),
    escapeHtml(p.reference || '-'),
  ]);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 12px; color: #555; margin-bottom: 20px; }
  h2 { font-size: 15px; margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 13px; margin: 14px 0 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  th { background: #f3f3f3; }
  .muted { color: #999; font-size: 12px; margin: 4px 0 12px; }
  .totals { font-size: 12px; font-weight: bold; margin: 4px 0 8px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(subtitle)}${subtitle ? ' &middot; ' : ''}Printed ${escapeHtml(new Date().toLocaleString())}</div>

  <h2>Vouchers</h2>
  <div class="totals">Grand Total (Open): ${escapeHtml(formatMoney(openVoucherTotal))}</div>
  ${voucherHtml}

  <h2>Payments</h2>
  <div class="totals">Grand Total (Paid): ${escapeHtml(formatMoney(paidPaymentTotal))}</div>
  ${paymentHtml}
</body>
</html>`;
}

function VoucherSection({
  heading, headingMr, printTitle, counterpartyLabel, data, showDealerColumn,
  showCounterpartyFilter = false, showStatusFilter = false,
  // Only passed for the DEALER's own "Voucher/Payments from Retailer" tab
  // (see Reports() below) - showVoucherAdjustmentColumn adds the extra
  // Payments column, onAdjustVoucher is what the button in it calls
  // (POST /sold-products/pay/:paymentId/adjust-vouchers). Left undefined
  // everywhere else (Supplier Vouchers, the RETAILER's own view, the
  // ADMIN/ORGANISATION panel) - a row's own needsVoucherAdjustment flag
  // is also only ever set by reports.js for that same tab's data, so
  // there's nothing to show even if it were passed.
  showVoucherAdjustmentColumn = false,
  onAdjustVoucher,
}) {
  // Own local selection state, same pattern as DealerInventoryPanel's
  // selectedDealer - so switching away from and back to this tab resets
  // the filter to All rather than persisting a stale selection.
  const [selectedCounterparty, setSelectedCounterparty] = useState('ALL');
  // State/status filter (OPEN / PARTIALLY_PAID / PAID) - defaults to All,
  // same reset-on-remount behaviour as the counterparty filter above.
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  // Payment id currently being adjusted (disables its own button while the
  // request is in flight) and any error from the last attempt, keyed by
  // payment id so one row's failure doesn't clear another's.
  const [adjustingId, setAdjustingId] = useState(null);
  const [adjustErrors, setAdjustErrors] = useState({});

  if (!data) return null;

  // Distinct {id, name} pairs across both vouchers and payments - a
  // counterparty might only show up in one of the two lists (e.g. a
  // supplier with an open voucher but no payment yet).
  const counterpartyMap = new Map();
  for (const row of [...data.vouchers, ...data.payments]) {
    if (row.counterpartyId != null) counterpartyMap.set(row.counterpartyId, row.counterpartyName || '-');
  }
  const counterparties = [...counterpartyMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let vouchers = selectedCounterparty === 'ALL'
    ? data.vouchers
    : data.vouchers.filter((v) => String(v.counterpartyId) === String(selectedCounterparty));
  let payments = selectedCounterparty === 'ALL'
    ? data.payments
    : data.payments.filter((p) => String(p.counterpartyId) === String(selectedCounterparty));

  if (selectedStatus !== 'ALL') {
    vouchers = vouchers.filter((v) => v.status === selectedStatus);
    // A payment has no status of its own - it inherits its voucher's
    // current status, same fallback groupByVoucherStatus below uses
    // (a payment with no linked voucher counts as PAID).
    payments = payments.filter((p) => (p.voucherStatus || 'PAID') === selectedStatus);
  }

  const voucherGroups = groupByVoucherStatus(vouchers, (v) => v.status);
  const paymentGroups = groupByVoucherStatus(payments, (p) => p.voucherStatus || 'PAID');

  const openVoucherTotal = vouchers
    .filter((v) => v.status === 'OPEN')
    .reduce((sum, v) => sum + Number(v.amount || 0), 0);
  const paidPaymentTotal = payments
    .filter((p) => (p.voucherStatus || 'PAID') === 'PAID')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // Prints exactly what's currently on screen for this section - the
  // vouchers/payments as narrowed by whichever counterparty/state
  // dropdowns are set right now - in a separate window so the rest of the
  // app UI (tabs, the other section, etc.) doesn't end up on the page.
  const handlePrint = () => {
    const selectedCounterpartyName = selectedCounterparty === 'ALL'
      ? 'All'
      : (counterparties.find((c) => String(c.id) === String(selectedCounterparty))?.name || selectedCounterparty);
    const selectedStatusLabel = selectedStatus === 'ALL' ? 'All' : (STATUS_LABELS[selectedStatus] || selectedStatus);

    const subtitleParts = [];
    if (showCounterpartyFilter) subtitleParts.push(`${counterpartyLabel}: ${selectedCounterpartyName}`);
    if (showStatusFilter) subtitleParts.push(`State: ${selectedStatusLabel}`);

    const html = buildVoucherPrintHtml({
      title: printTitle || heading || 'Vouchers & Payments',
      subtitle: subtitleParts.join('  |  '),
      counterpartyLabel,
      showDealerColumn,
      voucherGroups,
      paymentGroups,
      openVoucherTotal,
      paidPaymentTotal,
    });

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return; // popup blocked - nothing else to fall back to here
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
  };

  async function handleAdjustVoucher(paymentId) {
    setAdjustingId(paymentId);
    setAdjustErrors((prev) => ({ ...prev, [paymentId]: null }));
    try {
      await onAdjustVoucher(paymentId);
    } catch (err) {
      setAdjustErrors((prev) => ({ ...prev, [paymentId]: err.response?.data?.error || 'Failed to adjust voucher' }));
    } finally {
      setAdjustingId(null);
    }
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-2 mb-3">
        {heading ? (
          <h2 className="text-lg font-semibold">
            {heading} <span className="text-sm font-normal text-gray-500">({headingMr})</span>
          </h2>
        ) : <div />}
        <button
          onClick={handlePrint}
          className="px-3 py-1.5 rounded text-sm bg-white border hover:bg-gray-50 shrink-0"
        >
          🖨 Print / छापा
        </button>
      </div>

      {(showCounterpartyFilter || showStatusFilter) && (
        <div className="flex flex-wrap items-center gap-4 mb-3">
          {showCounterpartyFilter && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">{counterpartyLabel}:</label>
              <select
                className="border rounded px-2 py-1 text-sm bg-white"
                value={selectedCounterparty}
                onChange={(e) => setSelectedCounterparty(e.target.value)}
              >
                <option value="ALL">All / सर्व</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
          {showStatusFilter && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">State / स्थिती:</label>
              <select
                className="border rounded px-2 py-1 text-sm bg-white"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="ALL">All / सर्व</option>
                {VOUCHER_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Vouchers and payments shown side by side rather than stacked. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-gray-600">Vouchers / व्हाउचर</div>
            <div className="text-sm font-bold text-red-600">
              Grand Total (Open) / एकूण (खुले): {formatMoney(openVoucherTotal)}
            </div>
          </div>
          {voucherGroups.map((g) => (
            <StatusGroup key={`v-${g.status}`} label={STATUS_LABELS[g.status] || g.status} count={g.items.length}>
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-2">Voucher # / व्हाउचर क्र.</th>
                    <th className="text-left p-2">Date / दिनांक</th>
                    <th className="text-left p-2">{counterpartyLabel}</th>
                    {showDealerColumn && <th className="text-left p-2">Dealer / डीलर</th>}
                    <th className="text-left p-2">Amount / रक्कम</th>
                    <th className="text-left p-2">Description / वर्णन</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="p-2">{v.id}</td>
                      <td className="p-2">{new Date(v.date).toLocaleDateString()}</td>
                      <td className="p-2">{v.counterpartyName || v.dealerName || '-'}</td>
                      {showDealerColumn && <td className="p-2">{v.dealerName || '-'}</td>}
                      <td className="p-2">{formatMoney(v.amount)}</td>
                      <td className="p-2">{v.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </StatusGroup>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-gray-600">Payments / देयके</div>
            <div className="text-sm font-bold text-red-600">
              Grand Total (Paid) / एकूण (दिले): {formatMoney(paidPaymentTotal)}
            </div>
          </div>
          {paymentGroups.map((g) => (
            <StatusGroup key={`p-${g.status}`} label={STATUS_LABELS[g.status] || g.status} count={g.items.length}>
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-2">Payment # / देयक क्र.</th>
                    <th className="text-left p-2">Date / दिनांक</th>
                    <th className="text-left p-2">{counterpartyLabel}</th>
                    {showDealerColumn && <th className="text-left p-2">Dealer / डीलर</th>}
                    <th className="text-left p-2">Amount / रक्कम</th>
                    <th className="text-left p-2">Mode / पद्धत</th>
                    <th className="text-left p-2">Reference / संदर्भ</th>
                    {showVoucherAdjustmentColumn && (
                      <th className="text-left p-2">Voucher Adjustment / व्हाउचर समायोजन</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((p) => (
                    <tr key={p.id} className={`border-t ${p.needsVoucherAdjustment ? 'bg-amber-50' : ''}`}>
                      <td className="p-2">{p.id}</td>
                      <td className="p-2">{new Date(p.date).toLocaleDateString()}</td>
                      <td className="p-2">{p.counterpartyName || p.dealerName || '-'}</td>
                      {showDealerColumn && <td className="p-2">{p.dealerName || '-'}</td>}
                      <td className="p-2">{formatMoney(p.amount)}</td>
                      <td className="p-2">{p.mode}</td>
                      <td className="p-2">{p.reference || '-'}</td>
                      {showVoucherAdjustmentColumn && (
                        <td className="p-2">
                          {p.needsVoucherAdjustment ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="text-xs font-semibold text-amber-700">
                                ⚠ Not adjusted / समायोजित नाही
                              </span>
                              <button
                                disabled={adjustingId === p.id}
                                onClick={() => handleAdjustVoucher(p.id)}
                                className="px-2 py-1 rounded text-xs bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                              >
                                {adjustingId === p.id ? 'Adjusting... / समायोजित करत आहे...' : 'Adjust voucher / व्हाउचर समायोजित करा'}
                              </button>
                              {adjustErrors[p.id] && (
                                <span className="text-xs text-red-600">{adjustErrors[p.id]}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </StatusGroup>
          ))}
        </div>
      </div>
    </div>
  );
}

// Retailer Vouchers / Supplier Vouchers as sub-tabs, used only for the
// ADMIN/ORGANISATION ('ALL') split below - a status ("state") filter and
// a scrollbar are added here too, since this is the split that tends to
// grow tallest (every dealer's vouchers combined).
function AdminVouchersPanel({ data }) {
  const [subTab, setSubTab] = useState('retailer');
  const subTabs = [
    ['retailer', 'Retailer Vouchers', 'किरकोळ विक्रेता व्हाउचर'],
    ['supplier', 'Supplier Vouchers', 'पुरवठादार व्हाउचर'],
  ];

  return (
    <div>
      <div className="flex gap-2 mb-4">
        {subTabs.map(([key, label, labelMr]) => (
          <button
            key={key}
            onClick={() => setSubTab(key)}
            className={`px-3 py-1.5 rounded text-sm ${subTab === key ? 'bg-emerald-700 text-white' : 'bg-white border'}`}
          >
            {label} <span className={subTab === key ? 'text-emerald-100' : 'text-gray-500'}>({labelMr})</span>
          </button>
        ))}
      </div>
      {/* Scrolls independently once the detail tables push past the
          monitor height, instead of growing the page indefinitely. */}
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {subTab === 'retailer' && (
          <VoucherSection
            printTitle="Retailer Vouchers"
            counterpartyLabel="Retailer / किरकोळ विक्रेता"
            data={data.retailer}
            showDealerColumn
            showCounterpartyFilter
            showStatusFilter
          />
        )}
        {subTab === 'supplier' && (
          <VoucherSection
            printTitle="Supplier Vouchers"
            counterpartyLabel="Supplier / पुरवठादार"
            data={data.supplier}
            showDealerColumn
            showCounterpartyFilter
            showStatusFilter
          />
        )}
      </div>
    </div>
  );
}

function VouchersPanel({ data }) {
  if (!data) return null;

  if (data.context === 'RETAILER') {
    // Tab title already reads "Voucher/Payments to Dealer / डीलरला व्हाउचर/देयके",
    // so no separate section heading is needed here.
    return (
      <VoucherSection
        printTitle="Dealer Vouchers"
        counterpartyLabel="Dealer / डीलर"
        data={data.dealer}
        showDealerColumn={false}
      />
    );
  }

  if (data.context === 'ALL') {
    return <AdminVouchersPanel data={data} />;
  }

  // DEALER - stacked Supplier/Retailer sections. Dealer logins already
  // get a tabbed view via Reports.jsx's own vouchers-supplier /
  // vouchers-retailer tabs, so this combined "vouchers" tab is left as a
  // quick stacked overview.
  return (
    <div>
      <VoucherSection
        heading="Supplier Vouchers"
        headingMr="पुरवठादार व्हाउचर"
        counterpartyLabel="Supplier / पुरवठादार"
        data={data.supplier}
        showDealerColumn={false}
        showCounterpartyFilter
      />
      <VoucherSection
        heading="Retailer Vouchers"
        headingMr="किरकोळ विक्रेता व्हाउचर"
        counterpartyLabel="Retailer / किरकोळ विक्रेता"
        data={data.retailer}
        showDealerColumn={false}
        showCounterpartyFilter
      />
    </div>
  );
}

// The six report types the Downloads tab can print, backed by
// GET /reports/downloads?type=...&from=...&to=... (see reports.js). Order
// here is also the sub-tab order. RECEIPTS is filtered out for RETAILER
// scope below - a retailer has no downstream to receive payments from in
// this schema, so that endpoint always returns an empty list for them.
const DOWNLOAD_REPORTS = [
  ['PURCHASES', 'Purchases / खरेदी'],
  ['GOODS_RETURN', 'Goods Return / माल परत'],
  ['SALES', 'Sale / विक्री'],
  ['PAYMENTS', 'Payments / देयके'],
  ['RECEIPTS', 'Receipts / पावत्या'],
  ['VOUCHERS', 'Vouchers / व्हाउचर'],
];

// Where each download type's ID links out to - the screen in the rest of
// the app that shows that record (per App.jsx). None of these routes take
// an :id path segment today (they're plain list pages: /purchases,
// /goods-returns, /sales, /vouchers, /receipts, /payments) - an `id` query
// param is appended so the target page CAN pick it out and scroll to /
// highlight that one row once it's updated to read it - it doesn't do
// that yet.
//
// PAYMENTS is a special case: a DEALER pays their own supplier via the
// DEALER-only /payments page, but a RETAILER pays their dealer via
// /receipts instead (App.jsx has no /payments route a RETAILER is even
// allowed onto - see its RoleProtected roles={['DEALER']} comment) - so
// which page a "Payments" row opens depends on who's logged in, not just
// the download type.
const DOWNLOAD_ENTITY_ROUTES = {
  PURCHASES: '/purchases',
  GOODS_RETURN: '/goods-returns',
  SALES: '/sales',
  RECEIPTS: '/receipts',
  VOUCHERS: '/vouchers',
};

function downloadEntityHref(type, context, id) {
  const path = type === 'PAYMENTS'
    ? (context === 'RETAILER' ? '/receipts' : '/payments')
    : DOWNLOAD_ENTITY_ROUTES[type];
  return `${path || ''}?id=${id}`;
}

// Every target route above (per App.jsx) is RoleProtected to
// DEALER/RETAILER only - an ADMIN/ORGANISATION login (context 'ALL') would
// just get bounced back to the dashboard, so the id is only ever worth
// linking for those two contexts. Everyone else sees the id as plain text.
function canLinkToEntity(context) {
  return context === 'DEALER' || context === 'RETAILER';
}

// Shared print shell for every Downloads sub-tab - same flat
// id/date/counterparty/status/amount table regardless of report type, so
// one builder covers all six instead of one per type. The ID is a real
// link (absolute, since the print-out is a separate window/document) back
// to that record's own screen, same target as the on-screen table.
function buildDownloadPrintHtml({ type, context, title, subtitle, rows }) {
  const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const linkable = canLinkToEntity(context);
  const bodyRows = rows.map((r) => {
    const idCell = linkable
      ? `<a href="${escapeHtml(`${window.location.origin}${downloadEntityHref(type, context, r.id)}`)}">${escapeHtml(String(r.id))}</a>`
      : escapeHtml(String(r.id));
    return `<tr>
      <td>${idCell}</td>
      <td>${escapeHtml(new Date(r.date).toLocaleDateString())}</td>
      <td>${escapeHtml(r.counterpartyName || '--')}</td>
      <td>${escapeHtml(r.status || '--')}</td>
      <td>${escapeHtml(formatMoney(r.amount))}</td>
    </tr>`;
  }).join('');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .subtitle { font-size: 12px; color: #555; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  th { background: #f3f3f3; }
  a { color: #047857; }
  tfoot td { font-weight: bold; background: #f9f9f9; }
  .muted { color: #999; font-size: 12px; margin: 4px 0 12px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="subtitle">${escapeHtml(subtitle)} &middot; Printed ${escapeHtml(new Date().toLocaleString())}</div>
  <table>
    <thead><tr><th>ID</th><th>Date</th><th>Counterparty</th><th>Status</th><th>Amount</th></tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="5" class="muted">No records in this date range.</td></tr>'}</tbody>
    ${rows.length ? `<tfoot><tr><td colspan="4">Total</td><td>${escapeHtml(formatMoney(total))}</td></tr></tfoot>` : ''}
  </table>
</body>
</html>`;
}

// "Downloads" main tab: a date-windowed, printable version of the six core
// transaction lists (purchases / goods return / sale / payments / receipts
// / vouchers), each living under its own sub-tab within this one screen.
// Scope (which sub-tabs are offered, and what rows come back for each) is
// handled server-side by GET /reports/downloads based on the logged-in
// dealer/retailer/admin - this component just drives the date range and
// active sub-tab and prints whatever the API returns.
function DownloadsPanel({ context }) {
  const types = DOWNLOAD_REPORTS.filter(([key]) => !(key === 'RECEIPTS' && context === 'RETAILER'));
  const [subTab, setSubTab] = useState(types[0][0]);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    setRows(null);
    const params = new URLSearchParams({ type: subTab });
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    api.get(`/reports/downloads?${params.toString()}`).then((r) => setRows(r.data.rows));
  }, [subTab, fromDate, toDate]);

  function handlePrint() {
    const label = types.find(([key]) => key === subTab)?.[1] || subTab;
    const rangeLabel = (fromDate || toDate)
      ? `${fromDate ? new Date(fromDate).toLocaleDateString() : 'Start'} - ${toDate ? new Date(toDate).toLocaleDateString() : 'Today'}`
      : 'All dates';
    const html = buildDownloadPrintHtml({ type: subTab, context, title: label, subtitle: rangeLabel, rows: rows || [] });
    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) return; // popup blocked - nothing else to fall back to here
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
  }

  const total = (rows || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From date <span className="text-gray-400">/ पासून तारीख</span></label>
          <input type="date" value={fromDate} max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To date <span className="text-gray-400">/ पर्यंत तारीख</span></label>
          <input type="date" value={toDate} min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)} className="border rounded px-2 py-1 text-sm" />
        </div>
        <button onClick={handlePrint} disabled={!rows}
          className="px-4 py-2 rounded text-sm bg-emerald-700 text-white disabled:opacity-50">
          Print <span className="font-normal">/ प्रिंट</span>
        </button>
      </div>

      <div className="flex gap-2 mb-4 border-b overflow-x-auto">
        {types.map(([key, label]) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 ${subTab === key ? 'border-emerald-700 text-emerald-700 font-semibold' : 'border-transparent text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-100 sticky top-0 z-10">
          <tr>
            <th className="text-left p-2">ID</th>
            <th className="text-left p-2 border-l">Date <span className="text-gray-400 font-normal">/ तारीख</span></th>
            <th className="text-left p-2 border-l">Counterparty <span className="text-gray-400 font-normal">/ व्यापारी</span></th>
            <th className="text-left p-2 border-l">Status <span className="text-gray-400 font-normal">/ स्थिती</span></th>
            <th className="text-left p-2 border-l">Amount <span className="text-gray-400 font-normal">/ रक्कम</span></th>
          </tr>
        </thead>
        <tbody>
          {rows === null && (
            <tr><td className="p-3 text-gray-400" colSpan={5}>Loading... <span className="text-gray-400">/ लोड होत आहे...</span></td></tr>
          )}
          {rows?.length === 0 && (
            <tr><td className="p-3 text-gray-400" colSpan={5}>No records in this date range. <span className="text-gray-400">/ या कालावधीत नोंदी नाहीत.</span></td></tr>
          )}
          {rows?.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">
                {/* Opens that record's own screen in a new tab - see the
                    DOWNLOAD_ENTITY_ROUTES comment above for the route
                    prefixes. Only DEALER/RETAILER can actually reach those
                    routes (RoleProtected in App.jsx) - anyone else (ADMIN/
                    ORGANISATION) just sees the plain id, not a dead link. */}
                {canLinkToEntity(context) ? (
                  <a href={downloadEntityHref(subTab, context, r.id)} target="_blank" rel="noopener noreferrer"
                    className="text-emerald-700 underline hover:text-emerald-900">
                    {r.id}
                  </a>
                ) : (
                  r.id
                )}
              </td>
              <td className="p-2 border-l">{new Date(r.date).toLocaleDateString()}</td>
              <td className="p-2 border-l">{r.counterpartyName || '--'}</td>
              <td className="p-2 border-l">{r.status || '--'}</td>
              <td className="p-2 border-l">{formatMoney(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        {rows?.length > 0 && (
          <tfoot>
            <tr className="border-t font-semibold bg-gray-50">
              <td className="p-2" colSpan={4}>Total <span className="font-normal text-gray-500">/ एकूण</span></td>
              <td className="p-2 border-l">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('dashboard');
  const [purchases, setPurchases] = useState(null);
  const [vouchers, setVouchers] = useState(null);
  const [soldProducts, setSoldProducts] = useState(null);
  const [inventory, setInventory] = useState([]);
  // Admin/Organisation-only split view: null until loaded (and never loaded
  // at all for DEALER/RETAILER, since the API rejects it for those roles).
  const [inventoryByOwner, setInventoryByOwner] = useState(null);
  const [selectedCounterparty, setSelectedCounterparty] = useState(null);

  useEffect(() => {
    api.get('/reports/purchases').then((r) => {
      setPurchases(r.data);
      // Auto-select: the retailer's single primary dealer (no "All" option
      // there - see PurchasesPanel), or "All" suppliers/dealers for
      // DEALER/ADMIN-ORGANISATION so the report opens showing everything.
      setSelectedCounterparty(r.data.context === 'RETAILER' ? (r.data.counterparties?.[0]?.id ?? null) : 'ALL');
    });
    loadVouchers();
    api.get('/reports/sold-products').then((r) => setSoldProducts(r.data));
    api.get('/reports/inventory').then((r) => setInventory(r.data));
  }, []);

  // Pulled out of the mount effect so it can also be re-run after a
  // retroactive voucher adjustment (see adjustPaymentVoucher below) -
  // simplest way to pick up the payment's new needsVoucherAdjustment: false
  // and the touched voucher's new status/description without hand-patching
  // local state.
  function loadVouchers() {
    api.get('/reports/vouchers').then((r) => setVouchers(r.data));
  }

  // Applies an already-confirmed sold-products payment from a retailer
  // against that retailer's own outstanding RECEIVABLE vouchers (see
  // soldProducts.js POST /pay/:paymentId/adjust-vouchers) - the action
  // behind the "Adjust voucher" button reports.js flags via
  // needsVoucherAdjustment on the Voucher/Payments from Retailer tab.
  // Re-throws on failure so VoucherSection's own handler can show the
  // error next to that payment's row.
  async function adjustPaymentVoucher(paymentId) {
    await api.post(`/sold-products/pay/${paymentId}/adjust-vouchers`);
    loadVouchers();
  }

  // The split view is admin/organisation-only, so this second fetch only
  // fires once we know the role from /reports/purchases (rather than
  // firing for every role and having DEALER/RETAILER hit the 403 above).
  useEffect(() => {
    if (purchases?.context !== 'ALL') return;
    api.get('/reports/inventory-by-owner').then((r) => setInventoryByOwner(r.data));
  }, [purchases?.context]);

  // Role context should agree across every /reports/* response (it's
  // derived from req.user.role), so any loaded endpoint can tell us which
  // one we're in.
  const roleContext = purchases?.context || vouchers?.context;

  const purchasesText = PURCHASES_TEXT[purchases?.context] || { title: 'Products Received', titleMr: 'मिळालेली उत्पादने' };

  let tabs;
  if (roleContext === 'DEALER') {
    tabs = [
      ['dashboard', 'Dashboard / डॅशबोर्ड'],
      ['purchases', `${purchasesText.title} / ${purchasesText.titleMr}`],
      ['vouchers-supplier', 'Voucher/Payments to Supplier / पुरवठादाराला व्हाउचर/देयके'],
      ['vouchers-retailer', 'Voucher/Payments from Retailer / किरकोळ विक्रेत्याकडून व्हाउचर/देयके'],
      ['sold-products', 'Sold Products / विकलेली उत्पादने'],
      ['inventory', 'Product Inventory / उत्पादन साठा'],
      ['downloads', 'Downloads / डाउनलोड्स'],
    ];
  } else if (roleContext === 'RETAILER') {
    // No separate "Payments to Dealer" tab - it now lives side by side
    // with vouchers inside the renamed vouchers tab below.
    tabs = [
      ['dashboard', 'Dashboard / डॅशबोर्ड'],
      ['purchases', `${purchasesText.title} / ${purchasesText.titleMr}`],
      ['vouchers', 'Voucher/Payments to Dealer / डीलरला व्हाउचर/देयके'],
      ['sold-products', 'Sold Products / विकलेली उत्पादने'],
      ['inventory', 'Product Inventory / उत्पादन साठा'],
      ['downloads', 'Downloads / डाउनलोड्स'],
    ];
  } else {
    tabs = [
      ['dashboard', 'Dashboard / डॅशबोर्ड'],
      ['purchases', `${purchasesText.title} / ${purchasesText.titleMr}`],
      ['vouchers', 'Vouchers / व्हाउचर'],
      ['sold-products', 'Sold Products / विकलेली उत्पादने'],
      ['inventory-dealer', 'Dealer Inventory / डीलर साठा'],
      ['inventory-retailer', 'Retailer Inventory / किरकोळ विक्रेता साठा'],
      ['downloads', 'Downloads / डाउनलोड्स'],
    ];
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        Reports <span className="text-base font-normal text-gray-500">(अहवाल)</span>
      </h1>
      <div className="flex gap-2 mb-4">
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded text-sm ${tab === key ? 'bg-emerald-700 text-white' : 'bg-white border'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto max-h-[75vh] pr-1">
        {tab === 'dashboard' && <Dashboard showWelcome={false} />}

        {tab === 'purchases' && (
          <PurchasesPanel
            data={purchases}
            selectedCounterparty={selectedCounterparty}
            onSelectCounterparty={setSelectedCounterparty}
          />
        )}

        {tab === 'vouchers' && <VouchersPanel data={vouchers} />}

        {tab === 'vouchers-supplier' && (
          <VoucherSection
            printTitle="Supplier Vouchers"
            counterpartyLabel="Supplier / पुरवठादार"
            data={vouchers?.supplier}
            showDealerColumn={false}
            showCounterpartyFilter
          />
        )}

        {tab === 'vouchers-retailer' && (
          <VoucherSection
            printTitle="Retailer Vouchers"
            counterpartyLabel="Retailer / किरकोळ विक्रेता"
            data={vouchers?.retailer}
            showDealerColumn={false}
            showCounterpartyFilter
            showVoucherAdjustmentColumn
            onAdjustVoucher={adjustPaymentVoucher}
          />
        )}

        {tab === 'sold-products' && <SoldProductsPanel data={soldProducts} />}

        {tab === 'inventory' && (
          <InventoryTable rows={inventory} />
        )}

        {tab === 'inventory-dealer' && (
          <DealerInventoryPanel rows={inventoryByOwner?.dealerInventory || []} />
        )}

        {tab === 'inventory-retailer' && (
          <RetailerInventoryPanel
            dealers={inventoryByOwner?.dealers || []}
            rows={inventoryByOwner?.retailerInventory || []}
          />
        )}

        {tab === 'downloads' && <DownloadsPanel context={roleContext} />}
      </div>
    </div>
  );
}
