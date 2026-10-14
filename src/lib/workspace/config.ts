// MBUMAH HARDWARE POS - Workspace domain configuration (v2.16.0)
//
// Pure, dependency-free helpers that answer the "which workspace am I in?"
// question for a request Host header. Shared by:
//   - src/proxy.ts (Edge runtime: host validation + subdomain rewrite)
//   - src/lib/workspace/server.ts (Node runtime: DB-backed store resolution)
//   - client components (link building via src/lib/workspace/links.ts)
//
// HARD CONSTRAINTS:
//   - No Node-only APIs (fs, crypto, net). This file must stay Edge-safe.
//   - No Prisma. DB resolution happens only in workspace/server.ts.
//   - No zod/env.ts import: the Edge proxy reads process.env directly and the
//     client bundle inlines NEXT_PUBLIC_* at build time.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How the current request maps to a workspace:
 *   - 'subdomain': the host is {store}.{rootDomain} and subdomains are enabled
 *   - 'path': the host is the root domain (or localhost/IP); workspaces are
 *     addressed as /stores/{slug}/...
 *   - 'organization': root-domain request (the org console)
 */
export type WorkspaceHostMode = 'subdomain' | 'path' | 'organization';

export interface WorkspaceConfig {
  /** Root domain for subdomain workspaces, e.g. "mbumah.test" or "mbumah.co.ke". */
  rootDomain: string;
  /** Master switch for subdomain workspaces (NEXT_PUBLIC_USE_SUBDOMAINS). */
  useSubdomains: boolean;
  /** auto | subdomain | path | off (NEXT_PUBLIC_STORE_WORKSPACE_MODE). */
  mode: 'auto' | 'subdomain' | 'path' | 'off';
  /** Configured allowlist patterns (ALLOWED_HOSTS), may be empty. */
  allowedHosts: string[];
}

/**
 * Reserved subdomains are never treated as branch workspaces. They either
 * belong to infrastructure (www, api, auth) or collide with app routes
 * (login, chat, org, stores, ...).
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www',
  'api',
  'auth',
  'admin',
  'app',
  'mail',
  'status',
  'assets',
  'static',
  '_next',
  'favicon',
  'robots',
  'sitemap',
  'login',
  'logout',
  'chat',
  'org',
  'stores',
  'branches',
]);

/** RFC 1123 label for a store subdomain: lowercase alphanumerics + hyphens. */
const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// ---------------------------------------------------------------------------
// Environment reads (safe in Edge, Node, and browser bundles)
// ---------------------------------------------------------------------------

