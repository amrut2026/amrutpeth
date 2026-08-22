import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Receipts() {
  const { user } = useAuth();
  const canPay = user.role === 'RETAILER';
  const canConfirm = user.role === 'DEALER';

  const [receipts, setReceipts] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [form, setForm] = useState({ voucherId: '', amount: '', mode: 'CASH' });
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [confirmError, setConfirmError] = useState('');

  async function load() {
    const calls = [api.get('/receipts')];
    if (canPay) calls.push(api.get('/vouchers'));
    const results = await Promise.all(calls);
    setReceipts(results[0].data);
    if (canPay) setVouchers(results[1].data.filter((x) => x.status !== 'PAID'));
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

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Voucher / व्हाउचर</th>
              <th className="text-left p-2">{canPay ? 'Amount Paid / भरलेली रक्कम' : 'Amount Received / मिळालेली रक्कम'}</th>
              <th className="text-left p-2">Mode / पद्धत</th>
              <th className="text-left p-2">Status / स्थिती</th>
              <th className="text-left p-2">Date / दिनांक</th>
              {canConfirm && <th className="text-left p-2"></th>}
            </tr>
          </thead>
          <tbody>
            {confirmError && (
              <tr><td colSpan={canConfirm ? 7 : 6} className="p-2 text-sm text-red-600 bg-red-50">{confirmError}</td></tr>
            )}
            {receipts.map((r) => {
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
                  {canConfirm && (
                    <td className="p-2">
                      {r.status === 'TO_BE_CONFIRMED' && (
                        <button type="button" disabled={confirmingId === r.id} className="text-emerald-700 text-xs hover:underline disabled:opacity-50"
                          onClick={() => confirmReceipt(r.id)}>
                          {confirmingId === r.id ? 'Confirming... / पुष्टी करत आहे...' : 'Mark as Received / मिळाले म्हणून चिन्हांकित करा'}
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {receipts.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={canConfirm ? 7 : 6}>No payments yet. / अद्याप कोणतेही देयक नाही.</td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
