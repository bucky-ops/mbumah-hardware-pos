// MBUMAH HARDWARE POS - Workspace client state (v2.16.0)
//
// Tiny zustand store carrying the resolved branch-workspace context for the
// current tab. Set by the workspace gateway (path mode / branch subdomains)
// and consumed by the sidebar (branch badge, switcher visibility) and the
// top bar. The root domain (organization console) leaves it empty.

import { create } from 'zustand';

export interface WorkspaceStoreRef {
  id: string;
  name: string;
  slug: string | null;
  subdomain: string | null;
  code: string | null;
  location: string | null;
  brandingColor: string | null;
}

interface WorkspaceState {
  /** Resolved branch workspace for this tab; null on the root domain. */
  store: WorkspaceStoreRef | null;
  /** subdomain | path | organization */
  hostMode: 'subdomain' | 'path' | 'organization';
  /** Read-only financial view (ACCOUNTANT in a branch workspace). */
  readOnly: boolean;
  setWorkspace: (input: {
    store: WorkspaceStoreRef | null;
    hostMode: 'subdomain' | 'path' | 'organization';
    readOnly?: boolean;
  }) => void;
  clearWorkspace: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  store: null,
  hostMode: 'organization',
  readOnly: false,
  setWorkspace: ({ store, hostMode, readOnly }) =>
    set({ store, hostMode, readOnly: readOnly ?? false }),
  clearWorkspace: () => set({ store: null, hostMode: 'organization', readOnly: false }),
}));

/** True when this tab is pinned to a branch workspace (subdomain or path). */
export function isPinnedWorkspace(): boolean {
  try {
    return useWorkspaceStore.getState().store !== null;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared auth bootstrap for standalone workspace routes (/chat, /org/dashboard,
// /branches/select). The root SPA bootstraps in page.tsx; these routes mount
// their own trees and must run the same idempotent hydration (localStorage +
// cookie adoption + persisted app store) before they can trust
// isAuthenticated. Returns true once mounted+hydrated.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useSyncExternalStore } from 'react';
import { useAuthStore, useAppStore } from '@/lib/stores';

const emptySubscribe = () => () => {};

export function useWorkspaceAuthBoot(): boolean {
  const hasMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const hydrateFromStorage = useAuthStore((s) => s.hydrateFromStorage);

  useEffect(() => {
    // Same boot sequence as the root page; every call is idempotent.
    hydrateFromStorage();
    try {
      if (useAppStore?.persist?.rehydrate) useAppStore.persist.rehydrate();
    } catch (err) {
      console.error('[WorkspaceBoot] Failed to rehydrate app store:', err);
    }
  }, [hydrateFromStorage]);

  return hasMounted;
}
