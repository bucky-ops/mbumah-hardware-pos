import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withErrorHandler, ApiError } from "@/lib/api-error-handler";
import { requireAuth, requireRole, assertBranchAccess } from "@/lib/api/guard";
import { audit } from "@/lib/audit";
import { round2 } from "@/lib/format";
import { encryptPII, decryptPII, maskPhone, maskNationalId } from "@/lib/crypto";

// ─────────────────────────────────────────────────────────────────────────────
// /api/v1/credit/guarantors — collateral-style guarantors on a credit account.
//   GET    — any authenticated staff (PII always masked); ?creditAccountId=…
//   POST   — MANAGER+ ; PII (phone, national ID) encrypted with AES-256-GCM
//   DELETE — MANAGER+ ; ?id=
//
// `creditAccountId` accepts EITHER a CreditAccount.id OR the owning
// Customer.id: `customerId` is unique on CreditAccount, so both resolve. The
// UI's account pickers are customer-keyed (Customer type carries no
// accountId), which previously made every lookup 404 — resolved here once so
// GET/POST and any future caller share the same forgiving contract.
// ─────────────────────────────────────────────────────────────────────────────

const guarantorSchema = z.object({
  creditAccountId: z.string().min(1, "creditAccountId is required"),
  name: z.string().min(2, "name is required").max(120),
  phone: z.string().min(9, "phone is required").max(20),
  nationalId: z.string().min(4, "nationalId is required").max(30),
  guaranteedAmount: z.number().positive("guaranteedAmount must be > 0").max(100_000_000),
});

/**
 * Resolve a credit account from an id that may be either CreditAccount.id or
 * the owning Customer.id (customerId is @unique on CreditAccount).
 */
async function resolveCreditAccount(idOrCustomerId: string) {
  const byId = await db.creditAccount.findUnique({ where: { id: idOrCustomerId } });
  if (byId) return byId;
  return db.creditAccount.findUnique({ where: { customerId: idOrCustomerId } });
}

/** GET /api/v1/credit/guarantors?creditAccountId=… */
export const GET = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireAuth(req);
  const creditAccountId = req.nextUrl.searchParams.get("creditAccountId");
  if (!creditAccountId) throw ApiError.badRequest("creditAccountId query parameter is required");

  const account = await resolveCreditAccount(creditAccountId);
  if (!account) throw ApiError.notFound("Credit account not found");
  const full = await db.creditAccount.findUnique({
    where: { id: account.id },
    include: {
      guarantors: { orderBy: { createdAt: "desc" } },
      customer: { select: { id: true, name: true } },
    },
  });
  if (!full) throw ApiError.notFound("Credit account not found");
  assertBranchAccess(user, full.branchId);

  return NextResponse.json({
    account: {
      id: full.id,
      customerId: full.customer.id,
      customerName: full.customer.name,
      totalDebt: String(full.totalDebt),
      creditLimit: String(full.creditLimit),
    },
    guarantors: full.guarantors.map((g) => ({
      id: g.id,
      name: g.name,
      // PII leaves the server masked only — full values never cross the wire.
      phoneMasked: maskPhone(decryptPII(g.phoneEnc)),
      nationalIdMasked: maskNationalId(decryptPII(g.nationalIdEnc)),
      guaranteedAmount: String(g.guaranteedAmount),
      createdAt: g.createdAt.toISOString(),
    })),
  });
});

/** POST /api/v1/credit/guarantors (MANAGER+) */
export const POST = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const parsed = guarantorSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw ApiError.badRequest(parsed.error.issues[0]?.message ?? "Invalid guarantor payload");
  }
  const body = parsed.data;

  const account = await resolveCreditAccount(body.creditAccountId);
  if (!account) throw ApiError.notFound("Credit account not found");
  assertBranchAccess(user, account.branchId);

  const guarantor = await db.guarantor.create({
    data: {
      creditAccountId: account.id,
      name: body.name,
      phoneEnc: encryptPII(body.phone), // AES-256-GCM at rest
      nationalIdEnc: encryptPII(body.nationalId),
      guaranteedAmount: round2(body.guaranteedAmount),
    },
  });

  await audit({
    userId: user.id,
    action: "GUARANTOR_CREATE",
    entity: "Guarantor",
    entityId: guarantor.id,
    meta: { creditAccountId: account.id, guaranteedAmount: body.guaranteedAmount },
  });

  return NextResponse.json(
    {
      guarantor: {
        id: guarantor.id,
        name: guarantor.name,
        phoneMasked: maskPhone(decryptPII(guarantor.phoneEnc)),
        nationalIdMasked: maskNationalId(decryptPII(guarantor.nationalIdEnc)),
        guaranteedAmount: String(guarantor.guaranteedAmount),
        createdAt: guarantor.createdAt.toISOString(),
      },
    },
    { status: 201 }
  );
});

/** DELETE /api/v1/credit/guarantors?id=… (MANAGER+) */
export const DELETE = withErrorHandler(async (raw: Request) => {
  const req = raw as NextRequest;
  const user = await requireRole(req, "MANAGER");
  const id = req.nextUrl.searchParams.get("id");
  if (!id) throw ApiError.badRequest("id query parameter is required");

  const guarantor = await db.guarantor.findUnique({ where: { id } });
  if (!guarantor) throw ApiError.notFound("Guarantor not found");
  const account = await db.creditAccount.findUnique({ where: { id: guarantor.creditAccountId } });
  assertBranchAccess(user, account?.branchId);

  await db.guarantor.delete({ where: { id } });

  await audit({
    userId: user.id,
    action: "GUARANTOR_DELETE",
    entity: "Guarantor",
    entityId: id,
    meta: { creditAccountId: guarantor.creditAccountId, name: guarantor.name },
  });

  return NextResponse.json({ ok: true });
});
