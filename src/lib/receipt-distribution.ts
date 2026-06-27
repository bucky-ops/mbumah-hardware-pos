// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Receipt Distribution (Email via Resend + WhatsApp via Twilio)
// ─────────────────────────────────────────────────────────────────────────────
//
// Sends customer receipts through two channels:
//   • EMAIL    — Resend (https://resend.com) transactional email API
//   • WHATSAPP — Twilio WhatsApp Business API (https://twilio.com)
//
// DESIGN PRINCIPLES
// ─────────────────
// 1. Graceful degradation. In dev / sandbox, the Resend/Twilio API keys are
//    typically absent. Rather than crashing, the library:
//      • Logs a WARN-level systemLog entry.
//      • Returns a `simulated: true` result so the UI can inform the user
//        that the message was NOT actually sent (but the receipt HTML was
//        generated and the flow works end-to-end).
//    This makes the feature testable without external credentials while
//    remaining fully production-ready when keys are provisioned.
//
// 2. Receipt rendering. A single `renderReceiptHtml()` function produces a
//    branded, print-ready HTML receipt from a SalesTransaction + items. The
//    same HTML is used for the email body and as the text fallback for
//    WhatsApp. This guarantees a single source of truth for receipt layout.
//
// 3. Audit trail. Every distribution attempt (success or failure) is written
//    to the AuditLog via `recordAuditLog()` from accounting-helpers.ts,
//    satisfying ISO 27001 A.12.4.1 (event logging) and providing the
//    forensic trail required for customer-dispute resolution.
//
// 4. PII handling. Customer email and phone numbers are treated as PII:
//      • Never logged in full (masked in systemLog: +254•••••123,
//        j•••@example.com).
//      • Included only in the outbound message to the provider.
//      • Stored in AuditLog.newValues for the customer's own record.
//
// ISO 27001: A.12.4.1 — Event logging (every send is logged)
// ISO 27001: A.8.2.1  — Classification of information (PII masking)
// ISO 9001: 8.2       — Customer communication (receipt distribution)
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { systemLog } from "@/lib/logger";
import { LogSeverity, LogComponent } from "@/lib/types";
import { recordAuditLog } from "@/lib/accounting-helpers";
import { KES } from "@/lib/money";
import type { SalesTransaction, SaleItem } from "@prisma/client";

// ── Public types ─────────────────────────────────────────────────────────────

export type DistributionChannel = "EMAIL" | "WHATSAPP";

export interface DistributionResult {
  success: boolean;
  channel: DistributionChannel;
  recipient: string;
  /** True when API keys were missing and the send was simulated. */
  simulated: boolean;
  /** Provider message ID (null when simulated). */
  providerId: string | null;
  /** Human-readable status for the UI toast. */
  message: string;
}

export interface DistributeReceiptInput {
  transactionId: string;
  channel: DistributionChannel;
  /** Email address (required for EMAIL channel). */
  email?: string;
  /** Phone in E.164 format, e.g. +254712345678 (required for WHATSAPP). */
  phone?: string;
  /** Custom message to prepend. Defaults to a polite cover note. */
  customMessage?: string;
  /** Acting user (for the audit trail). */
  userId: string;
  storeId: string;
  organizationId?: string;
  ipAddress?: string;
  userAgent?: string;
}

// ── Provider configuration ───────────────────────────────────────────────────

interface ProviderConfig {
  /** True when the provider's API key is present and non-empty. */
  configured: boolean;
  /** From-address / sender for outbound messages. */
  from: string;
}

function getResendConfig(): ProviderConfig {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  return {
    configured: apiKey.length > 0,
    from: process.env.RESEND_FROM_EMAIL ?? "Mbumah Hardware <receipts@mbumah.co.ke>",
  };
}

function getTwilioConfig(): ProviderConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  return {
    configured: accountSid.length > 0 && authToken.length > 0,
    from: process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
  };
}

// ── PII masking ──────────────────────────────────────────────────────────────

/** Mask an email for logging: j•••@example.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "••••";
  const visible = local.slice(0, 1);
  return `${visible}${"•".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

/** Mask a phone for logging: +254•••••123 */
function maskPhone(phone: string): string {
  if (phone.length < 6) return "•••••";
  const head = phone.slice(0, 4);
  const tail = phone.slice(-3);
  return `${head}${"•".repeat(Math.max(3, phone.length - 7))}${tail}`;
}

// ── Receipt HTML rendering ───────────────────────────────────────────────────

