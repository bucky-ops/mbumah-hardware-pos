import { ReceiptText, ShieldCheck, Smartphone, User, Truck } from 'lucide-react';
import { formatKES } from '@/lib/utils/financialMath';

/**
 * DigitalDocumentView / DigitalDeliveryView (v2.10.0)
 *
 * Colored, mobile-friendly digital copies of the five business documents
 * (INVOICE / QUOTATION / PROFORMA / CREDIT NOTE / DEBIT NOTE) and delivery
 * notes - the exact same views the public /r/<docNumber> page renders when a
 * customer scans the QR on a printed document, reused inline by the in-app
 * DigitalReceiptViewer (scroll + autofit) so staff see precisely what the
 * customer sees.
 *
 * UNIVERSAL COMPONENT: no 'use client', no hooks, no window access - renders
 * on the server (public page, React Server Component) and inside client
 * dialogs alike. Callers map their data (Prisma rows or API contracts) into
 * the plain props below.
 *
 * PRIVACY: these views render only customer-safe fields. Callers on the
 * public page must NOT pass phone / e-mail / address, cost prices, margins,
 * supplier or internal data.
 */

// Invoice-family documents (the five types)

export interface DigitalDocLine {
  name: string;
  description?: string | null;
  quantity: number;
  unitType?: string | null;
  pricePerUnit?: number;
  discountPercent?: number;
  taxRate?: number;
  lineTotal?: number;
}

export interface DigitalDocTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface DigitalDocumentViewProps {
  docNumber: string;
  /** e.g. 'INVOICE' | 'QUOTATION' | 'PROFORMA INVOICE' | 'CREDIT NOTE' | 'DEBIT NOTE'. */
  typeLabel: string;
  /** Accent hex (matches the printed document band). */
  accent: string;
  storeName: string;
  /** Location · phone line under the store name. */
  storeLine?: string;
  status?: string;
  /** Pre-formatted date strings (caller decides locale/format). */
  issued?: string | null;
  due?: string | null;
  customerName?: string | null;
  items: DigitalDocLine[];
  totals?: DigitalDocTotals | null;
  notes?: string | null;
  terms?: string | null;
}

export function DigitalDocumentView({
  docNumber,
  typeLabel,
  accent,
  storeName,
  storeLine,
  status,
  issued,
  due,
  customerName,
  items,
  totals,
  notes,
  terms,
}: DigitalDocumentViewProps) {
  return (
    <DigitalDocShell
      accent={accent}
      storeName={storeName}
      storeLine={storeLine}
      typeLabel={typeLabel}
      status={status}
      docNumber={docNumber}
    >
      <dl className="space-y-1 border-b border-dashed border-stone-300 py-4 text-xs text-stone-600">
        <div className="flex justify-between gap-3">
          <dt>Document No.</dt>
          <dd className="font-mono font-semibold text-stone-900">{docNumber}</dd>
        </div>
        {issued ? <div className="flex justify-between"><dt>Issued</dt><dd>{issued}</dd></div> : null}
        {due ? <div className="flex justify-between"><dt>Due</dt><dd>{due}</dd></div> : null}
        {customerName ? (
          <div className="flex justify-between">
            <dt>Bill To</dt>
            <dd className="max-w-[60%] truncate text-right font-medium text-stone-800">{customerName}</dd>
          </div>
        ) : null}
      </dl>

      <ul className="divide-y divide-dashed divide-stone-200 py-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug text-stone-900">{item.name}</p>
              {item.description ? (
                <p className="mt-0.5 text-xs text-stone-500">{item.description}</p>
              ) : null}
              <p className="mt-0.5 text-xs text-stone-500">
                {item.quantity} {item.unitType || ''}
                {item.pricePerUnit !== undefined ? ` × ${formatKES(item.pricePerUnit)}` : ''}
                {item.discountPercent && item.discountPercent > 0 ? ` · −${item.discountPercent}%` : ''}
                {item.taxRate && item.taxRate > 0 ? ` · VAT ${item.taxRate}%` : ''}
              </p>
            </div>
            {item.lineTotal !== undefined ? (
              <p className="shrink-0 text-sm font-semibold text-stone-900">{formatKES(item.lineTotal)}</p>
            ) : null}
          </li>
        ))}
        {items.length === 0 ? (
          <li className="py-3 text-center text-xs text-stone-400">No line items</li>
        ) : null}
      </ul>

      {totals ? <DigitalDocTotalsBlock totals={totals} accent={accent} /> : null}

      {notes || terms ? (
        <div className="mt-4 space-y-2">
          {notes ? <DigitalDocNoteBlock label="Notes" text={notes} /> : null}
          {terms ? <DigitalDocNoteBlock label="Terms & Conditions" text={terms} /> : null}
        </div>
      ) : null}
    </DigitalDocShell>
  );
}

// Delivery notes

export interface DigitalDeliveryViewProps {
  docNumber: string;
  accent?: string;
  storeName: string;
  storeLine?: string;
  status?: string;
  /** Pre-formatted date strings. */
  scheduled?: string | null;
  delivered?: string | null;
  customerName?: string | null;
  deliveryAddress?: string | null;
  driverName?: string | null;
  vehicleNumber?: string | null;
  items: DigitalDocLine[];
  notes?: string | null;
}

