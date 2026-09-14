"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Printer, QrCode, Zap, X } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { jsPDF } from "jspdf";
import { useCartStore } from "@/stores/cart";
import { formatKES, formatQty } from "@/lib/format";
import type { ReceiptData } from "@/lib/types";
import { ReceiptSmsButton } from "@/components/pos/ReceiptSmsButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

// ─────────────────────────────────────────────────────────────────────────────
// CheckoutReceipt — 80mm tax-invoice preview + printing (v2).
//
//  • "Print" builds a standalone 80mm HTML document (with embedded eTIMS QR)
//    and prints it from a hidden iframe (srcdoc) — bypasses the main page's
//    print CSS entirely.
//  • "Download PDF" renders a vector 80mm receipt via jsPDF (crisp at any
//    zoom, sized to content height — no blank pages).
//  • "Send to Thermal (ESC/POS)" dispatches the `mbumah:print-receipt`
//    CustomEvent; the ESC/POS encoder listens on window and encodes the same
//    ReceiptData (including its own QR byte-block) for the thermal printer.
//  • "Send via SMS" (Task 20-b, extracted into <ReceiptSmsButton> in 21-d)
//    POSTs /api/v1/sales/[id]/receipt-sms when the receipt carries a
//    transactionId AND a customer is attached (server holds the decrypted
//    phone; masked number only ever reaches the client). Hidden for walk-in
//    receipts; spinner while sending, "Sent" check after success, and the
//    server's 60s spam-guard message surfaces verbatim on a double send.
//  • eTIMS QR payload mirrors the thermal encoder: TX|TOTAL|DATE so KRA
//    verification scans match the printed receipt.
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Canonical eTIMS verification string — shared by screen QR, print HTML and ESC/POS. */
export function etimsQrPayload(r: ReceiptData): string {
  return `TX:${r.ref}|TOTAL:${r.total.toFixed(2)}|DATE:${r.createdAt}`;
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  MPESA: "M-Pesa",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  STORE_CREDIT: "Store credit",
};

