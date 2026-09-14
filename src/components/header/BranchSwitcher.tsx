"use client";

// src/components/header/BranchSwitcher.tsx — compact header branch-scope filter.
//
// Renders ONLY for OWNER (roleAtLeast role gate): a small shadcn Select bound to
// the branchScope zustand store so the selection survives tab switches. Choosing
// "All branches" maps to store value `null`. The store is a client-side viewing
// convenience — the server stays authoritative (assertTargetBranch BOLA-fences
// non-OWNER requests no matter what this widget does).
//
// Failure policy: if GET /api/branches fails we degrade to a muted MapPin +
// session branchName chip — no crash, no toast spam (console.warn once).

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { roleAtLeast, type SessionUser } from "@/lib/types";
import { useBranchScope } from "@/stores/branchScope";
import { cn } from "@/lib/utils";

export interface BranchSwitcherProps {
  session: SessionUser;
  className?: string;
}

/** Minimal shape of GET /api/branches items (full rows carry code/kraPin/_count). */
interface BranchOption {
  id: string;
  name: string;
  code?: string;
  location?: string | null;
}

const ALL = "all"; // Select sentinel value → store null (unrestricted view)

export function BranchSwitcher({ session, className }: BranchSwitcherProps) {
  const isOwner = roleAtLeast(session.role, "OWNER");

  const branchId = useBranchScope((s) => s.branchId);
  const setBranchId = useBranchScope((s) => s.setBranchId);

  /** null = fetch in flight · [] = loaded (possibly empty) */
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/branches", { cache: "no-store" });
        if (!res.ok) throw new Error(`GET /api/branches → ${res.status}`);
        const data = (await res.json().catch(() => null)) as { items?: BranchOption[] } | null;
        if (cancelled) return;
        setBranches(Array.isArray(data?.items) ? data.items : []);
        setFailed(false);
      } catch (err) {
        if (!warnedRef.current) {
          console.warn("BranchSwitcher: branch registry unavailable — falling back to session branch", err);
          warnedRef.current = true;
        }
        if (!cancelled) {
          setFailed(true);
          setBranches([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  // Self-heal: a selection that no longer exists in the registry (branch deleted,
  // or a stale value left over from a previous session) falls back to ALL.
  useEffect(() => {
    if (branches && branchId && !branches.some((b) => b.id === branchId)) {
      setBranchId(null);
    }
  }, [branches, branchId, setBranchId]);

  if (!isOwner) return null;

  // Degrade gracefully while loading or when the registry is unreachable:
  // a muted MapPin + the session branch name chip (no crash, no toast spam).
  if (!branches || failed) {
    return (
      <span
        className={cn(
          "inline-flex h-8 max-w-[12rem] items-center gap-1.5 rounded-md border border-stone-200 bg-stone-50 px-2.5 text-xs text-stone-400",
          className,
        )}
        title={session.branchName ?? undefined}
      >
        <MapPin className="size-3.5 shrink-0 text-stone-300" aria-hidden />
        <span className="truncate">{session.branchName ?? "Branch"}</span>
      </span>
    );
  }

  const selected = branchId ? branches.find((b) => b.id === branchId) : undefined;
  const label = selected ? selected.name : `All branches (${branches.length})`;

  return (
    <Select
      value={branchId ?? ALL}
      onValueChange={(v) => setBranchId(v === ALL ? null : v)}
    >
      <SelectTrigger
        size="sm"
        aria-label="Filter by branch"
        title="View one branch or all branches (catalog · inventory)"
        className={cn(
          "h-8 w-auto min-w-0 max-w-[12rem] gap-1.5 border-stone-200 px-2.5 text-xs",
          "focus-visible:ring-2 focus-visible:ring-emerald-600/30",
          "hover:bg-stone-50",
          className,
        )}
      >
        <MapPin className="size-3.5 shrink-0 text-emerald-700" aria-hidden />
        <SelectValue>
          <span className="truncate">{label}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72 text-xs">
        <SelectItem value={ALL} className="text-xs">
          All branches ({branches.length})
        </SelectItem>
        {branches.map((b) => (
          <SelectItem key={b.id} value={b.id} className="text-xs">
            {b.name}
            {b.code ? <span className="pl-1 text-[10px] text-stone-400">{b.code}</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
