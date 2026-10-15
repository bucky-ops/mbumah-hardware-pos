// MBUMAH HARDWARE POS - Minimal payslip PDF writer (v2.18.9)
//
// Zero-dependency PDF 1.4 generator for single-page payslips. The POS repo
// deliberately carries no PDF library (receipts print via the browser); a
// payslip is simple text + rules, so we emit a valid PDF with the standard
// Helvetica base fonts (WinAnsi encoding) directly.
//
// SECURITY: the caller passes an ALREADY-SHAPED PayslipView (buildPayslipView)
// - statutory identifiers arrive masked unless the viewer cleared
// hr.employee.unmask.pii. This module never touches the database.

import type { PayslipView } from './payslip-view';

interface TextOp {
  kind: 'text';
  x: number;
  y: number;
  size: number;
  bold: boolean;
  value: string;
}
interface RuleOp {
  kind: 'rule';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}
type Op = TextOp | RuleOp;

const PAGE_WIDTH = 595.28; // A4 portrait, points
const PAGE_HEIGHT = 841.89;

/** Escape \, (, ) and strip anything outside WinAnsi-safe ASCII. */
function pdfEscape(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

const fmtKES = (n: number): string =>
  `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Approximate Helvetica advance width (per 1000 units) for right alignment. */
function textWidth(text: string, size: number, bold: boolean): number {
  // Average mixed-case approximation; payslips are left-aligned except the
  // amounts column, and a 3-4pt drift is acceptable for a plain slip.
  const factor = bold ? 0.56 : 0.52;
  return text.length * size * factor;
}

export function buildPayslipPdf(view: PayslipView): Uint8Array {
  const ops: Op[] = [];
  let y = PAGE_HEIGHT - 56;

  const text = (x: number, value: string, size = 10, bold = false) => {
    ops.push({ kind: 'text', x, y, size, bold, value });
  };
  const rule = (width = 0.75) => {
    ops.push({ kind: 'rule', x1: 48, y1: y, x2: PAGE_WIDTH - 48, y2: y, width });
  };

  // Header.
  text(48, 'MBUMAH HARDWARE', 16, true);
  y -= 16;
  text(48, 'Employee Payslip', 11);
  text(PAGE_WIDTH - 48 - textWidth(view.runStatus, 10, true), view.runStatus, 10, true);
  y -= 10;
  text(48, `Period: ${view.periodName}   Run type: ${view.runType}`, 10);
  y -= 14;
  text(48, `Payslip no: ${view.payslipNumber ?? '(pending issue)'}`, 10);
  if (view.payDate) {
    const label = `Pay date: ${new Date(view.payDate).toISOString().slice(0, 10)}`;
    text(PAGE_WIDTH - 48 - textWidth(label, 10, false), label, 10);
  }
  y -= 12;
  rule(1);
  y -= 16;

  // Employee block.
  text(48, `Employee: ${view.employee.name}  (${view.employee.employeeCode})`, 10, true);
  y -= 13;
  const statPairs = Object.entries(view.employee.statutory).filter(([, v]) => v !== '');
  if (statPairs.length > 0) {
    const line1 = statPairs
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${v}`)
      .join('   ');
    text(48, line1, 9);
    y -= 12;
    if (statPairs.length > 3) {
      text(
        48,
        statPairs
          .slice(3, 6)
          .map(([k, v]) => `${k}: ${v}`)
          .join('   '),
        9,
      );
      y -= 12;
    }
  }
  y -= 4;
  rule();
  y -= 16;

  // Earnings.
  text(48, 'EARNINGS', 10, true);
  y -= 14;
  for (const line of view.earnings) {
    const amount = fmtKES(line.amount);
    text(56, line.label, 10);
    text(PAGE_WIDTH - 48 - textWidth(amount, 10, false), amount, 10);
    y -= 13;
  }
  const grossLabel = 'GROSS PAY';
  const grossAmount = fmtKES(view.totals.gross);
  text(56, grossLabel, 10, true);
  text(PAGE_WIDTH - 48 - textWidth(grossAmount, 10, true), grossAmount, 10, true);
  y -= 16;

  // Deductions.
  rule();
  y -= 16;
  text(48, 'DEDUCTIONS', 10, true);
  y -= 14;
  for (const line of view.deductions) {
    const amount = fmtKES(line.amount);
    text(56, line.label, 10);
    text(PAGE_WIDTH - 48 - textWidth(amount, 10, false), amount, 10);
    y -= 13;
  }
  const dedLabel = 'TOTAL DEDUCTIONS';
  const dedAmount = fmtKES(view.totals.deductions);
  text(56, dedLabel, 10, true);
  text(PAGE_WIDTH - 48 - textWidth(dedAmount, 10, true), dedAmount, 10, true);
  y -= 18;

  // Employer contributions (informational).
  if (view.employerContributions.length > 0) {
    rule();
    y -= 16;
    text(48, 'EMPLOYER CONTRIBUTIONS (not deducted from you)', 9, true);
    y -= 13;
    for (const line of view.employerContributions) {
      const amount = fmtKES(line.amount);
      text(56, line.label, 9);
      text(PAGE_WIDTH - 48 - textWidth(amount, 9, false), amount, 9);
      y -= 12;
    }
    y -= 6;
  }

  // Net pay band.
  y -= 6;
  rule(1.5);
  y -= 22;
  const netLabel = 'NET PAY';
  const netAmount = fmtKES(view.totals.net);
  text(48, netLabel, 14, true);
  text(PAGE_WIDTH - 48 - textWidth(netAmount, 14, true), netAmount, 14, true);
  y -= 20;
  rule(1.5);
  y -= 18;

  // Working stats + payment footer.
  text(
    48,
    `Days worked: ${view.workingStats.daysWorked}   Absent: ${view.workingStats.daysAbsent}   Leave: ${view.workingStats.daysOnLeave}   Overtime: ${view.workingStats.overtimeHours}h`,
    9,
  );
  y -= 12;
  const payLine = `Payment: ${view.payment.status}${view.payment.reference ? ` (ref ${view.payment.reference})` : ''}${view.payment.date ? ` on ${new Date(view.payment.date).toISOString().slice(0, 10)}` : ''}`;
  text(48, payLine, 9);
  y -= 12;
  text(
    48,
    'Issued through the Mbumah Hardware POS payroll engine. This slip is generated from versioned statutory rate tables recorded on the payslip.',
    8,
  );

  return assemblePdf(ops);
}

/** Compose the PDF file structure: objects, content stream, xref, trailer. */
function assemblePdf(ops: Op[]): Uint8Array {
  const content: string[] = [];
  for (const op of ops) {
    if (op.kind === 'text') {
      content.push(
        `BT /${op.bold ? 'F2' : 'F1'} ${op.size} Tf ${op.x.toFixed(2)} ${op.y.toFixed(2)} Td (${pdfEscape(op.value)}) Tj ET`,
      );
    } else {
      content.push(
        `${op.width} w ${op.x1.toFixed(2)} ${op.y1.toFixed(2)} m ${op.x2.toFixed(2)} ${op.y2.toFixed(2)} l S`,
      );
    }
  }
  const stream = content.join('\n');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const binary = body + xref + trailer;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}
