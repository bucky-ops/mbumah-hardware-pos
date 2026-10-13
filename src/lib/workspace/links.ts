// MBUMAH HARDWARE POS - Workspace link builders (client-safe, v2.16.0)
//
// Turns a store record (slug + subdomain) into the URL the current origin
// should use to open that branch workspace:
//   - subdomain mode: https://juja-main.mbumah.co.ke/dashboard
//   - path mode:      /stores/juja-main/dashboard
//
// Decision inputs are NEXT_PUBLIC_* build-time flags plus the current
// window.location.host at call time, so server rendering falls back to
// relative path links (never throws).

import { parseHost, resolveWorkspaceHostMode } from './config';

export interface StoreWorkspaceRef {
  id: string;
  slug?: string | null;
  subdomain?: string | null;
}

export interface WorkspaceLinkOptions {
  /** In-page route inside the workspace. Defaults to '/dashboard'. */
  page?: string;
  /**
   * Force the link style. When omitted, the current origin decides
   * (subdomain links only when the current origin itself resolves to
   * subdomain mode, i.e. root-domain or cross-branch navigation).
   */
  forceSubdomain?: boolean;
  forcePath?: boolean;
}

/** The page route inside a workspace (normalized, always starts with /). */
export function workspacePagePath(page?: string): string {
  const clean = (page || 'dashboard').replace(/^\/+/, '');
  return clean.length > 0 ? `/${clean}` : '/dashboard';
}

/**
 * Canonical workspace URL for a store:
 *   1. forcePath, or subdomain mode unavailable -> /stores/{slug}{page}
 *   2. root domain configured + subdomain present -> absolute URL on the
 *      configured root domain, keeping the current protocol (http locally,
 *      https in production).
 *   3. fallback -> /stores/{slug}{page}
 */
export function buildStoreWorkspaceUrl(
  store: StoreWorkspaceRef,
  options: WorkspaceLinkOptions = {},
): string {
  const page = workspacePagePath(options.page);
  const slug = store.slug || store.subdomain || store.id;

  if (options.forcePath) return `/stores/${slug}${page}`;

  const rootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || '').toLowerCase();
  const useSubdomains = (process.env.NEXT_PUBLIC_USE_SUBDOMAINS || 'true').toLowerCase() !== 'false';
  const mode = (process.env.NEXT_PUBLIC_STORE_WORKSPACE_MODE || 'auto').toLowerCase();
  const subdomainAllowed = useSubdomains && mode !== 'off' && mode !== 'path' && !!rootDomain;
  const sub = store.subdomain || (store.slug ? store.slug : null);

  if (subdomainAllowed && sub) {
    const host = parseHost(typeof window !== 'undefined' ? window.location.host : '');
    // The current origin decides whether absolute subdomain links make sense:
    // from the root domain (or any other host that resolves to subdomain
    // mode) they do; from raw localhost/path mode they do not.
    const originResolvesToSubdomain =
      typeof window === 'undefined' ? true : resolveWorkspaceHostMode(host) === 'subdomain';
    if (options.forceSubdomain || originResolvesToSubdomain || host === rootDomain) {
      const proto = typeof window !== 'undefined' ? window.location.protocol : 'https:';
      return `${proto}//${sub}.${rootDomain}${page}`;
    }
  }

  return `/stores/${slug}${page}`;
}

/** Organization console URL (root domain, organization roles only). */
export function buildOrgConsoleUrl(): string {
  return '/org/dashboard';
}

/** Branch selector URL (warehouse managers with multiple stores). */
export function buildBranchSelectorUrl(): string {
  return '/branches/select';
}

export interface PostLoginUser {
  role: string;
  storeId?: string | null;
  memberships?: string[] | null;
}

/**
 * Post-login destination per the subdomain-workspaces spec. Null means
 * "stay where you are" (already inside a workspace, or the default SPA
 * behavior for branch-only roles).
 *
 *   SUPER_ADMIN / STORE_OWNER / ACCOUNTANT -> /org/dashboard
 *   WAREHOUSE_MANAGER (multiple stores)    -> /branches/select
 *   WAREHOUSE_MANAGER (one store)          -> that store's workspace
 *   CASHIER / BRANCH_MANAGER               -> null (root SPA, pinned store)
 */
export function postLoginRedirect(user: PostLoginUser | null | undefined): string | null {
  if (!user) return null;

  // Already inside a workspace context: keep the user where they are so the
  // "branch user logs in on their branch subdomain" flow lands in-branch.
  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    const inWorkspace =
      path.startsWith('/stores/') ||
      path.startsWith('/org/') ||
      path.startsWith('/branches/') ||
      path.startsWith('/chat');
    const onSubdomain = resolveWorkspaceHostMode(parseHost(window.location.host)) === 'subdomain';
    if (inWorkspace || onSubdomain) return null;
  }

  const role = (user.role || '').toUpperCase();

  if (['SUPER_ADMIN', 'STORE_OWNER', 'ACCOUNTANT'].includes(role)) {
    return buildOrgConsoleUrl();
  }

  if (role === 'WAREHOUSE_MANAGER') {
    // Always route through the branch selector: it resolves slugs/subdomains
    // from /api/stores, auto-redirects single-store members, and shows a calm
    // empty state for unassigned managers.
    return buildBranchSelectorUrl();
  }

  return null;
}
