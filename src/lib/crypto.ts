import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// PII Data Protection — AES-256-GCM encryption for customer records at rest
// (phone numbers, KRA PINs, national IDs, emails).
//
// SECURITY NOTES
//  • GCM = authenticated encryption: any tampering fails authTag verification
//    and decryptPII returns null (never garbage).
//  • A fresh 12-byte IV per encryption — NEVER reuse an IV with the same key.
//  • Key material: PII_ENCRYPTION_KEY env (64 hex chars = 32 bytes). This
//    satisfies the Kenya Data Protection Act 2019 "appropriate technical
//    measures" requirement for customer contact data.
//  • Storage format: base64(iv).base64(authTag).base64(ciphertext)
// ─────────────────────────────────────────────────────────────────────────────

const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey(): Buffer {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (hex && hex.length === KEY_BYTES * 2) {
    const key = Buffer.from(hex, "hex");
    if (key.length === KEY_BYTES) return key;
  }
  if (hex) {
    // Derive a stable key from a mis-sized secret rather than crash at runtime.
    return crypto.createHash("sha256").update(hex, "utf8").digest();
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("PII_ENCRYPTION_KEY must be configured in production");
  }
  // Dev-only deterministic fallback so seeds/tests behave consistently.
  return crypto.createHash("sha256").update("mbumah-dev-pii-key", "utf8").digest();
}

/** Encrypt UTF-8 plaintext → "iv.tag.ciphertext" base64 string. */
export function encryptPII(plaintext: string): string {
  if (!plaintext) return "";
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/** Decrypt "iv.tag.ciphertext" → plaintext; null on tamper/parse failure. */
export function decryptPII(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null; // wrong key or tampered ciphertext
  }
}

export interface PiiRecord {
  phone?: string | null;
  email?: string | null;
  nationalId?: string | null;
}

/** Encrypt all PII fields of a record in one call (null-safe). */
export function encryptPiiRecord(rec: PiiRecord): { phoneEnc: string | null; emailEnc: string | null; nationalIdEnc: string | null } {
  return {
    phoneEnc: rec.phone ? encryptPII(rec.phone) : null,
    emailEnc: rec.email ? encryptPII(rec.email) : null,
    nationalIdEnc: rec.nationalId ? encryptPII(rec.nationalId) : null,
  };
}

/** Masked display forms — never render full PII in UIs/logs. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `+${digits.slice(0, digits.length - 8).replace(/\d(?=\d{2})/g, "*")} *** ${digits.slice(-3)}`;
}

export function maskEmail(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, local.length - 1))}@${domain}`;
}

export function maskNationalId(id: string | null): string | null {
  if (!id) return null;
  return id.length <= 4 ? "***" : `${"*".repeat(id.length - 4)}${id.slice(-4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Searchable encryption for KRA PINs (audit GUARDRAIL 4 patch).
//
// Problem: AES-256-GCM uses a fresh IV per call, so the same PIN encrypts to a
// different ciphertext every time — a `@unique` constraint on the ciphertext
// column can never enforce "one customer per PIN", and exact-match lookups are
// impossible. Standard remedy: store BOTH
//   • kraPinEnc  — AES-256-GCM ciphertext (confidentiality at rest)
//   • kraPinHash — HMAC-SHA256(PIN) hex (deterministic → @unique + equality)
// The HMAC key is derived from PII_ENCRYPTION_KEY (never stored alongside the
// data), so a DB dump alone cannot brute-force the 11-char PIN keyspace
// offline; rainbow tables fail because the key is deployment-specific.
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic HMAC-SHA256 hex digest of a PII value (searchable index). */
export function hmacPII(plaintext: string): string {
  return crypto.createHmac("sha256", getKey()).update(plaintext, "utf8").digest("hex");
}

export interface EncryptedKraPin {
  /** AES-256-GCM ciphertext ("iv.tag.ciphertext" base64) — store in kraPinEnc. */
  enc: string;
  /** HMAC-SHA256 hex — store in kraPinHash (@unique). */
  hash: string;
}

/** Encrypt a KRA PIN for storage (null-safe → both columns null). */
export function encryptKraPin(pin: string | null | undefined): EncryptedKraPin | null {
  if (!pin) return null;
  return { enc: encryptPII(pin), hash: hmacPII(pin) };
}

/** Kenya KRA PIN shape — letter + 9 digits + letter (e.g. P051988776Q). */
const KRA_PIN_SHAPE = /^[A-Za-z]\d{9}[A-Za-z]$/;

/**
 * Recover a plaintext PIN from the kraPinEnc column.
 * Backward compatibility: rows written before the encryption patch stored the
 * plaintext directly — those are detected by shape and returned as-is so the
 * receipt/reprint paths keep working during a rolling migration.
 */
export function decryptKraPin(payload: string | null | undefined): string | null {
  if (!payload) return null;
  if (KRA_PIN_SHAPE.test(payload)) return payload; // legacy plaintext row
  return decryptPII(payload);
}

/** Masked display form of a KRA PIN (shows last 3 only). */
export function maskKraPin(pin: string | null | undefined): string | null {
  if (!pin) return null;
  return pin.length <= 4 ? "***" : `${"*".repeat(pin.length - 3)}${pin.slice(-3)}`;
}
