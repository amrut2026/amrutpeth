import { useEffect, useState } from 'react';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD'];

function formatMoney(value) {
  return `₹${Number(value || 0).toFixed(2)}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Prints exactly the sectioned/sub-grouped breakdown currently on screen
// for the active tab (built by buildPrintSections in the component below):
// each top-level section (e.g. "Sold by your retailers — payable to
// supplier") gets its own heading, and each of its groups (by supplier, or
// by retailer/payment) gets its own sub-heading with a subtotal — the same
// two-level structure as ItemsTable/RetailerOwedTable on screen, so the
// printout matches what's actually showing rather than one undifferentiated
// list. A retailer's own view still ends up as a single header-less
// section/group, same as it already renders as a single "Total" group on
// screen (see groupBySupplier).
function printItems(title, sections) {
  const allItems = sections.flatMap((s) => s.groups.flatMap((g) => g.items));
  const { quantity, amount } = sumItems(allItems);

  const sectionsHtml = sections.map((section) => {
    const groupsHtml = section.groups.map((g) => {
      const { quantity: gQty, amount: gAmount } = sumItems(g.items);
      const rows = g.items.map((i) => `
        <tr>
          <td>${i.saleId}</td>
          <td>${new Date(i.date).toLocaleDateString()}</td>
          <td>${escapeHtml(i.productName)}${i.remark ? `<div class="remark">${escapeHtml(i.remark)}</div>` : ''}</td>
          <td>${escapeHtml(i.batchName) || '-'}</td>
          <td>${i.quantity}</td>
          <td>${i.price != null ? formatMoney(i.price) : '-'}</td>
          <td>${formatMoney(i.amount)}</td>
        </tr>
      `).join('');
      return `
        <div class="group">
          <div class="group-header">
            <span>${escapeHtml(g.label)} (${g.items.length})</span>
            <span>${gQty} qty &middot; ${formatMoney(gAmount)}</span>
          </div>
          <table>
            <thead>
              <tr><th>Sale #</th><th>Date</th><th>Product</th><th>Batch</th><th>Qty</th><th>Rate owed</th><th>Amount</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');
    return `
      <section>
        ${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ''}
        ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ''}
        ${groupsHtml || '<div class="empty">Nothing here yet.</div>'}
      </section>
    `;
  }).join('');

  const html = `<!DOCTYPE html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: sans-serif; padding: 24px; color: #111; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
          h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          section:first-of-type h2 { margin-top: 0; }
          .note { font-size: 11px; color: #888; margin: -4px 0 8px; }
          .group { margin-bottom: 12px; }
          .group-header { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; background: #f3f4f6; padding: 4px 8px; border: 1px solid #ddd; border-bottom: none; }
          .empty { font-size: 12px; color: #999; padding: 6px 0 14px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
          th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; text-align: left; }
          th { background: #f3f4f6; }
          .remark { font-size: 10px; color: #b45309; margin-top: 2px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Printed ${new Date().toLocaleString()} &middot; ${allItems.length} item(s), qty ${quantity}, total ${formatMoney(amount)}</div>
        ${sectionsHtml}
      </body>
    </html>`;
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
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
  // DEALER only — which of the three Open-tab sections is showing. Shown
  // as tabs (rather than the sections stacked one after another) so only
  // one table is on screen at a time.
  const [openSubTab, setOpenSubTab] = useState('soldByRetailer');
  // DEALER only — same idea, for the Paid tab's three sections.
  const [paidSubTab, setPaidSubTab] = useState('soldByRetailer');
  // DEALER only — "Filter by Retailer" on the two Open-tab sections that
  // actually involve a retailer (soldByRetailer/retailerOwed — the direct
  // cash-sales section has no retailer to filter by). Default '' = All.
  const [soldByRetailerFilter, setSoldByRetailerFilter] = useState('');
  const [retailerOwedFilter, setRetailerOwedFilter] = useState('');
  // DEALER only — same "Filter by Retailer" idea, for the Pending tab's
  // "Retailer → Dealer — to be confirmed" section.
  const [pendingRetailerFilter, setPendingRetailerFilter] = useState('');
  // DEALER only — same idea, for the Paid tab's soldByRetailer/retailerPaid
  // sections (the direct cash-sales section again has no retailer to
  // filter by).
  const [soldByRetailerPaidFilter, setSoldByRetailerPaidFilter] = useState('');
  const [retailerPaidFilter, setRetailerPaidFilter] = useState('');
  const [suppliers, setSuppliers] = useState([]); // DEALER only
  const [supplierId, setSupplierId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [mode, setMode] = useState('CASH');
  const [reference, setReference] = useState('payment against sold products');
  const [paying, setPaying] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);
  const [error, setError] = useState('');
  const [voucherNote, setVoucherNote] = useState('');
  // DEALER only — set while the "adjust against outstanding vouchers?"
  // pop-up (see initiatePayment below) is open. Holds the oldest-first
  // OPEN/PARTIALLY_PAID PAYABLE vouchers for the chosen supplier, from GET
  // /vouchers/outstanding, so the pop-up can show what would be adjusted
  // before the user confirms.
  const [voucherPrompt, setVoucherPrompt] = useState(null);
  const [checkingVouchers, setCheckingVouchers] = useState(false);

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
  // group — unchanged from before. `key`/`label` are resolved here once so
  // ItemsTable and printItems (see buildPrintSections below) don't each
  // need their own copy of the "DEALER sees supplier name, RETAILER sees
  // 'Total'" rule.
  function groupBySupplier(items) {
    if (user.role !== 'DEALER') return [{ key: 'all', supplierId: null, supplierName: null, label: 'Total', items }];
    const map = new Map();
    for (const i of items) {
      const key = i.supplierId ?? 'none';
      if (!map.has(key)) {
        map.set(key, {
          key,
          supplierId: i.supplierId,
          supplierName: i.supplierName || 'Unknown supplier / अज्ञात पुरवठादार',
          items: [],
        });
      }
      map.get(key).items.push(i);
    }
    return [...map.values()]
      .map((g) => ({ ...g, label: g.supplierName }))
      .sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }

  // Same idea as groupBySupplier, for the retailer-owed lists (Owed to
  // you.../Retailer → Dealer.../Paid by retailers sections) — grouped by
  // the payment that settled them where one exists, or by retailer
  // otherwise. Used by both RetailerOwedTable below and printItems (via
  // buildPrintSections), so the two never drift apart. A RETAILER viewer
  // never sees this (they have no retailers of their own), so this always
  // falls back to the same single "Total" group as groupBySupplier.
  function groupRetailerOwed(items) {
    if (user.role !== 'DEALER') return groupBySupplier(items);
    const map = new Map();
    for (const i of items) {
      const key = i.paymentId != null ? `pay-${i.paymentId}` : `retailer-${i.retailerId}`;
      if (!map.has(key)) map.set(key, { key, paymentId: i.paymentId, retailerName: i.retailerName, items: [] });
      map.get(key).items.push(i);
    }
    return [...map.values()].map((g) => ({ ...g, label: g.retailerName || `Retailer #${g.key}` }));
  }

  // Options for the "Filter by Retailer" dropdowns on the Open tab's
  // soldByRetailer/retailerOwed sections — built from whichever retailers
  // actually appear in that section's own items, so the dropdown never
  // offers a retailer that couldn't show up in the list below it.
  function retailerFilterOptions(items) {
    return [...new Map(
      items.filter((i) => i.retailerId != null).map((i) => [String(i.retailerId), i.retailerName || `Retailer #${i.retailerId}`])
    ).entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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

  // Entry point for the "Pay Selected" button. For a DEALER, first checks
  // whether the chosen supplier has any OPEN/PARTIALLY_PAID PAYABLE
  // vouchers — if so, the FIFO-adjustment pop-up is shown (see
  // voucherPrompt) and pay() itself waits for that response instead of
  // running immediately. A RETAILER (who never carries a PAYABLE voucher
  // to adjust) always pays immediately, same as before.
  async function initiatePayment() {
    if (selected.size === 0 || paying) return;
    if (user.role === 'DEALER' && !supplierId) {
      setError('Choose a supplier to pay / भरणा करण्यासाठी पुरवठादार निवडा');
      return;
    }
    setError('');
    setVoucherNote('');

    if (user.role === 'DEALER') {
      setCheckingVouchers(true);
      try {
        const res = await api.get('/vouchers/outstanding', { params: { supplierId } });
        if (res.data.vouchers.length > 0) {
          setVoucherPrompt(res.data);
          setCheckingVouchers(false);
          return; // wait for the user's Adjust & Pay / Skip choice below
        }
      } catch (err) {
        // Outstanding-voucher check failing shouldn't block the payment
        // itself — just proceed without offering the adjustment.
      }
      setCheckingVouchers(false);
    }

    await pay(false);
  }

  async function pay(adjustVouchers) {
    setPaying(true);
    try {
      const res = await api.post('/sold-products/pay', {
        soldProductIds: [...selected],
        mode,
        reference: reference || undefined,
        supplierId: user.role === 'DEALER' ? supplierId : undefined,
        adjustVouchers: user.role === 'DEALER' ? !!adjustVouchers : undefined,
      });
      const touched = res.data?.voucherAdjustment?.touched;
      if (touched?.length) {
        const summary = touched.map((t) => `#${t.voucherId} (${t.newStatus === 'PAID' ? 'now Paid' : 'now Partially Paid'})`).join(', ');
        setVoucherNote(`Adjusted ${formatMoney(res.data.amount)} against voucher ${summary}.`);
      }
      setReference('payment against sold products');
      setVoucherPrompt(null);
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
      <div className="space-y-4 max-h-[70vh] lg:max-h-[calc(100vh-22rem)] overflow-y-auto">
        {groups.map((g) => {
          const groupSelectedCount = g.items.filter((i) => selected.has(i.id)).length;
          const { quantity: groupQty, amount: groupTotal } = sumItems(g.items);
          return (
            <div key={g.key} className="bg-white rounded shadow overflow-x-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
                <span className="text-sm font-medium">
                  {g.label}
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

  // Retailer-owed rows shown to a DEALER (what their retailers owe THEM),
  // across OPEN/TO_BE_CONFIRMED/PAID — see soldProducts.js GET / and
  // payableByMe. Grouped by the payment that settled them where one
  // exists (TO_BE_CONFIRMED/PAID — one retailer payment can cover several
  // rows at once), or by retailer otherwise (OPEN rows have no payment
  // yet). showConfirm only makes sense for the TO_BE_CONFIRMED tab — a
  // dealer can't confirm money that hasn't been submitted (OPEN) or has
  // already been confirmed (PAID).
  function RetailerOwedTable({ items, showConfirm }) {
    if (user.role !== 'DEALER') {
      return <ItemsTable items={items} selectable={false} />;
    }

    const groups = groupRetailerOwed(items);

    return (
      <div className="space-y-4 max-h-[70vh] lg:max-h-[calc(100vh-22rem)] overflow-y-auto">
        {groups.map((g) => {
          const { quantity: groupQty, amount: groupTotal } = sumItems(g.items);
          return (
            <div key={g.key} className="bg-white rounded shadow overflow-x-auto">
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
                <span className="text-sm font-medium">
                  {g.label} <span className="text-gray-400 font-normal">({g.items.length})</span>
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">
                    {groupQty} qty <span className="text-gray-400">/ प्रमाण</span> · {formatMoney(groupTotal)}
                  </span>
                  {showConfirm && g.paymentId != null && (
                    <button type="button" disabled={confirmingId === g.paymentId}
                      onClick={() => confirmPayment(g.paymentId)}
                      className="text-emerald-700 text-xs font-medium hover:underline disabled:opacity-50">
                      {confirmingId === g.paymentId ? 'Confirming... / पुष्टी करत आहे...' : 'Confirm Received / मिळाले म्हणून पुष्टी करा'}
                    </button>
                  )}
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

  // A DEALER's OPEN/PAID lists now also include their retailers' own rows
  // (see soldProducts.js GET / and payableByMe) — split so the payable
  // ItemsTable above only ever gets this viewer's own, selectable rows,
  // and the retailer-owed ones get their own read-only, retailer-grouped
  // section below it. Always an empty second half for a RETAILER, who
  // never sees anyone else's rows.
  const ownOpenItems = user.role === 'DEALER' ? openItems.filter((i) => i.payableByMe) : openItems;
  const retailerOpenItems = user.role === 'DEALER' ? openItems.filter((i) => !i.payableByMe) : [];
  const ownPaidItems = user.role === 'DEALER' ? paidItems.filter((i) => i.payableByMe) : paidItems;
  const retailerPaidItems = user.role === 'DEALER' ? paidItems.filter((i) => !i.payableByMe) : [];

  // A DEALER's own payable rows (payableByMe) are themselves two different
  // things, both owed to THEIR supplier and both selectable/payable the
  // same way (soldProducts.js POST /pay settles a mix of both in one
  // Payment) — but shown in their own sections so it's clear which is
  // which: units a retailer resold on this dealer's behalf (soldByRetailer
  // — see remark) vs cash this dealer took at their own counter.
  const soldByRetailerOpenItems = ownOpenItems.filter((i) => i.soldByRetailer);
  const directOpenItems = ownOpenItems.filter((i) => !i.soldByRetailer);
  const soldByRetailerPaidItems = ownPaidItems.filter((i) => i.soldByRetailer);
  const directPaidItems = ownPaidItems.filter((i) => !i.soldByRetailer);

  // Open tab only — soldByRetailerOpenItems/retailerOpenItems narrowed
  // down by whichever retailer is picked in that section's own "Filter by
  // Retailer" dropdown (soldByRetailerFilter/retailerOwedFilter above).
  // Used by both the on-screen table and buildPrintSections below, so
  // Print matches whatever's actually filtered on screen.
  const soldByRetailerOpenItemsFiltered = soldByRetailerFilter
    ? soldByRetailerOpenItems.filter((i) => String(i.retailerId) === soldByRetailerFilter)
    : soldByRetailerOpenItems;
  const retailerOpenItemsFiltered = retailerOwedFilter
    ? retailerOpenItems.filter((i) => String(i.retailerId) === retailerOwedFilter)
    : retailerOpenItems;

  // Pending tab only — same idea, for pendingRetailerFilter above. Used by
  // both the on-screen table and buildPrintSections, so Print matches
  // whatever's filtered on screen.
  const pendingItemsFiltered = pendingRetailerFilter
    ? pendingItems.filter((i) => String(i.retailerId) === pendingRetailerFilter)
    : pendingItems;

  // Paid tab only — same idea, for soldByRetailerPaidFilter/
  // retailerPaidFilter above.
  const soldByRetailerPaidItemsFiltered = soldByRetailerPaidFilter
    ? soldByRetailerPaidItems.filter((i) => String(i.retailerId) === soldByRetailerPaidFilter)
    : soldByRetailerPaidItems;
  const retailerPaidItemsFiltered = retailerPaidFilter
    ? retailerPaidItems.filter((i) => String(i.retailerId) === retailerPaidFilter)
    : retailerPaidItems;

  const TAB_LABELS = {
    open: 'Sold Products — Open / प्रलंबित',
    pending: 'Sold Products — To Be Confirmed / पुष्टीकरण प्रलंबित',
    paid: 'Sold Products — Paid / भरलेले',
  };
  const TAB_ITEMS = { open: openItems, pending: pendingItems, paid: paidItems };

  // Mirrors exactly what the tab below renders — same sections in the same
  // order, same sub-grouping (groupBySupplier/groupRetailerOwed) within
  // each — so Print never shows a different breakdown than the screen.
  // Keep this in sync with the JSX for each tab further down.
  function buildPrintSections() {
    if (user.role !== 'DEALER') {
      return [{ heading: null, groups: groupBySupplier(TAB_ITEMS[tab]) }];
    }
    // Open tab is now shown as three separate sub-tabs (see openSubTab) —
    // print only the one currently on screen, with the same retailer
    // filter applied, rather than all three stacked as before.
    if (tab === 'open') {
      if (openSubTab === 'direct') {
        return [{ heading: 'Your own cash sales — payable to supplier', groups: groupBySupplier(directOpenItems) }];
      }
      if (openSubTab === 'retailerOwed') {
        return [{
          heading: 'Owed to you by retailers — not yet paid',
          note: 'View only — your retailer has to pay this themselves.',
          groups: groupRetailerOwed(retailerOpenItemsFiltered),
        }];
      }
      return [{ heading: 'Sold by your retailers — payable to supplier', groups: groupBySupplier(soldByRetailerOpenItemsFiltered) }];
    }
    if (tab === 'pending') {
      return [{ heading: 'Retailer → Dealer — to be confirmed', groups: groupRetailerOwed(pendingItemsFiltered) }];
    }
    // paid — shown as three separate sub-tabs (see paidSubTab), same as
    // the Open tab — print only the one currently on screen.
    if (paidSubTab === 'direct') {
      return [{ heading: 'Your own cash sales — paid to supplier', groups: groupBySupplier(directPaidItems) }];
    }
    if (paidSubTab === 'retailerPaid') {
      return [{ heading: 'Paid by retailers', groups: groupRetailerOwed(retailerPaidItemsFiltered) }];
    }
    return [{ heading: 'Sold by your retailers — paid to supplier', groups: groupBySupplier(soldByRetailerPaidItemsFiltered) }];
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

        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
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
          <button type="button" onClick={() => printItems(TAB_LABELS[tab], buildPrintSections())}
            className="text-sm px-3 py-2 border rounded hover:bg-gray-50 whitespace-nowrap">
            Print / मुद्रित करा
          </button>
        </div>

        {tab === 'open' && (
          <>
            <TabTotals items={openItems} />
            {user.role === 'DEALER' ? (
              <>
                <div className="flex gap-1 mb-3 border-b overflow-x-auto">
                  {[
                    ['soldByRetailer', 'Sold by your retailers — payable to supplier', 'किरकोळ विक्रेत्यांनी विकलेले — पुरवठादाराला देय', soldByRetailerOpenItems.length],
                    ['direct', 'Your own cash sales — payable to supplier', 'स्वतःची रोख विक्री — पुरवठादाराला देय', directOpenItems.length],
                    ['retailerOwed', 'Owed to you by retailers — not yet paid', 'किरकोळ विक्रेत्यांकडून येणे — अद्याप न भरलेले', retailerOpenItems.length],
                  ].map(([key, label, labelMr, count]) => (
                    <button key={key} type="button" onClick={() => setOpenSubTab(key)}
                      className={`text-sm px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${
                        openSubTab === key
                          ? 'border-emerald-700 text-emerald-700 font-medium'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}>
                      {label} ({count})<span className="block text-xs font-normal">{labelMr}</span>
                    </button>
                  ))}
                </div>

                {openSubTab === 'soldByRetailer' && (
                  <>
                    <div className="flex justify-end mb-2">
                      <label className="text-xs text-gray-500 flex flex-col leading-tight">
                        <span>Filter by Retailer</span>
                        <span className="text-gray-400">किरकोळ विक्रेत्यानुसार फिल्टर करा</span>
                        <select className="border rounded px-2 py-1 text-sm mt-1"
                          value={soldByRetailerFilter}
                          onChange={(e) => setSoldByRetailerFilter(e.target.value)}>
                          <option value="">All Retailers / सर्व किरकोळ विक्रेते</option>
                          {retailerFilterOptions(soldByRetailerOpenItems).map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <ItemsTable items={soldByRetailerOpenItemsFiltered} selectable />
                  </>
                )}

                {openSubTab === 'direct' && (
                  <ItemsTable items={directOpenItems} selectable />
                )}

                {openSubTab === 'retailerOwed' && (
                  <>
                    <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
                      <p className="text-xs text-gray-400">View only — your retailer has to pay this themselves. / फक्त पाहण्यासाठी — हे तुमच्या किरकोळ विक्रेत्याला स्वतः भरावे लागेल.</p>
                      <label className="text-xs text-gray-500 flex flex-col leading-tight">
                        <span>Filter by Retailer</span>
                        <span className="text-gray-400">किरकोळ विक्रेत्यानुसार फिल्टर करा</span>
                        <select className="border rounded px-2 py-1 text-sm mt-1"
                          value={retailerOwedFilter}
                          onChange={(e) => setRetailerOwedFilter(e.target.value)}>
                          <option value="">All Retailers / सर्व किरकोळ विक्रेते</option>
                          {retailerFilterOptions(retailerOpenItems).map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <RetailerOwedTable items={retailerOpenItemsFiltered} showConfirm={false} />
                  </>
                )}
              </>
            ) : (
              <ItemsTable items={openItems} selectable />
            )}
          </>
        )}
        {tab === 'pending' && (
          <>
            <TabTotals items={pendingItems} />
            {user.role === 'DEALER' ? (
              <>
                <div className="flex items-start justify-between flex-wrap gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-gray-600">Retailer → Dealer — to be confirmed <span className="text-gray-400 font-normal">/ किरकोळ विक्रेता → डीलर — पुष्टीकरण प्रलंबित</span></h3>
                  <label className="text-xs text-gray-500 flex flex-col leading-tight">
                    <span>Filter by Retailer</span>
                    <span className="text-gray-400">किरकोळ विक्रेत्यानुसार फिल्टर करा</span>
                    <select className="border rounded px-2 py-1 text-sm mt-1"
                      value={pendingRetailerFilter}
                      onChange={(e) => setPendingRetailerFilter(e.target.value)}>
                      <option value="">All Retailers / सर्व किरकोळ विक्रेते</option>
                      {retailerFilterOptions(pendingItems).map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <RetailerOwedTable items={pendingItemsFiltered} showConfirm />
              </>
            ) : (
              <RetailerOwedTable items={pendingItems} showConfirm />
            )}
          </>
        )}
        {tab === 'paid' && (
          <>
            <TabTotals items={paidItems} />
            {user.role === 'DEALER' ? (
              <>
                <div className="flex gap-1 mb-3 border-b overflow-x-auto">
                  {[
                    ['soldByRetailer', 'Sold by your retailers — paid to supplier', 'किरकोळ विक्रेत्यांनी विकलेले — पुरवठादाराला भरले', soldByRetailerPaidItems.length],
                    ['direct', 'Your own cash sales — paid to supplier', 'स्वतःची रोख विक्री — पुरवठादाराला भरले', directPaidItems.length],
                    ['retailerPaid', 'Paid by retailers', 'किरकोळ विक्रेत्यांनी भरलेले', retailerPaidItems.length],
                  ].map(([key, label, labelMr, count]) => (
                    <button key={key} type="button" onClick={() => setPaidSubTab(key)}
                      className={`text-sm px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${
                        paidSubTab === key
                          ? 'border-emerald-700 text-emerald-700 font-medium'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}>
                      {label} ({count})<span className="block text-xs font-normal">{labelMr}</span>
                    </button>
                  ))}
                </div>

                {paidSubTab === 'soldByRetailer' && (
                  <>
                    <div className="flex justify-end mb-2">
                      <label className="text-xs text-gray-500 flex flex-col leading-tight">
                        <span>Filter by Retailer</span>
                        <span className="text-gray-400">किरकोळ विक्रेत्यानुसार फिल्टर करा</span>
                        <select className="border rounded px-2 py-1 text-sm mt-1"
                          value={soldByRetailerPaidFilter}
                          onChange={(e) => setSoldByRetailerPaidFilter(e.target.value)}>
                          <option value="">All Retailers / सर्व किरकोळ विक्रेते</option>
                          {retailerFilterOptions(soldByRetailerPaidItems).map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <ItemsTable items={soldByRetailerPaidItemsFiltered} selectable={false} />
                  </>
                )}

                {paidSubTab === 'direct' && (
                  <ItemsTable items={directPaidItems} selectable={false} />
                )}

                {paidSubTab === 'retailerPaid' && (
                  <>
                    <div className="flex justify-end mb-2">
                      <label className="text-xs text-gray-500 flex flex-col leading-tight">
                        <span>Filter by Retailer</span>
                        <span className="text-gray-400">किरकोळ विक्रेत्यानुसार फिल्टर करा</span>
                        <select className="border rounded px-2 py-1 text-sm mt-1"
                          value={retailerPaidFilter}
                          onChange={(e) => setRetailerPaidFilter(e.target.value)}>
                          <option value="">All Retailers / सर्व किरकोळ विक्रेते</option>
                          {retailerFilterOptions(retailerPaidItems).map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <RetailerOwedTable items={retailerPaidItemsFiltered} showConfirm={false} />
                  </>
                )}
              </>
            ) : (
              <ItemsTable items={paidItems} selectable={false} />
            )}
          </>
        )}
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
        {voucherNote && <p className="text-emerald-700 text-xs mb-2">{voucherNote}</p>}

        <button
          disabled={selected.size === 0 || paying || checkingVouchers || (user.role === 'DEALER' && !supplierId)}
          onClick={initiatePayment}
          className="w-full bg-emerald-700 text-white py-3 rounded font-semibold hover:bg-emerald-800 disabled:opacity-40">
          {paying ? 'Recording... / नोंदवत आहे...' : checkingVouchers ? 'Checking vouchers... / व्हाउचर तपासत आहे...' : 'Pay Selected / निवडलेल्यांचे पैसे भरा'}
        </button>

        {user.role === 'RETAILER' && (
          <p className="text-xs text-gray-400 mt-3">
            Your payment will show as "To be confirmed" until your dealer confirms it was received. / डीलरने पुष्टी करेपर्यंत तुमचे देयक "पुष्टीकरण प्रलंबित" असे दिसेल.
          </p>
        )}
      </div>

      {voucherPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded shadow-lg max-w-md w-full p-5">
            <h3 className="font-semibold text-base mb-1">
              Adjust against outstanding vouchers?
              <span className="block text-xs font-normal text-gray-400">थकीत व्हाउचर्सविरुद्ध समायोजित करायचे का?</span>
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              {suppliers.find((s) => String(s.id) === String(supplierId))?.name || 'This supplier'} has {formatMoney(voucherPrompt.totalOutstanding)} outstanding
              across {voucherPrompt.vouchers.length} voucher{voucherPrompt.vouchers.length === 1 ? '' : 's'}. This payment
              of {formatMoney(selectedTotal)} can be applied FIFO — oldest voucher first — against it before it's recorded.
            </p>
            <ul className="text-xs text-gray-600 mb-4 max-h-36 overflow-y-auto border rounded divide-y">
              {voucherPrompt.vouchers.map((v) => (
                <li key={v.id} className="px-2 py-1.5 flex justify-between gap-2">
                  <span>#{v.id} · {new Date(v.date).toLocaleDateString()} · {v.status === 'OPEN' ? 'Open' : 'Partially Paid'}</span>
                  <span className="font-medium whitespace-nowrap">{formatMoney(v.outstanding)}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={paying}
                onClick={() => { setVoucherPrompt(null); pay(false); }}
                className="px-3 py-2 text-sm rounded border hover:bg-gray-50 disabled:opacity-40">
                Skip / वगळा
              </button>
              <button
                type="button"
                disabled={paying}
                onClick={() => pay(true)}
                className="px-3 py-2 text-sm rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40">
                {paying ? 'Recording... / नोंदवत आहे...' : 'Adjust & Pay / समायोजित करा आणि भरा'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
