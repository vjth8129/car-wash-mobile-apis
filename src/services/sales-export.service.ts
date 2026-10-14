import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import { env } from '../config/env';
import { findCarWashById } from '../repositories/car-wash.repository';
import {
  getSalesReport,
  type SalesBucket,
  type SalesReport,
  type SalesRow,
  type SalesTotals,
} from '../repositories/report.repository';
import { NotFoundError, UnauthorizedError } from '../utils/errors';
import type { SalesExportQuery } from '../validators/report.validator';

export type ExportFormat = 'pdf' | 'xlsx';

/** Most transactions one export lists (totals always cover everything). */
const MAX_EXPORT_ROWS = 5000;
/** How long a download link works. */
const LINK_TTL_SECONDS = 5 * 60;

// ---- download links ------------------------------------------------------------
// The app opens the file in a browser / download manager, which can't send the bearer token,
// so it first asks for a short-lived link that carries a token good for this one export.

interface ExportTokenPayload {
  type: 'sales-export';
  carWashId: string;
  userId: string;
  query: SalesExportQuery;
}

export function createExportLink(carWashId: string, userId: string, query: SalesExportQuery) {
  const payload: ExportTokenPayload = { type: 'sales-export', carWashId, userId, query };
  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: LINK_TTL_SECONDS });
  return {
    path: `/reports/sales/export?token=${encodeURIComponent(token)}`,
    filename: exportFilename(query),
    expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(),
  };
}

function readExportToken(token: string): ExportTokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as ExportTokenPayload;
    if (payload.type !== 'sales-export') throw new Error('wrong token type');
    return payload;
  } catch {
    throw new UnauthorizedError('This download link has expired. Tap Download again.');
  }
}

const exportFilename = (q: SalesExportQuery) =>
  `sales-report_${q.from}${q.from === q.to ? '' : `_to_${q.to}`}.${q.format}`;

