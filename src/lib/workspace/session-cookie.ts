// MBUMAH HARDWARE POS - Shared session cookie (v2.16.0)
//
// The SPA authenticates API calls with a Bearer token held in localStorage,
// which is origin-scoped: a session on the root domain is invisible to
// branch subdomains. When a shared cookie domain is configured the login
// route additionally sets this cookie so branch subdomain origins can adopt
// the session (see getSessionFromRequest in src/lib/auth.ts and the
// workspace bootstrap in the login screen).
//
// Cookie decisions follow the subdomain-workspaces spec:
//   - Domain: NEXTAUTH_COOKIE_DOMAIN when set (must start with a dot to be
//     shared across subdomains); otherwise a host-only cookie (no Domain
//     attribute) which still helps localhost path mode and keeps the
//     default deployment behavior unchanged.
//   - Secure: NEXTAUTH_COOKIE_SECURE (true in production HTTPS, false for
//     local offline HTTP mode).
//   - SameSite: NEXTAUTH_COOKIE_SAME_SITE (lax default) so cross-subdomain
//     top-level navigation keeps the session.
//   - Not HttpOnly: the client must read it to bootstrap localStorage.
//     This matches the existing csrf_token cookie posture (the Bearer token
//     itself already lives in JS-readable localStorage, so no new exposure
//     class is introduced).

export const SESSION_COOKIE_NAME = 'mbt_token';

interface SessionCookieOptions {
  token: string;
  expiresAt?: Date | string | null;
}

function cookieDomain(): string | undefined {
  const raw = process.env.NEXTAUTH_COOKIE_DOMAIN?.trim();
  if (!raw) return undefined;
  return raw.startsWith('.') ? raw.toLowerCase() : `.${raw.toLowerCase()}`;
}

function cookieSecure(): boolean {
  const raw = (process.env.NEXTAUTH_COOKIE_SECURE || '').toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  // Default: secure on production deployments (Vercel/HTTPS), insecure locally.
  return process.env.NODE_ENV === 'production' && process.env.VERCEL === '1';
}

function cookieSameSite(): 'Lax' | 'Strict' | 'None' {
  const raw = (process.env.NEXTAUTH_COOKIE_SAME_SITE || 'lax').toLowerCase();
  if (raw === 'strict') return 'Strict';
  if (raw === 'none') return 'None';
  return 'Lax';
}

/** Serialize the Set-Cookie header value for a fresh session. */
export function buildSessionCookie({ token, expiresAt }: SessionCookieOptions): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    `SameSite=${cookieSameSite()}`,
  ];
  const domain = cookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  if (cookieSecure()) parts.push('Secure');
  if (expiresAt) {
    const exp = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
    if (!Number.isNaN(exp.getTime())) parts.push(`Expires=${exp.toUTCString()}`);
  }
  return parts.join('; ');
}

/** Set-Cookie headers for a login response. */
export function buildSessionCookieHeaders(token: string, expiresAt?: Date | string | null): HeadersInit {
  return { 'Set-Cookie': buildSessionCookie({ token, expiresAt }) };
}

/** Set-Cookie value that clears the session cookie (logout / session expiry). */
export function buildSessionClearCookie(): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    `SameSite=${cookieSameSite()}`,
  ];
  const domain = cookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  if (cookieSecure()) parts.push('Secure');
  return parts.join('; ');
}
