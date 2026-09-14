// ─────────────────────────────────────────────────────────────────────────────
// SMS gateway helper — Africa's Talking REST API.
//
//  • Provider: https://africastalking.com (sandbox endpoint below; swap the
//    host to api.africastalking.com for production traffic).
//  • Credentials come from env: AT_API_KEY (required to actually send),
//    AT_USERNAME (default "sandbox"), AT_SENDER_ID (default "MBUMAH").
//  • When AT_API_KEY is absent the helper returns { status: "MOCKED" } —
//    sandbox/mock mode keeps the workflow demoable; reminders are still
//    recorded in SmsLog so the audit trail stays complete.
//  • Hard 10s timeout: an SMS send must never hang a request thread.
// ─────────────────────────────────────────────────────────────────────────────

import { format } from "date-fns";
import { D, round2 } from "@/lib/format";

export interface SmsResult {
  status: "SENT" | "FAILED" | "MOCKED";
  providerRef?: string;
  error?: string;
}

const AT_ENDPOINT = "https://api.sandbox.africastalking.com/version1/messaging";
const TIMEOUT_MS = 10_000;

interface AtRecipient {
  messageId?: string;
  status?: string;
}
interface AtResponse {
  SMSMessageData?: { Recipients?: AtRecipient[] };
}

/** Send an SMS via Africa's Talking. Never throws — failures come back as {status:"FAILED"}. */
export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const apiKey = process.env.AT_API_KEY;
  // No credentials → mock mode (recorded downstream in SmsLog).
  if (!apiKey) return { status: "MOCKED" };

  const username = process.env.AT_USERNAME ?? "sandbox";
  const from = process.env.AT_SENDER_ID ?? "MBUMAH";

  try {
    const res = await fetch(AT_ENDPOINT, {
      method: "POST",
      headers: {
        apiKey, // Africa's Talking auths via the apiKey header, not Bearer
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ username, to, message, from }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return { status: "FAILED", error: `Africa's Talking HTTP ${res.status}` };
    }
    const data = (await res.json()) as AtResponse;
    const recipient = data.SMSMessageData?.Recipients?.[0];
    if (recipient?.status && recipient.status !== "Success") {
      return { status: "FAILED", error: recipient.status };
    }
    return { status: "SENT", providerRef: recipient?.messageId };
  } catch (err) {
    return { status: "FAILED", error: err instanceof Error ? err.message : "network error" };
  }
}

export interface ReminderMessageInput {
  customerName: string;
  ref: string; // debt plan reference (saleId or plan id)
  amountDue: number | string;
  dueDate: Date | string;
  paybill?: string; // override; default MPESA_PAYBILL env or 4103829
}

/** Canonical reminder copy — single source of truth for SMS + in-person scripts. */
export function buildReminderMessage({ customerName, ref, amountDue, dueDate, paybill }: ReminderMessageInput): string {
  const bill = paybill ?? process.env.MPESA_PAYBILL ?? "4103829";
  const due = format(new Date(dueDate), "d MMM yyyy");
  return `Dear ${customerName}, your Mbumah Hardware debt plan ${ref} installment of KES ${round2(D(amountDue))} is due on ${due}. Pay via M-Pesa Paybill ${bill}. Thank you.`;
}