/** The file a download link points at. */
export async function renderExport(token: string) {
  const { carWashId, query } = readExportToken(token);
  const carWash = await findCarWashById(carWashId);
  if (!carWash) throw new NotFoundError('Car wash not found');
  const { format, ...filters } = query;
  const report = await getSalesReport({
    ...filters,
    carWashId,
    timezone: carWash.timezone,
    limit: MAX_EXPORT_ROWS,
  });
  const ctx: ExportContext = {
    carWashName: carWash.name,
    currency: carWash.currency,
    tz: carWash.timezone,
    filters: filterLabels(report, filters),
    generatedAt: new Date(),
  };
  const body = format === 'pdf' ? await buildPdf(report, ctx) : await buildWorkbook(report, ctx);
  return {
    body,
    filename: exportFilename(query),
    contentType:
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}

// ---- shared formatting -----------------------------------------------------------

interface ExportContext {
  carWashName: string;
  currency: string;
  tz: string;
  /** e.g. ["Service: Basic Wash", "Payment: Not paid"]; empty = everything. */
  filters: string[];
  generatedAt: Date;
}

const BODY_LABEL: Record<string, string> = {
  SEDAN: 'Sedan',
  SUV: 'SUV',
  HATCHBACK: 'Hatchback',
  TRUCK: 'Truck',
  VAN: 'Van',
  MOTORCYCLE: 'Two-wheeler',
  OTHER: 'Other',
};

function filterLabels(report: SalesReport, q: Omit<SalesExportQuery, 'format'>): string[] {
  const service =
    q.serviceId &&
    (report.options.services.find((s) => s.id === q.serviceId)?.name ??
      report.byService.find((s) => s.key === q.serviceId)?.label ??
      'Selected service');
  const category =
    q.categoryId &&
    (report.options.categories.find((c) => c.id === q.categoryId)?.name ?? 'Selected type');
  return [
    service && `Service: ${service}`,
    category && `Vehicle type: ${category}`,
    q.vehicleType && `Body: ${BODY_LABEL[q.vehicleType] ?? q.vehicleType}`,
    q.paymentStatus && `Payment: ${q.paymentStatus === 'PAID' ? 'Paid' : 'Not paid'}`,
  ].filter((f): f is string => !!f);
}

const dayFmt = (s: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${s}T00:00:00Z`).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
const longDay = (s: string) =>
  dayFmt(s, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const rangeLabel = (r: { from: string; to: string }) =>
  r.from === r.to
    ? longDay(r.from)
    : `${dayFmt(r.from, { day: 'numeric', month: 'short', year: 'numeric' })} – ${dayFmt(r.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;

function bucketLabel(bucket: SalesBucket, key: string) {
  switch (bucket) {
    case 'hour':
      return `${key}:00 – ${String((Number(key) + 1) % 24).padStart(2, '0')}:00`;
    case 'day':
      return longDay(key);
    case 'week':
      return `Week of ${dayFmt(key, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    case 'month':
      return dayFmt(`${key}-01`, { month: 'long', year: 'numeric' });
  }
}
const BUCKET_TITLE: Record<SalesBucket, string> = {
  hour: 'Sales by hour',
  day: 'Sales by day',
  week: 'Sales by week',
  month: 'Sales by month',
};

const stamp = (d: Date, tz: string) =>
  d.toLocaleString('en-IN', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** The car wash's wall-clock time as a UTC Date, so Excel shows local time (it has no zones). */
function wallClock(iso: string, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return new Date(
    Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second),
  );
}

const pct = (now: number, before: number) =>
  before > 0
    ? `${now >= before ? '+' : '−'}${Math.abs(((now - before) / before) * 100).toFixed(0)}%`
    : '—';

const paymentLabel = (t: { paidAt: string | null; paymentMethod: string | null }) =>
  t.paidAt ? (t.paymentMethod === 'CASH' ? 'Cash' : 'UPI') : 'Not paid';

const METRICS: [string, (t: SalesTotals) => number, boolean][] = [
  ['Total sales', (t) => t.revenue, true],
  ['Washes', (t) => t.washes, false],
  ['Average ticket', (t) => t.average, true],
  ['Customers', (t) => t.customers, false],
  ['Collected', (t) => t.collected, true],
  ['Not paid', (t) => t.unpaid, true],
  ['Washes not paid', (t) => t.unpaidWashes, false],
];

const BREAKDOWNS: [string, (r: SalesReport) => SalesRow[]][] = [
  ['By service', (r) => r.byService],
  ['By vehicle type', (r) => r.byCategory],
  ['By body type', (r) => r.byVehicleType],
  ['By payment', (r) => r.byPayment],
];

// ---- Excel -------------------------------------------------------------------------

async function buildWorkbook(report: SalesReport, ctx: ExportContext): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = ctx.carWashName;
  wb.created = ctx.generatedAt;
  const money = ctx.currency === 'INR' ? '"₹"#,##0.00' : `"${ctx.currency} "#,##0.00`;
  const header = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A6CFF' } };
    });
  };

  // Summary
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 24 }, { width: 18 }, { width: 18 }, { width: 12 }];
  sum.addRow([`${ctx.carWashName} – Sales report`]).font = { bold: true, size: 14 };
  sum.addRow(['Period', rangeLabel(report.range)]);
  sum.addRow(['Compared with', rangeLabel(report.previous)]);
  sum.addRow(['Filters', ctx.filters.length ? ctx.filters.join(', ') : 'None (all sales)']);
  sum.addRow(['Generated', stamp(ctx.generatedAt, ctx.tz)]);
  sum.addRow([]);
  header(sum.addRow(['Metric', 'This period', 'Previous period', 'Change']));
  for (const [label, get, isMoney] of METRICS) {
    const row = sum.addRow([
      label,
      get(report.totals),
      get(report.previous),
      pct(get(report.totals), get(report.previous)),
    ]);
    if (isMoney) [2, 3].forEach((c) => (row.getCell(c).numFmt = money));
  }

  // Trend, splits, hours
  const table = (
    name: string,
    first: string,
    rows: { label: string; washes: number; revenue: number }[],
  ) => {
    const ws = wb.addWorksheet(name);
    ws.columns = [{ width: 30 }, { width: 10 }, { width: 16 }, { width: 10 }];
    header(ws.addRow([first, 'Washes', 'Amount', 'Share']));
    const total = rows.reduce((n, r) => n + r.revenue, 0);
    for (const r of rows) {
      const row = ws.addRow([r.label, r.washes, r.revenue, total ? r.revenue / total : 0]);
      row.getCell(3).numFmt = money;
      row.getCell(4).numFmt = '0%';
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  table(
    BUCKET_TITLE[report.groupBy],
    report.groupBy === 'hour' ? 'Hour' : 'Period',
    report.series.map((r) => ({ ...r, label: bucketLabel(report.groupBy, r.key) })),
  );
  for (const [name, rows] of BREAKDOWNS)
    table(
      name,
      name.replace('By ', '').replace(/^./, (c) => c.toUpperCase()),
      rows(report),
    );
  table(
    'By hour',
    'Hour',
    report.byHour.map((r) => ({ ...r, label: bucketLabel('hour', r.key) })),
  );

  // Transactions
  const tx = wb.addWorksheet('Transactions');
  tx.columns = [
    { header: 'Completed', width: 20 },
    { header: 'Vehicle no.', width: 14 },
    { header: 'Body', width: 12 },
    { header: 'Vehicle type', width: 13 },
    { header: 'Customer', width: 22 },
    { header: 'Phone', width: 16 },
    { header: 'Services', width: 32 },
    { header: 'Payment', width: 10 },
    { header: 'Amount', width: 14 },
  ];
  header(tx.getRow(1));
  for (const t of report.transactions) {
    const row = tx.addRow([
      wallClock(t.completedAt, ctx.tz),
      t.registrationNumber,
      BODY_LABEL[t.vehicleType] ?? t.vehicleType,
      t.category?.name ?? '',
      t.customer.name,
      t.customer.phone ?? '',
      t.services.map((s) => s.name).join(' + '),
      paymentLabel(t),
      t.amount,
    ]);
    row.getCell(1).numFmt = 'dd-mmm-yyyy hh:mm';
    row.getCell(9).numFmt = money;
  }
  if (report.totals.washes > report.transactions.length) {
    tx.addRow([]);
    tx.addRow([
      `Showing the latest ${report.transactions.length} of ${report.totals.washes} washes.`,
    ]);
  }
  tx.views = [{ state: 'frozen', ySplit: 1 }];
  tx.autoFilter = { from: 'A1', to: 'I1' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- PDF -----------------------------------------------------------------------------

const INK = '#0F1B2D';
const MUTED = '#5F6B7A';
const LINE = '#DDE3EB';
const BLUE = '#0A6CFF';
const SOFT = '#E7F0FF';

function buildPdf(report: SalesReport, ctx: ExportContext): Promise<Buffer> {
  // The built-in PDF fonts have no ₹ sign, so rupees are written "Rs." with Indian grouping.
  const nf = new Intl.NumberFormat(ctx.currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const money = (n: number) => `${ctx.currency === 'INR' ? 'Rs.' : ctx.currency} ${nf.format(n)}`;

  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true,
    info: { Title: 'Sales report' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  /** Cuts text to one line of the given width with "…" (pdfkit would otherwise wrap it). */
  const fit = (text: string, w: number) => {
    if (doc.widthOfString(text) <= w) return text;
    let cut = text;
    while (cut.length > 1 && doc.widthOfString(`${cut}…`) > w) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}…`;
  };
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const heading = (text: string) => {
    ensure(40);
    doc
      .moveDown(0.8)
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(MUTED)
      .text(text.toUpperCase(), left, doc.y, {
        characterSpacing: 0.6,
      });
    doc.moveDown(0.4);
  };

  /** A simple table; repeats its header on each new page. */
  const tableOut = (
    cols: { title: string; width: number; align?: 'left' | 'right' }[],
    rows: string[][],
  ) => {
    const rowH = 18;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, rowH).fill(SOFT);
      let x = left;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
      for (const c of cols) {
        doc.text(c.title, x + 4, y + 5, {
          width: c.width - 8,
          align: c.align ?? 'left',
          lineBreak: false,
        });
        x += c.width;
      }
      doc.y = y + rowH;
    };
    drawHeader();
    doc.font('Helvetica').fontSize(9);
    for (const r of rows) {
      if (doc.y + rowH > bottom()) {
        doc.addPage();
        drawHeader();
        doc.font('Helvetica').fontSize(9);
      }
      const y = doc.y;
      let x = left;
      doc.fillColor(INK);
      cols.forEach((c, i) => {
        doc.text(fit(r[i] ?? '', c.width - 8), x + 4, y + 5, {
          width: c.width - 8,
          align: c.align ?? 'left',
          lineBreak: false,
        });
        x += c.width;
      });
      doc
        .moveTo(left, y + rowH)
        .lineTo(left + width, y + rowH)
        .lineWidth(0.5)
        .strokeColor(LINE)
        .stroke();
      doc.y = y + rowH;
    }
  };

  // Title
  doc.font('Helvetica-Bold').fontSize(18).fillColor(INK).text(ctx.carWashName, left, 40);
  doc
    .font('Helvetica')
    .fontSize(12)
    .fillColor(MUTED)
    .text(`Sales report · ${rangeLabel(report.range)}`);
  doc
    .fontSize(9)
    .text(
      `${ctx.filters.length ? ctx.filters.join('  ·  ') : 'All sales'}   |   Generated ${stamp(ctx.generatedAt, ctx.tz)}`,
    );
  doc.moveDown(0.8);

  // Headline + figure boxes
  const t = report.totals;
  const prev = report.previous;
  const top = doc.y;
  doc.roundedRect(left, top, width, 64, 8).fill(BLUE);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#DCE8FF')
    .text('Total sales', left + 16, top + 12);
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor('#FFFFFF')
    .text(money(t.revenue), left + 16, top + 26);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#DCE8FF')
    .text(
      prev.washes
        ? `${pct(t.revenue, prev.revenue)} vs ${rangeLabel(prev)} (${money(prev.revenue)})`
        : `No sales in ${rangeLabel(prev)}`,
      left + width / 2,
      top + 30,
      { width: width / 2 - 16, align: 'right' },
    );
  doc.y = top + 76;

  const boxes: [string, string][] = [
    ['Washes', String(t.washes)],
    ['Avg ticket', money(t.average)],
    ['Customers', String(t.customers)],
    ['Collected', money(t.collected)],
    ['Not paid', `${money(t.unpaid)} · ${t.unpaidWashes}`],
  ];
  const gap = 8;
  const bw = (width - gap * (boxes.length - 1)) / boxes.length;
  const by = doc.y;
  boxes.forEach(([label, value], i) => {
    const x = left + i * (bw + gap);
    doc.roundedRect(x, by, bw, 44, 6).lineWidth(0.8).strokeColor(LINE).stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(label, x + 8, by + 8, { width: bw - 16 });
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(label === 'Not paid' && t.unpaid > 0 ? '#C62828' : INK)
      .text(fit(value, bw - 16), x + 8, by + 22, { width: bw - 16, lineBreak: false });
  });
  doc.y = by + 56;

  // Trend chart
  heading(BUCKET_TITLE[report.groupBy]);
  const chartH = 120;
  ensure(chartH + 30);
  const cy = doc.y;
  const axisW = 60;
  const plotX = left + axisW;
  const plotW = width - axisW;
  const max = Math.max(1, ...report.series.map((r) => r.revenue));
  const n = report.series.length || 1;
  const slot = plotW / n;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  doc.font('Helvetica').fontSize(7).fillColor(MUTED);
  [1, 0.5, 0].forEach((f) => {
    const y = cy + chartH * (1 - f);
    doc
      .moveTo(plotX, y)
      .lineTo(plotX + plotW, y)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    doc.text(money(max * f).replace(/\.00$/, ''), left, y - 4, {
      width: axisW - 6,
      align: 'right',
    });
  });
  const every = Math.max(1, Math.ceil(n / 12));
  report.series.forEach((r, i) => {
    const h = (r.revenue / max) * chartH;
    const x = plotX + i * slot + (slot - barW) / 2;
    if (h > 0) doc.rect(x, cy + chartH - h, barW, h).fill(BLUE);
    if (i % every === 0) {
      const tick =
        report.groupBy === 'hour'
          ? r.key
          : report.groupBy === 'month'
            ? dayFmt(`${r.key}-01`, { month: 'short' })
            : dayFmt(r.key, {
                day: 'numeric',
                month: report.groupBy === 'week' ? 'short' : undefined,
              });
      doc
        .fillColor(MUTED)
        .text(tick, plotX + i * slot - 10, cy + chartH + 4, { width: slot + 20, align: 'center' });
    }
  });
  doc.y = cy + chartH + 20;

  // Splits
  for (const [name, rows] of BREAKDOWNS) {
    const list = rows(report);
    if (!list.length) continue;
    heading(name);
    const total = list.reduce((s, r) => s + r.revenue, 0);
    tableOut(
      [
        {
          title: name.replace('By ', '').replace(/^./, (c) => c.toUpperCase()),
          width: width - 240,
        },
        { title: 'Washes', width: 60, align: 'right' },
        { title: 'Amount', width: 120, align: 'right' },
        { title: 'Share', width: 60, align: 'right' },
      ],
      list.map((r) => [
        r.label,
        String(r.washes),
        money(r.revenue),
        total ? `${Math.round((r.revenue / total) * 100)}%` : '—',
      ]),
    );
  }

  // Transactions
  heading(
    report.totals.washes > report.transactions.length
      ? `Transactions (latest ${report.transactions.length} of ${report.totals.washes})`
      : `Transactions (${report.totals.washes})`,
  );
  if (report.transactions.length) {
    tableOut(
      [
        { title: 'Completed', width: 88 },
        { title: 'Vehicle', width: 78 },
        { title: 'Customer', width: 90 },
        { title: 'Services', width: width - 88 - 78 - 90 - 50 - 80 },
        { title: 'Payment', width: 50 },
        { title: 'Amount', width: 80, align: 'right' },
      ],
      report.transactions.map((tr) => [
        stamp(new Date(tr.completedAt), ctx.tz).replace(/ \d{4},/, ','),
        tr.registrationNumber,
        tr.customer.name,
        tr.services.map((s) => s.name).join(' + '),
        paymentLabel(tr),
        money(tr.amount),
      ]),
    );
  } else {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('No completed washes in this period.');
  }

  // Page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // the footer sits below the margin; don't let it start a new page
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `${ctx.carWashName} · Sales report · Page ${i + 1} of ${range.count}`,
        left,
        doc.page.height - 30,
        {
          width,
          align: 'center',
          lineBreak: false,
        },
      );
  }
  doc.end();
  return done;
}
