import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireRole, assertTargetBranch, assertBranchAccess } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { D } from "@/lib/format";
import { decryptPII, maskPhone } from "@/lib/crypto";
import { sendSms, buildReminderMessage } from "@/lib/sms";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/credit/remind — collection reminders.
//   GET  ?planId=…  → message preview for the Remind dialog
//   GET             → due-soon/overdue list + recent SmsLog (20)
//   POST {planId, channel: SMS|IN_PERSON, installmentSeq?} → send + log + audit
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const remindSchema = z.object({
  planId: z.string().min(1, "planId is required"),
  channel: z.enum(["SMS", "IN_PERSON"]),
  installmentSeq: z.number().int().min(1).optional(),
});

function planRef(saleId: string | null, planId: string): string {
  return saleId ?? planId;
}

/** GET /api/v1/credit/remind[?planId=…] */
export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  // MANAGER+ only: reminder previews expose customer contact details and the
  // SMS log exposes collection correspondence.
  const user = await requireRole(req, "MANAGER");
  const sp = req.nextUrl.searchParams;
  const requestedBranch = sp.get("branchId");
  assertTargetBranch(user, requestedBranch);
  const branchId = user.role === "OWNER" ? requestedBranch : user.branchId;

  // ── Preview mode for the Remind dialog ────────────────────────────────────
  const planId = sp.get("planId");
  if (planId) {
    const plan = await db.debtPlan.findUnique({
      where: { id: planId },
      include: {
        creditAccount: { include: { customer: { select: { id: true, name: true, phoneEnc: true } } } },
        installments: { orderBy: { seq: "asc" } },
      },
    });
    if (!plan) throw ApiError.notFound("Debt plan not found");
    assertBranchAccess(user, plan.creditAccount.branchId);

    const seq = sp.get("installmentSeq");
    const target =
      (seq ? plan.installments.find((i) => i.seq === Number(seq)) : undefined) ??
      plan.installments.find((i) => i.status !== "PAID") ??
      plan.installments[plan.installments.length - 1];
    if (!target) throw ApiError.notFound("Plan has no installments");

    const message = buildReminderMessage({
      customerName: plan.creditAccount.customer.name,
      ref: planRef(plan.saleId, plan.id),
      amountDue: D(target.amountDue).sub(D(target.amountPaid)).toNumber(),
      dueDate: target.dueDate,
    });
    const phone = decryptPII(plan.creditAccount.customer.phoneEnc);
    return NextResponse.json({
      preview: message,
      installment: {
        id: target.id,
        seq: target.seq,
        dueDate: target.dueDate.toISOString(),
        amountDue: String(target.amountDue),
        amountPaid: String(target.amountPaid),
        status: target.status,
      },
      phoneMasked: maskPhone(phone),
      smsCapable: Boolean(phone),
    });
  }

  // ── Due list: installments due within 3 days OR already overdue ───────────
  const now = new Date();
  const horizon = new Date(now.getTime() + 3 * DAY_MS);
  const installments = await db.debtInstallment.findMany({
    where: {
      status: { in: ["PENDING", "OVERDUE"] },
      dueDate: { lte: horizon }, // covers overdue (dueDate < now) too
      debtPlan: branchId ? { branchId } : undefined,
    },
    include: {
      debtPlan: {
        include: {
          creditAccount: {
            include: { customer: { select: { id: true, name: true, phoneEnc: true, riskScore: true } } },
          },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 100,
  });

  const due = installments
    .map((inst) => ({
      installmentId: inst.id,
      planId: inst.debtPlanId,
      planRef: planRef(inst.debtPlan.saleId, inst.debtPlanId),
      planStatus: inst.debtPlan.status,
      seq: inst.seq,
      dueDate: inst.dueDate.toISOString(),
      amountDue: String(inst.amountDue),
      amountPaid: String(inst.amountPaid),
      customerId: inst.debtPlan.creditAccount.customer.id,
      customerName: inst.debtPlan.creditAccount.customer.name,
      riskScore: inst.debtPlan.creditAccount.customer.riskScore,
      phoneMasked: maskPhone(decryptPII(inst.debtPlan.creditAccount.customer.phoneEnc)),
      overdue: inst.status === "OVERDUE" || inst.dueDate < now,
    }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate));

  const recentLogs = await db.smsLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { customer: { select: { name: true } } },
  });

  return NextResponse.json({
    due,
    smsLogs: recentLogs.map((log) => ({
      id: log.id,
      phone: log.phone,
      message: log.message,
      provider: log.provider,
      status: log.status,
      customerName: log.customer?.name ?? null,
      createdAt: log.createdAt.toISOString(),
    })),
  });
});

/** POST /api/v1/credit/remind */
export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  // MANAGER+ only: sending SMS costs real money and contacts customers.
  const user = await requireRole(req, "MANAGER");
  const parsed = remindSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid reminder payload");
  }
  const body = parsed.data;

  const plan = await db.debtPlan.findUnique({
    where: { id: body.planId },
    include: {
      creditAccount: { include: { customer: true } },
      installments: { orderBy: { seq: "asc" } },
    },
  });
  if (!plan) throw ApiError.notFound("Debt plan not found");
  assertBranchAccess(user, plan.creditAccount.branchId);
  const customer = plan.creditAccount.customer;

  const target =
    (body.installmentSeq ? plan.installments.find((i) => i.seq === body.installmentSeq) : undefined) ??
    plan.installments.find((i) => i.status !== "PAID") ??
    plan.installments[plan.installments.length - 1];
  if (!target) throw ApiError.badRequest("Plan has no installments to remind about");

  const message = buildReminderMessage({
    customerName: customer.name,
    ref: planRef(plan.saleId, plan.id),
    amountDue: D(target.amountDue).sub(D(target.amountPaid)).toNumber(),
    dueDate: target.dueDate,
  });

  const phone = decryptPII(customer.phoneEnc);
  let logStatus: "SENT" | "FAILED" | "QUEUED";
  let provider: string;

  if (body.channel === "SMS") {
    if (!phone) throw ApiError.badRequest("Customer has no phone number on file");
    const result = await sendSms(phone, message);
    provider = "africastalking";
    // FAILED stays FAILED; SENT and MOCKED both record as SENT — mock mode
    // keeps the sandbox workflow demoable end-to-end while still being logged.
    logStatus = result.status === "FAILED" ? "FAILED" : "SENT";
  } else {
    // In-person reminder: scripted copy handed to staff, logged as sent.
    provider = "in_person";
    logStatus = "SENT";
  }

  await db.smsLog.create({
    data: {
      customerId: customer.id,
      planId: plan.id,
      phone: maskPhone(phone) ?? (body.channel === "IN_PERSON" ? "in_person" : "unknown"),
      message,
      provider,
      status: logStatus,
    },
  });

  await audit({
    userId: user.id,
    action: "DEBT_REMINDER",
    entity: "DebtPlan",
    entityId: plan.id,
    meta: { channel: body.channel, installmentSeq: target.seq, status: logStatus },
  });

  return NextResponse.json({ status: logStatus, message });
});
