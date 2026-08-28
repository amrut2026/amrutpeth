import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Receipts() {
  const { user } = useAuth();
  const canPay = user.role === 'RETAILER';
  const canConfirm = user.role === 'DEALER';

  const [receipts, setReceipts] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [retailers, setRetailers] = useState([]); // DEALER only — for the filter dropdown
  const [retailerFilter, setRetailerFilter] = useState(''); // '' = All
  const [form, setForm] = useState({ voucherId: '', amount: '', mode: 'CASH' });
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [confirmError, setConfirmError] = useState('');

  async function load() {
    const calls = [api.get('/receipts')];
    if (canPay) calls.push(api.get('/vouchers'));
    if (canConfirm) calls.push(api.get('/retailers'));
    const results = await Promise.all(calls);
    setReceipts(results[0].data);
    let next = 1;
    if (canPay) { setVouchers(results[next].data.filter((x) => x.status !== 'PAID')); next += 1; }
    if (canConfirm) { setRetailers(results[next].data); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/receipts', form);
      setForm({ voucherId: '', amount: '', mode: 'CASH' });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record payment / देयक नोंदवण्यात अयशस्वी');
    }
  }

  async function confirmReceipt(id) {
    setConfirmingId(id);
    setConfirmError('');
    try {
      await api.patch(`/receipts/${id}/confirm`);
      load();
    } catch (err) {
      setConfirmError(err.response?.data?.error || 'Failed to confirm receipt');
    } finally {
      setConfirmingId(null);
    }
  }

  function statusLabel(status) {
    if (status === 'PAID') return { text: 'PAID / भरले', className: 'text-green-600' };
    if (status === 'PARTIALLY_PAID') return { text: 'PARTIALLY PAID / अंशतः भरले', className: 'text-amber-600' };
    return { text: 'TO BE CONFIRMED / पुष्टीकरण प्रलंबित', className: 'text-red-600' };
  }

  // #, Voucher, Amount, Mode, Status, Date is the base 6. A retailer sees
  // only their own payments (no Retailer column); a dealer alone gets the
  // trailing confirm-action column. Used for the colSpan on the
  // full-width error/empty rows in the retailer's own flat table below.
  const columnCount = 6 + (canPay ? 0 : 1) + (canConfirm ? 1 : 0);

  // DEALER only: narrow to one retailer (default: all), then club into a
  // section per retailer with its own subtotal. A RETAILER's own view has
  // exactly one implicit counterparty (themselves), so none of this
  // applies there — it stays the original flat table.
  const filteredReceipts = canConfirm && retailerFilter
    ? receipts.filter((r) => String(r.retailerId) === retailerFilter)
    : receipts;

  const grandTotal = filteredReceipts.reduce((sum, r) => sum + Number(r.amount), 0);

  function groupByRetailer(list) {
    const map = new Map();
    for (const r of list) {
      const key = r.retailerId ?? 'none';
      if (!map.has(key)) {
        map.set(key, { retailerId: r.retailerId, retailerName: r.retailer?.name || 'Unknown retailer / अज्ञात किरकोळ विक्रेता', items: [] });
      }
      map.get(key).items.push(r);
    }
    return [...map.values()].sort((a, b) => a.retailerName.localeCompare(b.retailerName));
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">
        {canPay ? (
          <>Payments (Pay Dealer) <span className="text-base font-normal text-gray-500">(देयके (डीलरला पैसे द्या))</span></>
        ) : (
          <>Receipts <span className="text-base font-normal text-gray-500">(पावत्या)</span></>
        )}
      </h1>

      {/* Only the retailer who owes a voucher can pay against it — a dealer
          or admin viewing this page only sees the resulting ledger below. */}
      {canPay && (
        <form onSubmit={submit} className="bg-white p-4 rounded shadow mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <select className="border rounded px-2 py-1" required
            value={form.voucherId} onChange={(e) => setForm({ ...form, voucherId: e.target.value })}>
            <option value="">Voucher... / व्हाउचर...</option>
            {vouchers.map((v) => <option key={v.id} value={v.id}>#{v.id} · ₹{v.amount} ({v.status})</option>)}
          </select>
          <input type="number" step="0.01" placeholder="Amount to pay / भरावयाची रक्कम" className="border rounded px-2 py-1" required
            value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <select className="border rounded px-2 py-1"
            value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            <option value="CASH">CASH / रोख</option>
            <option value="UPI">UPI / यूपीआय</option>
            <option value="CARD">CARD / कार्ड</option>
          </select>
          <button className="bg-emerald-700 text-white px-4 py-2 rounded hover:bg-emerald-800">
            Make Payment / देयक करा
          </button>
          {error && <p className="md:col-span-4 text-red-600 text-sm">{error}</p>}
          <p className="md:col-span-4 text-xs text-gray-400">
            Your payment will show as "To be confirmed" until your dealer confirms it was received. / डीलरने पुष्टी करेपर्यंत तुमचे देयक "पुष्टीकरण प्रलंबित" असे दिसेल.
          </p>
        </form>
      )}

      {canConfirm && (
        <>
          <div className="mb-4 flex items-end gap-6 flex-wrap">
            <div>
              <label className="text-xs text-gray-500">Retailer <span className="text-gray-400">/ किरकोळ विक्रेता</span></label>
              <select className="border rounded px-2 py-1 text-sm w-full md:w-64 mt-1"
                value={retailerFilter} onChange={(e) => setRetailerFilter(e.target.value)}>
                <option value="">All / सर्व</option>
                {retailers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <span className="text-sm text-gray-500">Grand Total :</span>{' '}
              <span className="text-sm text-gray-400">/ एकूण रक्कम:</span>{' '}
              <span className="text-2xl font-bold text-red-600">₹{grandTotal.toFixed(2)}</span>
            </div>
          </div>

          {confirmError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">{confirmError}</div>
          )}

          <div className="space-y-4 max-h-[75vh] overflow-y-auto">
            {groupByRetailer(filteredReceipts).map((g) => {
              const groupTotal = g.items.reduce((sum, r) => sum + Number(r.amount), 0);
              return (
                <div key={g.retailerId ?? 'none'} className="bg-white rounded shadow overflow-x-auto">
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
                    <span className="text-sm font-medium">
                      {g.retailerName} <span className="text-gray-400 font-normal">({g.items.length})</span>
                    </span>
                    <span className="text-sm font-semibold text-red-600">Sub Total : ₹{groupTotal.toFixed(2)}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 sticky top-0 z-10">
                      <tr>
                        <th className="text-left p-2">#</th>
                        <th className="text-left p-2">Voucher / व्हाउचर</th>
                        <th className="text-left p-2">Amount Received / मिळालेली रक्कम</th>
                        <th className="text-left p-2">Mode / पद्धत</th>
                        <th className="text-left p-2">Status / स्थिती</th>
                        <th className="text-left p-2">Date / दिनांक</th>
                        <th className="text-left p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((r) => {
                        const status = statusLabel(r.status);
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="p-2">{r.id}</td>
                            <td className="p-2">
                              {r.voucherId
                                ? `#${r.voucherId}`
                                : <span className="text-xs text-gray-500">Sold products settlement / विकलेल्या उत्पादनांची देयक</span>}
                            </td>
                            <td className="p-2">₹{Number(r.amount).toFixed(2)}</td>
                            <td className="p-2">{r.mode}</td>
                            <td className="p-2"><span className={status.className}>{status.text}</span></td>
                            <td className="p-2">{new Date(r.date).toLocaleDateString()}</td>
                            <td className="p-2">
                              {r.status === 'TO_BE_CONFIRMED' && (
                                <button type="button" disabled={confirmingId === r.id} className="text-emerald-700 text-xs hover:underline disabled:opacity-50"
                                  onClick={() => confirmReceipt(r.id)}>
                                  {confirmingId === r.id ? 'Confirming... / पुष्टी करत आहे...' : 'Mark as Received / मिळाले म्हणून चिन्हांकित करा'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })}
            {filteredReceipts.length === 0 && (
              <div className="bg-white rounded shadow p-3 text-gray-400">
                No payments yet. / अद्याप कोणतेही देयक नाही.
              </div>
            )}
          </div>
        </>
      )}

      {!canConfirm && (
        <div className="bg-white rounded shadow overflow-x-auto max-h-[75vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 sticky top-0 z-10">
              <tr>
                <th className="text-left p-2">#</th>
                {!canPay && <th className="text-left p-2">Retailer / किरकोळ विक्रेता</th>}
                <th className="text-left p-2">Voucher / व्हाउचर</th>
                <th className="text-left p-2">{canPay ? 'Amount Paid / भरलेली रक्कम' : 'Amount Received / मिळालेली रक्कम'}</th>
                <th className="text-left p-2">Mode / पद्धत</th>
                <th className="text-left p-2">Status / स्थिती</th>
                <th className="text-left p-2">Date / दिनांक</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => {
                const status = statusLabel(r.status);
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.id}</td>
                    {!canPay && <td className="p-2">{r.retailer?.name || '-'}</td>}
                    <td className="p-2">
                      {r.voucherId
                        ? `#${r.voucherId}`
                        : <span className="text-xs text-gray-500">Sold products settlement / विकलेल्या उत्पादनांची देयक</span>}
                    </td>
                    <td className="p-2">₹{Number(r.amount).toFixed(2)}</td>
                    <td className="p-2">{r.mode}</td>
                    <td className="p-2"><span className={status.className}>{status.text}</span></td>
                    <td className="p-2">{new Date(r.date).toLocaleDateString()}</td>
                  </tr>
                );
              })}
              {receipts.length === 0 && (
                <tr><td className="p-3 text-gray-400" colSpan={columnCount}>No payments yet. / अद्याप कोणतेही देयक नाही.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}