import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

export default function Barcode({ value, width = 1.4, height = 40 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && value) {
      JsBarcode(ref.current, value, { format: 'CODE128', width, height, displayValue: true, fontSize: 12, margin: 4 });
    }
  }, [value, width, height]);
  return <svg ref={ref}></svg>;
}

// Renders the label markup for one product repeated `quantity` times.
// `priceInfo` (optional) is `{ mrp, retailerSellingPrice }` — when given, a
// price line is added below the barcode. Printed as "You Pay" rather than
// "Retailer" since this is the price the retailer scanning the label pays,
// not a description of who they are.
function renderLabelGroup({ name, sizeWeight, barcode, quantity = 1, priceInfo }) {
  const priceLine = priceInfo
    ? `<div class="price">${priceInfo.mrp != null ? `MRP: ₹${priceInfo.mrp}` : ''}${
        priceInfo.mrp != null && priceInfo.retailerSellingPrice != null ? ' &nbsp;|&nbsp; ' : ''
      }${priceInfo.retailerSellingPrice != null ? `You Pay: ₹${priceInfo.retailerSellingPrice}` : ''}</div>`
    : '';
  return Array.from({ length: Math.max(1, Number(quantity) || 1) }).map(() => `
    <div class="label">
      <div class="name">${name} (${sizeWeight})</div>
      <svg class="bc" jsbarcode-value="${barcode}" jsbarcode-height="40" jsbarcode-fontsize="12"></svg>
      ${priceLine}
    </div>`).join('');
}

function openLabelPrintWindow(title, labelsHtml) {
  const win = window.open('', '_blank', 'width=420,height=600');
  win.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: sans-serif; }
          .label { border: 1px dashed #999; padding: 8px; margin: 8px; display: inline-block; text-align: center; }
          .name { font-size: 12px; font-weight: bold; }
          .price { font-size: 11px; margin-top: 2px; color: #333; }
          @media print { .label { page-break-inside: avoid; } }
        </style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"></script>
      </head>
      <body onload="JsBarcode('.bc').init(); setTimeout(() => window.print(), 300);">
        ${labelsHtml}
      </body>
    </html>
  `);
  win.document.close();
}

// Opens a single print-friendly window with labels for several purchase
// items at once, each with its own print quantity and its own batch's MRP /
// retailer selling price shown below the barcode. This is the only barcode
// printing path in the app — printing was intentionally removed from the
// product screen, since Product itself carries no MRP/price (that only
// exists per purchase batch — see PurchaseItem), so a label printed from the
// catalog could never show real pricing anyway.
export function printBarcodeLabelsBatch(entries, title = 'Print Barcodes') {
  const labels = entries.map((entry) => renderLabelGroup({
    name: entry.name,
    sizeWeight: entry.sizeWeight,
    barcode: entry.barcode,
    quantity: entry.quantity,
    priceInfo: { mrp: entry.mrp, retailerSellingPrice: entry.retailerSellingPrice },
  })).join('');
  openLabelPrintWindow(title, labels);
}
