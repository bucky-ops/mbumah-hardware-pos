"use client";

import { Lightbulb } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HOTKEY_LEGEND, type HotkeyAction } from "@/hooks/usePOSHotkeys";

// ─────────────────────────────────────────────────────────────────────────────
// ShortcutsHelp — polished keyboard-shortcuts dialog for the header's
// "Shortcuts ?" button (controlled via props; the orchestrator owns the state).
//
// The "Point of sale" group is derived from HOTKEY_LEGEND (the hook's single
// source of truth) so this dialog can never drift from the live key map. The
// "Everywhere" group is declared here because the F8 notifications-focus
// hotkey is owned by the orchestrator layout, not the POS hook.
// ─────────────────────────────────────────────────────────────────────────────

export interface ShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShortcutRow {
  keys: string;
  label: string;
}

const POS_ACTIONS: HotkeyAction[] = ["search", "mpesa", "cash", "hold", "clear"];

const EVERYWHERE: ShortcutRow[] = [
  { keys: "⌘K / Ctrl K", label: "Command palette — navigate, search & act" },
  { keys: "?", label: "Open this shortcut help" },
  { keys: "F8", label: "Focus notifications" },
  { keys: "F9", label: "Sync queued orders" },
];

function ShortcutGroup({ title, rows }: { title: string; rows: ShortcutRow[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {rows.map((row) => (
        <div
          key={row.keys}
          className="flex items-center justify-between gap-3 rounded-lg border border-stone-100 bg-stone-50/60 px-2.5 py-1.5"
        >
          <span className="truncate text-xs text-stone-700">{row.label}</span>
          <kbd className="kbd shrink-0">{row.keys}</kbd>
        </div>
      ))}
    </div>
  );
}

export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const posRows: ShortcutRow[] = POS_ACTIONS.map((action) =>
    HOTKEY_LEGEND.find((h) => h.action === action)
  )
    .filter((h): h is (typeof HOTKEY_LEGEND)[number] => h !== undefined)
    .map((h) => ({ keys: h.keys, label: h.label }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs">
            Keyboard-first POS — ring up sales without touching the mouse.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <ShortcutGroup title="Point of sale" rows={posRows} />
          <ShortcutGroup title="Everywhere" rows={EVERYWHERE} />
        </div>

        <p className="text-[11px] text-muted-foreground">
          Shortcuts are disabled while typing in text fields.
        </p>

        <Alert className="border-amber-200 bg-amber-50">
          <Lightbulb className="size-4 text-amber-600" aria-hidden />
          <AlertTitle className="text-xs text-amber-800">Pro tip</AlertTitle>
          <AlertDescription className="text-xs text-amber-800/90">
            Repeated scans of the same barcode merge into one line — set the line discount before
            taking payment.
          </AlertDescription>
        </Alert>
      </DialogContent>
    </Dialog>
  );
}