export function DigitalDeliveryView({
  docNumber,
  accent = '#16a34a',
  storeName,
  storeLine,
  status,
  scheduled,
  delivered,
  customerName,
  deliveryAddress,
  driverName,
  vehicleNumber,
  items,
  notes,
}: DigitalDeliveryViewProps) {
  return (
    <DigitalDocShell
      accent={accent}
      storeName={storeName}
      storeLine={storeLine}
      typeLabel="DELIVERY NOTE"
      status={status}
      docNumber={docNumber}
    >
      <dl className="space-y-1 border-b border-dashed border-stone-300 py-4 text-xs text-stone-600">
        <div className="flex justify-between gap-3">
          <dt>Delivery No.</dt>
          <dd className="font-mono font-semibold text-stone-900">{docNumber}</dd>
        </div>
        {customerName ? (
          <div className="flex justify-between">
            <dt>Deliver To</dt>
            <dd className="max-w-[60%] truncate text-right font-medium text-stone-800">{customerName}</dd>
          </div>
        ) : null}
        {scheduled ? <div className="flex justify-between"><dt>Scheduled</dt><dd>{scheduled}</dd></div> : null}
        {delivered ? <div className="flex justify-between"><dt>Delivered</dt><dd>{delivered}</dd></div> : null}
      </dl>

      <ul className="divide-y divide-dashed divide-stone-200 py-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug text-stone-900">{item.name}</p>
              {item.description ? (
                <p className="mt-0.5 text-xs text-stone-500">{item.description}</p>
              ) : null}
            </div>
            <p className="shrink-0 text-sm font-semibold text-stone-900">
              {item.quantity} {item.unitType || ''}
            </p>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="py-3 text-center text-xs text-stone-400">No items recorded</li>
        ) : null}
      </ul>

      {deliveryAddress ? (
        <div className="mt-3 rounded-xl bg-stone-50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-400">
            <Truck className="h-3.5 w-3.5" aria-hidden /> Delivery address
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{deliveryAddress}</p>
        </div>
      ) : null}

      {driverName || vehicleNumber ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
          {driverName ? (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" aria-hidden /> Driver:{' '}
              <span className="font-medium text-stone-700">{driverName}</span>
            </span>
          ) : null}
          {vehicleNumber ? <span>Vehicle: <span className="font-mono text-stone-700">{vehicleNumber}</span></span> : null}
        </div>
      ) : null}

      {notes ? <div className="mt-3"><DigitalDocNoteBlock label="Notes" text={notes} /></div> : null}
    </DigitalDocShell>
  );
}

// Shared shell

function DigitalDocShell({
  accent,
  storeName,
  storeLine,
  typeLabel,
  status,
  docNumber,
  children,
}: {
  accent: string;
  storeName: string;
  storeLine?: string;
  typeLabel: string;
  status?: string;
  docNumber: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md font-sans">
      <div
        className="overflow-hidden rounded-t-2xl p-5 text-white shadow-lg"
        style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)` }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg font-black tracking-tight">
            MH
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold leading-tight">{storeName}</h1>
            {storeLine ? <p className="text-xs text-white/85">{storeLine}</p> : null}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold tracking-wide">
            {typeLabel}
          </span>
          {status ? (
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold" style={{ color: accent }}>
              {status}
            </span>
          ) : null}
        </div>
      </div>

      <div className="rounded-b-2xl border border-t-0 border-stone-200 bg-white px-5 pb-6 shadow-lg">
        {children}

        <div className="mt-5 rounded-xl bg-stone-50 p-3 text-center">
          <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-stone-500">
            <Smartphone className="h-3.5 w-3.5" aria-hidden />
            Digital copy - scanned from the QR code on your document
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-1 text-center text-[11px] text-stone-500">
        <p className="flex items-center justify-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: accent }} aria-hidden />
          Verified digital record · {docNumber}
        </p>
        <p className="flex items-center justify-center gap-1.5">
          <ReceiptText className="h-3.5 w-3.5" aria-hidden />
          Keep this link or your paper document for your records
        </p>
        <p className="pt-1 text-stone-400">Powered by MBUMAH HARDWARE POS · Made in Kenya 🇰🇪</p>
      </div>
    </div>
  );
}

function DigitalDocTotalsBlock({
  totals,
  accent,
}: {
  totals: DigitalDocTotals;
  accent: string;
}) {
  return (
    <dl className="space-y-1.5 border-t border-dashed border-stone-300 pt-4 text-sm">
      <div className="flex justify-between text-stone-600">
        <dt>Subtotal</dt>
        <dd>{formatKES(totals.subtotal)}</dd>
      </div>
      {totals.discountAmount > 0 ? (
        <div className="flex justify-between" style={{ color: accent }}>
          <dt>Discount</dt>
          <dd>− {formatKES(totals.discountAmount)}</dd>
        </div>
      ) : null}
      <div className="flex justify-between text-stone-600">
        <dt>Tax</dt>
        <dd>{formatKES(totals.taxAmount)}</dd>
      </div>
      <div className="flex items-baseline justify-between border-t border-stone-300 pt-2.5">
        <dt className="text-base font-bold text-stone-900">TOTAL</dt>
        <dd className="text-xl font-black tracking-tight" style={{ color: accent }}>
          {formatKES(totals.totalAmount)}
        </dd>
      </div>
    </dl>
  );
}

function DigitalDocNoteBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-xl bg-stone-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{label}</p>
      <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{text}</p>
    </div>
  );
}