/** Standalone 80mm-wide HTML document (monospace, dashed separators, eTIMS footer). */
function buildReceiptHtml(r: ReceiptData, qrDataUrl: string | null): string {
  const rows = r.lines
    .map(
      (l) => `
      <div class="row"><span class="grow">${escapeHtml(l.description)}</span><span class="cat">${escapeHtml(l.uom)}</span></div>
      <div class="row muted"><span>${formatQty(l.qty, l.uom)} × ${formatKES(l.unitPrice)}${l.discountPct ? ` (−${l.discountPct}%)` : ""} [${escapeHtml(r.taxCategories.includes(",") ? "B" : r.taxCategories || "B")}]</span><span>${formatKES(l.lineNet)}</span></div>`
    )
    .join("");

  const payments = r.payments
    .map(
      (p) =>
        `<div class="row"><span>${escapeHtml(PAYMENT_LABELS[p.method] ?? p.method)}${p.reference ? ` (${escapeHtml(p.reference)})` : ""}</span><span>${formatKES(p.amount)}</span></div>`
    )
    .join("");

  const net = r.total - r.vat;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(r.invoiceNumber)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { font-family: "Courier New", ui-monospace, monospace; font-size: 10px; width: 74mm; margin: 0 auto; color: #111; }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .big { font-size: 12px; }
  .muted { font-size: 9px; color: #444; }
  .dashed { border-top: 1px dashed #555; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; gap: 6px; line-height: 1.5; }
  .grow { flex: 1; }
  .cat { color: #666; }
  .totals .row span:first-child { color: #333; }
  .qr { display: block; margin: 4px auto 0; width: 26mm; height: 26mm; }
</style></head>
<body>
  <div class="center bold big">${escapeHtml(r.branchName)}</div>
  ${r.branchLocation ? `<div class="center muted">${escapeHtml(r.branchLocation)}</div>` : ""}
  <div class="center">KRA PIN: ${escapeHtml(r.kraPin)}</div>
  <div class="center muted">CU-SN: ${escapeHtml(r.cuSerial)} · HS: ${escapeHtml(r.hsCodesSummary || "—")}</div>
  <div class="dashed"></div>
  <div class="row"><span>INVOICE: <b>${escapeHtml(r.invoiceNumber)}</b></span><span>${new Date(r.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}</span></div>
  <div class="row muted"><span>Cashier: ${escapeHtml(r.cashier)}</span><span>${escapeHtml(r.customerName ?? "Walk-in")}</span></div>
  ${r.buyerPin ? `<div class="row"><span>BUYER PIN:</span><span>${escapeHtml(r.buyerPin)}</span></div>` : ""}
  <div class="dashed"></div>
  ${rows}
  <div class="dashed"></div>
  <div class="totals">
    <div class="row"><span>Gross</span><span>${formatKES(r.grossSubtotal)}</span></div>
    ${r.discount > 0 ? `<div class="row"><span>Discount</span><span>−${formatKES(r.discount)}</span></div>` : ""}
    <div class="row"><span>NET</span><span>${formatKES(net)}</span></div>
    <div class="row"><span>VAT 16%${r.vatInclusive ? " (incl.)" : ""}</span><span>${formatKES(r.vat)}</span></div>
    <div class="row bold big"><span>TOTAL KES</span><span>${formatKES(r.total)}</span></div>
  </div>
  <div class="dashed"></div>
  ${payments}
  ${r.balance > 0 ? `<div class="row bold"><span>BALANCE DUE</span><span>${formatKES(r.balance)}</span></div>` : `<div class="row"><span>Paid in full</span><span></span></div>`}
  <div class="dashed"></div>
  ${qrDataUrl ? `<img class="qr" alt="eTIMS verification QR" src="${qrDataUrl}" />` : ""}
  <div class="center muted">Scan to verify · eTIMS compliant tax invoice</div>
  <div class="center muted">Tax categories: ${escapeHtml(r.taxCategories || "B")} · ${escapeHtml(r.ref)}</div>
</body></html>`;
}

/** Vector 80mm PDF via jsPDF — courier text layout, height sized to content. */
function downloadReceiptPdf(r: ReceiptData, qrDataUrl: string | null): void {
  const PAGE_W = 80; // mm
  const MARGIN = 4;
  const LINE_H = 3.6;
  const content = r.lines.length + 14; // items + header/totals/footer blocks
  const PAGE_H = Math.max(140, Math.min(400, content * LINE_H + 60));

  const doc = new jsPDF({ unit: "mm", format: [PAGE_W, PAGE_H] });
  let y = MARGIN + 2;
  const cx = PAGE_W / 2;
  const line = (text: string, size = 7, bold = false, center = false) => {
    doc.setFont("courier", bold ? "bold" : "normal");
    doc.setFontSize(size);
    if (center) doc.text(text, cx, y, { align: "center" });
    else doc.text(text, MARGIN, y);
    y += LINE_H * (size >= 9 ? 1.2 : 1);
  };
  const pair = (left: string, right: string, bold = false) => {
    doc.setFont("courier", bold ? "bold" : "normal");
    doc.setFontSize(7);
    doc.text(left, MARGIN, y);
    doc.text(right, PAGE_W - MARGIN, y, { align: "right" });
    y += LINE_H;
  };
  const dashed = () => {
    doc.setLineDashPattern([0.6, 0.6], 0);
    doc.setDrawColor(90);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    doc.setLineDashPattern([], 0);
    y += 2.4;
  };

  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  doc.text(r.branchName.toUpperCase().slice(0, 34), cx, y, { align: "center" });
  y += LINE_H * 1.3;
  if (r.branchLocation) line(r.branchLocation.slice(0, 40), 6.4, false, true);
  line(`KRA PIN: ${r.kraPin}`, 7, false, true);
  line(`CU-SN: ${r.cuSerial}`, 6.2, false, true);
  if (r.hsCodesSummary) line(`HS: ${r.hsCodesSummary.slice(0, 44)}`, 6.2, false, true);
  dashed();
  pair(`INVOICE: ${r.invoiceNumber}`, new Date(r.createdAt).toLocaleDateString("en-KE"), true);
  pair(`Cashier: ${r.cashier.slice(0, 18)}`, (r.customerName ?? "Walk-in").slice(0, 18));
  if (r.buyerPin) pair("BUYER PIN:", r.buyerPin);
  dashed();
  for (const l of r.lines) {
    line(l.description.slice(0, 36), 7, true);
    pair(
      `${formatQty(l.qty, l.uom)} x ${l.unitPrice.toFixed(2)}${l.discountPct ? ` -${l.discountPct}%` : ""}`,
      l.lineNet.toFixed(2)
    );
  }
  dashed();
  pair("Gross", r.grossSubtotal.toFixed(2));
  if (r.discount > 0) pair("Discount", `-${r.discount.toFixed(2)}`);
  pair("NET", net2(r));
  pair(`VAT 16%${r.vatInclusive ? " (incl.)" : ""}`, r.vat.toFixed(2));
  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.text("TOTAL KES", MARGIN, y);
  doc.text(r.total.toFixed(2), PAGE_W - MARGIN, y, { align: "right" });
  y += LINE_H * 1.4;
  dashed();
  for (const p of r.payments) {
    pair(`${PAYMENT_LABELS[p.method] ?? p.method}${p.reference ? ` (${p.reference})` : ""}`, p.amount.toFixed(2));
  }
  if (r.balance > 0) pair("BALANCE DUE", r.balance.toFixed(2), true);
  else pair("Paid in full", "");
  dashed();
  // eTIMS QR (verification payload identical to thermal ESC/POS QR)
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, "PNG", cx - 13, y, 26, 26);
      y += 28;
    } catch {
      /* QR image optional — text footer still identifies the invoice */
    }
  }
  line("Scan QR to verify · eTIMS tax invoice", 6.2, false, true);
  line(`Tax cat: ${r.taxCategories || "B"} · ${r.ref}`, 6.2, false, true);

  doc.save(`receipt-${r.invoiceNumber}.pdf`);
}

function net2(r: ReceiptData): string {
  return (r.total - r.vat).toFixed(2);
}

export function CheckoutReceipt() {
  const receiptDialogOpen = useCartStore((s) => s.receiptDialogOpen);
  const lastReceipt = useCartStore((s) => s.lastReceipt);
  const closeReceipt = useCartStore((s) => s.closeReceipt);
  const [qr, setQr] = useState<{ ref: string; url: string } | null>(null);

  // Render the eTIMS QR whenever a new receipt is shown. Keyed by ref so a
  // slow QR render for receipt B can never display receipt A's image.
  useEffect(() => {
    if (!lastReceipt) return;
    const target = lastReceipt;
    let cancelled = false;
    QRCode.toDataURL(etimsQrPayload(target), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: { dark: "#1c1917", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQr({ ref: target.ref, url });
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lastReceipt]);

  const print = useCallback(() => {
    if (!lastReceipt) return;
    // Hidden iframe print — a fresh document with its own 80mm @page CSS, so
    // the workspace's print styles can never corrupt the receipt layout.
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    iframe.srcdoc = buildReceiptHtml(lastReceipt, qr?.ref === lastReceipt.ref ? qr.url : null);
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      window.setTimeout(() => iframe.remove(), 1_500);
    };
    document.body.appendChild(iframe);
  }, [lastReceipt, qr]);

  const sendToThermal = useCallback(() => {
    if (!lastReceipt) return;
    window.dispatchEvent(new CustomEvent<ReceiptData>("mbumah:print-receipt", { detail: lastReceipt }));
    toast.success("Receipt sent to thermal printer (ESC/POS)");
  }, [lastReceipt]);

  if (!lastReceipt) return null;
  const r = lastReceipt;
  const net = r.total - r.vat;
  const qrDataUrl = qr?.ref === r.ref ? qr.url : null;
  // Only when the receipt identifies the transaction AND a customer (walk-in
  // receipts have no phone to text — cleaner than a permanently disabled row).
  const smsCapable = Boolean(r.transactionId && r.customerName);

  return (
    <Dialog open={receiptDialogOpen} onOpenChange={(open) => !open && closeReceipt()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden /> Receipt
          </DialogTitle>
          <DialogDescription>80mm preview — {r.ref}</DialogDescription>
        </DialogHeader>

        {/* 80mm thermal paper preview — serrated top/bottom edges + receipt typography */}
        <div
          className="receipt-paper relative mx-auto w-full max-w-[320px] bg-white p-4 pt-5 font-mono text-[11px] leading-relaxed text-stone-900 dark:bg-stone-900 dark:text-stone-100"
          style={{
            boxShadow: "0 1px 2px rgba(0,0,0,.08), 0 8px 24px -12px rgba(0,0,0,.25)",
            borderTop: "none",
            borderBottom: "none",
          }}
        >
          {/* perforation edges — light & dark stacked (the paper fill color is
              baked into the gradient, which inline styles can't theme-switch) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-[radial-gradient(circle_at_6px_0px,transparent_5px,#fff_5px)] dark:hidden"
            style={{ backgroundSize: "12px 8px", backgroundPosition: "-6px -4px" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 hidden h-2 bg-[radial-gradient(circle_at_6px_0px,transparent_5px,#1c1917_5px)] dark:block"
            style={{ backgroundSize: "12px 8px", backgroundPosition: "-6px -4px" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2 bg-[radial-gradient(circle_at_6px_8px,transparent_5px,#fff_5px)] dark:hidden"
            style={{ backgroundSize: "12px 8px", backgroundPosition: "-6px 4px" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-2 bg-[radial-gradient(circle_at_6px_8px,transparent_5px,#1c1917_5px)] dark:block"
            style={{ backgroundSize: "12px 8px", backgroundPosition: "-6px 4px" }}
          />

          <div className="text-center">
            <p className="text-sm font-bold uppercase tracking-wide">{r.branchName}</p>
            {r.branchLocation && <p className="text-[10px] text-stone-500 dark:text-stone-400">{r.branchLocation}</p>}
            <p className="mt-1">KRA PIN: {r.kraPin}</p>
            {r.buyerPin && (
              <p>
                BUYER PIN: <span className="font-semibold">{r.buyerPin}</span>
              </p>
            )}
            <p className="text-[10px] text-stone-500 dark:text-stone-400">
              CU-SN: {r.cuSerial} · HS: {r.hsCodesSummary || "—"}
            </p>
            <div className="mt-2 flex items-center justify-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px]">
                INVOICE {r.invoiceNumber}
              </Badge>
              <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-300">
                Tax cat {r.taxCategories || "B"}
              </Badge>
            </div>
            <p className="mt-1 text-[10px] text-stone-500 dark:text-stone-400">
              {new Date(r.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })} · {r.cashier}
            </p>
          </div>

          <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

          <div className="grid gap-1.5">
            {r.lines.map((l, idx) => (
              <div key={`${r.ref}-${idx}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 grow">{l.description}</span>
                  <span className="font-semibold tabular-nums">{formatKES(l.lineNet)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-stone-500 dark:text-stone-400">
                  <span>
                    {formatQty(l.qty, l.uom)} × {formatKES(l.unitPrice)}
                    {l.discountPct ? ` (−${l.discountPct}%)` : ""}
                  </span>
                  <span className="rounded-sm border border-stone-300 px-1 leading-none dark:border-stone-700">
                    {r.taxCategories.includes(",") ? "B" : r.taxCategories || "B"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

          <div className="grid gap-0.5">
            <div className="flex justify-between">
              <span>Gross</span>
              <span className="tabular-nums">{formatKES(r.grossSubtotal)}</span>
            </div>
            {r.discount > 0 && (
              <div className="flex justify-between text-rose-700 dark:text-rose-400">
                <span>Discount</span>
                <span className="tabular-nums">−{formatKES(r.discount)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium">
              <span>NET</span>
              <span className="tabular-nums">{formatKES(net)}</span>
            </div>
            <div className="flex justify-between">
              <span>VAT 16%{r.vatInclusive ? " (incl.)" : ""}</span>
              <span className="tabular-nums">{formatKES(r.vat)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-dashed border-stone-300 pt-1 text-sm font-bold dark:border-stone-700">
              <span>TOTAL</span>
              <span className="tabular-nums">{formatKES(r.total)}</span>
            </div>
          </div>

          <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

          <div className="grid gap-0.5">
            {r.payments.map((p, idx) => (
              <div key={`${p.method}-${idx}`} className="flex justify-between">
                <span>
                  {PAYMENT_LABELS[p.method] ?? p.method}
                  {p.reference ? <span className="text-stone-500 dark:text-stone-400"> ({p.reference})</span> : null}
                </span>
                <span className="tabular-nums">{formatKES(p.amount)}</span>
              </div>
            ))}
            {r.balance > 0 ? (
              <div className="flex justify-between font-bold text-amber-700 dark:text-amber-300">
                <span>BALANCE DUE</span>
                <span className="tabular-nums">{formatKES(r.balance)}</span>
              </div>
            ) : (
              <div className="flex justify-between text-stone-500 dark:text-stone-400">
                <span>Paid in full</span>
                <span>{r.customerName ?? ""}</span>
              </div>
            )}
          </div>

          <Separator className="my-2 border-dashed border-stone-300 dark:border-stone-700" />

          {/* eTIMS verification QR — payload matches the thermal ESC/POS QR bytes */}
          {qrDataUrl && (
            <div className="flex flex-col items-center gap-1">
              <img
                src={qrDataUrl}
                alt={`eTIMS verification QR for ${r.invoiceNumber}`}
                className="h-24 w-24 rounded-sm bg-white p-0.5"
              />
              <p className="text-[9px] tracking-wide text-stone-400 dark:text-stone-500">Scan to verify with KRA</p>
            </div>
          )}
          <p className="text-center text-[10px] tracking-wide text-stone-500 dark:text-stone-400">eTIMS compliant tax invoice</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={print}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          {smsCapable && r.transactionId && <ReceiptSmsButton transactionId={r.transactionId} />}
          <Button
            variant="outline"
            onClick={() => {
              downloadReceiptPdf(r, qrDataUrl);
              toast.success("Receipt PDF downloaded");
            }}
          >
            <Download className="mr-2 h-4 w-4" /> Download PDF
          </Button>
          <Button
            onClick={sendToThermal}
            className="bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <Zap className="mr-2 h-4 w-4" /> Send to Thermal (ESC/POS)
          </Button>
          <Button variant="ghost" onClick={closeReceipt}>
            <X className="mr-2 h-4 w-4" /> New sale
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
