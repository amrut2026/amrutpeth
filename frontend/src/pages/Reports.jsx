import { useEffect, useState } from 'react';
import api from '../api.js';

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

const RETAILER_PURCHASE_STATUS_ORDER = ['PENDING', 'IN_REVIEW', 'ORDERED', 'IN_TRANSIT', 'RECEIVED'];
const DEALER_PURCHASE_STATUS_ORDER = ['PENDING', 'IN_REVIEW', 'CONFIRMED'];

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

function formatMoney(value) {
  return value != null ? `₹${Number(value).toFixed(2)}` : '-';
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
  if (!data) return null;
  const context = data.context;
  const dropdownLabel = context === 'DEALER' ? 'Supplier / पुरवठादार' : 'Dealer / डीलर';
  const priceLabel = context === 'DEALER' ? 'Cost Price / खरेदी किंमत' : 'Selling Price / विक्री किंमत';
  const counterparties = data.counterparties || [];
  // <select> values are always strings, so compare/select on the string
  // form of the id to avoid a number/string mismatch once the user changes
  // the dropdown themselves.
  const filtered = data.purchases.filter((p) => String(p.counterpartyId) === String(selectedCounterparty));
  const groups = groupPurchasesByStatus(filtered, context);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <label className="text-sm font-medium">{dropdownLabel}:</label>
        <select
          className="border rounded px-2 py-1 text-sm bg-white"
          value={selectedCounterparty != null ? String(selectedCounterparty) : ''}
          disabled={counterparties.length <= 1}
          onChange={(e) => onSelectCounterparty(e.target.value)}
        >
          {counterparties.length === 0 && <option value="">-</option>}
          {counterparties.map((c) => (
            <option key={c.id} value={String(c.id)}>{c.name}</option>
          ))}
        </select>
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
                    <div>{p.id}</div>
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
                            <td className="pr-2 py-1">{i.product.name}</td>
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

function VoucherSection({ heading, headingMr, counterpartyLabel, data, showDealerColumn }) {
  if (!data) return null;
  const voucherGroups = groupByVoucherStatus(data.vouchers, (v) => v.status);
  const paymentGroups = groupByVoucherStatus(data.payments, (p) => p.voucherStatus || 'PAID');

  const openVoucherTotal = data.vouchers
    .filter((v) => v.status === 'OPEN')
    .reduce((sum, v) => sum + Number(v.amount || 0), 0);
  const paidPaymentTotal = data.payments
    .filter((p) => (p.voucherStatus || 'PAID') === 'PAID')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return (
    <div className="mb-8">
      {heading && (
        <h2 className="text-lg font-semibold mb-3">
          {heading} <span className="text-sm font-normal text-gray-500">({headingMr})</span>
        </h2>
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
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-2">{p.id}</td>
                      <td className="p-2">{new Date(p.date).toLocaleDateString()}</td>
                      <td className="p-2">{p.counterpartyName || p.dealerName || '-'}</td>
                      {showDealerColumn && <td className="p-2">{p.dealerName || '-'}</td>}
                      <td className="p-2">{formatMoney(p.amount)}</td>
                      <td className="p-2">{p.mode}</td>
                      <td className="p-2">{p.reference || '-'}</td>
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

function VouchersPanel({ data }) {
  if (!data) return null;
  const showDealerColumn = data.context === 'ALL';

  if (data.context === 'RETAILER') {
    // Tab title already reads "Voucher/Payments to Dealer / डीलरला व्हाउचर/देयके",
    // so no separate section heading is needed here.
    return (
      <VoucherSection
        counterpartyLabel="Dealer / डीलर"
        data={data.dealer}
        showDealerColumn={false}
      />
    );
  }

  // DEALER and ALL both carry the same supplier/retailer split.
  return (
    <div>
      <VoucherSection
        heading="Supplier Vouchers"
        headingMr="पुरवठादार व्हाउचर"
        counterpartyLabel="Supplier / पुरवठादार"
        data={data.supplier}
        showDealerColumn={showDealerColumn}
      />
      <VoucherSection
        heading="Retailer Vouchers"
        headingMr="किरकोळ विक्रेता व्हाउचर"
        counterpartyLabel="Retailer / किरकोळ विक्रेता"
        data={data.retailer}
        showDealerColumn={showDealerColumn}
      />
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('purchases');
  const [purchases, setPurchases] = useState(null);
  const [vouchers, setVouchers] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [selectedCounterparty, setSelectedCounterparty] = useState(null);

  useEffect(() => {
    api.get('/reports/purchases').then((r) => {
      setPurchases(r.data);
      // Auto-select: the retailer's single primary dealer, or the first
      // supplier alphabetically for a dealer.
      setSelectedCounterparty(r.data.counterparties?.[0]?.id ?? null);
    });
    api.get('/reports/vouchers').then((r) => setVouchers(r.data));
    api.get('/reports/inventory').then((r) => setInventory(r.data));
  }, []);

  // Role context should agree across every /reports/* response (it's
  // derived from req.user.role), so any loaded endpoint can tell us which
  // one we're in.
  const roleContext = purchases?.context || vouchers?.context;

  const purchasesText = PURCHASES_TEXT[purchases?.context] || { title: 'Products Received', titleMr: 'मिळालेली उत्पादने' };

  let tabs;
  if (roleContext === 'DEALER') {
    tabs = [
      ['purchases', `${purchasesText.title} / ${purchasesText.titleMr}`],
      ['vouchers-supplier', 'Voucher/Payments to Supplier / पुरवठादाराला व्हाउचर/देयके'],
      ['vouchers-retailer', 'Voucher/Payments from Retailer / किरकोळ विक्रेत्याकडून व्हाउचर/देयके'],
      ['inventory', 'Product Inventory / उत्पादन साठा'],
    ];
  } else if (roleContext === 'RETAILER') {
    // No separate "Payments to Dealer" tab - it now lives side by side
    // with vouchers inside the renamed vouchers tab below.
    tabs = [
      ['purchases', `${purchasesText.title} / ${purchasesText.titleMr}`],
      ['vouchers', 'Voucher/Payments to Dealer / डीलरला व्हाउचर/देयके'],
      ['inventory', 'Product Inventory / उत्पादन साठा'],
    ];
  } else {
    tabs = [
      ['purchases', `${purchasesText.title} / ${purchasesText.titleMr}`],
      ['vouchers', 'Vouchers / व्हाउचर'],
      ['inventory', 'Product Inventory / उत्पादन साठा'],
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
            counterpartyLabel="Supplier / पुरवठादार"
            data={vouchers?.supplier}
            showDealerColumn={false}
          />
        )}

        {tab === 'vouchers-retailer' && (
          <VoucherSection
            counterpartyLabel="Retailer / किरकोळ विक्रेता"
            data={vouchers?.retailer}
            showDealerColumn={false}
          />
        )}

        {tab === 'inventory' && (
          <div className="bg-white rounded shadow overflow-x-auto">
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
                {inventory.map((r) => (
                  <tr key={r.id} className={`border-t ${r.lowStock ? 'bg-red-50' : ''}`}>
                    <td className="p-2">{r.product?.name} ({r.product?.sizeWeight})</td>
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
                {inventory.length === 0 && <tr><td className="p-3 text-gray-400" colSpan={8}>No inventory yet. / अद्याप साठा नाही.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