interface ReceiptRenderContext {
  transaction: SalesTransaction & {
    items?: SaleItem[];
    customer?: { name: string | null; phone: string | null; email: string | null } | null;
    cashier?: { name: string | null } | null;
  };
  store: { name: string; location: string | null; phone: string | null } | null;
}

/**
 * Render a branded, print-ready HTML receipt from a sales transaction.
 *
 * The layout matches the in-app ReceiptModal so customers receive the same
 * document whether they view it on screen, print it, or receive it via
 * email/WhatsApp. Uses inline styles (no external CSS) for email-client
 * compatibility — Gmail and Outlook strip <style> tags.
 */
export function renderReceiptHtml(ctx: ReceiptRenderContext): string {
  const { transaction, store } = ctx;
  const items = transaction.items ?? [];
  const storeName = store?.name ?? "Mbumah Hardware";
  const storeLocation = store?.location ?? "";
  const storePhone = store?.phone ?? "";

  const itemRows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:4px 0;border-bottom:1px solid #eee;">${escapeHtml(item.productName)}</td>
          <td style="padding:4px 8px;text-align:center;border-bottom:1px solid #eee;">${item.quantity}</td>
          <td style="padding:4px 8px;text-align:right;border-bottom:1px solid #eee;">${KES(item.pricePerUnit).formatKES()}</td>
          <td style="padding:4px 0;text-align:right;border-bottom:1px solid #eee;font-weight:600;">${KES(item.lineTotal).formatKES()}</td>
        </tr>`,
    )
    .join("");

  const customerName = transaction.customer?.name ?? "Walk-in Customer";
  const cashierName = transaction.cashier?.name ?? "—";

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 420px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <div style="text-align:center;margin-bottom:16px;">
        <h1 style="font-size:22px;font-weight:800;margin:0;color:#059669;">MBUMAH HARDWARE</h1>
        <p style="font-size:13px;margin:2px 0;color:#6b7280;">${escapeHtml(storeName)}</p>
        ${storeLocation ? `<p style="font-size:12px;margin:1px 0;color:#9ca3af;">${escapeHtml(storeLocation)}</p>` : ""}
        ${storePhone ? `<p style="font-size:12px;margin:1px 0;color:#9ca3af;">Tel: ${escapeHtml(storePhone)}</p>` : ""}
      </div>
      <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0;" />
      <div style="font-size:12px;margin-bottom:8px;">
        <p style="margin:2px 0;"><strong>Receipt #:</strong> ${escapeHtml(transaction.receiptNumber)}</p>
        <p style="margin:2px 0;"><strong>Date:</strong> ${new Date(transaction.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</p>
        <p style="margin:2px 0;"><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
        <p style="margin:2px 0;"><strong>Cashier:</strong> ${escapeHtml(cashierName)}</p>
      </div>
      <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0;" />
      <table style="width:100%;font-size:12px;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:6px 0;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Item</th>
            <th style="padding:6px 8px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Qty</th>
            <th style="padding:6px 8px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Price</th>
            <th style="padding:6px 0;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
      <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0;" />
      <div style="font-size:13px;">
        <div style="display:flex;justify-content:space-between;margin:3px 0;"><span style="color:#6b7280;">Subtotal:</span><span>${KES(transaction.subtotal).formatKES()}</span></div>
        <div style="display:flex;justify-content:space-between;margin:3px 0;"><span style="color:#6b7280;">VAT (16%):</span><span>${KES(transaction.taxAmount).formatKES()}</span></div>
        ${Number(transaction.discountAmount) > 0
          ? `<div style="display:flex;justify-content:space-between;margin:3px 0;color:#059669;"><span>Discount:</span><span>-${KES(transaction.discountAmount).formatKES()}</span></div>`
          : ""}
        <div style="display:flex;justify-content:space-between;margin:8px 0 4px;font-size:16px;font-weight:800;">
          <span>TOTAL:</span><span style="color:#059669;">${KES(transaction.totalAmount).formatKES()}</span>
        </div>
      </div>
      <hr style="border:none;border-top:1px dashed #d1d5db;margin:12px 0;" />
      <div style="text-align:center;font-size:11px;color:#6b7280;">
        <p style="margin:2px 0;">Paid via <strong>${escapeHtml(transaction.paymentMethod)}</strong></p>
        <p style="margin:2px 0;">Status: ${escapeHtml(transaction.paymentStatus)}</p>
      </div>
      <p style="text-align:center;font-size:11px;color:#9ca3af;margin-top:16px;">Thank you for your business! — Asante kwa biashara yako!</p>
    </div>
  `;
}

