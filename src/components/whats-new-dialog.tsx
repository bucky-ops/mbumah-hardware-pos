'use client';

/**
 * WhatsNewDialog (v2.13.0) — "Karibu! What's New in Mbumah POS".
 *
 * Shows ONCE per release: on app mount the component reads
 * localStorage 'mbt_seen_version' and, when it differs from APP_VERSION
 * (package.json via src/lib/version.ts — the single source of truth), opens
 * the dialog. Dismissing it ("Got it", Esc or overlay click) writes the
 * current APP_VERSION so the dialog stays quiet until the next release.
 *
 * SSR-SAFETY: localStorage only exists in the browser, so every storage
 * access happens inside useEffect after mount — the component renders null
 * until a mounted flag is set, which also guarantees zero hydration
 * mismatch (server HTML and the first client render are identical: nothing).
 *
 * Release content lives in src/lib/whats-new.ts (WHATS_NEW, newest first) —
 * adding a release is a one-entry edit there.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/lib/version';
import { WHATS_NEW, type WhatsNewEntry } from '@/lib/whats-new';

const SEEN_VERSION_KEY = 'mbt_seen_version';
const CHANGELOG_URL =
  'https://github.com/bucky-ops/mbumah-hardware-pos/blob/main/CHANGELOG.md';

function EntryBlock({ entry, latest }: { entry: WhatsNewEntry; latest: boolean }) {
  return (
    <div
      className={
        latest
          ? 'rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30'
          : 'rounded-lg border bg-muted/30 p-3'
      }
    >
      <div className="flex items-center gap-2">
        <Badge
          variant={latest ? 'default' : 'secondary'}
          className="font-mono text-[11px]"
        >
          v{entry.version}
        </Badge>
        <span className="text-sm font-semibold leading-tight">{entry.title}</span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {entry.bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <span
              aria-hidden="true"
              className={
                latest
                  ? 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500'
                  : 'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40'
              }
            />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhatsNewDialog() {
  // SSR-SAFETY GATE: identical (null) output on server and hydration render.
  // useSyncExternalStore flips to true only after hydration — the same
  // hydration-safe pattern page.tsx uses for useHasMounted.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false);

  // One-time, browser-only decision: open when this device hasn't seen the
  // current APP_VERSION yet. Deferred to a timeout so no setState runs
  // synchronously inside the effect, and the app paints before the dialog
  // appears. Never touches localStorage during render/SSR.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        if (localStorage.getItem(SEEN_VERSION_KEY) !== APP_VERSION) {
          setOpen(true);
        }
      } catch {
        // Storage unavailable (private mode, disabled storage) — stay quiet
        // rather than nag on every load.
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    } catch {
      // Nothing to do — the dialog just re-shows on next launch.
    }
  };

  // SSR-safe: identical (empty) output on server and first client render.
  if (!mounted) return null;

  const [latest, ...older] = WHATS_NEW;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            Karibu! What&apos;s New in Mbumah POS
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-left text-sm text-muted-foreground">
              You&apos;re on version {APP_VERSION} — here&apos;s what changed since your
              last visit.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {latest ? <EntryBlock entry={latest} latest /> : null}
          {older.map((entry) => (
            <EntryBlock key={entry.version} entry={entry} latest={false} />
          ))}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" size="sm" asChild>
            <a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              View changelog on GitHub
            </a>
          </Button>
          <Button size="sm" onClick={dismiss}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
