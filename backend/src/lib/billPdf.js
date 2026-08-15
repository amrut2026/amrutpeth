import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Noto Sans Devanagari covers both Devanagari and basic Latin, so one font
// family handles the English + Marathi bilingual labels below without
// switching fonts mid-line. Download both weights from Google Fonts
// (https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari) and place
// them at these paths — see README for the exact filenames expected.
const FONT_REGULAR = path.join(__dirname, '../fonts/NotoSansDevanagari-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '../fonts/NotoSansDevanagari-Bold.ttf');

const PAGE_MARGIN = 40;
const CONTENT_WIDTH = 515; // A4 width (595) minus 2x margin
const RIGHT_EDGE = PAGE_MARGIN + CONTENT_WIDTH;

// English / Marathi label pairs, combined as "English / मराठी" wherever
// printed on the bill.
const L = {
  title: 'SALES BILL / विक्री पावती',
  billNo: 'Bill No / बिल क्र.',
  date: 'Date / दिनांक',
  paymentMode: 'Payment Mode / पैसे भरण्याची पद्धत',
  posRef: 'POS Ref / पीओएस संदर्भ',
  customer: 'Customer / ग्राहक',
  cashCustomer: 'Cash Customer / रोख ग्राहक',
  continued: '...continued / ...पुढे चालू',
  carriedForward: 'Carried forward / पुढे नेले',
  totalSavings: 'Total Savings / एकूण बचत',
  grandTotal: 'GRAND TOTAL / एकूण रक्कम',
  thankYou: 'Thank you for your business. / आपल्या व्यवसायासाठी धन्यवाद.',
};

// Consumer-facing bill (CASH sale, either a dealer selling direct or a
// retailer selling to their end customer): shows MRP and savings.
const COLS_FULL = [
  { key: 'sn', label: 'S.No\nअ.क्र.', width: 32 },
  { key: 'name', label: 'Product\nउत्पादन', width: 130 },
  { key: 'batch', label: 'Batch\nबॅच', width: 65 },
  { key: 'qty', label: 'Qty\nप्रमाण', width: 42, align: 'right' },
  { key: 'mrp', label: 'MRP\nएमआरपी', width: 58, align: 'right' },
  { key: 'price', label: 'Price\nकिंमत', width: 58, align: 'right' },
  { key: 'saved', label: 'You Save\nबचत', width: 60, align: 'right' },
  { key: 'amount', label: 'Amount\nरक्कम', width: 70, align: 'right' },
];

// B2B bill (a dealer selling on to a retailer): MRP and "You Save" are a
// consumer-facing concept and don't belong on a wholesale invoice, so
// they're dropped and the remaining columns take the freed-up width.
const COLS_B2B = [
  { key: 'sn', label: 'S.No\nअ.क्र.', width: 32 },
  { key: 'name', label: 'Product\nउत्पादन', width: 230 },
  { key: 'batch', label: 'Batch\nबॅच', width: 90 },
  { key: 'qty', label: 'Qty\nप्रमाण', width: 50, align: 'right' },
  { key: 'price', label: 'Price\nकिंमत', width: 60, align: 'right' },
  { key: 'amount', label: 'Amount\nरक्कम', width: 53, align: 'right' },
];

function fmt(n) {
  return Number(n || 0).toFixed(2);
}

function drawHeader(doc, party) {
  doc.font(FONT_BOLD).fontSize(14).text(party?.name || '—', PAGE_MARGIN, PAGE_MARGIN, { align: 'center', width: CONTENT_WIDTH });
  doc.font(FONT_REGULAR).fontSize(9);
  if (party?.address) doc.text(party.address, { align: 'center', width: CONTENT_WIDTH });
  const line2 = [party?.contactNumber ? `Ph: ${party.contactNumber}` : null, party?.gstNumber ? `GSTIN: ${party.gstNumber}` : null]
    .filter(Boolean).join('   |   ');
  if (line2) doc.text(line2, { align: 'center', width: CONTENT_WIDTH });
  doc.moveDown(0.3);
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(RIGHT_EDGE, doc.y).stroke();
  doc.moveDown(0.5);
}

function drawBillMeta(doc, sale) {
  doc.font(FONT_BOLD).fontSize(10).text(L.title, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
  doc.font(FONT_REGULAR).fontSize(9);
  const leftY = doc.y;
  doc.text(`${L.billNo}: ${sale.id}`, PAGE_MARGIN, leftY);
  doc.text(`${L.date}: ${new Date(sale.date).toLocaleString('en-IN')}`, PAGE_MARGIN, doc.y);
  doc.text(`${L.paymentMode}: ${sale.paymentMode || '-'}`, PAGE_MARGIN, doc.y);
  if (sale.posTransactionRef) doc.text(`${L.posRef}: ${sale.posTransactionRef}`, PAGE_MARGIN, doc.y);
  const leftColumnBottom = doc.y; // remember where the (taller) left column actually ended

  const customerLabel = sale.customerType === 'RETAILER'
    ? (sale.customerRetailer?.name || 'Retailer')
    : L.cashCustomer;
  // Drawn with an explicit y back at leftY (to sit beside the left column,
  // not below it) — PDFKit then advances doc.y to just past THIS block,
  // which is shorter than the left column, silently rewinding the cursor
  // upward. Everything drawn next (the product table header) would land on
  // top of "Payment Mode" / "POS Ref" instead of below them. Restoring
  // doc.y to the taller of the two columns' end positions fixes it.
  doc.text(`${L.customer}: ${customerLabel}`, 260, leftY, { width: 295, align: 'right' });
  doc.y = Math.max(doc.y, leftColumnBottom);
  doc.moveDown(0.5);
}

function drawTableHeader(doc, cols) {
  const y = doc.y;
  let x = PAGE_MARGIN;
  doc.font(FONT_BOLD).fontSize(6.5);
  for (const col of cols) {
    doc.text(col.label, x, y, { width: col.width, align: col.align || 'left' });
    x += col.width;
  }
  doc.moveDown(0.9); // extra room for the two-line bilingual header
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(RIGHT_EDGE, doc.y).stroke();
  doc.moveDown(0.2);
  doc.font(FONT_REGULAR).fontSize(8);
}

function drawRow(doc, cols, row) {
  const y = doc.y;
  let x = PAGE_MARGIN;
  for (const col of cols) {
    doc.text(String(row[col.key] ?? ''), x, y, { width: col.width, align: col.align || 'left' });
    x += col.width;
  }
  doc.moveDown(0.4);
}

function drawRunningTotal(doc, runningTotal) {
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(RIGHT_EDGE, doc.y).stroke();
  doc.moveDown(0.2);
  doc.font(FONT_BOLD).fontSize(8);
  doc.text(`${L.carriedForward}: Rs. ${fmt(runningTotal)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right' });
  doc.font(FONT_REGULAR).fontSize(8);
}

// sale: a Sale with { items: [{ product, quantity, price, mrp, batchName }],
//        ..., customerRetailer? } — items[].price and items[].mrp are
//        snapshots taken at sale time from the Inventory batch sold from,
//        so the bill still shows correct figures even if that batch's
//        inventory row later changes. "You Save" is only shown when mrp is
//        greater than the price actually charged.
// party: the Dealer or Retailer that made the sale (for the header).
export async function generateSaleBillPdf(sale, party) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // A dealer selling on to a retailer is a B2B transaction — MRP and "You
    // Save" are a consumer-facing concept and don't belong on that invoice.
    const isB2B = sale.customerType === 'RETAILER';
    const cols = isB2B ? COLS_B2B : COLS_FULL;

    drawHeader(doc, party);
    drawBillMeta(doc, sale);
    drawTableHeader(doc, cols);

    const rowsPerPage = 28; // slightly lower than before — bilingual header takes more vertical space
    let runningTotal = 0;
    let totalSavings = 0;
    let rowsOnPage = 0;

    sale.items.forEach((item, idx) => {
      const amount = Number(item.price) * Number(item.quantity);
      const mrp = item.mrp != null ? Number(item.mrp) : null;
      const savedPerUnit = mrp != null && mrp > Number(item.price) ? mrp - Number(item.price) : 0;
      const savedTotal = savedPerUnit * Number(item.quantity);
      runningTotal += amount;
      if (!isB2B) totalSavings += savedTotal;

      drawRow(doc, cols, {
        sn: idx + 1,
        name: item.product?.name || `#${item.productId}`,
        batch: item.batchName || '-',
        qty: item.quantity,
        mrp: mrp != null ? fmt(mrp) : '-',
        price: fmt(item.price),
        saved: savedTotal > 0 ? fmt(savedTotal) : '-',
        amount: fmt(amount),
      });
      rowsOnPage++;

      const isLastItem = idx === sale.items.length - 1;
      if (rowsOnPage >= rowsPerPage && !isLastItem) {
        drawRunningTotal(doc, runningTotal);
        doc.addPage();
        drawHeader(doc, party);
        doc.font(FONT_REGULAR).fontSize(8).text(`${L.continued} (${L.billNo}: ${sale.id})`, PAGE_MARGIN, doc.y);
        doc.moveDown(0.3);
        drawTableHeader(doc, cols);
        rowsOnPage = 0;
      }
    });

    doc.moveTo(PAGE_MARGIN, doc.y).lineTo(RIGHT_EDGE, doc.y).stroke();
    doc.moveDown(0.3);

    if (!isB2B && totalSavings > 0) {
      doc.font(FONT_REGULAR).fontSize(9);
      doc.text(`${L.totalSavings}: Rs. ${fmt(totalSavings)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right' });
      doc.moveDown(0.2);
    }

    doc.font(FONT_BOLD).fontSize(11);
    doc.text(`${L.grandTotal}: Rs. ${fmt(sale.totalAmount)}`, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'right' });
    doc.moveDown(1);
    doc.font(FONT_REGULAR).fontSize(8).text(L.thankYou, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });

    doc.end();
  });
}