/** Minimal HTML-escaper for user-supplied strings in the receipt. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Plain-text receipt (for WhatsApp body) ───────────────────────────────────

export function renderReceiptText(ctx: ReceiptRenderContext): string {
  const { transaction, store } = ctx;
  const items = transaction.items ?? [];
  const storeName = store?.name ?? "Mbumah Hardware";

  const itemLines = items
    .map(
      (i) =>
        `  • ${i.productName} ×${i.quantity} — ${KES(i.lineTotal).formatKES()}`,
    )
    .join("\n");

  return [
    `*${storeName}* — Receipt`,
    `Receipt #: ${transaction.receiptNumber}`,
    `Date: ${new Date(transaction.createdAt).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}`,
    `Customer: ${transaction.customer?.name ?? "Walk-in"}`,
    "",
    "Items:",
    itemLines,
    "",
    `Subtotal: ${KES(transaction.subtotal).formatKES()}`,
    `VAT: ${KES(transaction.taxAmount).formatKES()}`,
    Number(transaction.discountAmount) > 0
      ? `Discount: -${KES(transaction.discountAmount).formatKES()}`
      : "",
    `*TOTAL: ${KES(transaction.totalAmount).formatKES()}*`,
    "",
    `Paid via: ${transaction.paymentMethod}`,
    "Thank you for your business!",
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Load full transaction with relations ─────────────────────────────────────

async function loadTransactionForReceipt(transactionId: string) {
  return db.salesTransaction.findUnique({
    where: { id: transactionId },
    include: {
      items: true,
      customer: { select: { name: true, phone: true, email: true } },
      cashier: { select: { name: true } },
      store: { select: { name: true, location: true, phone: true } },
    },
  });
}

// ── EMAIL distribution (Resend) ──────────────────────────────────────────────

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
): Promise<{ providerId: string | null; simulated: boolean }> {
  const config = getResendConfig();

  if (!config.configured) {
    await systemLog({
      action: "RECEIPT_EMAIL_SIMULATED",
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.WARN,
      message: `RESEND_API_KEY not set — email to ${maskEmail(to)} was simulated (not actually sent).`,
      metadata: { recipient: maskEmail(to), provider: "resend" },
    });
    return { providerId: null, simulated: true };
  }

  // Lazy-import so the package is only loaded when actually needed (keeps
  // cold-start fast for routes that don't distribute receipts).
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data, error } = await resend.emails.send({
    from: config.from,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message} (code: ${error.name})`);
  }

  return { providerId: data?.id ?? null, simulated: false };
}

// ── WHATSAPP distribution (Twilio) ───────────────────────────────────────────

async function sendViaTwilioWhatsApp(
  to: string,
  body: string,
): Promise<{ providerId: string | null; simulated: boolean }> {
  const config = getTwilioConfig();

  if (!config.configured) {
    await systemLog({
      action: "RECEIPT_WHATSAPP_SIMULATED",
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.WARN,
      message: `TWILIO_ACCOUNT_SID/AUTH_TOKEN not set — WhatsApp to ${maskPhone(to)} was simulated (not actually sent).`,
      metadata: { recipient: maskPhone(to), provider: "twilio" },
    });
    return { providerId: null, simulated: true };
  }

  const twilio = (await import("twilio")).default;
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );

  // Normalize recipient to the whatsapp: prefixed E.164 format Twilio expects.
  const normalizedTo = to.startsWith("whatsapp:") ? to : `whatsapp:${to.replace(/\s/g, "")}`;

  const message = await client.messages.create({
    from: config.from,
    to: normalizedTo,
    body,
  });

  return { providerId: message.sid, simulated: false };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Distribute a receipt to a customer via Email (Resend) or WhatsApp (Twilio).
 *
 * Loads the transaction + items + store, renders the branded receipt, sends it
 * through the appropriate provider, and writes an AuditLog entry. Returns a
 * structured result the API layer can pass straight to the UI.
 *
 * @throws {Error} if the transaction is not found, or required recipient is missing.
 */
