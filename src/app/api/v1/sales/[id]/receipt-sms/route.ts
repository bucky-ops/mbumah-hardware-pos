// src/app/api/v1/sales/[id]/receipt-sms/route.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { format } from "date-fns";
import { tz } from "@date-fns/tz";

import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireAuth, assertBranchAccess } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { D, formatKES } from "@/lib/format";
import { sendSms } from "@/lib/sms";
import { decryptPII, maskPhone } from "@/lib/security/pii";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sales/[id]/receipt-sms — SMS the receipt of a finished sale to
// the customer phone on file.
//
//  • Auth: requireAuth — CASHIER is the lowest role, so this is "any role ≥
//    CASHIER" (till operators receipt their own sales; no MANAGER gate needed,
//    unlike /api/v1/credit/remind which spends collections budget).
//  • BOLA: the persisted transaction's branchId is re-checked with
//    assertBranchAccess — the URL id is untrusted client input.
//  • Guards: only COMPLETED | PARTIAL | CREDIT sales can be receipted (HELD
//    tickets are parked, not sold); a customer with an encrypted phone must be
//    attached; the stored phone must decrypt cleanly (AES-256-GCM tamper → 400).
//  • Spam guard: an identical SmsLog row (same customer + same message) within
//    the last 60 seconds short-circuits with 400 (double-click / double-tab).
//  • Message is built SERVER-SIDE from the transaction (no request body, no
//    client-supplied text): branch, ref, Nairobi wall-clock date, item count,
//    TOTAL and settlement line. ≤ 320 chars, single-SMS friendly.
//  • Gateway: lib/sms.sendSms — MOCKED when AT_API_KEY is absent. The raw
//    gateway status ("SENT"|"FAILED"|"MOCKED") is returned to the UI; the
//    SmsLog row maps MOCKED → SENT + provider "mock" (remind-route precedent)
//    so the audit trail stays complete without pretending a real send happened
//    (the provider column distinguishes it). Phone is logged MASKED only
//    (Kenya Data Protection Act 2019).
// ─────────────────────────────────────────────────────────────────────────────

const RECEIPTABLE_STATUSES = new Set(["COMPLETED", "PARTIAL", "CREDIT"]);
const NAIROBI_TZ = "Africa/Nairobi"; // Kenya is UTC+3 year-round (no DST)
const SPAM_WINDOW_MS = 60_000;

/** Next.js 16: route params arrive as a Promise. */
type Ctx = { params: Promise<{ id: string }> };

export const POST = withErrorHandler(async (raw: Request, ctx: Ctx) => {
  const req = raw as NextRequest;
  const user = await requireAuth(req);
  const { id } = await ctx.params;

  const tx = await db.transaction.findUnique({
    where: { id },
    include: {
      branch: { select: { name: true } },
      customer: true, // phoneEnc needed; id used for the log row
      _count: { select: { items: true } },
    },
  });
  if (!tx) throw ApiError.notFound("Transaction not found");
  assertBranchAccess(user, tx.branchId); // BOLA — persisted branch is authoritative

  if (!RECEIPTABLE_STATUSES.has(tx.status)) {
    throw ApiError.badRequest(
      tx.status === "HELD"
        ? "Held tickets cannot be receipted"
        : `Receipts cannot be sent for ${tx.status} sales`,
    );
  }

  const customer = tx.customer;
  if (!customer || !customer.phoneEnc) {
    throw ApiError.badRequest("This sale has no customer phone attached");
  }
  const plaintext = decryptPII(customer.phoneEnc);
  if (!plaintext) throw ApiError.badRequest("Stored phone is unreadable");

  // ── Canonical receipt copy — built from the persisted transaction only. ────
  const when = format(tx.createdAt, "d MMM yyyy, HH:mm", { in: tz(NAIROBI_TZ) });
  const itemCount = tx._count.items;
  const settlement =
    D(tx.balanceDue).comparedTo(0) > 0
      ? `Balance due: ${formatKES(tx.balanceDue)}`
      : "Paid in full";
  const message = [
    `Mbumah Hardware — ${tx.branch.name}`,
    `Receipt ${tx.ref} · ${when}`,
    `${itemCount} item${itemCount === 1 ? "" : "s"} · Total: ${formatKES(tx.totalAmount)}`,
    settlement,
    "Asante for shopping with Mbumah Hardware!",
  ].join("\n");

  // ── Spam guard: same customer + identical copy inside the last minute. ─────
  const justSent = await db.smsLog.findFirst({
    where: {
      customerId: customer.id,
      message,
      createdAt: { gte: new Date(Date.now() - SPAM_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (justSent) throw ApiError.badRequest("Receipt SMS was just sent");

  const result = await sendSms(plaintext, message);

  // SmsLog mapping (remind-route precedent): MOCKED records as SENT with the
  // "mock" provider so the sandbox workflow stays demoable end-to-end while
  // the provider column keeps the distinction honest.
  const provider = result.status === "MOCKED" ? "mock" : "africastalking";
  const logStatus = result.status === "FAILED" ? "FAILED" : "SENT";
  const masked = maskPhone(plaintext);

  await db.smsLog.create({
    data: {
      customerId: customer.id,
      phone: masked ?? "unknown", // masked before logging — never the plaintext
      message,
      provider,
      status: logStatus,
    },
  });

  void audit({
    userId: user.id,
    action: "RECEIPT_SMS",
    entity: "Transaction",
    entityId: tx.id,
    meta: { ref: tx.ref, phone: masked, provider, status: logStatus },
  });

  // Raw gateway status surfaces the MOCKED/FAILED distinction to the UI.
  return NextResponse.json({ status: result.status, maskedPhone: masked, message });
});
