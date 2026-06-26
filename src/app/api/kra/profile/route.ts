// GET/PUT /api/kra/profile
//
// Manage a store's KRA eTIMS business profile (credentials + environment).
//   GET  — return the active profile for the store (or null if none configured)
//   PUT  — create or update the active profile (idempotent upsert on businessPin)
//
// SECURITY:
//   • Only SUPER_ADMIN, STORE_OWNER, and STORE_MANAGER roles may edit credentials.
//   • The kraPasswordEncrypted field is base64-encoded in transit (over HTTPS)
//     and stored as-is (kra-helpers.ts decryptPassword reverses it). For real
//     production use, swap to AES-256-GCM via src/lib/crypto-helpers.ts.
//   • The password is NEVER returned in GET responses — only a "configured" boolean.

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_EDIT_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'STORE_MANAGER'];

// ── GET: retrieve the active KRA business profile ────────────────────────────
async function getProfileHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get('storeId') || session.storeId;

  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 },
    );
  }

  const profile = await db.kraBusinessProfile.findFirst({
    where: { storeId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });

  if (!profile) {
    return Response.json({
      success: true,
      data: null,
      message: 'No KRA business profile configured for this store.',
    });
  }

  // Strip sensitive fields before returning.
  const safe = {
    id: profile.id,
    storeId: profile.storeId,
    businessPin: profile.businessPin,
    businessName: profile.businessName,
    registrationDate: profile.registrationDate.toISOString(),
    kraUsername: profile.kraUsername,
    environment: profile.environment,
    isActive: profile.isActive,
    passwordConfigured: !!profile.kraPasswordEncrypted,
    tokenConfigured: !!profile.authToken,
    tokenExpiresAt: profile.authTokenExpiresAt?.toISOString() ?? null,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };

  return Response.json({ success: true, data: safe });
}

// ── PUT: create or update the KRA business profile ───────────────────────────
async function upsertProfileHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email?: string },
): Promise<Response> {
  // Role guard — only managers+ may touch KRA credentials.
  if (!ALLOWED_EDIT_ROLES.includes(session.role)) {
    return Response.json(
      {
        success: false,
        error: 'Insufficient permissions. Only managers and admins may edit KRA credentials.',
      },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return Response.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const {
    storeId,
    businessPin,
    businessName,
    registrationDate,
    kraUsername,
    kraPassword,
    environment = 'sandbox',
    isActive = true,
  } = body;

  // Validate required fields.
  if (!storeId || !businessPin || !businessName || !kraUsername || !kraPassword) {
    return Response.json(
      {
        success: false,
        error: 'Missing required fields: storeId, businessPin, businessName, kraUsername, kraPassword.',
      },
      { status: 400 },
    );
  }

  // Validate KRA PIN format (P + 9 alphanumerics + 1 letter, e.g. P051234567X).
  const pinRegex = /^[A-Za-z]\d{9}[A-Za-z]$/;
  if (!pinRegex.test(businessPin)) {
    return Response.json(
      { success: false, error: 'Invalid KRA PIN format. Expected: P + 9 digits + 1 letter (e.g. P051234567X).' },
      { status: 400 },
    );
  }

  if (!['sandbox', 'production'].includes(environment)) {
    return Response.json(
      { success: false, error: 'environment must be "sandbox" or "production".' },
      { status: 400 },
    );
  }

  const regDate = registrationDate ? new Date(registrationDate) : new Date();
  if (isNaN(regDate.getTime())) {
    return Response.json(
      { success: false, error: 'Invalid registrationDate.' },
      { status: 400 },
    );
  }

  // Encode the password (base64 pass-through — see kra-helpers.ts decryptPassword).
  // For real production, swap to AES-256-GCM via src/lib/crypto-helpers.ts.
  const encryptedPassword = Buffer.from(kraPassword, 'utf8').toString('base64');

  // Upsert by businessPin (unique constraint). If the PIN already exists for
  // this store, update it; otherwise create a new row.
  const existing = await db.kraBusinessProfile.findFirst({
    where: { storeId, businessPin },
  });

  let profile;
  if (existing) {
    profile = await db.kraBusinessProfile.update({
      where: { id: existing.id },
      data: {
        businessName,
        registrationDate: regDate,
        kraUsername,
        kraPasswordEncrypted: encryptedPassword,
        environment,
        isActive,
        // Reset cached token on credential change.
        authToken: null,
        authTokenExpiresAt: null,
      },
    });
  } else {
    profile = await db.kraBusinessProfile.create({
      data: {
        storeId,
        businessPin,
        businessName,
        registrationDate: regDate,
        kraUsername,
        kraPasswordEncrypted: encryptedPassword,
        environment,
        isActive,
      },
    });
  }

  await systemLog({
    action: 'KRA_PROFILE_UPSERTED',
    component: LogComponent.AUTH,
    severity: LogSeverity.INFO,
    message: `KRA profile ${existing ? 'updated' : 'created'} for store ${storeId} (PIN: ${businessPin}, env: ${environment})`,
    userId: session.userId,
    storeId,
    metadata: {
      profileId: profile.id,
      businessPin,
      environment,
      isActive,
      action: existing ? 'UPDATE' : 'CREATE',
    },
  });

  // Return safe shape (no password).
  return Response.json(
    {
      success: true,
      data: {
        id: profile.id,
        storeId: profile.storeId,
        businessPin: profile.businessPin,
        businessName: profile.businessName,
        registrationDate: profile.registrationDate.toISOString(),
        kraUsername: profile.kraUsername,
        environment: profile.environment,
        isActive: profile.isActive,
        passwordConfigured: true,
        createdAt: profile.createdAt.toISOString(),
        updatedAt: profile.updatedAt.toISOString(),
      },
      message: `KRA profile ${existing ? 'updated' : 'created'} successfully.`,
    },
    { status: existing ? 200 : 201 },
  );
}

// ── Export wrapped handlers ─────────────────────────────────────────────────
export const GET = withErrorBoundary(
  requireStoreAccess(getProfileHandler),
  'KRA_PROFILE_GET',
);

export const PUT = withErrorBoundary(
  requireStoreAccess(upsertProfileHandler),
  'KRA_PROFILE_PUT',
);
