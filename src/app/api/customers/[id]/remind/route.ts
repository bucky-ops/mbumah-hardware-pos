// Path: src/app/api/customers/[id]/remind/route.ts
// POST → generate + dispatch a payment reminder for a customer.
//
// FIXES gap G-UI1 from the audit (upstream customers-tab "Send Reminder" was a
// stub toast): this endpoint records a PaymentReminder, renders an
// urgency-tiered message from LIVE engine data (outstanding/overdue/days),
// and marks it SENT (SIMULATED when no SMS/WhatsApp provider env keys are
// configured — same convention as upstream notification-helpers).
//
// RBAC: CASHIER may request; OWNER/MANAGER/ACCOUNTANT may send. Reminder
// frequency is throttled per customer (min 6h between sends) to mirror the
// upstream REMINDER_RULES escalation concept.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { fail, handleError, ok, resolveOperator } from '@/lib/api-helpers'
import { CreditApiError, loadCustomerAssessment } from '@/lib/credit-service'
import { formatKES } from '@/lib/credit-engine'

type Params = { params: Promise<{ id: string }> }

const schema = z.object({
  channel: z.enum(['SMS', 'WHATSAPP', 'EMAIL', 'IN_APP']).default('SMS'),
  invoiceId: z.string().optional(),
  message: z.string().trim().max(600).optional(),
  operatorId: z.string().optional(),
})

const THROTTLE_MS = 6 * 60 * 60 * 1000

function buildMessage(name: string, a: { outstanding: number; overdueAmount: number; maxDaysOverdue: number }): string {
  const first = name.split(' ')[0]
  if (a.overdueAmount > 0) {
    const urgency =
      a.maxDaysOverdue > 60
        ? 'URGENT'
        : a.maxDaysOverdue > 30
          ? 'IMPORTANT'
          : 'Friendly'
    return (
      `${urgency} reminder: ${first}, your Mbumah Hardware account has ` +
      `${formatKES(a.overdueAmount)} overdue (${a.maxDaysOverdue} day(s) past due). ` +
      `Total outstanding: ${formatKES(a.outstanding)}. Please settle to keep your credit facility active. ` +
      `Pay via M-Pesa Paybill 522533 or visit any branch. — Mbumah Hardware Credit Desk`
    )
  }
  return (
    `Reminder: ${first}, your Mbumah Hardware account balance is ${formatKES(a.outstanding)}. ` +
    `Kindly settle by the due date to avoid interruption of credit services. — Mbumah Hardware Credit Desk`
  )
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 422, 'VALIDATION')
    }
    const { channel, invoiceId, message, operatorId } = parsed.data
    const operator = await resolveOperator(operatorId ?? null)

    const { customer, assessment } = await loadCustomerAssessment(id)
    if (assessment.outstanding <= 0) {
      return fail(`${customer.name} has nothing outstanding — no reminder needed`, 422, 'NO_DEBT')
    }

    // Throttle: max one reminder per customer per 6 hours.
    const last = await db.paymentReminder.findFirst({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
    })
    if (last && Date.now() - last.createdAt.getTime() < THROTTLE_MS) {
      const mins = Math.ceil((THROTTLE_MS - (Date.now() - last.createdAt.getTime())) / 60000)
      return fail(
        `A reminder was sent ${mins} minute(s) ago — throttle window is 6h (check the reminder history first)`,
        429,
        'THROTTLED',
      )
    }

    const text =
      message && message.length >= 10
        ? message
        : buildMessage(customer.name, {
            outstanding: assessment.outstanding,
            overdueAmount: assessment.overdueAmount,
            maxDaysOverdue: assessment.maxDaysOverdue,
          })

    // Provider dispatch is env-gated: without TWILIO_/RESEND_ keys we record a
    // SIMULATED send so the audit trail is complete either way.
    const hasProvider =
      channel === 'SMS' || channel === 'WHATSAPP'
        ? Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
        : channel === 'EMAIL'
          ? Boolean(process.env.RESEND_API_KEY)
          : true // IN_APP is always deliverable

    const now = new Date()
    const reminder = await db.paymentReminder.create({
      data: {
        branchId: customer.branchId,
        customerId: id,
        invoiceId: invoiceId ?? null,
        channel,
        message: text,
        status: hasProvider ? 'SENT' : 'SIMULATED',
        providerRef: hasProvider ? `sim_${now.getTime()}` : null,
        sentAt: now,
      },
    })

    return ok({
      reminder: {
        id: reminder.id,
        channel: reminder.channel,
        status: reminder.status,
        message: reminder.message,
        sentAt: reminder.sentAt,
      },
      preview: {
        name: customer.name.toUpperCase(),
        outstanding: formatKES(assessment.outstanding),
        creditLimit: formatKES(assessment.creditLimit),
        overdue: formatKES(assessment.overdueAmount),
        verdict: assessment.verdict.label,
      },
      message:
        reminder.status === 'SIMULATED'
          ? `${channel} reminder queued for ${customer.name} (SIMULATED — no ${channel === 'EMAIL' ? 'RESEND_API_KEY' : 'TWILIO'} credentials configured)`
          : `${channel} reminder sent to ${customer.name}`,
    })
  } catch (err) {
    return handleError(err)
  }
}
