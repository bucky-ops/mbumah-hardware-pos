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

/**
 * Expert Information System console URL (v2.18.3). The full expert console
 * (KPI row, Store Intelligence Matrix, 9 expert modules, Decision Support,
 * Activity Timeline, Global Chat, Live Feed) lives at /console on the root
 * domain; /org/dashboard stays the compact per-store summary.
 */
export function buildExpertConsoleUrl(): string {
  return '/console';
}

/** Branch selector URL (warehouse managers with multiple stores). */
export function buildBranchSelectorUrl(): string {
  return '/branches/select';
}

/**
 * People & Payroll deep link for a branch (v2.112.0) — the Branch Selector
 * hand-over. Encodes the branch id (store ids are client-safe strings, but
 * encoding keeps the contract airtight) and rides the v2.111.0 boot deep
 * link: `/?tab=people-payroll&branch=<id>` opens the home shell on the
 * People & Payroll tab, pre-filtered to the branch. The tab must exist in
 * the shell's TAB_CONFIG and the role must hold it — callers gate on
 * ORG_SUMMARY_ROLES so the affordance never renders as a dead door.
 */
export function buildPeoplePayrollDeepLink(storeId: string): string {
  const params = new URLSearchParams();
  params.set('tab', 'people-payroll');
  params.set('branch', storeId || '');
  return `/?${params.toString()}`;
}

/**
 * v2.113.0: the People & Payroll panel's expiry-alerts door — the documents
 * half of the alert count opens the HR employees list pre-filtered to people
 * whose documents expire within `days` (default 90, mirroring the panel's
 * own definition). Pure: URLSearchParams-encoded, relative, never throws.
 */
export function buildExpiringEmployeesHref(storeId: string, days = 90): string {
  const params = new URLSearchParams();
  params.set('expiring', String(days > 0 ? Math.floor(days) : 90));
  params.set('storeId', storeId || '');
  return `/hr/employees?${params.toString()}`;
}

/**
 * v2.113.0: the People & Payroll panel's latest-run door — opens /hr/payroll
 * with ?run=<id>; the page consumes the param and opens that run's detail
 * dialog (the dialog fetches by id and fail-closes on its own). Pure.
 */
export function buildRunDeepLinkHref(runId: string): string {
  const params = new URLSearchParams();
  params.set('run', runId || '');
  return `/hr/payroll?${params.toString()}`;
}

/**
 * v2.114.0: the People & Payroll panel's expiry-alerts door — the assets
 * half of the alert count opens the HR assets list pre-filtered to overdue
 * returns for that branch (`overdue=1` mirrors the panel's own assetsOverdue
 * definition: ASSIGNED with dueReturnOn in the past). Pure:
 * URLSearchParams-encoded, relative, never throws.
 */
export function buildOverdueAssetsHref(storeId: string): string {
  const params = new URLSearchParams();
  params.set('overdue', '1');
  params.set('storeId', storeId || '');
  return `/hr/assets?${params.toString()}`;
}

/**
 * The configured workspace mode as a safe hint string (v2.18.1). Pure and
 * env-derived: 'path' | 'subdomain' | 'auto' | 'off'. The actual per-request
 * decision (path fallback on localhost and raw IPs) always happens in the
 * link builder and the server-side resolver; this hint is informational.
 */
export function resolveWorkspaceModeHint(): 'auto' | 'path' | 'subdomain' | 'off' {
  const raw = (process.env.NEXT_PUBLIC_STORE_WORKSPACE_MODE || 'auto').toLowerCase();
  return raw === 'path' || raw === 'subdomain' || raw === 'off' ? raw : 'auto';
}

export interface PostLoginUser {
  role: string;
  storeId?: string | null;
  memberships?: string[] | null;
  /**
   * The signed-in user's primary store summary (v2.18.1). The login response
   * includes it from the User.store relation; slug/subdomain drive the
   * branch workspace redirect for branch-bound roles.
   */
  store?: {
    id?: string;
    slug?: string | null;
    subdomain?: string | null;
    status?: string | null;
  } | null;
}

/**
 * Post-login destination per the subdomain-workspaces spec. Null means
 * "stay where you are" (already inside a workspace, or the default SPA
 * behavior for branch-only roles).
 *
 *   SUPER_ADMIN / STORE_OWNER / ACCOUNTANT -> /org/dashboard
 *   WAREHOUSE_MANAGER (multiple stores)    -> /branches/select
 *   WAREHOUSE_MANAGER (one store)          -> that store's workspace
 *   CASHIER / BRANCH_MANAGER (v2.18.1)     -> their own branch workspace
 *                                             (subdomain URL when the current
 *                                             host is subdomain-capable, else
 *                                             /stores/{slug}/dashboard);
 *                                             unassigned accounts go to
 *                                             /account/pending-branch
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
      path.startsWith('/account/') ||
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

  // v2.18.1 branch-manager binding: branch-bound roles land in their own
  // branch workspace, decided by the DATABASE relation (User.storeId ->
  // Store.slug), never by email parsing or client-supplied input.
  if (role === 'BRANCH_MANAGER' || role === 'CASHIER') {
    if (!user.storeId && !user.store?.slug) {
      // No branch assignment in the database: never fall through to the
      // organization console or the all-stores view. The pending-branch page
      // explains the situation calmly.
      return '/account/pending-branch';
    }
    const storeRef = {
      id: user.store?.id ?? user.storeId ?? '',
      slug: user.store?.slug ?? null,
      subdomain: user.store?.subdomain ?? null,
    };
    if (!storeRef.slug) {
      // Store assigned but its slug is not configured: the workspace gateway
      // would show "Store slug is not configured", so keep the branch-bound
      // user on the root SPA, which stays pinned to their store via the
      // server-side session and remains fully usable.
      return null;
    }
    // buildStoreWorkspaceUrl applies the full safety matrix itself: path
    // mode on localhost / raw IPs / disabled subdomains, subdomain URL only
    // when the current host is subdomain-capable and the label is valid and
    // non-reserved.
    return buildStoreWorkspaceUrl(storeRef, { page: 'dashboard' });
  }

  return null;
}
