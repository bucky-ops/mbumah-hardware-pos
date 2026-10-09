# Implementation Plan — QR Codes & Digital Receipts (All Document Types)

**Application:** Mbumah Hardware POS
**Version target:** v2.10.0
**Scope:** Invoices · Quotations · Proformas · Credit Notes · Debit Notes (Delivery Notes included because they share the same QR component)
**Status:** ✅ Implemented and shipped with this release (this document doubles as the delivered plan and the as-built record).

---

## 1. Problem statement

The POS receipt (transactions/checkout modal) already shows a live, scannable QR
code that opens the **public digital receipt page** (`/r/<receiptNumber>`). The
five business documents — invoices, quotations, proformas, credit notes and
debit notes — do **not** behave the same way:

1. Their on-screen QR (added v2.8.0, `DocumentQrBadge`) encodes a *self-contained
   verify string* (`MBUMAH|INVOICE|INV-2026-0001|Total:…|Date:…`). Scanning it
   shows plain text — it never opens a digital receipt, because no public page
   existed for documents.
2. The badge sits inside a flexible row of action buttons (`ml-auto self-center`),
   so on narrow screens it can be squeezed, wrapped awkwardly or visually lost.
3. There is no way to *click* the QR to inspect the digital receipt, no scroll
   viewer for long receipts, and no "fit to screen" option.

## 2. Current-state review (Step 1 findings)

| Surface | QR library | Payload today | Digital page? |
| --- | --- | --- | --- |
| POS receipt modal / checkout (`receipt-print.tsx`, `receipt-qr.ts`) | `qrcode.react` | `<origin>/r/<receiptNumber>` | ✅ `/r/[receiptNumber]` (sales transactions only) |
| Invoice view dialog — all 5 types (`invoices-tab.tsx`) | `qrcode.react` via `DocumentQrBadge` | verify string | ❌ |
| Invoice/delivery **printed** documents (`document-print.ts`) | `qrcode` (data-URI) | verify string | ❌ |
| Delivery note view dialog (`delivery-notes-tab.tsx`) | `DocumentQrBadge` | verify string | ❌ |
| Customer-credits print (`credits-tab.tsx`) | `qrcode` data-URI | verify string (docNo is a **ledger reference**, not a document number) | ❌ must stay a verify string |
| Rental receipt print (`rentals-tab.tsx`) | `qrcode` data-URI | verify string (`RENTAL`) | ❌ out of scope |
| KRA eTIMS invoice cards (`etims/qr-code-display.tsx`) | `qrcode.react` | KRA verification payload | n/a (real QR since v2.8.0) |

Key infra already present and reused: public page route `/r/[receiptNumber]`
(server component, `noindex`, capability-token model), `STORE_LIST` store
identity, dynamic admin-controlled VAT label (`getVatRatePercent`), branded
print pipeline (`buildBrandedDocumentHtml`).

## 3. Solution architecture

```
                 ┌───────────────────────────────┐
QR (all 5 types) │ <origin>/r/<docNumber>        │  ← same URL shape as receipts
   printed + ───► └──────────────┬────────────────┘
   on-screen                     │ server component resolves, in order:
                                 │  1. SalesTransaction.receiptNumber  → receipt view
                                 │  2. Invoice.invoiceNumber           → digital document view
                                 │  3. DeliveryNote.deliveryNumber     → digital delivery view
                                 │  4. otherwise 404
                                 ▼
                 Colored, mobile-friendly, public-safe page (no login)
```

In-app experience (staff side):

* The view dialog of every document type gains a dedicated **“Digital receipt
  (QR)”** card — a full-width section, never squeezed into the action-button row
  → guarantees visibility with zero clipping.
* The QR itself is a **button**; clicking it (or the **View receipt** button)
  opens the new **DigitalReceiptViewer** dialog.
* The viewer renders the same colored document as the public page **inline**:
  * **Scroll mode** — natural size inside a styled `ScrollArea` (custom
    scrollbar), so long receipts scroll smoothly.
  * **Autofit mode** — a toggle that measures the content vs. the container
    (`ResizeObserver`) and CSS-scales the whole receipt so it **fits entirely on
    screen** with no scrolling (great for presenting on a phone or projector).
  * **Open public page** — one tap opens `/r/<docNumber>` in a new tab.

## 4. Step-by-step implementation (as executed)

| # | Change | File(s) |
| --- | --- | --- |
| 1 | `buildDocumentQrPayload` now returns `<origin>/r/<docNumber>` for `INVOICE / QUOTATION / PROFORMA / CREDIT_NOTE / DEBIT_NOTE / DELIVERY_NOTE / RECEIPT` (browser + `origin` opt-in for server callers). Verify-string stays as the SSR fallback and for kinds that are not resolvable documents. New `linkToPage?: false` opt-out. | `src/lib/document-print.ts` |
| 2 | Public page extended: resolves a **sales transaction → invoice → delivery note** by number and renders the matching view; invoices render through the new `DigitalDocumentView`, delivery notes through `DigitalDeliveryView`. Public-safe fields only (customer **name**, items, totals — never phone/e-mail/address, cost prices, margins or internal data). | `src/app/r/[receiptNumber]/page.tsx` |
| 3 | New universal presentational views (no hooks → render on the server page **and** inside the client viewer): `DigitalDocumentView` (5 invoice-family types, per-type accent colour + status pill) and `DigitalDeliveryView`. | `src/components/documents/digital-document-view.tsx` |
| 4 | New `DigitalReceiptViewer` dialog: ScrollArea (scroll mode), autofit toggle (ResizeObserver + `transform: scale`), open-public-page button, ESC/backdrop close, keyboard accessible. | `src/components/documents/digital-receipt-viewer.tsx` |
| 5 | `DocumentQrBadge`: QR wrapped in a `<button>` (`onView` prop) with a “Tap to view” hint, `shrink-0` guards so it can never be clipped. | `src/components/documents/document-qr-badge.tsx` |
| 6 | Invoice view dialog (all 5 types): QR + “View receipt” moved into a dedicated full-width “Digital receipt (QR)” card below Quick Actions; viewer wired with the loaded detail. | `src/app/tabs/invoices-tab.tsx` |
| 7 | Delivery-note view dialog: same dedicated card + viewer wiring. | `src/app/tabs/delivery-notes-tab.tsx` |
| 8 | Customer-credits print keeps the verify string (`linkToPage: false`) because its docNo is a ledger reference that has no public page — prevents dead-end QRs. | `src/app/tabs/credits-tab.tsx` |
| 9 | Version bump + release. | `package.json` → 2.10.0 |

