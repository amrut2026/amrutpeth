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

const PAYMENTS_TEXT = {
  RETAILER: { title: 'Payments to Dealer', titleMr: 'डीलरला दिलेली देयके', counterparty: 'Dealer / डीलर' },
  DEALER: { title: 'Payments to Supplier', titleMr: 'पुरवठादाराला दिलेली देयके', counterparty: 'Supplier / पुरवठादार' },
  ALL: { title: 'Payments', titleMr: 'देयके', counterparty: 'To / कडे' },
};

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

function paymentCounterparty(context, payment) {
  if (context === 'RETAILER') return payment.dealer?.name;
  if (context === 'DEALER') return payment.supplier?.name;
  return payment.supplier?.name || payment.dealer?.name;
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
                <th className="text-left p-2">Date / दिनांक</th>
                <th className="text-left p-2">Items / वस्तू</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((p) => (
                <tr key={p.id} className="border-t align-top">
                  <td className="p-2">{p.id}</td>
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

function PaymentsPanel({ data }) {
  if (!data) return null;
  const context = data.context;
  const counterpartyLabel = (PAYMENTS_TEXT[context] || PAYMENTS_TEXT.ALL).counterparty;
  return (
    <div>
      {data.groups.map((g) => (
        <StatusGroup key={g.status} label={STATUS_LABELS[g.status] || g.status} count={g.items.length}>
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-2">Payment # / देयक क्र.</th>
                <th className="text-left p-2">Date / दिनांक</th>
                <th className="text-left p-2">{counterpartyLabel}</th>
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
                  <td className="p-2">{paymentCounterparty(context, p) || '-'}</td>
                  <td className="p-2">₹{Number(p.amount).toFixed(2)}</td>
                  <td className="p-2">{p.mode}</td>
                  <td className="p-2">{p.reference || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </StatusGroup>
      ))}
    </div>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('purchases');
  const [purchases, setPurchases] = useState(null);
  const [payments, setPayments] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [selectedCounterparty, setSelectedCounterparty] = useState(null);

  useEffect(() => {
    api.get('/reports/purchases').then((r) => {
      setPurchases(r.data);
      // Auto-select: the retailer's single primary dealer, or the first
      // supplier alphabetically for a dealer.
      setSelectedCounterparty(r.data.counterparties?.[0]?.id ?? null);
    });
    api.get('/reports/payments').then((r) => setPayments(r.data));
    api.get('/reports/inventory').then((r) => setInventory(r.data));
  }, []);

  const purchasesText = PURCHASES_TEXT[purchases?.context] || { title: 'Products Received', titleMr: 'मिळालेली उत्पादने' };
  const paymentsText = PAYMENTS_TEXT[payments?.context] || { title: 'Payments', titleMr: 'देयके' };

  const tabs = [
    ['purchases', `${purchasesText.title} / ${purchasesText.titleMr}`],
    ['payments', `${paymentsText.title} / ${paymentsText.titleMr}`],
    ['inventory', 'Product Inventory / उत्पादन साठा'],
  ];

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

      {tab === 'purchases' && (
        <PurchasesPanel
          data={purchases}
          selectedCounterparty={selectedCounterparty}
          onSelectCounterparty={setSelectedCounterparty}
        />
      )}

      {tab === 'payments' && <PaymentsPanel data={payments} />}

      {tab === 'inventory' && (
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
  );
}
