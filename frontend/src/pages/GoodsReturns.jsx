import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

// Same sizeWeight/flavour/brand join and Product cell Purchases.jsx uses,
// so a returned line looks identical to how it looks everywhere else in
// the app.
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

// Once a line has been decided (approvedQuantity set — even to 0, a full
// rejection), that's what actually moved money/inventory, so the total
// shown has to switch to it instead of the retailer's original request.
// Still-undecided lines (OPEN/IN_REVIEW, approvedQuantity null) fall back
// to the requested quantity, same as the detail table's own Qty column.
// Once a line has been decided (approvedQuantity set — even to 0, a full
// rejection), that's what actually moved money/inventory, so the total
// shown has to switch to it instead of the retailer's original request.
// Still-undecided lines (OPEN/IN_REVIEW, approvedQuantity null) fall back
// to the requested quantity, same as the detail table's own Qty column.
function returnTotal(gr) {
  return gr.items.reduce((sum, it) => {
    const qty = it.approvedQuantity ?? it.quantity;
    return sum + Number(it.rate || 0) * Number(qty || 0);
  }, 0);
}

function returnItemCount(gr) {
  return gr.items.length;
}

function returnRequestedQty(gr) {
  return gr.items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
}

// Every item's approvedQuantity is set together, in one PATCH /:id/status
// call, at CONFIRMED (see goodsReturns.js) — so it's never a mix of some
// decided and some not on the same return. Any item still null means the
// whole return hasn't been decided yet, so the sum itself is meaningless
// (not zero) until then.
function returnApprovedQty(gr) {
  if (gr.items.some((it) => it.approvedQuantity === null || it.approvedQuantity === undefined)) return null;
  return gr.items.reduce((sum, it) => sum + Number(it.approvedQuantity || 0), 0);
}

