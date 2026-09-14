"use client";

import { useEffect, useRef } from "react";

export type HotkeyAction =
  | "search"
  | "mpesa"
  | "cash"
  | "hold"
  | "clear"
  | "help"
  | "sync";

/** Single source of truth for the POS keyboard map (also renders the "?" overlay). */
export const HOTKEY_LEGEND: Array<{ keys: string; action: HotkeyAction; label: string }> = [
  { keys: "F1", action: "search", label: "Focus product search" },
  { keys: "F2", action: "mpesa", label: "M-Pesa checkout" },
  { keys: "F3", action: "cash", label: "Cash checkout" },
  { keys: "F4", action: "hold", label: "Hold order" },
  { keys: "Esc", action: "clear", label: "Cancel & clear cart" },
  { keys: "?", action: "help", label: "Keyboard shortcuts" },
  { keys: "F9", action: "sync", label: "Force offline sync" },
];

const FKEY_TO_ACTION: Partial<Record<string, HotkeyAction>> = {
  F1: "search",
  F2: "mpesa",
  F3: "cash",
  F4: "hold",
  F9: "sync",
};

/**
 * Global POS hotkeys (Task 2.3).
 *
 * The listener is bound exactly once per hook mount; handlers live in a ref so
 * callers can pass inline closures without re-binding the window listener on
 * every render. F-keys are preventDefault-ed so the browser never steals them
 * (F1 opens help, F3 opens find, F4 focuses the address bar in some browsers).
 * "?" only fires outside text fields so typing "What?" in a note never opens
 * the overlay. ESC always reaches the page — the page decides whether clearing
 * the cart needs a confirmation dialog.
 */
export function usePOSHotkeys(handlers: Partial<Record<HotkeyAction, () => void>>): void {
  const handlersRef = useRef(handlers);

  // Latest-ref pattern: keeps the bound listener stable across renders.
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inTextField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      const fkeyAction = FKEY_TO_ACTION[e.key];
      if (fkeyAction) {
        e.preventDefault();
        if (fkeyAction === "search") {
          // F1 doubles as a physical shortcut to the SKU search field.
          const searchEl = document.querySelector<HTMLElement>('[data-hotkey-target="search"]');
          searchEl?.focus();
        }
        handlersRef.current[fkeyAction]?.();
        return;
      }

      if (e.key === "Escape") {
        // Page decides whether to confirm; hook only dispatches intent.
        handlersRef.current.clear?.();
        return;
      }

      if (e.key === "?" && !inTextField) {
        e.preventDefault();
        handlersRef.current.help?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
