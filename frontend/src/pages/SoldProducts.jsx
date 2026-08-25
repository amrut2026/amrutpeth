import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD'];

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

// Sum of quantity + amount across a list of sold-product rows — used for
// both the per-group subtotal (per supplier for a DEALER, the single
// implicit group for a RETAILER) and the overall per-tab total.
function sumItems(items) {
  return items.reduce((acc, i) => ({
    quantity: acc.quantity + Number(i.quantity || 0),
    amount: acc.amount + Number(i.amount || 0),
  }), { quantity: 0, amount: 0 });
}

// Same sizeWeight/flavour/brand join and layout as ProductCell in
// Sales.jsx / Purchases.jsx, so a product reads identically everywhere it
// shows up across the app.
function ProductCell({ item }) {
  const details = [item.productSizeWeight, item.productFlavour, item.productBrand].filter(Boolean).join(' · ');
  return (
    <>
      <div>{item.productName}</div>
      {details && <div className="text-xs text-gray-400">{details}</div>}
      {item.remark && <span className="block text-xs text-amber-600">{item.remark}</span>}
    </>
  );
}

export default function SoldProducts() {
  const { user } = useAuth();
  const [openItems, setOpenItems] = useState([]);
  const [pendingItems, setPendingItems] = useState([]); // TO_BE_CONFIRMED
  const [paidItems, setPaidItems] = useState([]);
  const [tab, setTab] = useState('open');
  const [suppliers, setSuppliers] = useState([]); // DEALER only
  const [supplierId, setSupplierId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState('CASH');
  const [reference, setReference] = useState('');
  const [paying, setPaying] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const [open, pending, paid] = await Promise.all([
      api.get('/sold-products', { params: { status: 'OPEN' } }),
      api.get('/sold-products', { params: { status: 'TO_BE_CONFIRMED' } }),
      api.get('/sold-products', { params: { status: 'PAID' } }),
    ]);
    setOpenItems(open.data);
    setPendingItems(pending.data);
    setPaidItems(paid.data);
    setSelected(new Set());
    if (user.role === 'DEALER') {
      const s = await api.get('/sold-products/counterparties');
      setSuppliers(s.data);
      setSupplierId((prev) => prev || s.data[0]?.id || '');
    }
  }
  useEffect(() => { load(); }, []);

  async function confirmPayment(paymentId) {
    setConfirmingId(paymentId);
    setError('');
    try {
      await api.patch(`/sold-products/pay/${paymentId}/confirm`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to confirm payment / भरणा पुष्टी करण्यात अयशस्वी');
    } finally {
      setConfirmingId(null);
    }
  }

  const payToLabel = user.role === 'DEALER' ? 'Supplier / पुरवठादार' : 'Dealer / डीलर';

  // Groups a DEALER's list by the product's own supplier — a payment can
  // only ever go to one supplier at a time (see below), so this is also
  // how selection gets scoped. A RETAILER only ever has one counterparty
  // (their primary dealer), so their list stays a single, header-less
  // group — unchanged from before.
  function groupBySupplier(items) {
    if (user.role !== 'DEALER') return [{ supplierId: null, supplierName: null, items }];
    const map = new Map();
    for (const i of items) {
      const key = i.supplierId ?? 'none';
      if (!map.has(key)) map.set(key, { supplierId: i.supplierId, supplierName: i.supplierName || 'Unknown supplier / अज्ञात पुरवठादार', items: [] });
      map.get(key).items.push(i);
    }
    return [...map.values()].sort((a, b) => (a.supplierName || '').localeCompare(b.supplierName || ''));
  }

  // Selecting an item from a different supplier than what's currently
  // selected starts a fresh selection, and switches the Pay panel's
  // supplier to match — the backend only ever settles one supplier per
  // payment, so mixing groups would just get rejected at pay time.
  function toggle(item) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
        return next;
      }
      if (user.role === 'DEALER' && next.size > 0) {
        const firstSelected = openItems.find((x) => next.has(x.id));
        if (firstSelected && firstSelected.supplierId !== item.supplierId) next.clear();
      }
      next.add(item.id);
      return next;
    });
    if (user.role === 'DEALER' && item.supplierId != null) setSupplierId(String(item.supplierId));
  }

  function toggleGroup(group) {
    const groupIds = group.items.map((i) => i.id);
    setSelected((prev) => {
      const allSelected = groupIds.length > 0 && groupIds.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(groupIds);
    });
    if (user.role === 'DEALER' && group.supplierId != null) setSupplierId(String(group.supplierId));
  }

  // Changing the supplier by hand drops any selected item that no longer
  // belongs to it, rather than leaving a stale cross-supplier selection.
  function changeSupplier(id) {
    setSupplierId(id);
    setSelected((prev) => new Set(openItems.filter((i) => prev.has(i.id) && String(i.supplierId) === String(id)).map((i) => i.id)));
  }

  const selectedTotal = openItems
    .filter((i) => selected.has(i.id))
    .reduce((sum, i) => sum + Number(i.amount), 0);

  async function pay() {
    if (selected.size === 0 || paying) return;
    if (user.role === 'DEALER' && !supplierId) {
      setError('Choose a supplier to pay / भरणा करण्यासाठी पुरवठादार निवडा');
      return;
    }
    setError('');
    setPaying(true);
    try {
      await api.post('/sold-products/pay', {
        soldProductIds: [...selected],
        mode,
        reference: reference || undefined,
        supplierId: user.role === 'DEALER' ? supplierId : undefined,
      });
      setReference('');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment / भरणा नोंदवण्यात अयशस्वी');
    } finally {
      setPaying(false);
    }
  }

  // The overall total for whichever tab is showing — across every group,
  // not just the one currently in view — shown above the table.
  function TabTotals({ items }) {
    if (!items.length) return null;
    const { quantity, amount } = sumItems(items);
    return (
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm bg-gray-50 border border-gray-200 rounded px-3 py-2 mb-3">
        <div>
          <span className="text-gray-500">Items</span> <span className="text-gray-400">/ वस्तू:</span>{' '}
          <span className="font-medium">{items.length}</span>
        </div>
        <div>
          <span className="text-gray-500">Total Qty</span> <span className="text-gray-400">/ एकूण प्रमाण:</span>{' '}
          <span className="font-medium">{quantity}</span>
        </div>
        <div>
          <span className="text-gray-500">Total</span> <span className="text-gray-400">/ एकूण:</span>{' '}
          <span className="font-medium">{formatMoney(amount)}</span>
        </div>
      </div>
    );
  }

  function ItemsTable({ items, selectable }) {
    const groups = groupBySupplier(items);
    return (
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {groups.map((g) => {
          const groupSelectedCount = g.items.filter((i) => selected.has(i.id)).length;
          const { quantity: groupQty, amount: groupTotal } = sumItems(g.items);
          return (
            <div key={g.supplierId ?? 'all'} className="bg-white rounded shadow overflow-x-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
                <span className="text-sm font-medium">
                  {user.role === 'DEALER' ? g.supplierName : 'Total'}
                  {user.role !== 'DEALER' && <span className="text-gray-400 font-normal"> / एकूण</span>}
                  {' '}<span className="text-gray-400 font-normal">({g.items.length})</span>
                </span>
                <span className="text-sm text-gray-600">
                  {groupQty} qty <span className="text-gray-400">/ प्रमाण</span> · {formatMoney(groupTotal)}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    {selectable && (
                      <th className="p-2">
                        <input type="checkbox"
                          checked={g.items.length > 0 && groupSelectedCount === g.items.length}
                          onChange={() => toggleGroup(g)} />
                      </th>
                    )}
                    <th className="text-left p-2">Sale # / विक्री क्र.</th>
                    <th className="text-left p-2">Date / दिनांक</th>
                    <th className="text-left p-2">Product / उत्पादन</th>
                    <th className="text-left p-2">Batch / बॅच</th>
                    <th className="text-left p-2">Qty / प्रमाण</th>
                    <th className="text-left p-2">Rate owed / देय दर</th>
                    <th className="text-left p-2">Amount / रक्कम</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((i) => (
                    <tr key={i.id} className="border-t">
                      {selectable && (
                        <td className="p-2">
                          <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i)} />
                        </td>
                      )}
                      <td className="p-2">{i.saleId}</td>
                      <td className="p-2">{new Date(i.date).toLocaleDateString()}</td>
                      <td className="p-2">
                        <ProductCell item={i} />
                      </td>
                      <td className="p-2">{i.batchName || '-'}</td>
                      <td className="p-2">{i.quantity}</td>
                      <td className="p-2">{i.price != null ? formatMoney(i.price) : '-'}</td>
                      <td className="p-2">{formatMoney(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="bg-white rounded shadow p-3 text-gray-400">
            Nothing here yet. / अद्याप काहीही नाही.
          </div>
        )}
      </div>
    );
  }

  // TO_BE_CONFIRMED rows are always the retailer-to-dealer flow (a dealer's
  // own payments to their supplier are never in this state — see
  // schema.prisma SoldProductStatus), so this groups by paymentId instead
  // of supplier: each group is one payment a retailer submitted, awaiting
  // this dealer's confirmation. A RETAILER just sees their own pending
  // payments read-only — there's only ever one payee (their dealer), so no
  // grouping header is needed there either.
  function PendingConfirmationTable({ items }) {
    if (user.role !== 'DEALER') {
      return <ItemsTable items={items} selectable={false} />;
    }

    const map = new Map();
    for (const i of items) {
      if (!map.has(i.paymentId)) map.set(i.paymentId, { paymentId: i.paymentId, retailerName: i.retailerName, items: [] });
      map.get(i.paymentId).items.push(i);
    }
    const groups = [...map.values()];

    return (
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {groups.map((g) => {
          const { quantity: groupQty, amount: groupTotal } = sumItems(g.items);
          return (
            <div key={g.paymentId} className="bg-white rounded shadow overflow-x-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
                <span className="text-sm font-medium">
                  {g.retailerName || `Retailer #${g.paymentId}`} <span className="text-gray-400 font-normal">({g.items.length})</span>
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">
                    {groupQty} qty <span className="text-gray-400">/ प्रमाण</span> · {formatMoney(groupTotal)}
                  </span>
                  <button type="button" disabled={confirmingId === g.paymentId}
                    onClick={() => confirmPayment(g.paymentId)}
                    className="text-emerald-700 text-xs font-medium hover:underline disabled:opacity-50">
                    {confirmingId === g.paymentId ? 'Confirming... / पुष्टी करत आहे...' : 'Confirm Received / मिळाले म्हणून पुष्टी करा'}
                  </button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-2">Sale # / विक्री क्र.</th>
                    <th className="text-left p-2">Date / दिनांक</th>
                    <th className="text-left p-2">Product / उत्पादन</th>
                    <th className="text-left p-2">Batch / बॅच</th>
                    <th className="text-left p-2">Qty / प्रमाण</th>
                    <th className="text-left p-2">Rate owed / देय दर</th>
                    <th className="text-left p-2">Amount / रक्कम</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((i) => (
                    <tr key={i.id} className="border-t">
                      <td className="p-2">{i.saleId}</td>
                      <td className="p-2">{new Date(i.date).toLocaleDateString()}</td>
                      <td className="p-2"><ProductCell item={i} /></td>
                      <td className="p-2">{i.batchName || '-'}</td>
                      <td className="p-2">{i.quantity}</td>
                      <td className="p-2">{i.price != null ? formatMoney(i.price) : '-'}</td>
                      <td className="p-2">{formatMoney(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="bg-white rounded shadow p-3 text-gray-400">
            Nothing here yet. / अद्याप काहीही नाही.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
      <div className="lg:col-span-2">
        <h1 className="text-2xl font-semibold mb-4">
          Sold Products <span className="text-base font-normal text-gray-500">(विकलेली उत्पादने)</span>
        </h1>
        <p className="text-sm text-gray-500 mb-4">
          Cash-customer sales, owed to your {user.role === 'DEALER' ? 'supplier' : 'dealer'} until settled.
          <span className="block text-xs">
            रोख ग्राहकांना केलेली विक्री, सेटल होईपर्यंत तुमच्या {user.role === 'DEALER' ? 'पुरवठादाराला' : 'डीलरला'} देय.
          </span>
        </p>

        <div className="flex gap-2 mb-4">
          {[
            ['open', `Open / प्रलंबित (${openItems.length})`],
            ['pending', `To Be Confirmed / पुष्टीकरण प्रलंबित (${pendingItems.length})`],
            ['paid', `Paid / भरलेले (${paidItems.length})`],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 rounded text-sm ${tab === key ? 'bg-emerald-700 text-white' : 'bg-white border'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'open' && <><TabTotals items={openItems} /><ItemsTable items={openItems} selectable /></>}
        {tab === 'pending' && <><TabTotals items={pendingItems} /><PendingConfirmationTable items={pendingItems} /></>}
        {tab === 'paid' && <><TabTotals items={paidItems} /><ItemsTable items={paidItems} selectable={false} /></>}
      </div>

      <div className="bg-white p-4 rounded shadow sticky top-4">
        <h2 className="font-semibold mb-3">Pay {user.role === 'DEALER' ? 'Supplier' : 'Dealer'}
          <span className="text-gray-400 font-normal block text-xs">
            {user.role === 'DEALER' ? 'पुरवठादाराला भरा' : 'डीलरला भरा'}
          </span>
        </h2>

        {user.role === 'DEALER' && (
          <div className="mb-3">
            <label className="text-xs text-gray-500">{payToLabel}</label>
            <select className="border rounded px-2 py-1 text-sm w-full mt-1" value={supplierId}
              onChange={(e) => changeSupplier(e.target.value)}>
              {suppliers.length === 0 && <option value="">No suppliers yet</option>}
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div className="text-3xl font-bold mb-1">{formatMoney(selectedTotal)}</div>
        <p className="text-xs text-gray-500 mb-4">{selected.size} item(s) selected / निवडलेल्या वस्तू</p>

        <label className="text-xs text-gray-500">Payment mode <span className="text-gray-400">/ पैसे भरण्याची पद्धत</span></label>
        <div className="flex gap-2 mb-3">
          {PAYMENT_MODES.map((m) => (
            <button key={m}
              className={`flex-1 py-2 rounded text-sm border ${mode === m ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white'}`}
              onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
        </div>

        <label className="text-xs text-gray-500">Reference (optional) <span className="text-gray-400">/ संदर्भ (ऐच्छिक)</span></label>
        <input className="border rounded px-2 py-1 text-sm w-full mb-3" value={reference}
          onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no. / ..." />

        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

        <button
          disabled={selected.size === 0 || paying || (user.role === 'DEALER' && !supplierId)}
          onClick={pay}
          className="w-full bg-emerald-700 text-white py-3 rounded font-semibold hover:bg-emerald-800 disabled:opacity-40">
          {paying ? 'Recording... / नोंदवत आहे...' : 'Pay Selected / निवडलेल्यांचे पैसे भरा'}
        </button>

        {user.role === 'RETAILER' && (
          <p className="text-xs text-gray-400 mt-3">
            Your payment will show as "To be confirmed" until your dealer confirms it was received. / डीलरने पुष्टी करेपर्यंत तुमचे देयक "पुष्टीकरण प्रलंबित" असे दिसेल.
          </p>
        )}
      </div>
    </div>
  );
}
