// AES-256-GCM encryption helpers for credentials at rest.
//
// AUDIT REFERENCE — FINANCIAL_MODULE_AUDIT_REPORT.md:
//   • SYS-9 / F9-3: the KRA (eTIMS) portal password was previously stored as
//     base64 — trivially reversible by anyone with DB read access. This module
//     provides real authenticated encryption (AES-256-GCM) so that ciphertext
//     is tamper-evident and keyed by a server-side secret that never touches
//     the database.
//
// Design notes:
//   • Key material comes from the `CREDENTIAL_ENCRYPTION_KEY` environment
//     variable (32 bytes, base64 or hex encoded). When absent we derive a
//     deterministic key from `NEXTAUTH_SECRET || JWT_SECRET` via scrypt so the
//     system is never accidentally unencrypted in environments that already
//     have a strong NextAuth secret. Production deployments SHOULD set
//     CREDENTIAL_ENCRYPTION_KEY explicitly (see docs/CREDENTIAL_ROTATION.md).
//   • Output format: "v1:<iv_b64>:<tag_b64>:<ciphertext_b64>" — versioned so
//     future rotations can coexist with old rows.
//   • Legacy base64 rows (no "v1:" prefix) are transparently detected by
//     `isEncrypted()` so the KRA profile route can migrate them on next save.
//   • Node's `crypto` is available in the Vercel Node.js runtime — no external
//     dependency, and this file is server-only (never import from client code).

import crypto from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard 96-bit IV

/** Cached derived key (32 bytes). */
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const explicit = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (explicit) {
    // Accept 32-byte base64 or 64-char hex.
    if (/^[A-Fa-f0-9]{64}$/.test(explicit)) {
      cachedKey = Buffer.from(explicit, 'hex');
    } else {
      const decoded = Buffer.from(explicit, 'base64');
      if (decoded.length !== 32) {
        throw new Error(
          'CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (base64 or hex). Generate with: openssl rand -base64 32'
        );
      }
      cachedKey = decoded;
    }
    return cachedKey;
  }

  // Deterministic fallback derived from the NextAuth/JWT secret (scrypt).
  const secret =
    process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || undefined;
  if (!secret) {
    throw new Error(
      'No encryption key material available: set CREDENTIAL_ENCRYPTION_KEY (or NEXTAUTH_SECRET).'
    );
  }
  // Salt is static by design — determinism is required so previously stored
  // ciphertexts remain decryptable across cold starts and instances.
  cachedKey = crypto.scryptSync(secret, 'mbumah-credential-encryption-v1', 32);
  return cachedKey;
}

/**
 * Encrypt a plaintext secret with AES-256-GCM.
 * Returns a versioned envelope string safe to store in a database column.
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt an envelope produced by `encryptSecret`.
 * Throws when the ciphertext was tampered with (GCM auth failure) or the key
 * material changed — both conditions MUST be treated as security incidents.
 */
export function decryptSecret(envelope: string): string {
  if (!envelope) return '';
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognised ciphertext envelope (expected v1:iv:tag:data).');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Returns true when the value is in our v1 envelope format (already encrypted).
 * Used by migration paths to detect legacy base64 rows.
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}:`);
}

/** Best-effort decrypt that tolerates legacy base64 rows (read-migration aid). */
export function decryptSecretLegacyAware(envelope: string): string {
  if (!envelope) return '';
  if (isEncrypted(envelope)) return decryptSecret(envelope);
  // Legacy base64 "encryption" (audit finding F9-3) — decode but do NOT trust.
  try {
    return Buffer.from(envelope, 'base64').toString('utf8');
  } catch {
    return envelope;
  }
}
