// MBUMAH HARDWARE POS - Safe branch workspace link builder (v2.18.0.0)
//
// One pure, client-safe AND server-safe function that answers: "given a
// store record and the CURRENT origin, what is the correct branch workspace
// URL to open in a new tab?"
//
// WHY IT EXISTS (v2.18.0.0 correction release): the organization console's
// "Open branch workspace" button could produce broken or misleading links:
//   - stores with a missing slug produced placeholder paths like
//     /stores/<undefined> instead of a real workspace address
//   - subdomain URLs (https://juja-main.mbumah.co.ke) were generated even on
//     localhost / 127.0.0.1 / raw LAN IPs where they can never resolve
//   - reserved labels (admin, api, ...) could be turned into branch subdomains
// The builder is deterministic and testable: same inputs, same URL, no
// window access at module scope, no Node-only APIs.
//
// CONTRACT (v2.18.0.0):
//   - slug missing / empty / the literal strings "undefined" or "null" -> null
//   - isActive === false -> null (an inactive branch never opens a tab)
//   - mode 'off' -> null (workspace routing disabled)
//   - mode 'path' -> /stores/{slug}/dashboard
//   - mode 'auto' | 'subdomain': an absolute subdomain URL is produced ONLY
//     when every safety check passes (subdomains enabled, a valid root
//     domain, a non-local non-IP current host, and a valid, non-reserved
//     RFC 1123 subdomain label). Otherwise the builder falls back to the
//     path workspace /stores/{slug}/dashboard.
//   - It NEVER returns a path with a placeholder slug (<undefined>/<null>)
//     or an unresolvable empty host ("//undefined..").

import { isRawIpAddress, isReservedSubdomain, parseHost } from './workspace/config';

export interface BranchWorkspaceStoreRef {
  slug?: string | null;
  subdomain?: string | null;
  isActive?: boolean;
}

export interface BranchWorkspaceHrefInput {
  store: BranchWorkspaceStoreRef;
  /** window.location.host (or request Host). '' means unknown host. */
  currentHost: string;
  mode?: 'auto' | 'path' | 'subdomain' | 'off';
  rootDomain?: string;
  useSubdomains?: boolean;
  /** window.location.protocol, e.g. 'https:'. Defaults by host safety. */
  protocol?: string;
}

/** RFC 1123 label: lowercase alphanumerics + inner hyphens, 1-63 chars. */
const RFC1123_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A usable root domain: at least two valid dot-separated labels. */
const ROOT_DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const LOCAL_HOST_NAMES: ReadonlySet<string> = new Set(['localhost']);
const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set(['127.0.0.1', '::1']);

