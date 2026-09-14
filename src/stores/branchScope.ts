// src/stores/branchScope.ts — OWNER-only branch scope for catalog/inventory views.
//
// IMPORTANT SCOPE CONTRACT: this store is a CLIENT-side viewing convenience only.
// It narrows which branch's products/movements the OWNER workspace requests, but
// the server remains authoritative — assertTargetBranch (BOLA layer 2) fences
// non-OWNER requests to their own token branch regardless of what is sent here,
// and every endpoint re-derives the real scope from the JWT. Non-OWNER clients
// must never act on this value (page.tsx gates threading on session.role).
import { create } from "zustand";

interface BranchScopeState {
  /** Selected branch id; `null` = ALL branches (unrestricted OWNER view). */
  branchId: string | null;
  setBranchId: (branchId: string | null) => void;
}

export const useBranchScope = create<BranchScopeState>()((set) => ({
  branchId: null,
  setBranchId: (branchId) => set({ branchId }),
}));