function envStr(name: string): string | undefined {
  try {
    const value = process.env[name];
    return value === undefined || value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

function parseWorkspaceConfig(): WorkspaceConfig {
  const rawMode = (envStr('NEXT_PUBLIC_STORE_WORKSPACE_MODE') || 'auto').toLowerCase();
  const mode = (['auto', 'subdomain', 'path', 'off'] as const).includes(
    rawMode as WorkspaceConfig['mode'],
  )
    ? (rawMode as WorkspaceConfig['mode'])
    : 'auto';

  const useSubdomainsRaw = (envStr('NEXT_PUBLIC_USE_SUBDOMAINS') || 'true').toLowerCase();
  const useSubdomains = useSubdomainsRaw !== 'false' && useSubdomainsRaw !== '0' && useSubdomainsRaw !== 'no';

  const allowedHosts = (envStr('ALLOWED_HOSTS') || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);

  return {
    rootDomain: (envStr('NEXT_PUBLIC_ROOT_DOMAIN') || '').toLowerCase().replace(/\.$/, ''),
    useSubdomains,
    mode,
    allowedHosts,
  };
}

/**
 * Parse and normalize a Host header (or window.location.host):
 * strips the port, lowercases, strips a trailing dot, and unwraps IPv6
 * brackets. Returns '' for unparseable input (caller treats as unknown host).
 */
export function parseHost(hostHeader: string | null | undefined): string {
  if (!hostHeader) return '';
  let host = hostHeader.trim().toLowerCase();
  if (host.length === 0) return '';
  // IPv6 literal with port: [::1]:3000
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end === -1) return '';
    return host.slice(1, end);
  }
  // Strip port (a second colon would mean a bracketless IPv6 literal, which
  // is not valid in a Host header, so a single colon is a safe port marker).
  const colon = host.lastIndexOf(':');
  if (colon !== -1 && host.indexOf(':') === colon) {
    host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

// ---------------------------------------------------------------------------
// Forwarded host resolution (online tunnel / reverse proxy mode, v2.17.7)
// ---------------------------------------------------------------------------

/** Truthy spellings for the TRUST_X_FORWARDED_HOST flag (case-insensitive). */
function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Resolve the client-visible request host for the workspace pipeline.
 *
 * SECURITY CONTRACT: the x-forwarded-host header is honored ONLY when
 * TRUST_X_FORWARDED_HOST is truthy ('1', 'true', 'yes', 'on',
 * case-insensitive), and it must ONLY be enabled behind a proxy or tunnel
 * that OVERWRITES x-forwarded-host on every request (Cloudflare Tunnel,
 * Caddy, nginx with an explicit proxy_set_header). Never enable it on a
 * directly exposed server: any client could spoof the header and impersonate
 * another workspace origin. With the flag off (the default everywhere) the
 * forwarded header is ignored and behavior matches pre-2.17.7 releases.
 *
 * When the header carries a comma-separated list (a chain of proxies), the
 * FIRST value is the host as injected by the outermost client-facing proxy,
 * which is the one the workspace pipeline should see. If the trusted header
 * is absent or unparseable, the plain Host header is used as the fallback.
 *
 * Returns the normalized host (port stripped, lowercased, trailing dot
 * removed) or null when no usable host information is present.
 */
export function resolveRequestHost(headers: {
  host?: string | null;
  'x-forwarded-host'?: string | null;
}): string | null {
  if (isTruthyFlag(envStr('TRUST_X_FORWARDED_HOST'))) {
    const forwarded = headers['x-forwarded-host'];
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim() ?? '';
      const parsedForwarded = parseHost(first);
      if (parsedForwarded) return parsedForwarded;
    }
  }
  const parsed = parseHost(headers.host);
  return parsed === '' ? null : parsed;
}

// ---------------------------------------------------------------------------
// Host classification
// ---------------------------------------------------------------------------

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1']);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isRawIpAddress(host: string): boolean {
  if (IPV4_PATTERN.test(host)) return true;
  return host.includes(':'); // bare IPv6 literal
}

/**
 * Wildcard allowlist match. Patterns:
 *   - exact: "mbumah.test" matches only "mbumah.test"
 *   - suffix wildcard: "*.mbumah.test" matches "mbumah.test" and any
 *     deeper host like "juja-main.mbumah.test"
 */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (p === '*') return true;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return host === p;
}

/**
 * Default allowlist applied when ALLOWED_HOSTS is not configured. The goal is
 * to keep every existing deployment mode working (localhost dev, LAN IPs,
 * Vercel prod + previews, self-hosted domains) while rejecting lookalike
 * hosts such as "example.com.evil.io".
 */
function defaultAllowedHosts(config: WorkspaceConfig): string[] {
  const defaults = ['localhost', '*.localhost', '127.0.0.1', '::1', '*.vercel.app'];
  if (config.rootDomain) {
    defaults.push(config.rootDomain, '*.' + config.rootDomain);
  }
  return defaults;
}

/**
 * Validate a request host against ALLOWED_HOSTS (or the built-in defaults).
 * Localhost names, raw IP addresses (LAN/offline mode), and configured
 * patterns are allowed. Everything else is rejected (host header attacks).
 */
export function isHostAllowed(host: string, config: WorkspaceConfig = parseWorkspaceConfig()): boolean {
  const parsed = parseHost(host);
  if (!parsed) return false;
  if (isLocalHost(parsed)) return true;
  if (isRawIpAddress(parsed)) return true;

  const patterns = config.allowedHosts.length > 0 ? config.allowedHosts : defaultAllowedHosts(config);
  return patterns.some((p) => hostMatchesPattern(parsed, p));
}

/**
 * Extract the branch subdomain from a host. Returns null when:
 *   - the host is the root domain itself (or a bare localhost/IP)
 *   - no root domain is configured
 *   - the remaining label(s) contain a dot (deep hosts like a.b.root are not
 *     valid slugs) or violate the slug pattern
 *   - the label is reserved (www, api, admin, ...)
 */
