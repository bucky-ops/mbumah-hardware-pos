/**
 * LEAVE ATTACHMENTS (v2.42.0) — pure validation + display helpers.
 *
 * The LeaveRequest.attachmentUrl column has existed since the leave module
 * was born ("e.g. medical certificate for sick leave") but nothing ever
 * validated or rendered it. v2.42.0 turns it into a governed surface:
 *
 *  - Employees and HR attach supporting documents (medical certificates,
 *    accident reports, death notices for compassionate leave) directly in
 *    the filing / correction / self-service dialogs.
 *  - There is NO blob storage in this deployment, so the pragmatic path is
 *    a base64 DATA URL stored in the existing String? column with a hard
 *    size cap and a MIME allowlist enforced on BOTH ends (client picker and
 *    server route).
 *  - Legacy rows may still hold plain http(s) links — they render as link
 *    chips and remain accepted on save.
 *
 * PURE module — imported by client components AND API routes, so it must
 * stay free of any server-only or React imports (same constraint as
 * src/lib/permissions.ts).
 */

/** Hard cap on the DECODED size of an uploaded attachment (500 KB). */
export const MAX_LEAVE_ATTACHMENT_BYTES = 500 * 1024;

/** Human-facing cap label for copy and error toasts. */
export const MAX_LEAVE_ATTACHMENT_LABEL = '500 KB';

/** MIME types accepted for data-URL attachments. */
export const ALLOWED_LEAVE_ATTACHMENT_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type LeaveAttachmentMime = (typeof ALLOWED_LEAVE_ATTACHMENT_MIME)[number];

export interface LeaveAttachmentOk {
  ok: true;
}

export interface LeaveAttachmentInvalid {
  ok: false;
  /** Machine-readable reason: EMPTY | TOO_LARGE | TYPE | FORMAT */
  code: 'EMPTY' | 'TOO_LARGE' | 'TYPE' | 'FORMAT';
  /** User-facing message (already includes the cap where relevant). */
  message: string;
}

export type LeaveAttachmentValidation = LeaveAttachmentOk | LeaveAttachmentInvalid;

const invalid = (code: LeaveAttachmentInvalid['code'], message: string): LeaveAttachmentInvalid => ({
  ok: false,
  code,
  message,
});

/**
 * Validate an attachmentUrl value coming from ANY surface (HR desk, portal,
 * API body). Accepts:
 *   - null / undefined / ''            → no attachment (ok)
 *   - http(s)://…                       → legacy external link (ok)
 *   - data:<allowed-mime>;base64,…      → upload, size-capped (ok)
 * Anything else (ftp:, bare text, disallowed mime, oversized payload) is
 * rejected with a specific code so the API can map it to a 400.
 */
export function validateLeaveAttachmentUrl(value: string | null | undefined): LeaveAttachmentValidation {
  if (value == null) return { ok: true };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true };

  if (/^https?:\/\//i.test(trimmed)) return { ok: true };

  const dataMatch = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (!dataMatch) {
    // A data URL that did not parse at all (wrong shape, or a random string
    // someone pasted) is a format error; the picker never produces one.
    return invalid('FORMAT', 'Attachments must be a PDF or image file, or an http(s) link.');
  }
  const [, mime, payload] = dataMatch;
  const normalizedMime = mime.toLowerCase();
  if (!(ALLOWED_LEAVE_ATTACHMENT_MIME as readonly string[]).includes(normalizedMime)) {
    return invalid('TYPE', `Unsupported attachment type "${mime}" — use PDF, PNG, JPEG or WebP.`);
  }
  const decodedBytes = base64PayloadBytes(payload);
  if (decodedBytes > MAX_LEAVE_ATTACHMENT_BYTES) {
    return invalid(
      'TOO_LARGE',
      `Attachment is ${formatBytes(decodedBytes)} — the limit is ${MAX_LEAVE_ATTACHMENT_LABEL}.`,
    );
  }
  return { ok: true };
}

/** Decoded byte length of a base64 payload (padding-aware). */
export function base64PayloadBytes(payload: string): number {
  let padding = 0;
  const len = payload.length;
  if (len === 0) return 0;
  if (payload.endsWith('==')) padding = 2;
  else if (payload.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

/** Exact base64 payload length that decodes to `bytes` (for tests). */
export function base64PayloadLengthFor(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

/**
 * Validate a browser File against the same rules the server enforces
 * (client-side gate so the toast fires before any upload attempt).
 */
export function validateLeaveAttachmentFile(file: File): LeaveAttachmentValidation {
  const mime = (file.type || '').toLowerCase();
  if (!(ALLOWED_LEAVE_ATTACHMENT_MIME as readonly string[]).includes(mime)) {
    return invalid('TYPE', `“${file.name}” is not a supported type — use PDF, PNG, JPEG or WebP.`);
  }
  if (file.size > MAX_LEAVE_ATTACHMENT_BYTES) {
    return invalid('TOO_LARGE', `“${file.name}” is ${formatBytes(file.size)} — the limit is ${MAX_LEAVE_ATTACHMENT_LABEL}.`);
  }
  return { ok: true };
}

/** Read a File as a base64 data URL (rejects with an Error on failure). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read. Try again.'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result.startsWith('data:')) reject(new Error('The file could not be read. Try again.'));
      else resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

// ── Display metadata ────────────────────────────────────────────────────────

export type LeaveAttachmentKind = 'pdf' | 'image' | 'link';

export interface LeaveAttachmentMeta {
  kind: LeaveAttachmentKind;
  /** Short human label: file name for data URLs, host for links. */
  label: string;
  /** Decoded size in bytes (null for links). */
  bytes: number | null;
  /** The mime of a data-URL attachment (null otherwise). */
  mime: string | null;
}

const MIME_KIND: Record<string, LeaveAttachmentKind> = {
  'application/pdf': 'pdf',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
};

/** Parse an attachmentUrl into display metadata (null = nothing to show). */
export function parseLeaveAttachmentMeta(value: string | null | undefined): LeaveAttachmentMeta | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dataMatch = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (dataMatch) {
    const mime = dataMatch[1].toLowerCase();
    const payload = dataMatch[2];
    const ext = mime === 'application/pdf' ? 'pdf' : mime.split('/')[1] || 'bin';
    return { kind: MIME_KIND[mime] ?? 'pdf', label: `attachment.${ext}`, bytes: base64PayloadBytes(payload), mime };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    let host = trimmed;
    try {
      host = new URL(trimmed).host || trimmed;
    } catch {
      /* keep the raw string */
    }
    return { kind: 'link', label: host, bytes: null, mime: null };
  }
  // Unrecognized legacy content — still show something rather than nothing.
  return { kind: 'link', label: trimmed.slice(0, 48), bytes: null, mime: null };
}

/** 512000 → "500 KB", 15360 → "15 KB", 640 → "640 B". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