function voucherRemaining(v) {
  const paid = (v.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  return Number(v.amount) - paid;
}

// A DEALER returning to a supplier sees their own cost for the batch
// (Inventory.rate). A RETAILER returning to their dealer sees what THEY
// paid the dealer for it — Inventory.sellingPrice (the dealer's price TO
// the retailer, i.e. the retailer's own purchase price) — not
// retailerSellingPrice, which is the retailer's price to their own end
// customers and has nothing to do with what this return is credited at.
// purchases.js always populates sellingPrice and rate with the same
// number on a retailer-owned batch, so this also matches what
// goodsReturns.js actually settles the credit against (Inventory.rate).
function inventoryPrice(row, isDealer) {
  return Number(isDealer ? row.rate : row.sellingPrice) || 0;
}

function statusBadge(status) {
  if (status === 'CONFIRMED') return { text: 'Confirmed / पुष्टी झाली', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (status === 'IN_REVIEW') return { text: 'In Review / पुनरावलोकनात', className: 'bg-amber-50 text-amber-800 border-amber-200' };
  if (status === 'CANCELLED') return { text: 'Cancelled / रद्द केले', className: 'bg-red-50 text-red-700 border-red-200' };
  return { text: 'Open / उघडे', className: 'bg-gray-50 text-gray-600 border-gray-200' };
}

// Who a return is FOR/FROM, independent of which of the three lists it
// came from — used by both the sidebar table and the selected-return
// detail header.
function counterpartyNameFor(gr) {
  return gr.supplier?.name || gr.retailer?.name || gr.sourceDealer?.name || '—';
}

// Which direction a return went, based on gr.kind (set when the three
// return lists — own/toSupplier/fromRetailer — are merged into
// allReturns): a dealer's own return goes TO a supplier, a retailer's
// own return goes TO their dealer, and a dealer reviewing a retailer's
// return receives it FROM that retailer. Used on the printed receipt so
// it's explicit which party the goods moved to/from, not just a name.
function counterpartyLabelFor(gr) {
  if (gr.kind === 'toSupplier') return { en: 'Returned to Supplier', mr: 'पुरवठादाराला परत केले' };
  if (gr.kind === 'own') return { en: 'Returned to Dealer', mr: 'वितरकाला परत केले' };
  if (gr.kind === 'fromRetailer') return { en: 'Returned from Retailer', mr: 'किरकोळ विक्रेत्याकडून परत आले' };
  return { en: 'Party', mr: '' };
}

// Opens a formatted, print-ready receipt for a single goods return in a
// new tab and triggers the browser print dialog. Available regardless of
// the return's status — the current state (badge text) is printed on the
// receipt itself so it's clear from the printout alone.
function printReturnDetail(gr) {
  const badge = statusBadge(gr.status);
  const rows = gr.items.map((it) => {
    const details = productDetails(it.product);
    const approved = it.approvedQuantity !== null && it.approvedQuantity !== undefined ? it.approvedQuantity : '—';
    return `
      <tr>
        <td>${it.product?.name || '—'}${details ? `<div class="muted">${details}</div>` : ''}</td>
        <td>${it.batchName || '—'}</td>
        <td class="right">₹${Number(it.rate || 0).toFixed(2)}</td>
        <td class="right">${it.quantity}</td>
        <td class="right">${approved}</td>
      </tr>`;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Goods Return #${gr.id}</title>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
          h1 { font-size: 18px; margin: 0 0 4px; }
          .muted { color: #666; font-size: 11px; }
          .meta { margin-bottom: 16px; font-size: 13px; color: #444; }
          .badge { display: inline-block; padding: 2px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 12px; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
          th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
          .right { text-align: right; }
          tfoot td { font-weight: bold; border-top: 2px solid #333; }
        </style>
      </head>
      <body>
        <h1>Goods Return #${gr.id}</h1>
        <div class="meta">
          <div><span class="muted">${counterpartyLabelFor(gr).en}${counterpartyLabelFor(gr).mr ? ` / ${counterpartyLabelFor(gr).mr}` : ''}:</span> <strong>${counterpartyNameFor(gr)}</strong></div>
          ${new Date(gr.date).toLocaleString()}<br/>
          <span class="badge">${badge.text}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Batch</th>
              <th class="right">Cost Price</th>
              <th class="right">Qty</th>
              <th class="right">Approved Qty</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="4">Total</td>
              <td class="right">₹${returnTotal(gr).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </body>
    </html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// Prints whatever the "Expiring Soon" tab currently has on screen — no
// row selection needed, this is a plain reference sheet (not barcode
// labels), sized for a regular A4 printout via the browser's print
// dialog, same mechanism as printReturnDetail above. `rows` is exactly
// expiringPickerOptions as rendered, so the printout always matches what
// the user is looking at (same expiry window / category filter applied).
function printExpiringSoonList(rows, { supplierName, categoryName, windowText } = {}) {
  const tableRows = rows.map((row) => {
    const details = productDetails(row.product);
    return `
      <tr>
        <td>${row.product?.name || '—'}${details ? `<div class="muted">${details}</div>` : ''}</td>
        <td>${row.batchName || '—'}</td>
        <td class="right">${row.quantity}${row.rows && row.rows.length > 1 ? '*' : ''}</td>
        <td class="right">₹${Number(row.rate || 0).toFixed(2)}</td>
        <td>${row.expiryDate ? new Date(row.expiryDate).toLocaleDateString() : '—'}</td>
      </tr>`;
  }).join('');

  const hasCombined = rows.some((row) => row.rows && row.rows.length > 1);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Stock Expiring Soon</title>
        <meta charset="utf-8" />
        <style>
          @page { size: A4; margin: 16mm; }
          body { font-family: Arial, sans-serif; padding: 0; color: #111; }
          h1 { font-size: 18px; margin: 0 0 4px; }
          .muted { color: #666; font-size: 11px; }
          .meta { margin-bottom: 16px; font-size: 13px; color: #444; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px; }
          th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
          .right { text-align: right; }
          .footnote { font-size: 11px; color: #666; margin-top: 8px; }
        </style>
      </head>
      <body>
        <h1>Stock Expiring Soon</h1>
        <div class="meta">
          ${supplierName ? `<div><span class="muted">Supplier:</span> <strong>${supplierName}</strong></div>` : ''}
          ${categoryName ? `<div><span class="muted">Category:</span> <strong>${categoryName}</strong></div>` : ''}
          <div><span class="muted">Expiring within:</span> <strong>${windowText}</strong></div>
          <div class="muted">Generated ${new Date().toLocaleString()}</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Batch</th>
              <th class="right">Inventory Qty</th>
              <th class="right">Cost Price</th>
              <th>Expiry Date</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${hasCombined ? '<div class="footnote">* combined quantity across more than one purchase, same product and batch</div>' : ''}
      </body>
    </html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// The selected return's detail — counterparty, status/action, and item
// table. Also doubles as the row content shown once something is picked
// from the sidebar. editableApproval/approvals/notes only apply to a
// DEALER reviewing a retailer's still-IN_REVIEW return (see PATCH
// /:id/status in goodsReturns.js) — every other case is read-only.
function ReturnDetail({
  gr, action,
  editableApproval, approvals, onApprovalChange, notes, onNoteChange,
  editableQuantity, quantityEdits, onQuantityChange, quantityError, savingQuantities, onSaveQuantities,
}) {
  const badge = statusBadge(gr.status);
  return (
    <div className="bg-white p-4 rounded shadow space-y-3">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <div className="font-semibold">{counterpartyNameFor(gr)}</div>
          <div className="text-xs text-gray-400">
            {new Date(gr.date).toLocaleString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded border ${badge.className}`}>{badge.text}</span>
          <button type="button" onClick={() => printReturnDetail(gr)}
            className="text-xs bg-gray-50 text-gray-700 border border-gray-200 px-3 py-1.5 rounded hover:bg-gray-100">
            Print<span className="block">प्रिंट करा</span>
          </button>
          {action}
        </div>
      </div>
      {/* Same columns as the build form (Product / Batch / Cost Price /
          Qty), plus Approved Qty — populated immediately for a DEALER's own
          return (always auto-CONFIRMED, see goodsReturns.js POST /), null
          until CONFIRMED for a retailer-initiated one. Qty is a plain
          number here by default and only ever becomes an editable input
          when the viewer is the retailer who raised this return and it's
          still OPEN/IN_REVIEW (editableQuantity) — never at the same time
          editableApproval is (that's the DEALER reviewing the same return,
          a different viewer entirely). */}
      <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="text-left text-gray-400 text-xs">
            <th className="py-1 font-normal">Product / उत्पादन</th>
            <th className="py-1 font-normal">Batch / बॅच</th>
            <th className="py-1 font-normal text-right">Cost Price / खरेदी किंमत</th>
            <th className="py-1 font-normal">Voucher / व्हाउचर</th>
            <th className="py-1 font-normal text-right w-24">{editableQuantity ? 'Return Qty / परत प्रमाण' : 'Qty / प्रमाण'}</th>
            <th className="py-1 font-normal text-right w-24">Approved Qty / मंजूर प्रमाण</th>
          </tr>
        </thead>
        <tbody>
          {gr.items.map((it) => {
            const approvedValue = editableApproval ? (approvals?.[it.id] ?? it.quantity) : it.approvedQuantity;
            const differs = approvedValue !== null && approvedValue !== undefined && Number(approvedValue) !== it.quantity;
            return [
              <tr key={it.id} className="border-t">
                <td className="py-1.5"><ProductCell product={it.product} /></td>
                <td className="py-1.5 text-gray-500">{it.batchName || '—'}</td>
                <td className="py-1.5 text-right">₹{Number(it.rate).toFixed(2)}</td>
                <td className="py-1.5 text-gray-500">#{it.voucherId}</td>
                <td className="py-1.5 text-right">
                  {editableQuantity ? (
                    <input
                      type="number"
                      min="1"
                      className="border rounded px-2 py-1 w-20 text-right"
                      value={quantityEdits?.[it.id] ?? ''}
                      onChange={(e) => onQuantityChange(it.id, e.target.value)}
                    />
                  ) : it.quantity}
                </td>
                <td className="py-1.5 text-right">
                  {editableApproval ? (
                    <input
                      type="number"
                      min="0"
                      max={it.quantity}
                      className="border rounded px-2 py-1 w-20 text-right"
                      value={approvals?.[it.id] ?? it.quantity}
                      onChange={(e) => onApprovalChange(it.id, e.target.value)}
                    />
                  ) : (it.approvedQuantity ?? '—')}
                </td>
              </tr>,
              differs && (
                <tr key={`${it.id}-note`} className="bg-amber-50/50">
                  <td colSpan={6} className="px-1.5 pb-2">
                    {editableApproval ? (
                      <input
                        type="text"
                        placeholder="Note — required since approved qty differs from requested / टीप — आवश्यक"
                        className="border rounded px-2 py-1 text-xs w-full"
                        value={notes?.[it.id] || ''}
                        onChange={(e) => onNoteChange(it.id, e.target.value)}
                      />
                    ) : (
                      it.approvalNote && (
                        <div className="text-xs text-amber-700">Note: {it.approvalNote}</div>
                      )
                    )}
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
      </div>

      {editableQuantity && (
        <div className="pt-1">
          {quantityError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-2">{quantityError}</div>
          )}
          <button type="button" onClick={onSaveQuantities} disabled={savingQuantities}
            className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800 disabled:opacity-50">
            {savingQuantities ? 'Saving... / जतन करत आहे...' : 'Save Quantity Changes / प्रमाण बदल जतन करा'}
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-4 text-xs text-gray-500 mt-2 flex-wrap">
        <span>Items / वस्तू: <span className="font-medium text-gray-700">{returnItemCount(gr)}</span></span>
        <span>Requested Qty / मागितलेले प्रमाण: <span className="font-medium text-gray-700">{returnRequestedQty(gr)}</span></span>
        <span>Approved Qty / मंजूर प्रमाण: <span className="font-medium text-gray-700">{returnApprovedQty(gr) ?? '—'}</span></span>
      </div>
      <div className="text-right text-sm font-medium mt-1">Total: ₹{returnTotal(gr).toFixed(2)}</div>
    </div>
  );
}

export default function GoodsReturns() {
  const { user } = useAuth();
  const isDealer = user.role === 'DEALER';
  const [searchParams] = useSearchParams();
  // Guards the ?id= auto-select below to a single run per page load — see
  // the same guard in Purchases.jsx for why.
  const appliedIdParam = useRef(false);

  const [inventory, setInventory] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [myDealer, setMyDealer] = useState(null);
  const [supplierId, setSupplierId] = useState('');

  // Page-level tab: 'build' is the existing return-building/detail view,
  // 'expiring' is the new browse-by-expiry view (see renderExpiringSoonTab
  // below). Both share the same `items` cart, so switching tabs never
  // loses anything already added.
  const [pageTab, setPageTab] = useState('build');

  // The return being built, as a running list — same "pick a product, it's
  // added to the list, pick another, it's added too" pattern Sales.jsx's
  // cart uses, rather than one big always-shown inventory table to check
  // rows in. Each entry is { key, quantity, voucherId }: key identifies
  // WHICH row was picked (String(inventoryId) for a DEALER — one raw
  // Inventory row IS the line; the group key `${productId}::${batchName}`
  // for a RETAILER — see groupInventoryRows below, since a return line
  // still ties to exactly one Inventory row but purchases.js can leave
  // more than one row sharing the same product+batch). Selecting a
  // DIFFERENT product from the picker below never touches this list — it
  // only ever appends.
  const [items, setItems] = useState([]);
  // The picker <select>'s own value — always reset back to '' right after
  // an item is added, so the same control is ready to add the next one
  // rather than sitting on whatever was just picked.
  const [pickerValue, setPickerValue] = useState('');

  function addItem(key) {
    if (!key) return;
    setItems((prev) => [...prev, { key, quantity: '1', voucherId: '' }]);
    setPickerValue('');
  }
  // Clamps to the row/group's available quantity (availableRowsByKey,
  // defined further down but in scope by the time this runs, since it's
  // only ever called from an onChange after render) — typing more than
  // what's on hand snaps back to the max instead of accepting it.
  function updateItemQuantity(idx, value) {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const row = availableRowsByKey.get(it.key);
      const max = row ? row.quantity : undefined;
      const num = Number(value);
      const next = max !== undefined && Number.isFinite(num) && num > max ? String(max) : value;
      return { ...it, quantity: next };
    }));
  }
  function updateItemVoucher(idx, value) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, voucherId: value } : it)));
  }
  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Distinguishes "still fetching" from "fetched, and it's genuinely
  // empty" for both the inventory list and the supplier picker below —
  // without this, a failed request and a merely-empty result look
  // identical to the user (nothing rendered, no explanation).
  const [loading, setLoading] = useState(true);

  // DEALER only — the approved quantity/note the dealer is editing for
  // whichever retailer return is currently selected and still IN_REVIEW:
  // { [itemId]: value }. Reset whenever the selection changes (see
  // selectReturn below). Defaults to the retailer's own requested
  // quantity for any line that hasn't been touched.
  const [approvals, setApprovals] = useState({});
  const [approvalNotes, setApprovalNotes] = useState({});

  // RETAILER: their own returns to their dealer. DEALER: their own
  // returns to suppliers, plus every retailer's return TO them.
  const [ownReturns, setOwnReturns] = useState([]);
  const [retailerReturns, setRetailerReturns] = useState([]);

  // One combined, sortable list for the sidebar/selector below — a
  // DEALER needs both their own outgoing returns and every retailer's
  // incoming one in the same picker, tagged so the detail panel knows
  // which actions apply.
  const allReturns = [
    ...ownReturns.map((gr) => ({ ...gr, kind: isDealer ? 'toSupplier' : 'own' })),
    ...(isDealer ? retailerReturns.map((gr) => ({ ...gr, kind: 'fromRetailer' })) : []),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const [selectedReturnId, setSelectedReturnId] = useState('');
  const selectedReturn = allReturns.find((gr) => String(gr.id) === selectedReturnId) || null;

  // Inline "Return Qty" edits on the caller's own selected return, before
  // its CONFIRMED step ever touches inventory/voucher/payment (see
  // confirmReturn/confirmOwnReturn below). Same "quick correction before it
  // settles" window purchases.js offers via its own quantityEdits / PATCH
  // /:id/quantities. A RETAILER's own return (kind 'own') allows this
  // while OPEN or IN_REVIEW; a DEALER's own return to a supplier (kind
  // 'toSupplier') has no IN_REVIEW stage at all, so only while OPEN.
  const isSelectedReturnEditable = !!selectedReturn && (
    (selectedReturn.kind === 'own' && (selectedReturn.status === 'OPEN' || selectedReturn.status === 'IN_REVIEW'))
    || (selectedReturn.kind === 'toSupplier' && selectedReturn.status === 'OPEN')
  );
  const [returnQuantityEdits, setReturnQuantityEdits] = useState({});
  const [returnQuantityError, setReturnQuantityError] = useState('');
  const [savingReturnQuantities, setSavingReturnQuantities] = useState(false);

  // Reset the qty inputs to whatever's actually on the newly selected
  // return. Keyed only on the id, not on selectedReturn itself, so a
  // background load() refresh (e.g. after a sibling save) never clobbers
  // an in-progress edit on the row the user is looking at.
  useEffect(() => {
    if (!selectedReturn) { setReturnQuantityEdits({}); return; }
    const edits = {};
    selectedReturn.items.forEach((it) => { edits[it.id] = String(it.quantity); });
    setReturnQuantityEdits(edits);
    setReturnQuantityError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReturnId]);

  function setReturnQuantityEdit(itemId, value) {
    setReturnQuantityEdits((prev) => ({ ...prev, [itemId]: value }));
  }

  async function saveReturnQuantities() {
    if (!selectedReturn) return;
    setReturnQuantityError('');
    const items = selectedReturn.items.map((it) => ({ id: it.id, quantity: Number(returnQuantityEdits[it.id]) }));
    if (items.some((it) => !Number.isFinite(it.quantity) || it.quantity <= 0)) {
      setReturnQuantityError('Quantity must be a number greater than zero for every item / प्रत्येक वस्तूसाठी प्रमाण शून्यापेक्षा जास्त संख्या असावी');
      return;
    }
    setSavingReturnQuantities(true);
    try {
      await api.patch(`/goods-returns/${selectedReturn.id}/quantities`, { items });
      await load();
    } catch (err) {
      setReturnQuantityError(err.response?.data?.error || 'Failed to update quantity / प्रमाण अद्ययावत करण्यात अयशस्वी');
    } finally {
      setSavingReturnQuantities(false);
    }
  }

  // DEALER only — which direction of return the sidebar/selector is
  // currently showing. Requested as separate tabs rather than lumped
  // together, since a dealer's own outgoing returns to suppliers and every
  // retailer's incoming return to them are different workflows with
  // different actions.
  const [returnsTab, setReturnsTab] = useState('toSupplier');
  function switchReturnsTab(tab) {
    setReturnsTab(tab);
    const stillVisible = allReturns.some((gr) =>
      String(gr.id) === selectedReturnId && gr.kind === tab
      && (returnStatusTab === 'ALL' || gr.status === returnStatusTab)
    );
    if (!stillVisible) setSelectedReturnId('');
  }

  // DEALER only — same "Filter by Supplier" pattern Purchases.jsx uses in
  // its sidebar. Only meaningful on the "To Suppliers" tab — a
  // retailer-initiated return has no supplierId of its own (it's tied to
  // sourceDealerId instead).
  const [returnSupplierFilter, setReturnSupplierFilter] = useState('');

  // DEALER only — same idea as the supplier filter above, but for the
  // "From Retailers" tab. Options are built from whichever retailers
  // actually appear in retailerReturns (rather than a separate /retailers
  // call), so the dropdown always matches what could possibly show up in
  // the list below. Defaults to '' — "All Retailers".
  const [returnRetailerFilter, setReturnRetailerFilter] = useState('');
  const retailerFilterOptions = [...new Map(
    retailerReturns.filter((gr) => gr.retailer).map((gr) => [String(gr.retailerId), gr.retailer.name])
  ).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // Every status a goods return can be in, plus 'ALL' as the default —
  // shown as its own row of tabs (see statusTabs render below) rather than
  // a single combined list, so a long mixed-status history doesn't have to
  // be scanned/scrolled through to find e.g. just what's still IN_REVIEW.
  const STATUS_TABS = [
    { id: 'ALL', label: 'All', labelMr: 'सर्व' },
    { id: 'OPEN', label: 'Open', labelMr: 'उघडे' },
    { id: 'IN_REVIEW', label: 'In Review', labelMr: 'पुनरावलोकनात' },
    { id: 'CONFIRMED', label: 'Confirmed', labelMr: 'पुष्टी झाली' },
    { id: 'CANCELLED', label: 'Cancelled', labelMr: 'रद्द केले' },
  ];
  const [returnStatusTab, setReturnStatusTab] = useState('ALL');
  function switchReturnStatusTab(status) {
    setReturnStatusTab(status);
    const stillVisible = allReturns.some((gr) =>
      String(gr.id) === selectedReturnId
      && (!isDealer || gr.kind === returnsTab)
      && (status === 'ALL' || gr.status === status)
    );
    if (!stillVisible) setSelectedReturnId('');
  }

  const visibleReturns = allReturns
    .filter((gr) => !isDealer || gr.kind === returnsTab)
    .filter((gr) => !isDealer || returnsTab !== 'toSupplier' || !returnSupplierFilter || String(gr.supplierId) === returnSupplierFilter)
    .filter((gr) => !isDealer || returnsTab !== 'fromRetailer' || !returnRetailerFilter || String(gr.retailerId) === returnRetailerFilter)
    .filter((gr) => returnStatusTab === 'ALL' || gr.status === returnStatusTab);

  function selectReturn(gr) {
    setSelectedReturnId(String(gr.id));
    setApprovals({});
    setApprovalNotes({});
  }

  // Deep link from Reports > Downloads (?id=79) — switch to whichever
  // tab/status/filter combination actually shows that return, then select
  // it, once the combined return list has loaded.
  useEffect(() => {
    if (appliedIdParam.current) return;
    const id = searchParams.get('id');
    if (!id || allReturns.length === 0) return;
    const gr = allReturns.find((x) => String(x.id) === id);
    if (gr) {
      if (isDealer) {
        setReturnsTab(gr.kind);
        setReturnSupplierFilter('');
        setReturnRetailerFilter('');
      }
      setReturnStatusTab('ALL');
      selectReturn(gr);
    }
    appliedIdParam.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allReturns]);

  function startNewReturn() {
    setSelectedReturnId('');
    setApprovals({});
    setApprovalNotes({});
  }

  async function load() {
    setError('');
    setLoading(true);
    try {
      const calls = [api.get('/goods-returns'), api.get('/goods-returns/inventory'), api.get('/vouchers')];
      if (isDealer) calls.push(api.get('/suppliers'));
      else calls.push(api.get(`/retailers/${user.retailerId}`));

      // Promise.all on purpose still fails fast on the first rejection —
      // but now it's actually caught below instead of leaving inventory,
      // vouchers, suppliers, and returns all silently stuck at their
      // initial empty state with no indication anything went wrong.
      const results = await Promise.all(calls);
      const returnsData = results[0].data;
      setInventory(results[1].data.items);
      setVouchers(results[2].data.filter((v) => v.status !== 'PAID'));
      if (isDealer) {
        const supplierList = results[3].data;
        setSuppliers(supplierList);
        // A dealer dealing with only one supplier shouldn't have to pick
        // it just to see their own stock — auto-select it so the table
        // below renders immediately on entry, same as it always does for
        // a retailer.
        setSupplierId((prev) => prev || (supplierList.length === 1 ? String(supplierList[0].id) : ''));
        setOwnReturns(returnsData.supplierReturns || []);
        setRetailerReturns(returnsData.retailerReturns || []);
      } else {
        setMyDealer(results[3].data.dealer);
        setOwnReturns(returnsData.goodsReturns || []);
      }
    } catch (err) {
      console.error('Failed to load goods returns page:', err);
      setError(err.response?.data?.error || 'Failed to load goods returns data — please refresh / माहिती लोड करण्यात अयशस्वी — कृपया रिफ्रेश करा');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // RETAILER only — a return line still ties to exactly one raw Inventory
  // row (its own batch, its own snapshotted rate), but purchases.js can
  // leave more than one Inventory row sharing the same product+batch (a
  // batch restocked across separate purchases, etc.) — same product name,
  // flavour, sizeWeight, brand AND batch, just a different row. The picker
  // below offers ONE option per distinct product+batch, quantity summed
  // across whichever raw rows match. Picking it, then submitting, is
  // resolved back down to its underlying raw rows (see
  // allocateGroupQuantity below) — the API itself is unchanged, still one
  // inventoryId per line, all sharing whichever single voucher was chosen
  // for this product line.
  function groupInventoryRows(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = `${row.productId}::${row.batchName || ''}`;
      if (!map.has(key)) {
        map.set(key, {
          key, product: row.product, batchName: row.batchName, rate: row.rate,
          quantity: 0, approvedQuantity: 0, expiryDate: null,
          eligibleVoucherIds: new Set(), purchasedQuantityByVoucherId: {},
          rows: [],
        });
      }
      const g = map.get(key);
      g.quantity += row.quantity;
      g.approvedQuantity += row.approvedQuantity || 0;
      // Same product+batch should share one expiry in practice, but take
      // the earliest of whatever's actually on the underlying rows —
      // consistent with the FIFO (oldest-row-first) draw-down these groups
      // already do below, and it means the group never understates how
      // soon it needs attention.
      if (row.expiryDate) {
        if (!g.expiryDate || new Date(row.expiryDate) < new Date(g.expiryDate)) g.expiryDate = row.expiryDate;
      }
      // Every underlying raw row shares the same product+batch, so their
      // eligibleVoucherIds/purchasedQuantityByVoucherId (computed
      // server-side off that same key — see goodsReturns.js GET
      // /inventory) should already agree; union them defensively rather
      // than assume it.
      for (const vid of row.eligibleVoucherIds || []) g.eligibleVoucherIds.add(vid);
      for (const [vid, qty] of Object.entries(row.purchasedQuantityByVoucherId || {})) {
        g.purchasedQuantityByVoucherId[vid] = (g.purchasedQuantityByVoucherId[vid] || 0) + qty;
      }
      g.rows.push(row);
    }
    // Oldest first, so a return draws down the earliest-stocked batch rows
    // before newer ones (FIFO) when a quantity has to be split across more
    // than one underlying row.
    for (const g of map.values()) {
      g.rows.sort((a, b) => a.id - b.id);
      g.eligibleVoucherIds = [...g.eligibleVoucherIds];
    }
    return [...map.values()];
  }

  // Splits a summed row's requested return quantity back across its
  // underlying raw Inventory rows, capping each at what that specific row
  // actually still holds. If requestedQty exceeds the group's own total,
  // the excess is simply left unallocated (never over-submitted) — the
  // Return Qty input's max attribute already discourages that, this is
  // just the hard backstop.
  function allocateGroupQuantity(group, requestedQty) {
    let remaining = requestedQty;
    const allocations = [];
    for (const row of group.rows) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, row.quantity);
      if (take > 0) {
        allocations.push({ inventoryId: row.id, quantity: take });
        remaining -= take;
      }
    }
    return allocations;
  }

  // A DEALER's return, like a purchase, is scoped to one supplier at a
  // time — the picker below only ever shows that supplier's own stock and
  // vouchers. A RETAILER only ever has the one primary dealer, so nothing
  // to narrow down on their side.
  const eligibleInventory = isDealer
    ? inventory.filter((r) => String(r.product?.supplierId ?? '') === String(supplierId))
    : inventory;
  const eligibleVouchers = isDealer
    ? vouchers.filter((v) => v.type === 'PAYABLE' && String(v.supplierId) === String(supplierId))
    : vouchers;

  // RETAILER only — narrows the ADD-PRODUCT picker below down to one
  // category at a time (purely a picker aid — it never hides anything
  // already added to the list, since removing a product from the picker's
  // options never removes it from `items`). Built from the retailer's own
  // inventory rather than a separate /categories call, so it only ever
  // offers categories the retailer actually holds stock in (and could
  // therefore return). Replaces a per-PRODUCT filter — redundant now that
  // the Add Product picker below is itself a searchable/scrollable list of
  // every product, so narrowing it product-by-product added a step
  // instead of saving one; narrowing by category (a coarser grouping the
  // product list itself doesn't offer) is the filter actually worth
  // having alongside it.
  const [categoryFilter, setCategoryFilter] = useState('');
  const categoryOptions = !isDealer
    ? [...new Map(inventory.map((r) => [r.product?.categoryId, r.product?.category])).values()]
        .filter(Boolean)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    : [];

  // One shared shape for both roles — a DEALER's picker works off raw
  // Inventory rows (one row IS one line), a RETAILER's off product+batch
  // groups (see groupInventoryRows above) — normalized here to the same
  // `.key` field so the picker, the added-items table, and submitReturn
  // below don't need to branch on role at every point, only where the two
  // genuinely differ (how a key resolves back to {inventoryId, quantity}
  // pairs for the API).
  const availableRows = isDealer
    ? eligibleInventory.map((r) => ({ ...r, key: String(r.id) }))
    : groupInventoryRows(inventory);
  const availableRowsByKey = new Map(availableRows.map((r) => [r.key, r]));

  // The picker's own options — every row not already added to `items`
  // (picking the same batch/group twice would just create a second,
  // redundant line for it — better to fold that into raising the
  // quantity on the one line already there), narrowed further by
  // categoryFilter for a RETAILER.
  const usedKeys = new Set(items.map((it) => it.key));
  const pickerOptions = availableRows
    .filter((r) => !usedKeys.has(r.key))
    .filter((r) => !categoryFilter || String(r.product?.categoryId) === String(categoryFilter));

  const enteredTotal = items.reduce((sum, it) => {
    const row = availableRowsByKey.get(it.key);
    if (!row) return sum;
    const qty = Math.min(Number(it.quantity) || 0, row.quantity);
    return sum + qty * Number(row.rate || 0);
  }, 0);

  // Backs the page-level "Expiring Soon" tab (see renderExpiringSoonTab
  // below) — filters pickerOptions down to batches whose expiry falls
  // within the chosen window, so someone building a return for near-expiry
  // stock can find it directly instead of hunting for it in the full
  // "Add Product" dropdown on the Build Return tab.
  const [expiryFilterValue, setExpiryFilterValue] = useState('1');
  const [expiryFilterUnit, setExpiryFilterUnit] = useState('weeks');

  // Today + the entered value/unit — the default (1, weeks) means "expiring
  // any time between now and 7 days from now". 'months' uses setMonth so
  // "1 month" tracks the actual next-month date rather than a flat
  // 30-day approximation.
  function expiryThresholdDate() {
    const n = Number(expiryFilterValue);
    const amount = Number.isFinite(n) && n > 0 ? n : 1;
    const d = new Date();
    if (expiryFilterUnit === 'days') d.setDate(d.getDate() + amount);
    else if (expiryFilterUnit === 'months') d.setMonth(d.getMonth() + amount);
    else d.setDate(d.getDate() + amount * 7);
    return d;
  }

  // No lower bound on purpose — a batch that's already past its expiry
  // needs returning even more urgently than one merely approaching it, so
  // it stays in this list rather than dropping out the moment it expires.
  const expiryThreshold = expiryThresholdDate();
  const expiringPickerOptions = pickerOptions
    .filter((row) => row.expiryDate && new Date(row.expiryDate) <= expiryThreshold)
    .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));

  // Shared by both the dealer and retailer "Add Product" sections below —
  // pickerOptions is already role-normalized, so this doesn't need to
  // branch on role.
  function renderAddProductSection() {
    return (
      <div>
        <label className="text-xs text-gray-500 flex flex-col leading-tight mb-1">
          <span>Add Product</span>
          <span className="text-orange-700">उत्पादन जोडा</span>
        </label>
        {pickerOptions.length === 0 ? (
          <div className="text-sm text-gray-400 italic">No matching stock available to return / जुळणारा साठा उपलब्ध नाही</div>
        ) : (
          <select
            className="border rounded px-2 py-1.5 text-sm w-full md:w-96"
            value={pickerValue}
            onChange={(e) => addItem(e.target.value)}
          >
            <option value="">Select product to add... / जोडण्यासाठी उत्पादन निवडा...</option>
            {pickerOptions.map((row) => (
              <option key={row.key} value={row.key}>
                {row.product?.name}{productDetails(row.product) ? ` — ${productDetails(row.product)}` : ''}
                {row.batchName ? ` (Batch: ${row.batchName})` : ''} · Qty {row.quantity}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  // Page-level tab: browse/filter batches by expiry and add straight into
  // the same `items` cart the Build Return tab's table shows — switching
  // tabs never clears `items`, so anything added here is already sitting
  // in the cart when the user switches back to finish the return.
  function renderExpiringSoonTab() {
    return (
      <div className="bg-white p-4 rounded shadow space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">
            Expiring Soon
            <span className="text-sm font-normal text-gray-500 ml-2">(लवकर एक्सपायर होणारे)</span>
          </h2>
          {expiringPickerOptions.length > 0 && (
            <button type="button"
              onClick={() => printExpiringSoonList(expiringPickerOptions, {
                supplierName: isDealer ? suppliers.find((s) => String(s.id) === String(supplierId))?.name : undefined,
                categoryName: !isDealer ? categoryOptions.find((c) => String(c.id) === String(categoryFilter))?.name : undefined,
                windowText: `${expiryFilterValue} ${expiryFilterUnit}`,
              })}
              className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800">
              Print<span className="block text-[10px] font-normal">प्रिंट करा</span>
            </button>
          )}
        </div>

        {isDealer && (
          <div>
            <label className="text-xs text-gray-500 flex flex-col leading-tight mb-1">
              <span>Supplier</span>
              <span className="text-orange-700">पुरवठादार</span>
            </label>
            {loading ? (
              <div className="text-sm text-gray-400 italic">Loading... / लोड होत आहे...</div>
            ) : suppliers.length === 0 ? (
              <div className="text-sm text-gray-400 italic">No suppliers set up yet / अद्याप कोणतेही पुरवठादार जोडलेले नाहीत</div>
            ) : (
              <select
                className="border rounded px-2 py-1.5 text-sm w-64"
                value={supplierId}
                onChange={(e) => { setSupplierId(e.target.value); setItems([]); setPickerValue(''); }}
              >
                <option value="">Select supplier / पुरवठादार निवडा</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
        )}

        {isDealer && !supplierId ? (
          <div className="text-sm text-gray-400 italic">Select a supplier above to see stock expiring soon / लवकर एक्सपायर होणारा साठा पाहण्यासाठी वरील पुरवठादार निवडा</div>
        ) : (
          <>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Expiring within</span>
                <input
                  type="number"
                  min="1"
                  className="border rounded px-2 py-1 text-sm w-16"
                  value={expiryFilterValue}
                  onChange={(e) => setExpiryFilterValue(e.target.value)}
                />
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={expiryFilterUnit}
                  onChange={(e) => setExpiryFilterUnit(e.target.value)}
                >
                  <option value="days">Day/s</option>
                  <option value="weeks">Week/s</option>
                  <option value="months">Month/s</option>
                </select>
                <span className="text-xs text-orange-700">एक्सपायरी मुदत</span>
              </div>

              {!isDealer && categoryOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 flex flex-col leading-tight">
                    <span>Filter by Category</span>
                    <span className="text-orange-700">श्रेणीनुसार फिल्टर करा</span>
                  </label>
                  <select
                    className="border rounded px-2 py-1.5 text-sm"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="">All Categories / सर्व श्रेणी</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {expiringPickerOptions.length === 0 ? (
              <div className="text-sm text-gray-400 italic">No stock expiring in this period / या कालावधीत एक्सपायर होणारा साठा नाही</div>
            ) : (
              <div className="max-h-[65vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2">Product / उत्पादन</th>
                      <th className="py-2">Batch / बॅच</th>
                      <th className="py-2 text-right">Inventory Qty / साठा प्रमाण</th>
                      <th className="py-2 text-right">Cost Price / खरेदी किंमत</th>
                      <th className="py-2">Expiry Date / एक्सपायरी दिनांक</th>
                      <th className="py-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiringPickerOptions.map((row) => (
                      <tr key={row.key} className="border-b last:border-0 align-top">
                        <td className="py-2"><ProductCell product={row.product} /></td>
                        <td className="py-2 text-gray-500">{row.batchName || '—'}</td>
                        <td className="py-2 text-right">{row.quantity}{row.rows && row.rows.length > 1 && '*'}</td>
                        <td className="py-2 text-right">₹{Number(row.rate || 0).toFixed(2)}</td>
                        <td className="py-2 text-amber-700">{new Date(row.expiryDate).toLocaleDateString()}</td>
                        <td className="py-2 text-right">
                          <button type="button" onClick={() => addItem(row.key)}
                            className="text-xs bg-emerald-700 text-white px-2 py-1 rounded hover:bg-emerald-800">
                            Add
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {expiringPickerOptions.some((row) => row.rows && row.rows.length > 1) && (
                  <div className="text-xs text-gray-400 mt-1">* combined quantity across more than one purchase, same product and batch / * एकाच उत्पादनाच्या आणि बॅचच्या अनेक खरेदींमधील एकत्रित प्रमाण</div>
                )}
              </div>
            )}

            {items.length > 0 && (
              <div className="text-xs text-gray-500 border-t pt-2">
                {items.length} product{items.length > 1 ? 's' : ''} in your return so far — switch to the Build Return tab to set quantities and submit. / तुमच्या परतीमध्ये आतापर्यंत {items.length} उत्पादने आहेत — प्रमाण सेट करण्यासाठी आणि सादर करण्यासाठी "परत तयार करा" टॅबवर जा.
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  async function submitReturn() {
    setError('');
    if (isDealer && !supplierId) {
      setError('Select a supplier / पुरवठादार निवडा');
      return;
    }
    if (!items.length) {
      setError('Add at least one product to return / परत करण्यासाठी किमान एक उत्पादन जोडा');
      return;
    }
    if (items.some((it) => !it.quantity || Number(it.quantity) <= 0)) {
      setError('Enter a quantity to return for every product added / जोडलेल्या प्रत्येक उत्पादनासाठी परतीचे प्रमाण भरा');
      return;
    }
    if (items.some((it) => !it.voucherId)) {
      setError('Select a voucher for every product being returned / परत केल्या जाणाऱ्या प्रत्येक उत्पादनासाठी व्हाउचर निवडा');
      return;
    }

    // DEALER: each item's key IS the raw inventoryId already.
    // RETAILER: each item's key is a product+batch group — resolved back
    // down to one or more underlying {inventoryId, quantity} lines here,
    // since the API itself still only ever accepts a single inventoryId
    // per line (see allocateGroupQuantity above); every raw row split out
    // of the same group shares that group's one chosen voucher.
    const payloadItems = isDealer
      ? items.map((it) => ({
          inventoryId: Number(it.key),
          quantity: Number(it.quantity),
          voucherId: Number(it.voucherId),
        }))
      : items.flatMap((it) => {
          const g = availableRowsByKey.get(it.key);
          if (!g) return [];
          return allocateGroupQuantity(g, Number(it.quantity)).map((line) => ({ ...line, voucherId: Number(it.voucherId) }));
        });

    if (!payloadItems.length) {
      setError('Add at least one product to return / परत करण्यासाठी किमान एक उत्पादन जोडा');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/goods-returns', {
        supplierId: isDealer ? Number(supplierId) : undefined,
        items: payloadItems,
      });
      setItems([]);
      setPickerValue('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to record return / परत नोंदवण्यात अयशस्वी');
    } finally {
      setSubmitting(false);
    }
  }


  async function markForReview(id) {
    try {
      await api.patch(`/goods-returns/${id}/status`, { status: 'IN_REVIEW' });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed / अयशस्वी');
    }
  }

  // Cancels a return the caller owns while it's still OPEN (or, for a
  // RETAILER's own return, also IN_REVIEW). Nothing to reverse either way
  // (inventory/voucher are only ever touched at CONFIRMED — see
  // confirmReturn/confirmOwnReturn below), so this is a dead-end status
  // flip, same as Purchases.jsx's own cancelPurchase.
  async function cancelReturn(id) {
    if (!window.confirm('Cancel this return? This cannot be undone. / हे परत रद्द करायचे? हे पूर्ववत करता येणार नाही.')) {
      return;
    }
    try {
      await api.patch(`/goods-returns/${id}/status`, { status: 'CANCELLED' });
      startNewReturn();
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel return / परत रद्द करण्यात अयशस्वी');
    }
  }

  async function confirmReturn(gr) {
    const items = gr.items.map((it) => {
      const approvedQuantity = approvals[it.id] !== undefined && approvals[it.id] !== ''
        // Untouched line defaults to the retailer's own requested quantity
        // — the dealer only needs to edit lines they're partially approving.
        ? Number(approvals[it.id])
        : it.quantity;
      return { id: it.id, approvedQuantity, note: (approvalNotes[it.id] || '').trim() };
    });

    const missingNote = items.find((i) => i.approvedQuantity !== gr.items.find((it) => it.id === i.id).quantity && !i.note);
    if (missingNote) {
      setError('A note is required for every line whose approved quantity differs from what was requested / विनंती केलेल्या आणि मंजूर प्रमाणात फरक असल्यास टीप आवश्यक आहे');
      return;
    }

    if (!window.confirm(
      'Confirm the approved quantities below? This will update inventory and credit the retailer. / ' +
      'खालील मंजूर प्रमाणाची पुष्टी करायची? यामुळे साठा अद्ययावत होईल आणि किरकोळ विक्रेत्याला जमा होईल.'
    )) return;

    try {
      await api.patch(`/goods-returns/${gr.id}/status`, { status: 'CONFIRMED', items });
      startNewReturn();
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to confirm / पुष्टी करण्यात अयशस्वी');
    }
  }

  // DEALER only — confirms their OWN return to a supplier. Unlike
  // confirmReturn above (a DEALER reviewing a RETAILER's return, which can
  // be partially approved per line), there's no separate party's request
  // to second-guess here, so this just confirms in full — no items payload
  // needed, the backend defaults every line to its full requested quantity
  // when none is sent.
  async function confirmOwnReturn(gr) {
    if (!window.confirm(
      'Confirm this return? This will update your inventory and record the payment to the supplier. / ' +
      'हे परत निश्चित करायचे? यामुळे तुमचा साठा अद्ययावत होईल आणि पुरवठादाराला देयक नोंदवले जाईल.'
    )) return;

    try {
      await api.patch(`/goods-returns/${gr.id}/status`, { status: 'CONFIRMED' });
      startNewReturn();
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to confirm / पुष्टी करण्यात अयशस्वी');
    }
  }

  // Sidebar list — same styling/behaviour as Purchases.jsx's Recent
  // Purchases table: scrollable, sticky header, clicking a row loads that
  // return into the detail panel. Respects the same tab/supplier filter as
  // the View Return dropdown, for a DEALER.
  function renderReturnsTable() {
    const counterpartyLabel = !isDealer ? 'Dealer' : (returnsTab === 'toSupplier' ? 'Supplier' : 'Retailer');
    const counterpartyLabelMr = !isDealer ? 'वितरक' : (returnsTab === 'toSupplier' ? 'पुरवठादार' : 'किरकोळ विक्रेता');
    return (
      <div className="bg-white rounded shadow overflow-x-auto lg:max-h-[calc(100vh-20rem)] lg:overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 sticky top-0">
            <tr>
              <th className="text-left p-2">#</th>
              <th className="text-left p-2">Date <span className="text-gray-400 font-normal">/ दिनांक</span></th>
              <th className="text-left p-2">{counterpartyLabel} <span className="text-gray-400 font-normal">/ {counterpartyLabelMr}</span></th>
              <th className="text-left p-2">Status <span className="text-gray-400 font-normal">/ स्थिती</span></th>
              <th className="text-left p-2">Total <span className="text-gray-400 font-normal">/ एकूण</span></th>
            </tr>
          </thead>
          <tbody>
            {visibleReturns.map((gr) => {
              const isActive = String(gr.id) === selectedReturnId;
              const badge = statusBadge(gr.status);
              return (
                <tr key={`${gr.kind}-${gr.id}`}
                  className={`border-t cursor-pointer hover:bg-gray-50 ${isActive ? 'bg-emerald-50' : ''}`}
                  onClick={() => selectReturn(gr)}>
                  <td className="p-2">{gr.id}</td>
                  <td className="p-2">{new Date(gr.date).toLocaleDateString()}</td>
                  <td className="p-2">{counterpartyNameFor(gr)}</td>
                  <td className="p-2">
                    <span className={`text-xs px-2 py-1 rounded border ${badge.className}`}>{badge.text.split(' / ')[0]}</span>
                  </td>
                  <td className="p-2">₹{returnTotal(gr).toFixed(2)}</td>
                </tr>
              );
            })}
            {visibleReturns.length === 0 && (
              <tr><td className="p-3 text-gray-400" colSpan={5}>No returns yet. / अद्याप कोणतीही परत नाही.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Goods Returned</h1>
        <p className="text-sm text-orange-700">मालाची परत</p>
      </div>

      <div className="flex border-b mb-4">
        <button type="button" onClick={() => setPageTab('build')}
          className={`text-sm px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${
            pageTab === 'build'
              ? 'border-emerald-700 text-emerald-700 font-medium'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          Build Return{items.length > 0 ? ` (${items.length})` : ''}<span className="block text-xs font-normal">परत तयार करा</span>
        </button>
        <button type="button" onClick={() => setPageTab('expiring')}
          className={`text-sm px-3 py-2 border-b-2 -mb-px whitespace-nowrap ${
            pageTab === 'expiring'
              ? 'border-emerald-700 text-emerald-700 font-medium'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}>
          Expiring Soon<span className="block text-xs font-normal">लवकर एक्सपायर होणारे</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>
      )}

      {pageTab === 'expiring' ? (
        renderExpiringSoonTab()
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          {selectedReturn && (
            <div className="flex justify-end mb-2">
              <button type="button" onClick={startNewReturn}
                className="text-sm bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800">
                + New Return
              </button>
            </div>
          )}

          {selectedReturn ? (
            <ReturnDetail
              gr={selectedReturn}
              editableApproval={selectedReturn.kind === 'fromRetailer' && selectedReturn.status === 'IN_REVIEW'}
              approvals={approvals}
              onApprovalChange={(itemId, val) => setApprovals((prev) => ({ ...prev, [itemId]: val }))}
              notes={approvalNotes}
              onNoteChange={(itemId, val) => setApprovalNotes((prev) => ({ ...prev, [itemId]: val }))}
              editableQuantity={isSelectedReturnEditable}
              quantityEdits={returnQuantityEdits}
              onQuantityChange={setReturnQuantityEdit}
              quantityError={returnQuantityError}
              savingQuantities={savingReturnQuantities}
              onSaveQuantities={saveReturnQuantities}
              action={
                selectedReturn.kind === 'own' && (selectedReturn.status === 'OPEN' || selectedReturn.status === 'IN_REVIEW') ? (
                  <div className="flex items-center gap-2">
                    {selectedReturn.status === 'OPEN' && (
                      <button type="button" onClick={() => markForReview(selectedReturn.id)}
                        className="text-xs bg-amber-100 text-amber-800 px-3 py-1.5 rounded hover:bg-amber-200">
                        Mark for Review<span className="block">पुनरावलोकनासाठी चिन्हांकित करा</span>
                      </button>
                    )}
                    <button type="button" onClick={() => cancelReturn(selectedReturn.id)}
                      className="text-xs bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded hover:bg-red-100">
                      Cancel Return<span className="block">परत रद्द करा</span>
                    </button>
                  </div>
                ) : selectedReturn.kind === 'toSupplier' && selectedReturn.status === 'OPEN' ? (
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => cancelReturn(selectedReturn.id)}
                      className="text-xs bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded hover:bg-red-100">
                      Cancel Return<span className="block">परत रद्द करा</span>
                    </button>
                    <button type="button" onClick={() => confirmOwnReturn(selectedReturn)}
                      className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800">
                      Confirm Return<span className="block">परत निश्चित करा</span>
                    </button>
                  </div>
                ) : selectedReturn.kind === 'fromRetailer' && selectedReturn.status === 'IN_REVIEW' ? (
                  <button type="button" onClick={() => confirmReturn(selectedReturn)}
                    className="text-xs bg-emerald-700 text-white px-3 py-1.5 rounded hover:bg-emerald-800">
                    Confirm Receipt<span className="block">पावतीची पुष्टी करा</span>
                  </button>
                ) : null
              }
            />
          ) : (
            <div className="bg-white p-4 rounded shadow space-y-4">
              <h2 className="text-lg font-semibold">
                {isDealer ? 'Return to Supplier' : 'Return to Dealer'}
                <span className="text-sm font-normal text-gray-500 ml-2">
                  ({isDealer ? 'पुरवठादाराला परत करा' : 'वितरकाला परत करा'})
                </span>
              </h2>

              {isDealer ? (
                <>
                  <div>
                    <label className="text-xs text-gray-500 flex flex-col leading-tight mb-1">
                      <span>Supplier</span>
                      <span className="text-orange-700">पुरवठादार</span>
                    </label>
                    {loading ? (
                      <div className="text-sm text-gray-400 italic">Loading... / लोड होत आहे...</div>
                    ) : suppliers.length === 0 ? (
                      <div className="text-sm text-gray-400 italic">No suppliers set up yet / अद्याप कोणतेही पुरवठादार जोडलेले नाहीत</div>
                    ) : (
                      <select
                        className="border rounded px-2 py-1.5 text-sm w-64"
                        value={supplierId}
                        onChange={(e) => { setSupplierId(e.target.value); setItems([]); setPickerValue(''); }}
                      >
                        <option value="">Select supplier / पुरवठादार निवडा</option>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </div>

                  {!loading && !supplierId && suppliers.length > 1 && (
                    <div className="text-sm text-gray-400 italic">Select a supplier above to see your stock available to return / तुमचा साठा पाहण्यासाठी वरील पुरवठादार निवडा</div>
                  )}

                  {supplierId && (
                    eligibleInventory.length === 0 ? (
                      <div className="text-sm text-gray-400 italic">No stock available to return / परत करण्यासाठी साठा उपलब्ध नाही</div>
                    ) : (
                      <>
                        {renderAddProductSection()}

                        {items.length === 0 ? (
                          <div className="text-sm text-gray-400 italic">No products added yet — pick one above to start building the return / अद्याप कोणतेही उत्पादन जोडलेले नाही — परत तयार करण्यासाठी वरील निवडा</div>
                        ) : (
                          <div className="max-h-[60vh] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white">
                              <tr className="text-left text-gray-500 border-b">
                                <th className="py-2">Product / उत्पादन</th>
                                <th className="py-2">Batch / बॅच</th>
                                <th className="py-2 text-right">Inventory Qty / साठा प्रमाण</th>
                                <th className="py-2 text-right">Cost Price / खरेदी किंमत</th>
                                <th className="py-2 text-right w-28">Return Qty / परत प्रमाण</th>
                                <th className="py-2 w-64">Voucher to credit / कोणत्या व्हाउचरवर जमा करायचे</th>
                                <th className="py-2 w-8"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((it, idx) => {
                                const row = availableRowsByKey.get(it.key);
                                if (!row) return null;
                                const rowVouchers = eligibleVouchers.filter((v) => (row.eligibleVoucherIds || []).includes(v.id));
                                const chosenPurchasedQty = it.voucherId ? row.purchasedQuantityByVoucherId?.[it.voucherId] : undefined;
                                return (
                                  <tr key={it.key} className="border-b last:border-0 align-top">
                                    <td className="py-2"><ProductCell product={row.product} /></td>
                                    <td className="py-2 text-gray-500">{row.batchName || '—'}</td>
                                    <td className="py-2 text-right">{row.quantity}</td>
                                    <td className="py-2 text-right">₹{inventoryPrice(row, isDealer).toFixed(2)}</td>
                                    <td className="py-2 text-right">
                                      <input
                                        type="number"
                                        min="1"
                                        max={row.quantity}
                                        className="border rounded px-2 py-1 w-24 text-right"
                                        value={it.quantity}
                                        onChange={(e) => updateItemQuantity(idx, e.target.value)}
                                      />
                                    </td>
                                    <td className="py-2">
                                      {rowVouchers.length === 0 ? (
                                        <div className="text-xs text-gray-400 italic">No open voucher for this product / या उत्पादनासाठी उघडे व्हाउचर नाही</div>
                                      ) : (
                                        <select
                                          className="border rounded px-2 py-1 text-xs w-full"
                                          value={it.voucherId}
                                          onChange={(e) => updateItemVoucher(idx, e.target.value)}
                                        >
                                          <option value="">Select voucher... / व्हाउचर निवडा...</option>
                                          {rowVouchers.map((v) => (
                                            <option key={v.id} value={v.id}>
                                              #{v.id} · ₹{voucherRemaining(v).toFixed(2)} remaining
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                      {it.voucherId && chosenPurchasedQty === undefined && (
                                        <div className="text-[10px] text-amber-600 mt-0.5">Couldn't match this voucher to a specific purchase / हे व्हाउचर विशिष्ट खरेदीशी जुळवता आले नाही</div>
                                      )}
                                      {it.voucherId && chosenPurchasedQty !== undefined && (
                                        <div className="text-[10px] text-gray-400 mt-0.5">Purchased qty / खरेदी प्रमाण: {chosenPurchasedQty}</div>
                                      )}
                                    </td>
                                    <td className="py-2 text-right">
                                      <button type="button" onClick={() => removeItem(idx)}
                                        className="text-gray-400 hover:text-red-600 text-xs" title="Remove / काढा">✕</button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </>
                    )
                  )}
                </>
              ) : (
                <>
                  {myDealer && (
                    <div className="text-sm text-gray-600">
                      Returning to: <span className="font-medium">{myDealer.name}</span>
                      <span className="text-gray-400"> (तुमचा वितरक)</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-xs text-gray-500 flex flex-col leading-tight">
                      <span>Filter by Category</span>
                      <span className="text-orange-700">श्रेणीनुसार फिल्टर करा</span>
                    </label>
                    <select
                      className="border rounded px-2 py-1.5 text-sm"
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                      <option value="">All Categories / सर्व श्रेणी</option>
                      {categoryOptions.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  {loading ? (
                    <div className="text-sm text-gray-400 italic">Loading... / लोड होत आहे...</div>
                  ) : (
                    <>
                      {renderAddProductSection()}

                      {items.length === 0 ? (
                        <div className="text-sm text-gray-400 italic">No products added yet — pick one above to start building the return / अद्याप कोणतेही उत्पादन जोडलेले नाही — परत तयार करण्यासाठी वरील निवडा</div>
                      ) : (
                        <>
                          <div className="max-h-[60vh] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white">
                              <tr className="text-left text-gray-500 border-b">
                                <th className="py-2">Product / उत्पादन</th>
                                <th className="py-2">Batch / बॅच</th>
                                <th className="py-2 text-right">Inventory Qty / साठा प्रमाण</th>
                                <th className="py-2 text-right">Cost Price / खरेदी किंमत</th>
                                <th className="py-2 text-right w-24">Return Qty / परत प्रमाण</th>
                                <th className="py-2 text-right w-24">Approved Qty / मंजूर प्रमाण</th>
                                <th className="py-2 w-56">Voucher to credit / कोणत्या व्हाउचरवर जमा करायचे</th>
                                <th className="py-2 w-8"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((it, idx) => {
                                const g = availableRowsByKey.get(it.key);
                                if (!g) return null;
                                const rowVouchers = eligibleVouchers.filter((v) => g.eligibleVoucherIds.includes(v.id));
                                const chosenPurchasedQty = it.voucherId ? g.purchasedQuantityByVoucherId?.[it.voucherId] : undefined;
                                return (
                                  <tr key={it.key} className="border-b last:border-0 align-top">
                                    <td className="py-2"><ProductCell product={g.product} /></td>
                                    <td className="py-2 text-gray-500">{g.batchName || '—'}</td>
                                    <td className="py-2 text-right">{g.quantity}{g.rows.length > 1 && '*'}</td>
                                    <td className="py-2 text-right">₹{Number(g.rate || 0).toFixed(2)}</td>
                                    <td className="py-2 text-right">
                                      <input
                                        type="number"
                                        min="1"
                                        max={g.quantity}
                                        className="border rounded px-2 py-1 w-20 text-right"
                                        value={it.quantity}
                                        onChange={(e) => updateItemQuantity(idx, e.target.value)}
                                      />
                                    </td>
                                    <td className="py-2 text-right text-gray-500">{g.approvedQuantity || 0}</td>
                                    <td className="py-2">
                                      {rowVouchers.length === 0 ? (
                                        <div className="text-xs text-gray-400 italic">No open voucher / उघडे व्हाउचर नाही</div>
                                      ) : (
                                        <select
                                          className="border rounded px-2 py-1 text-xs w-full"
                                          value={it.voucherId}
                                          onChange={(e) => updateItemVoucher(idx, e.target.value)}
                                        >
                                          <option value="">Select voucher... / व्हाउचर निवडा...</option>
                                          {rowVouchers.map((v) => (
                                            <option key={v.id} value={v.id}>
                                              #{v.id} · ₹{voucherRemaining(v).toFixed(2)} left
                                            </option>
                                          ))}
                                        </select>
                                      )}
                                      {it.voucherId && chosenPurchasedQty === undefined && (
                                        <div className="text-[10px] text-amber-600 mt-0.5">Couldn't match this voucher to a specific purchase / हे व्हाउचर विशिष्ट खरेदीशी जुळवता आले नाही</div>
                                      )}
                                      {it.voucherId && chosenPurchasedQty !== undefined && (
                                        <div className="text-[10px] text-gray-400 mt-0.5">Purchased qty / खरेदी प्रमाण: {chosenPurchasedQty}</div>
                                      )}
                                    </td>
                                    <td className="py-2 text-right">
                                      <button type="button" onClick={() => removeItem(idx)}
                                        className="text-gray-400 hover:text-red-600 text-xs" title="Remove / काढा">✕</button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          </div>
                          {items.some((it) => (availableRowsByKey.get(it.key)?.rows.length || 0) > 1) && (
                            <div className="text-xs text-gray-400 mt-1">* combined quantity across more than one purchase, same product and batch / * एकाच उत्पादनाच्या आणि बॅचच्या अनेक खरेदींमधील एकत्रित प्रमाण</div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {((!isDealer) || supplierId) && (
                <div className="flex items-center justify-between pt-2">
                  <div className="text-sm text-gray-500">
                    Return value: <span className="font-medium text-gray-800">₹{enteredTotal.toFixed(2)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={submitReturn}
                    disabled={submitting}
                    className="bg-red-700 text-white text-sm px-4 py-2 rounded hover:bg-red-800 disabled:opacity-50"
                  >
                    Record Return<span className="block text-xs font-normal">परत नोंदवा</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white rounded shadow p-4 lg:sticky lg:top-4">
            {isDealer && (
              <div className="flex border-b mb-3 -mt-1">
                <button type="button"
                  onClick={() => switchReturnsTab('toSupplier')}
                  className={`flex-1 text-sm px-2 py-2 border-b-2 -mb-px ${
                    returnsTab === 'toSupplier'
                      ? 'border-emerald-700 text-emerald-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  To Suppliers<span className="block text-xs font-normal">पुरवठादारांना</span>
                </button>
                <button type="button"
                  onClick={() => switchReturnsTab('fromRetailer')}
                  className={`flex-1 text-sm px-2 py-2 border-b-2 -mb-px ${
                    returnsTab === 'fromRetailer'
                      ? 'border-emerald-700 text-emerald-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  From Retailers<span className="block text-xs font-normal">किरकोळ विक्रेत्यांकडून</span>
                </button>
              </div>
            )}

            {isDealer && returnsTab === 'toSupplier' && (
              <div className="mb-3">
                <label className="text-xs text-gray-500 flex flex-col leading-tight">
                  <span>Filter by Supplier</span>
                  <span className="text-orange-700">पुरवठादारानुसार फिल्टर करा</span>
                </label>
                <select className="border rounded px-2 py-1 w-full mt-1"
                  value={returnSupplierFilter}
                  onChange={(e) => {
                    const next = e.target.value;
                    setReturnSupplierFilter(next);
                    const stillVisible = !next || allReturns.some(
                      (gr) => String(gr.id) === selectedReturnId && String(gr.supplierId) === next
                    );
                    if (!stillVisible) setSelectedReturnId('');
                  }}>
                  <option value="">All Suppliers / सर्व पुरवठादार</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            {isDealer && returnsTab === 'fromRetailer' && (
              <div className="mb-3">
                <label className="text-xs text-gray-500 flex flex-col leading-tight">
                  <span>Filter by Retailer</span>
                  <span className="text-orange-700">किरकोळ विक्रेत्यानुसार फिल्टर करा</span>
                </label>
                <select className="border rounded px-2 py-1 w-full mt-1"
                  value={returnRetailerFilter}
                  onChange={(e) => {
                    const next = e.target.value;
                    setReturnRetailerFilter(next);
                    const stillVisible = !next || allReturns.some(
                      (gr) => String(gr.id) === selectedReturnId && String(gr.retailerId) === next
                    );
                    if (!stillVisible) setSelectedReturnId('');
                  }}>
                  <option value="">All Retailers / सर्व किरकोळ विक्रेते</option>
                  {retailerFilterOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}

            <div className="flex border-b mb-3 overflow-x-auto">
              {STATUS_TABS.map((tab) => (
                <button key={tab.id} type="button"
                  onClick={() => switchReturnStatusTab(tab.id)}
                  className={`text-xs px-2.5 py-1.5 border-b-2 -mb-px whitespace-nowrap ${
                    returnStatusTab === tab.id
                      ? 'border-emerald-700 text-emerald-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  {tab.label}<span className="block text-[10px] font-normal">{tab.labelMr}</span>
                </button>
              ))}
            </div>

            <label className="text-xs text-gray-500 flex flex-col leading-tight">
              <span>View Return</span>
              <span className="text-orange-700">परत पहा</span>
            </label>
            <select className="border rounded px-2 py-1 w-full mt-1"
              value={selectedReturnId}
              onChange={(e) => {
                const gr = visibleReturns.find((r) => String(r.id) === e.target.value);
                if (gr) selectReturn(gr); else startNewReturn();
              }}>
              <option value="">Select a return... / परत निवडा...</option>
              {visibleReturns.map((gr) => (
                <option key={`${gr.kind}-${gr.id}`} value={gr.id}>
                  #{gr.id} — {counterpartyNameFor(gr)} — {new Date(gr.date).toLocaleDateString()} — {gr.status}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <h2 className="text-lg font-semibold mb-2">
              {isDealer
                ? (returnsTab === 'toSupplier' ? 'Returns to Suppliers' : 'Returns from Retailers')
                : 'Recent Returns'}
              <span className="text-gray-400 font-normal">
                {' / '}
                {isDealer
                  ? (returnsTab === 'toSupplier' ? 'पुरवठादारांना परत' : 'किरकोळ विक्रेत्यांकडून परत')
                  : 'अलीकडील परत'}
              </span>
            </h2>
            {renderReturnsTable()}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
