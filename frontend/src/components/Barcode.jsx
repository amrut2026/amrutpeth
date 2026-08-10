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

// Opens a print-friendly window with one label per requested quantity.
export function printBarcodeLabels(product, quantity = 1) {
  const win = window.open('', '_blank', 'width=420,height=600');
  const labels = Array.from({ length: quantity }).map(() => `
    <div class="label">
      <div class="name">${product.name} (${product.sizeWeight})</div>
      <svg class="bc" jsbarcode-value="${product.barcode}" jsbarcode-height="40" jsbarcode-fontsize="12"></svg>
      <div class="mrp">MRP: ₹${product.mrp} · Batch: ${product.batchName}</div>
    </div>`).join('');

  win.document.write(`
    <html>
      <head>
        <title>Print Barcodes - ${product.name}</title>
        <style>
          body { font-family: sans-serif; }
          .label { border: 1px dashed #999; padding: 8px; margin: 8px; display: inline-block; text-align: center; }
          .name { font-size: 12px; font-weight: bold; }
          .mrp { font-size: 10px; }
          @media print { .label { page-break-inside: avoid; } }
        </style>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.5/JsBarcode.all.min.js"></script>
      </head>
      <body onload="JsBarcode('.bc').init(); setTimeout(() => window.print(), 300);">
        ${labels}
      </body>
    </html>
  `);
  win.document.close();
}