export function extractSubdomain(
  host: string,
  config: WorkspaceConfig = parseWorkspaceConfig(),
): string | null {
  const parsed = parseHost(host);
  if (!parsed || !config.rootDomain) return null;
  if (!parsed.endsWith('.' + config.rootDomain)) return null;
  const prefix = parsed.slice(0, parsed.length - config.rootDomain.length - 1);
  if (!prefix || prefix.includes('.')) return null;
  if (!SUBDOMAIN_PATTERN.test(prefix)) return null;
  if (isReservedSubdomain(prefix)) return null;
  return prefix;
}

export function isReservedSubdomain(label: string): boolean {
  return RESERVED_SUBDOMAINS.has(label.toLowerCase());
}

/**
 * Is this host the root domain (organization console) rather than a branch
 * subdomain? True for localhost / raw IPs / unconfigured domains too, since
 * those always use path mode.
 */
export function isRootDomain(host: string, config: WorkspaceConfig = parseWorkspaceConfig()): boolean {
  const parsed = parseHost(host);
  if (!parsed) return false;
  if (isLocalHost(parsed) || isRawIpAddress(parsed)) return true;
  if (!config.rootDomain) return true;
  return parsed === config.rootDomain;
}

/**
 * Decide the workspace mode for a request host:
 *   - mode 'off' -> 'organization' (feature disabled, root behavior)
 *   - explicit 'path' -> 'organization' (host-based subdomains disabled)
 *   - subdomain host detected and subdomains enabled -> 'subdomain'
 *   - everything else -> 'organization' (path mode is addressed by URL)
 */
export function resolveWorkspaceHostMode(
  host: string,
  config: WorkspaceConfig = parseWorkspaceConfig(),
): WorkspaceHostMode {
  if (config.mode === 'off' || config.mode === 'path') return 'organization';
  if (!config.useSubdomains) return 'organization';
  return extractSubdomain(host, config) ? 'subdomain' : 'organization';
}

/**
 * True when branch workspace links should point at absolute subdomain URLs
 * from the current origin. Path mode is used on localhost, raw IPs, hosts
 * without a configured root domain, and when the feature is off.
 */
export function shouldUseSubdomainMode(host: string, config: WorkspaceConfig = parseWorkspaceConfig()): boolean {
  return resolveWorkspaceHostMode(host, config) === 'subdomain';
}

/** Inverse of shouldUseSubdomainMode, kept for readability at call sites. */
export function shouldUsePathMode(host: string, config: WorkspaceConfig = parseWorkspaceConfig()): boolean {
  return !shouldUseSubdomainMode(host, config);
}

/**
 * Build the internal rewrite target for a branch subdomain request.
 * juja-main.mbumah.test/pos -> /stores/juja-main/pos
 * Returns null when the label is not a valid store subdomain.
 */
export function buildInternalPath(subdomain: string, path: string): string | null {
  if (!SUBDOMAIN_PATTERN.test(subdomain) || isReservedSubdomain(subdomain)) return null;
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  if (cleanPath === '/') return `/stores/${subdomain}`;
  return `/stores/${subdomain}${cleanPath}`;
}

/**
 * Extract the store slug from a path-mode workspace pathname
 * (v2.18.0.3 store-context correction).
 *
 *   /stores/juja-main/dashboard          -> juja-main
 *   /stores/thika                        -> thika
 *   /stores/nairobi-cbd/reports/export   -> nairobi-cbd
 *   /dashboard, /, null, /stores/        -> null
 *
 * Pure and edge-safe: lets resolveStoreContext accept a bare pathname
 * (spec behavior) instead of requiring the caller to pre-parse ?slug=.
 * The label must be a plausible slug (letters, digits, hyphens); anything
 * else (ids, "undefined", "null") is returned as-is for the caller to
 * treat as an unknown store, NOT silently rewritten.
 */
export function extractSlugFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const match = /^\/stores\/([A-Za-z0-9-]+)(?:\/|$)/i.exec(pathname);
  return match ? match[1].toLowerCase() : null;
}