export async function distributeReceipt(
  input: DistributeReceiptInput,
): Promise<DistributionResult> {
  const { transactionId, channel, email, phone, customMessage, userId, storeId } = input;

  // ── 1. Load transaction ──
  const transaction = await loadTransactionForReceipt(transactionId);
  if (!transaction) {
    throw new Error(`Transaction ${transactionId} not found.`);
  }
  if (transaction.storeId !== storeId) {
    throw new Error("Transaction does not belong to this store.");
  }

  // ── 2. Resolve recipient ──
  const resolvedEmail = email ?? transaction.customer?.email ?? undefined;
  const resolvedPhone = phone ?? transaction.customer?.phone ?? undefined;

  if (channel === "EMAIL" && !resolvedEmail) {
    throw new Error("No email address on the customer. Provide one explicitly.");
  }
  if (channel === "WHATSAPP" && !resolvedPhone) {
    throw new Error("No phone number on the customer. Provide one explicitly.");
  }

  const recipient = channel === "EMAIL" ? resolvedEmail! : resolvedPhone!;

  // ── 3. Render receipt ──
  const store = transaction.store;
  const renderCtx: ReceiptRenderContext = { transaction, store };
  const coverNote =
    customMessage ??
    "Dear customer, please find your receipt from Mbumah Hardware below. Thank you for your business!";

  let providerResult: { providerId: string | null; simulated: boolean };

  try {
    if (channel === "EMAIL") {
      const html = `
        <div style="font-family:sans-serif;color:#374151;font-size:14px;">
          <p>${escapeHtml(coverNote)}</p>
          ${renderReceiptHtml(renderCtx)}
          <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
          <p style="font-size:11px;color:#9ca3af;">
            This is an automated receipt from Mbumah Hardware. If you did not make
            this purchase, please contact us at ${escapeHtml(store?.phone ?? "our store")}.
          </p>
        </div>
      `;
      const subject = `Receipt #${transaction.receiptNumber} — Mbumah Hardware`;
      providerResult = await sendViaResend(recipient, subject, html);
    } else {
      const text = `${coverNote}\n\n${renderReceiptText(renderCtx)}`;
      providerResult = await sendViaTwilioWhatsApp(recipient, text);
    }
  } catch (err) {
    // Log the failure and record an audit entry, but re-throw so the API
    // layer returns a 500 to the client.
    const errMsg = err instanceof Error ? err.message : String(err);
    await systemLog({
      action: "RECEIPT_DISTRIBUTION_FAILED",
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.ERROR,
      message: `Failed to send receipt ${transaction.receiptNumber} via ${channel} to ${channel === "EMAIL" ? maskEmail(recipient) : maskPhone(recipient)}: ${errMsg}`,
      storeId,
      userId,
      metadata: {
        transactionId,
        receiptNumber: transaction.receiptNumber,
        channel,
        recipient: channel === "EMAIL" ? maskEmail(recipient) : maskPhone(recipient),
        error: errMsg,
      },
    });

    await recordAuditLog({
      storeId,
      organizationId: input.organizationId,
      entityType: "SALES_TRANSACTION",
      entityId: transactionId,
      action: "RECEIPT_DISTRIBUTION_FAILED",
      userId,
      oldValues: null,
      newValues: { channel, recipient, error: errMsg },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    }).catch(() => {
      /* audit-log write must never block the error path */
    });

    throw err;
  }

  // ── 4. Audit trail ──
  const maskedRecipient =
    channel === "EMAIL" ? maskEmail(recipient) : maskPhone(recipient);

  await recordAuditLog({
    storeId,
    organizationId: input.organizationId,
    entityType: "SALES_TRANSACTION",
    entityId: transactionId,
    action: "RECEIPT_DISTRIBUTED",
    userId,
    oldValues: null,
    newValues: {
      channel,
      recipient: maskedRecipient,
      receiptNumber: transaction.receiptNumber,
      providerId: providerResult.providerId,
      simulated: providerResult.simulated,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await systemLog({
    action: "RECEIPT_DISTRIBUTED",
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Receipt ${transaction.receiptNumber} sent via ${channel} to ${maskedRecipient}${providerResult.simulated ? " (SIMULATED — no API key)" : ""}.`,
    storeId,
    userId,
    metadata: {
      transactionId,
      receiptNumber: transaction.receiptNumber,
      channel,
      recipient: maskedRecipient,
      providerId: providerResult.providerId,
      simulated: providerResult.simulated,
    },
  });

  return {
    success: true,
    channel,
    recipient: maskedRecipient,
    simulated: providerResult.simulated,
    providerId: providerResult.providerId,
    message:
      (providerResult.simulated ? "Simulated (no API key): " : "") +
      `Receipt sent via ${channel === "EMAIL" ? "email" : "WhatsApp"} to ${maskedRecipient}.`,
  };
}