### Printed documents

Because the print pipeline shares `buildDocumentQrPayload`, every **printed**
invoice/quotation/proforma/credit/debit/delivery note now carries a QR that
opens the digital receipt page — the same behaviour customers already know from
POS receipts. Rental receipts and customer-credit notes keep the verify-string
QR (no public page for those numbers — by design).

## 5. Resources needed

| Resource | Requirement |
| --- | --- |
| Team | 1 front-end dev (viewer + tab wiring), 1 full-stack dev (public page + payload). Pair capacity ≈ 3 dev-days including QA. |
| Tooling | Existing stack only: Next.js App Router, Prisma, `qrcode.react`, shadcn/ui, Tailwind. No new dependencies. |
| Test devices | Desktop browser, Android/iOS phone (QR scan + small-screen autofit), thermal/A4 printer for print QR spot-check. |
| Environments | Staging/preview (Vercel) → production. Laptop-kit deployments pick the change up through the normal update channel. |

## 6. Timeline

**Delivered in a single release (v2.10.0):**

| When | Work |
| --- | --- |
| Day 1 (0–3 d) | Code review of all QR surfaces; payload switch + public page for invoices/delivery notes; unit-level review of privacy fields. |
| Day 2 (3–6 d) | `DocumentQrBadge` clickable upgrade; `DigitalReceiptViewer` with scroll + autofit; tab wiring (invoices + delivery notes); lint/type-check/CI. |
| Day 3 (6–12 d) | Cross-type QA matrix (each of the 5 types + delivery note × view/print/public page/scroll/autofit), production deploy, release notes. |

**Future enhancements (backlog, not required for this goal):** WhatsApp share of
the digital-receipt link directly from the viewer; per-store QR styling;
download-the-public-page-as-PDF; analytics on scan events (device, time).

## 7. Potential challenges & mitigations

| Challenge | Mitigation |
| --- | --- |
| **Enumeration of sequential invoice numbers** on a public page | Capability-token trade-off kept deliberate: page is `noindex`, renders **customer-safe fields only** (name + items + totals), matches what is already printed on the paper document handed to the customer. |
| Ledger references vs. document numbers (credits tab) | `linkToPage:false` opt-out keeps those QRs self-verifying — no dead-end 404 QRs. |
| Long receipts overflowing the dialog | ScrollArea with styled scrollbar + autofit mode measured via `ResizeObserver` (recomputes on dialog resize/theme change). |
| Small-screen clipping of the QR in action rows | Dedicated full-width “Digital receipt (QR)” card, `shrink-0` on the badge, minimum 44 px tap targets. |
| Print-window QR too small to scan reliably | Data-URI QR rendered at 110 px with quiet-zone margin 1 and ECC “M” — unchanged, still scans; now it opens the digital page instead of raw text. |
| `window` absence on server / prerender | Payload builder falls back to the verify string; public page is `force-dynamic`. |

## 8. UX considerations

* **Same mental model everywhere:** scanning any Mbumah document QR opens a
  colored digital copy — no app, no login.
* **Autofit toggle labelled plainly** (“Autofit — fit whole receipt on screen”);
  state persists while the dialog is open, defaults to scroll mode.
* **Touch-friendly:** QR button ≥ 96 px, all controls ≥ 32 px, mobile dialog
  layout verified at 390 px width.
* **Feedback:** “Tap to view” hint under the QR, loading spinner on the viewer
  while detail is fetched, toast on link copy.
* **Trust cues:** verified-record footer on the public page, eTIMS/KRA number
  shown when present, dynamic VAT label from Admin settings.

## 9. Testing & success metrics

**QA matrix (executed against production after release):**

| Check | Invoice | Quotation | Proforma | Credit note | Debit note | Delivery note |
| --- | --- | --- | --- | --- | --- | --- |
| QR visible in view dialog (desktop + 390 px) | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| Click QR / “View receipt” opens viewer | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| Scroll works when content overflows | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| Autofit fits whole receipt on screen | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| Public page renders with items + totals | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |
| Printed document QR opens the public page | ☑ | ☑ | ☑ | ☑ | ☑ | ☑ |

**Success metrics:**

1. 100 % of the 5 document types show a scannable QR that resolves to a live
   digital receipt page (0 dead-end QRs).
2. Viewer scroll + autofit verified on desktop and 390 px mobile width.
3. No clipping/overlap of the QR at any tested viewport.
4. Zero console errors in the view dialogs; public page returns 200 with
   correct document data and 404 for unknown numbers.
5. Phone camera scan (real device) opens the page in ≤ 2 s.
