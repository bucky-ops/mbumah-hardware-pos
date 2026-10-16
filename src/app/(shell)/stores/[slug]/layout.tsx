// Branch workspace route layout (v2.18.3.0 correction release)
//
// Server-side branch context guard for every /stores/{slug}/... request:
//   - Rejects placeholder slugs ("undefined", "null") before they can reach
//     the gateway, so a broken link can never render a workspace shell or
//     leak an undefined slug into queries.
//   - Resolves the store record server-side (by slug or subdomain) and
//     publishes a screen-reader status region so assistive technology gets
//     the branch identity even before client hydration.
//   - Passes all valid requests through to the catch-all page, which keeps
//     rendering the shared SPA shell (the top-bar already shows the branch
//     badge, current user name and role for pinned workspaces, so this
//     layout adds context without duplicating chrome).
//
// This layout is NOT the authorization boundary. The gateway + the
// /api/me/store-context resolver + every API route re-validate access
// server-side (see src/lib/workspace/server.ts and src/lib/auth.ts).

import type { ReactNode } from 'react';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Slugs that can only come from broken upstream links, never real stores. */
const PLACEHOLDER_SLUGS = new Set(['undefined', 'null', '']);

interface LayoutProps {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function StoreWorkspaceLayout({ children, params }: LayoutProps) {
  const { slug: rawSlug } = await params;
  const slug = (rawSlug || '').toLowerCase();

  if (PLACEHOLDER_SLUGS.has(slug)) {
    // Broken link (a template rendered an undefined slug). Never query with
    // it; render a calm, safe message with no internal paths or raw errors.
    return (
      <div role="alert" className="p-6 text-sm text-muted-foreground">
        This branch workspace link is incomplete. Open the workspace from the
        organization console, or go back to the app home page.
      </div>
    );
  }

  let storeName: string | null = null;
  let storeLocation: string | null = null;
  try {
    const store = await db.store.findFirst({
      where: { OR: [{ slug }, { subdomain: slug }] },
      select: { name: true, location: true, status: true },
    });
    if (store) {
      storeName = store.name;
      storeLocation = store.location;
    }
  } catch {
    // Database unavailable at request time: the gateway below renders its
    // own safe states. Never leak raw Prisma errors here.
  }

  return (
    <div data-branch-slug={slug}>
      <p aria-live="polite" className="sr-only">
        {storeName
          ? `${storeName} branch workspace${storeLocation ? `, ${storeLocation}` : ''}`
          : 'Branch workspace'}
      </p>
      {children}
    </div>
  );
}
