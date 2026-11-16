import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { ReportResult } from './report.types';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

@Injectable()
export class ReportExportService {
  async xlsx(r: ReportResult, company: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(r.title.slice(0, 31));
    ws.addRow([company]).font = { bold: true, size: 14 };
    ws.addRow([r.title]).font = { bold: true };
    if (r.subtitle) ws.addRow([r.subtitle]);
    ws.addRow([]);
    const head = ws.addRow(r.columns.map((c) => c.label));
    head.font = { bold: true }; head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } }; });
    for (const row of r.rows) {
      const x = ws.addRow(r.columns.map((c) => (c.type === 'money' && row[c.key] !== undefined && row[c.key] !== '' ? Number(row[c.key]) : row[c.key] ?? '')));
      if (row._kind && row._kind !== 'row') x.font = { bold: true };
      r.columns.forEach((c, i) => { if (c.type === 'money') x.getCell(i + 1).numFmt = '#,##0.00;[Red]-#,##0.00'; });
    }
    if (r.summary?.length) { ws.addRow([]); for (const s of r.summary) { const x = ws.addRow([s.label, s.value]); x.font = { bold: true }; } }
    r.columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.type === 'money' ? 16 : c.key === 'particulars' || c.key === 'name' ? 42 : 18; });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  csv(r: ReportResult): string {
    const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [r.columns.map((c) => cell(c.label)).join(','), ...r.rows.map((row) => r.columns.map((c) => cell(row[c.key])).join(','))].join('\n');
  }

  html(r: ReportResult, company: string): string {
    const th = r.columns.map((c) => `<th class="${c.align ?? ''}">${esc(c.label)}</th>`).join('');
    const trs = r.rows.map((row) => `<tr class="${row._kind ?? ''}">${r.columns.map((c) => `<td class="${c.align ?? ''}">${esc(row[c.key])}</td>`).join('')}</tr>`).join('');
    const sum = (r.summary ?? []).map((s) => `<div><b>${esc(s.label)}:</b> ${esc(s.value)}</div>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>
body{font:12px/1.4 Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}h2{font-size:14px;margin:4px 0}p{color:#555;margin:0 0 12px}
table{border-collapse:collapse;width:100%}th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left}th{background:#eef2f8}.right{text-align:right}
tr.header td,tr.total td,tr.subtotal td{font-weight:bold}tr.total td{border-top:2px solid #333}@media print{body{margin:8mm}}</style></head>
<body><h1>${esc(company)}</h1><h2>${esc(r.title)}</h2><p>${esc(r.subtitle ?? '')}</p><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table><div style="margin-top:12px">${sum}</div></body></html>`;
  }

  pdf(r: ReportResult, company: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: r.columns.length > 5 ? 'landscape' : 'portrait', margin: 36 });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
      const width = doc.page.width - 72;
      const weights = r.columns.map((c) => (c.type === 'money' ? 1 : c.key === 'particulars' || c.key === 'name' || c.key === 'narration' ? 2.4 : 1.3));
      const total = weights.reduce((a, b) => a + b, 0);
      const xs: number[] = []; let acc = 36; weights.forEach((w) => { xs.push(acc); acc += (w / total) * width; });
      const colW = weights.map((w) => (w / total) * width - 4);
      doc.fontSize(14).font('Helvetica-Bold').text(company, 36, 36);
      doc.fontSize(11).text(r.title); if (r.subtitle) doc.font('Helvetica').fontSize(9).fillColor('#555').text(r.subtitle).fillColor('#000');
      let y = doc.y + 8;
      const header = () => { doc.font('Helvetica-Bold').fontSize(8); r.columns.forEach((c, i) => doc.text(c.label, xs[i], y, { width: colW[i], align: c.align === 'right' ? 'right' : 'left' })); y += 14; doc.moveTo(36, y - 3).lineTo(36 + width, y - 3).stroke('#999'); };
      header();
      for (const row of r.rows) {
        if (y > doc.page.height - 60) { doc.addPage(); y = 36; header(); }
        const bold = row._kind && row._kind !== 'row';
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        let h = 11;
        r.columns.forEach((c, i) => { const t = String(row[c.key] ?? ''); doc.text(t, xs[i], y, { width: colW[i], align: c.align === 'right' ? 'right' : 'left', lineBreak: false, ellipsis: true }); });
        y += h;
      }
      y += 8;
      for (const s of r.summary ?? []) { if (y > doc.page.height - 50) { doc.addPage(); y = 36; } doc.font('Helvetica-Bold').fontSize(9).text(`${s.label}: ${s.value}`, 36, y); y += 13; }
      doc.end();
    });
  }
}
