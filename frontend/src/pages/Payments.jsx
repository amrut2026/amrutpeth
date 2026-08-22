import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Custom page instead of CrudTable (see Receipts.jsx / Vouchers.jsx for the
// same pattern) — CrudTable posts fixed fields to a fixed endpoint, but
// paying a specific PAYABLE voucher needs a dynamic URL
// (POST /vouchers/:id/payments) and an amount auto-filled from that
// voucher's remaining balance, neither of which CrudTable supports.
//
// Primary flow: DEALER picks one of their own open PAYABLE (supplier)
// vouchers and pays against it — mirrors RETAILER paying a RECEIVABLE
// voucher on Receipts.jsx. This goes through vouchers.js's
// POST /vouchers/:id/payments, which also moves the voucher
// OPEN -> PARTIALLY_PAID -> PAID.
//
// Secondary flow: the original generic "payment not tied to any voucher"
// (what the old CrudTable-based version of this page did), kept as a
// fallback so nothing that worked before stops working — posts straight
// to POST /payments.
export default function Payments() {
  const { user } = useAuth();
  const canPay = user.role === 'DEALER';
  // This screen is titled "Payments to Manufacturer" for a dealer — so the
  // list below should only ever show payments actually made TO a supplier,
  // not the retailer -> dealer payments that also land in the Payment
  // table now (see receipts.js POST /). Those already have their own home,
  // the Receipts (from Retailers) screen — showing them here too would
  // contradict what this screen says it's for. ADMIN's view stays the full
  // unscoped ledger (oversight), so no filtering there.
  const showOnlySupplierPayments = canPay;
  // Direction/Party only add information for a viewer who genuinely sees
  // payments in both directions — with the dealer's list now filtered to
  // supplier-only above, direction is redundant there (every row is
  // "Paid"). ADMIN's unfiltered ledger still needs it. Party (which
  // supplier/retailer) stays useful for the dealer even so — they still
  // want to see who each payment went to — so it isn't tied to the same
  // flag as Direction.
  const showDirection = user.role === 'ADMIN';
  const showParty = canPay || user.role === 'ADMIN';

  const [payments, setPayments] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [tab, setTab] = useState('voucher'); // 'voucher' | 'general' — which form is shown, not the payment mode (CASH/UPI/CARD)
  const [form, setForm] = useState({ voucherId: '', amount: '', mode: 'CASH', reference: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const calls = [api.get('/payments')];
    if (canPay) calls.push(api.get('/vouchers'));
    const results = await Promise.all(calls);
    setPayments(showOnlySupplierPayments ? results[0].data.filter((p) => !p.retailerId) : results[0].data);
    if (canPay) {
      setVouchers(results[1].data.filter((v) => v.type === 'PAYABLE' && v.status !== 'PAID'));
    }
  }
  useEffect(() => { load(); }, []);

  function remainingFor(voucherId) {
    const v = vouchers.find((x) => String(x.id) === String(voucherId));
    if (!v) return null;
    const paid = (v.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    return Number(v.amount) - paid;
  }

  function selectVoucher(voucherId) {
    const remaining = remainingFor(voucherId);
    setForm({ ...form, voucherId, amount: remaining != null ? remaining.toFixed(2) : '' });
  }

  function switchTab(next) {
    setTab(next);
    setForm({ voucherId: '', amount: '', mode: 'CASH', reference: '' });
    setError('');
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (tab === 'voucher') {
        await api.post(`/vouchers/${form.voucherId}/payments`, {
          amount: Number(form.amount), mode: form.mode, reference: form.reference || undefined
        });
      } else {
        await api.post('/payments', {
          amount: Number(form.amount), mode: form.mode, reference: form.reference || undefined
        });
      }
      setForm({ voucherId: '', amount: '', mode: 'CASH', reference: '' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment / देयक नोंदवण्यात अयशस्वी');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        {canPay ? (
          <>Payments to Manufacturer <span className="text-base font-normal text-gray-500">(उत्पादकाला देयके)</span></>
        ) : (
          <>Payments <span className="text-base font-normal text-gray-500">(देयके)</span></>
        )}
      </h1>

      {/* Only a dealer can make a payment — admin viewing this page only
          sees the resulting ledger below. */}
      {canPay && (
        <div className="bg-white p-4 rounded shadow mb-6">
          <div className="flex gap-4 mb-3 text-sm">
            <button type="button"
              className={`pb-1 border-b-2 ${tab === 'voucher' ? 'border-emerald-700 text-emerald-800 font-medium' : 'border-transparent text-gray-400'}`}
              onClick={() => switchTab('voucher')}>
              Pay a supplier voucher / पुरवठादार व्हाउचर भरा
            </button>
            <button type="button"
              className={`pb-1 border-b-2 ${tab === 'general' ? 'border-emerald-700 text-emerald-800 font-medium' : 'border-transparent text-gray-400'}`}
              onClick={() => switchTab('general')}>
              General payment / सर्वसाधारण देयक
            </button>
          </div>

          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {tab === 'voucher' && (
              <select className="border rounded px-2 py-1" required
                value={form.voucherId} onChange={(e) => selectVoucher(e.target.value)}>
                <option value="">Supplier voucher... / पुरवठादार व्हाउचर...</option>
                {vouchers.map((v) => (
                  <option key={v.id} value={v.id}>
                    #{v.id} · {v.supplier?.name || `Supplier #${v.supplierId}`} · ₹{v.amount} ({v.status})
                  </option>
                ))}
              </select>
            )}
            <input type="number" step="0.01" placeholder="Amount to pay / भरावयाची रक्कम" className="border rounded px-2 py-1" required
              value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <select className="border rounded px-2 py-1"
              value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <option value="CASH">CASH / रोख</option>
              <option value="UPI">UPI / यूपीआय</option>
              <option value="CARD">CARD / कार्ड</option>
            </select>
            <input placeholder="Reference (optional) / संदर्भ (ऐच्छिक)" className="border rounded px-2 py-1"
              value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            <button disabled={submitting} className="md:col-span-4 bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800 disabled:opacity-50">
              {submitting ? 'Saving... / जतन करत आहे...' : 'Make Payment / देयक करा'}
            </button>
            {error && <p className="md:col-span-4 text-red-600 text-sm">{error}</p>}
            {tab === 'voucher' && vouchers.length === 0 && (
              <p className="md:col-span-4 text-xs text-amber-600">No open supplier vouchers to pay against. / भरण्यासाठी कोणतेही खुले पुरवठादार व्हाउचर नाहीत.</p>
            )}
          </form>
        </div>
      )}

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">#</th>
              {!canPay && <th className="text-left p-2">Dealer / डीलर</th>}
              {showDirection && <th className="text-left p-2">Direction / दिशा</th>}
              {showParty && <th className="text-left p-2">{showDirection ? 'Party / पक्ष' : 'Supplier / पुरवठादार'}</th>}
              <th className="text-left p-2">Voucher / व्हाउचर</th>
              <th className="text-left p-2">Amount / रक्कम</th>
              <th className="text-left p-2">Mode / पद्धत</th>
              <th className="text-left p-2">Reference</th>
              <th className="text-left p-2">Date / दिनांक</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              // A Payment row is either the dealer paying a supplier
              // (supplierId set) or a retailer paying the dealer
              // (retailerId set — see receipts.js POST /, which creates
              // one of these alongside every retailer receipt) — never
              // both, so this is enough to tell them apart.
              const isFromRetailer = !!p.retailerId;
              return (
                <tr key={p.id} className="border-t">
                  <td className="p-2">{p.id}</td>
                  {!canPay && <td className="p-2">{p.dealer?.name || p.dealerId}</td>}
                  {showDirection && (
                    <td className="p-2">
                      {isFromRetailer ? (
                        <span className="text-emerald-700">Received / मिळाले</span>
                      ) : (
                        <span className="text-amber-700">Paid / भरले</span>
                      )}
                    </td>
                  )}
                  {showParty && (
                    <td className="p-2">
                      {isFromRetailer ? (p.retailer?.name || p.retailerId) : (p.supplier?.name || p.supplierId || '—')}
                    </td>
                  )}
                  {/* A payment with no voucherId is either the old generic
                      "dealer -> manufacturer" payment (no supplierId either)
                      or a sold-products settlement (POST /sold-products/pay
                      — supplierId set, but never tied to a specific
                      voucher, since it settles a batch of SoldProduct rows
                      instead). Label the two differently so they aren't
                      both shown as a bare "—". */}
                  <td className="p-2">
                    {p.voucherId ? `#${p.voucherId}` : (
                      p.supplierId
                        ? <span className="text-xs text-gray-500">Sold products / विकलेली उत्पादने</span>
                        : <span className="text-xs text-gray-500">General / सर्वसाधारण</span>
                    )}
                  </td>
                  <td className="p-2">₹{Number(p.amount).toFixed(2)}</td>
                  <td className="p-2">{p.mode}</td>
                  <td className="p-2">{p.reference || '—'}</td>
                  <td className="p-2">{new Date(p.date).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {payments.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={(canPay ? 6 : 7) + (showDirection ? 1 : 0) + (showParty ? 1 : 0)}>No payments yet. / अद्याप कोणतेही देयक नाही.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