function envStr(name: string): string | undefined {
  try {
    const value = process.env[name];
    return value === undefined || value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

/** Raw IP host check (IPv4 dotted quad, or anything containing ':' / IPv6). */
export function isRawIpHost(host: string): boolean {
  return isRawIpAddress(host);
}

/**
 * Local / offline hosts can never serve branch subdomains (no wildcard DNS).
 * Mirrors the config.ts rules: localhost, *.localhost, 127.0.0.1, ::1, and
 * every raw IP address (LAN or otherwise).
 */
function isLocalOfflineHost(host: string): boolean {
  if (LOCAL_HOST_NAMES.has(host) || host.endsWith('.localhost')) return true;
  if (LOOPBACK_ADDRESSES.has(host)) return true;
  return isRawIpAddress(host);
}

function parseUseSubdomainsFlag(): boolean {
  const raw = (envStr('NEXT_PUBLIC_USE_SUBDOMAINS') || 'true').toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'no';
}

function normalizedProtocol(protocol: string | undefined, host: string): string {
  const raw = (protocol || '').trim().toLowerCase();
  if (raw) return raw.endsWith(':') ? raw : `${raw}:`;
  // No protocol hint: https everywhere except local/offline hosts.
  return isLocalOfflineHost(host) ? 'http:' : 'https:';
}

/** Trim + normalize a slug-ish field; '' when missing or a placeholder string. */
function cleanSlug(value: string | null | undefined): string {
  const slug = (value ?? '').toString().trim().toLowerCase();
  if (!slug) return '';
  // Defensive: broken upstream data (undefined/null/blank) must never become
  // a placeholder slug path.
  if (slug === 'undefined' || slug === 'null') return '';
  return slug;
}

/**
 * Precise reason a branch workspace link cannot be built (v2.18.3.0).
 *
 * Mirrors the getBranchWorkspaceHref short-circuits one-to-one so the
 * organization console can replace the generic "Branch workspace
 * unavailable" message with a precise, actionable badge. Status text is
 * always rendered alongside any color so the reason is never conveyed by
 * color alone.
 */
export type WorkspaceUnavailableReason =
  | 'missing-slug'
  | 'store-inactive'
  | 'workspace-disabled';

export interface BranchWorkspaceResolution {
  /** Safe URL, or null when no workspace link can be built. */
  href: string | null;
  /** How the href serves the workspace: absolute subdomain or path fallback. */
  usedMode: 'subdomain' | 'path' | null;
  /** Precise reason code when href is null; null when a link exists. */
  unavailableReason: WorkspaceUnavailableReason | null;
}

/**
 * Full workspace link resolution. Pure and deterministic: same inputs,
 * same resolution. getBranchWorkspaceHref stays the canonical thin wrapper
 * so every existing caller and test keeps its exact contract.
 */
export function resolveBranchWorkspace(input: BranchWorkspaceHrefInput): BranchWorkspaceResolution {
  const slug = cleanSlug(input?.store?.slug);
  if (!slug) return { href: null, usedMode: null, unavailableReason: 'missing-slug' };
  if (input.store.isActive === false) {
    return { href: null, usedMode: null, unavailableReason: 'store-inactive' };
  }

  const envMode = (envStr('NEXT_PUBLIC_STORE_WORKSPACE_MODE') || 'auto').toLowerCase();
  const mode = input.mode || (envMode as BranchWorkspaceHrefInput['mode']);
  if (mode === 'off') {
    return { href: null, usedMode: null, unavailableReason: 'workspace-disabled' };
  }
  if (mode === 'path') return { href: `/stores/${slug}/dashboard`, usedMode: 'path', unavailableReason: null };

  const host = parseHost(input.currentHost);
  // Unknown host (server render, empty currentHost): never guess an absolute
  // subdomain URL - fall back to the relative path workspace.
  if (!host) return { href: `/stores/${slug}/dashboard`, usedMode: 'path', unavailableReason: null };
  // localhost, *.localhost, 127.0.0.1, ::1 and raw IPs always use path mode:
  // subdomain URLs cannot resolve there even when the env asks for them.
  if (isLocalOfflineHost(host)) {
    return { href: `/stores/${slug}/dashboard`, usedMode: 'path', unavailableReason: null };
  }

  const useSubdomains = input.useSubdomains ?? parseUseSubdomainsFlag();
  const rootDomain = (input.rootDomain ?? envStr('NEXT_PUBLIC_ROOT_DOMAIN') ?? '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (!useSubdomains || !rootDomain || !ROOT_DOMAIN_PATTERN.test(rootDomain)) {
    return { href: `/stores/${slug}/dashboard`, usedMode: 'path', unavailableReason: null };
  }

  const sub = cleanSlug(input.store.subdomain) || slug;
  // Reserved labels (admin, api, www, ...) must never become branch
  // subdomains; a non-RFC1123 label cannot either.
  if (!RFC1123_LABEL_PATTERN.test(sub) || isReservedSubdomain(sub)) {
    return { href: `/stores/${slug}/dashboard`, usedMode: 'path', unavailableReason: null };
  }

  return {
    href: `${normalizedProtocol(input.protocol, host)}//${sub}.${rootDomain}/dashboard`,
    usedMode: 'subdomain',
    unavailableReason: null,
  };
}

/**
 * Precise reason code for a store whose workspace link cannot be built.
 * Returns null when a safe href exists (the caller renders the link).
 */
export function getWorkspaceUnavailableReason(
  input: BranchWorkspaceHrefInput
): WorkspaceUnavailableReason | null {
  return resolveBranchWorkspace(input).unavailableReason;
}

/**
 * Which transport the resolved href uses: an absolute subdomain origin or
 * the path fallback. Null when no href exists.
 */
export function getBranchWorkspaceUsedMode(
  input: BranchWorkspaceHrefInput
): 'subdomain' | 'path' | null {
  return resolveBranchWorkspace(input).usedMode;
}

/**
 * True for hosts where branch subdomains can never resolve (localhost,
 * *.localhost, 127.0.0.1, ::1, raw IPv4/IPv6). The org console uses this to
 * decide whether a path-mode link is the normal local behavior or a
 * fallback worth surfacing.
 */
export function isLocalWorkspaceHost(host: string): boolean {
  const parsed = parseHost(host);
  if (!parsed) return true;
  return isLocalOfflineHost(parsed);
}

/**
 * Safe URL for opening a branch workspace in a new tab. Returns null when
 * no safe URL can be built (missing slug, inactive store, mode off); the
 * caller renders a calm inline message instead of a broken link. Use
 * resolveBranchWorkspace / getWorkspaceUnavailableReason when the caller
 * also needs the precise reason code.
 */
export function getBranchWorkspaceHref(input: BranchWorkspaceHrefInput): string | null {
  return resolveBranchWorkspace(input).href;
}
