"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { useOfflineSync } from "@/hooks/useOfflineSync";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Tiny relative formatter (no Intl dependency needed for a badge label). */
function relativeAgo(ts: number | null, now: number): string | null {
  if (ts === null) return null;
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 15) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/**
 * Compact always-visible status badge for the POS top bar: connectivity dot,
 * queued-orders chip, manual sync (F9 twin) and last-sync time.
 */
export function OfflineIndicator({ className }: { className?: string }) {
  const { online, pendingCount, syncing, lastSyncAt, syncNow } = useOfflineSync();
  const [now, setNow] = useState(() => Date.now());

  // Keep the "synced Xm ago" label honest without re-rendering constantly.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);

  const lastSyncLabel = relativeAgo(lastSyncAt, now);

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-stone-200 bg-card px-3 py-1 text-xs",
        className
      )}
      role="status"
      aria-label={
        online ? "Online" : `Offline, ${pendingCount} orders queued`
      }
    >
      {/* Connectivity dot: emerald = online, amber = offline (queue takes over) */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span
              aria-hidden
              className={cn(
                "size-2 rounded-full",
                online ? "bg-emerald-500" : "bg-amber-500",
                !online && "animate-pulse"
              )}
            />
            <span className={online ? "text-emerald-700" : "text-amber-700"}>
              {online ? "Online" : "Offline"}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {online ? "Connected — sales submit instantly" : "Offline — sales queue in IndexedDB and sync later"}
        </TooltipContent>
      </Tooltip>

      {pendingCount > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {pendingCount} queued
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Orders saved offline — they replay to the server automatically (oldest first)
          </TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={syncing}
            aria-label="Sync queued orders now"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-stone-600 transition-colors hover:bg-stone-100 disabled:opacity-60"
          >
            <RefreshCw aria-hidden className={cn("size-3.5", syncing && "animate-spin")} />
            Sync
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Force offline sync now (F9)
          {lastSyncLabel ? ` · last sync ${lastSyncLabel}` : ""}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
