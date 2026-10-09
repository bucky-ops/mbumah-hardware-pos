import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { formatKES } from '@/lib/utils/financialMath';
import { getVatRatePercent } from '@/lib/vat-settings';
import { STORE_LIST, COMPANY } from '@/lib/store-info';
import { ReceiptText, ShieldCheck, Smartphone } from 'lucide-react';
import {
  DigitalDocumentView,
  DigitalDeliveryView,
  type DigitalDocLine,
} from '@/components/documents/digital-document-view';

/**
 * PUBLIC DIGITAL RECEIPT (v2.5.0) - /r/<receiptNumber>
 *
 * The QR code printed on every POS receipt now encodes the URL of THIS page,
 * so a customer who scans it gets a colored, digital, mobile-friendly copy
 * of their receipt - no app, no login, no paper.
 *
 * v2.10.0 - the SAME URL shape now also resolves BUSINESS DOCUMENTS:
 *   1. SalesTransaction.receiptNumber  → colored sales receipt (below)
 *   2. Invoice.invoiceNumber           → digital INVOICE / QUOTATION /
 *      PROFORMA / CREDIT NOTE / DEBIT NOTE (DigitalDocumentView)
 *   3. DeliveryNote.deliveryNumber     → digital delivery note
 *      (DigitalDeliveryView)
 * so the QR printed on every branded document opens its digital copy -
 * the same behaviour customers already knew from POS receipts.
 *
 * Security / privacy:
 *   • The document number is the capability token (unique per document).
 *     Invoice numbers are sequential - the page therefore renders
 *     CUSTOMER-SAFE FIELDS ONLY (customer name, items, totals). It NEVER
 *     renders phone / e-mail / address, cost prices, profit margins,
 *     supplier data or internal data.
 *   • The page is `noindex` so search engines don't index customer records.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Digital Receipt — MBUMAH HARDWARE',
  robots: { index: false, follow: false },
};

function safeNumber(v: unknown): number {
  const n = typeof v === 'object' && v !== null && 'toNumber' in (v as object)
    ? (v as { toNumber: () => number }).toNumber()
    : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash',
  MPESA: 'M-Pesa',
  DEBT: 'Credit (Pay Later)',
  SPLIT: 'Split Payment',
  CARD: 'Card',
};

export default async function DigitalReceiptPage({
  params,
}: {
  params: Promise<{ receiptNumber: string }>;
}) {
  const { receiptNumber } = await params;

  const tx = await db.salesTransaction.findUnique({
    where: { receiptNumber },
    select: {
      receiptNumber: true,
      createdAt: true,
      subtotal: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      cashTendered: true,
      changeDue: true,
      paymentMethod: true,
      paymentStatus: true,
      transactionType: true,
      etimsInvoiceNumber: true,
      storeId: true,
      customer: { select: { name: true } },
      cashier: { select: { name: true } },
      items: {
        select: {
          // PUBLIC-SAFE FIELDS ONLY - costPrice is deliberately NOT selected.
          productName: true,
          quantity: true,
          unitType: true,
          pricePerUnit: true,
          lineTotal: true,
          isRentalItem: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  });

  if (!tx) {
    return <DocumentResolver docNumber={receiptNumber} />;
  }

  // v2.8.0: current admin-controlled VAT rate for the display label (the
  // amount itself is the stored tax component of THIS receipt).
  const vatRatePercent = await getVatRatePercent();

  const store =
    STORE_LIST.find((s) => s.id === tx.storeId) ?? null;
  const storeName = store?.name ?? COMPANY.legalName ?? 'MBUMAH HARDWARE';
  const storeLocation = store?.location ?? '';
  const storePhone = store?.phone ?? '';

  const subtotal = safeNumber(tx.subtotal);
  const taxAmount = safeNumber(tx.taxAmount);
  const discountAmount = safeNumber(tx.discountAmount);
  const totalAmount = safeNumber(tx.totalAmount);
  const changeDue = safeNumber(tx.changeDue);
  const isRefundOrVoid = tx.transactionType !== 'SALE';
  const paymentLabel = PAYMENT_LABELS[tx.paymentMethod] ?? tx.paymentMethod;

  const created = new Date(tx.createdAt).toLocaleString('en-KE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-100 to-stone-200 py-6 px-3 sm:py-10">
      <div className="mx-auto w-full max-w-md">
        {/* Colored brand header */}
        <div className="overflow-hidden rounded-t-2xl bg-gradient-to-r from-emerald-700 via-emerald-600 to-green-600 p-5 text-white shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-lg font-black tracking-tight">
              MH
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-extrabold leading-tight">
                {storeName}
              </h1>
              <p className="text-xs text-emerald-100">
                {storeLocation}
                {storePhone ? ` · ${storePhone}` : ''}
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold tracking-wide">
              {isRefundOrVoid ? tx.transactionType : 'SALES RECEIPT'}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                tx.paymentStatus === 'COMPLETED'
                  ? 'bg-white text-emerald-700'
                  : 'bg-amber-300 text-amber-900'
              }`}
            >
              {tx.paymentStatus}
            </span>
          </div>
        </div>

        {/* Receipt body */}
        <div className="rounded-b-2xl border border-t-0 border-stone-200 bg-white px-5 pb-6 shadow-lg">
          <dl className="space-y-1 border-b border-dashed border-stone-300 py-4 text-xs text-stone-600">
            <div className="flex justify-between gap-3">
              <dt>Receipt No.</dt>
              <dd className="font-mono font-semibold text-stone-900">
                {tx.receiptNumber}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Date</dt>
              <dd>{created}</dd>
            </div>
            {tx.cashier?.name ? (
              <div className="flex justify-between">
                <dt>Served by</dt>
                <dd>{tx.cashier.name}</dd>
              </div>
            ) : null}
            {tx.customer?.name ? (
              <div className="flex justify-between">
                <dt>Customer</dt>
                <dd className="max-w-[60%] truncate text-right">
                  {tx.customer.name}
                </dd>
              </div>
            ) : null}
          </dl>

          {/* Items */}
          <ul className="divide-y divide-dashed divide-stone-200 py-2">
            {tx.items.map((item, idx) => {
              const qty = safeNumber(item.quantity);
              const price = safeNumber(item.pricePerUnit);
              const line = safeNumber(item.lineTotal);
              const unit = (item.unitType || '').trim();
              return (
                <li key={idx} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug text-stone-900">
                      {item.productName}
                      {item.isRentalItem ? (
                        <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                          RENTAL
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {qty} {unit} × {formatKES(price)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-stone-900">
                    {formatKES(line)}
                  </p>
                </li>
              );
            })}
          </ul>

          {/* Totals */}
          <dl className="space-y-1.5 border-t border-dashed border-stone-300 pt-4 text-sm">
            <div className="flex justify-between text-stone-600">
              <dt>Subtotal</dt>
              <dd>{formatKES(subtotal)}</dd>
            </div>
            {discountAmount > 0 ? (
              <div className="flex justify-between text-emerald-700">
                <dt>Discount</dt>
                <dd>− {formatKES(discountAmount)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-stone-600">
              {/* v2.8.0: dynamic admin-controlled rate (amount is stored data). */}
              <dt>VAT ({vatRatePercent}%)</dt>
              <dd>{formatKES(taxAmount)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-stone-300 pt-2.5">
              <dt className="text-base font-bold text-stone-900">TOTAL</dt>
              <dd className="text-xl font-black tracking-tight text-emerald-700">
                {formatKES(totalAmount)}
              </dd>
            </div>
            <div className="flex justify-between text-stone-600">
              <dt>Paid via</dt>
              <dd className="font-medium text-stone-900">{paymentLabel}</dd>
            </div>
            {tx.paymentMethod === 'CASH' && safeNumber(tx.cashTendered) > 0 ? (
              <>
                <div className="flex justify-between text-stone-600">
                  <dt>Cash tendered</dt>
                  <dd>{formatKES(safeNumber(tx.cashTendered))}</dd>
                </div>
                {changeDue > 0 ? (
                  <div className="flex justify-between font-medium text-stone-900">
                    <dt>Change</dt>
                    <dd>{formatKES(changeDue)}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
            {tx.etimsInvoiceNumber ? (
              <div className="flex justify-between pt-1 text-xs text-stone-500">
                <dt>KRA eTIMS Invoice</dt>
                <dd className="font-mono">{tx.etimsInvoiceNumber}</dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-5 rounded-xl bg-stone-50 p-3 text-center">
            <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-stone-500">
              <Smartphone className="h-3.5 w-3.5" aria-hidden />
              Digital copy — scanned from the QR code on your paper receipt
            </p>
          </div>
        </div>

        {/* Trust footer */}
        <div className="mt-4 space-y-1 text-center text-[11px] text-stone-500">
          <p className="flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            Verified digital record of a genuine MBUMAH HARDWARE sale
          </p>
          <p className="flex items-center justify-center gap-1.5">
            <ReceiptText className="h-3.5 w-3.5" aria-hidden />
            Keep this link or your paper receipt for returns
          </p>
          <p className="pt-1 text-stone-400">
            Powered by MBUMAH HARDWARE POS · Made in Kenya 🇰🇪
          </p>
        </div>
      </div>
    </main>
  );
}

// v2.10.0 - business-document resolver (invoices, quotations, proformas,
// credit notes, debit notes and delivery notes share the /r/<number> space).
// Rendered when the number is NOT a sales receipt. The lookups run in order
// and stop at the first match; an unknown number falls through to 404.

const DOC_ACCENTS: Record<string, string> = {
  INVOICE: '#ea580c',
  QUOTATION: '#0d9488',
  PROFORMA: '#7c3aed',
  CREDIT_NOTE: '#dc2626',
  DEBIT_NOTE: '#b45309',
  DELIVERY_NOTE: '#16a34a',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  INVOICE: 'INVOICE',
  QUOTATION: 'QUOTATION',
  PROFORMA: 'PROFORMA INVOICE',
  CREDIT_NOTE: 'CREDIT NOTE',
  DEBIT_NOTE: 'DEBIT NOTE',
  DELIVERY_NOTE: 'DELIVERY NOTE',
};

async function DocumentResolver({ docNumber }: { docNumber: string }) {
  // 1) Invoice-family documents (the five types). Privacy: customerPhone /
  //    Email / Address and any cost/margin fields are deliberately NOT
  //    selected - sequential invoice numbers make this page guessable.
  const invoice = await db.invoice.findUnique({
    where: { invoiceNumber: docNumber },
    select: {
      invoiceNumber: true,
      invoiceType: true,
      customerName: true,
      issueDate: true,
      dueDate: true,
      subtotal: true,
      taxAmount: true,
      discountAmount: true,
      totalAmount: true,
      status: true,
      notes: true,
      terms: true,
      storeId: true,
      items: {
        select: {
          productName: true,
          description: true,
          quantity: true,
          unitType: true,
          pricePerUnit: true,
          discountPercent: true,
          taxRate: true,
          lineTotal: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  });

  if (invoice) {
    const kind = String(invoice.invoiceType || 'INVOICE').toUpperCase();
    const store = STORE_LIST.find((s) => s.id === invoice.storeId) ?? null;
    const items: DigitalDocLine[] = invoice.items.map((item) => ({
      name: item.productName,
      description: item.description,
      quantity: safeNumber(item.quantity),
      unitType: item.unitType,
      pricePerUnit: safeNumber(item.pricePerUnit),
      discountPercent: safeNumber(item.discountPercent),
      taxRate: safeNumber(item.taxRate),
      lineTotal: safeNumber(item.lineTotal),
    }));

    return (
      <main className="min-h-screen bg-gradient-to-b from-stone-100 to-stone-200 py-6 px-3 sm:py-10">
        <DigitalDocumentView
          docNumber={invoice.invoiceNumber}
          typeLabel={DOC_TYPE_LABELS[kind] ?? kind}
          accent={DOC_ACCENTS[kind] ?? DOC_ACCENTS.INVOICE}
          storeName={store?.name ?? COMPANY.legalName ?? 'MBUMAH HARDWARE'}
          storeLine={[store?.location, store?.phone].filter(Boolean).join(' · ')}
          status={invoice.status}
          issued={new Date(invoice.issueDate).toLocaleDateString('en-KE', { dateStyle: 'medium' })}
          due={invoice.dueDate
            ? new Date(invoice.dueDate).toLocaleDateString('en-KE', { dateStyle: 'medium' })
            : null}
          customerName={invoice.customerName}
          items={items}
          totals={{
            subtotal: safeNumber(invoice.subtotal),
            discountAmount: safeNumber(invoice.discountAmount),
            taxAmount: safeNumber(invoice.taxAmount),
            totalAmount: safeNumber(invoice.totalAmount),
          }}
          notes={invoice.notes}
          terms={invoice.terms}
        />
      </main>
    );
  }

  // 2) Delivery notes.
  const note = await db.deliveryNote.findUnique({
    where: { deliveryNumber: docNumber },
    select: {
      deliveryNumber: true,
      customerName: true,
      deliveryAddress: true,
      driverName: true,
      vehicleNumber: true,
      status: true,
      scheduledDate: true,
      deliveredAt: true,
      notes: true,
      storeId: true,
      items: {
        select: { productName: true, quantity: true, unitType: true, notes: true },
        orderBy: { id: 'asc' },
      },
    },
  });

  if (note) {
    const store = STORE_LIST.find((s) => s.id === note.storeId) ?? null;
    const items: DigitalDocLine[] = note.items.map((item) => ({
      name: item.productName,
      description: item.notes,
      quantity: safeNumber(item.quantity),
      unitType: item.unitType,
    }));

    return (
      <main className="min-h-screen bg-gradient-to-b from-stone-100 to-stone-200 py-6 px-3 sm:py-10">
        <DigitalDeliveryView
          docNumber={note.deliveryNumber}
          storeName={store?.name ?? COMPANY.legalName ?? 'MBUMAH HARDWARE'}
          storeLine={[store?.location, store?.phone].filter(Boolean).join(' · ')}
          status={note.status}
          scheduled={note.scheduledDate
            ? new Date(note.scheduledDate).toLocaleDateString('en-KE', { dateStyle: 'medium' })
            : null}
          delivered={note.deliveredAt
            ? new Date(note.deliveredAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
            : null}
          customerName={note.customerName}
          deliveryAddress={note.deliveryAddress}
          driverName={note.driverName}
          vehicleNumber={note.vehicleNumber}
          items={items}
          notes={note.notes}
        />
      </main>
    );
  }

  notFound();
}
