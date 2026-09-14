"use client";

// src/components/theme/ThemeToggle.tsx
//
// Appearance switcher for the workspace header — Light / Dark / System via
// next-themes. Rendered as a compact icon button that opens a dropdown; the
// icon crossfades between Sun and Moon (System keeps whichever the OS
// resolves to, shown via the active item's check + description).
//
// Palette discipline: neutral slate/stone only — no indigo/blue accents.
// Mount anywhere inside <ThemeProvider> (see src/app/layout.tsx). Safe to
// render during SSR — before hydration the button is disabled-muted and the
// icon renders the "system" default (Sun) to avoid a hydration mismatch.

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Check, Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", hint: "Bright showroom look", icon: Sun },
  { value: "dark", label: "Dark", hint: "Low-light counter use", icon: Moon },
  { value: "system", label: "System", hint: "Follow the device setting", icon: Monitor },
] as const;

/** No-op subscribe — the store value never changes after hydration. */
const subscribeNoop = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  // Hydration-safe "mounted" flag: the server snapshot renders `false` so the
  // SSR markup is deterministic; after hydration the client snapshot returns
  // `true` once — without a setState-in-effect (React 19 lint rule).
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );

  const active = mounted ? theme ?? "system" : "system";
  const ActiveIcon = OPTIONS.find((o) => o.value === active)?.icon ?? Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-8"
          aria-label="Change appearance"
          title="Appearance"
          disabled={!mounted}
        >
          <Sun
            className="size-4 scale-100 rotate-0 transition-transform duration-200 dark:scale-0 dark:-rotate-90"
            aria-hidden
          />
          <Moon
            className="absolute size-4 scale-0 rotate-90 transition-transform duration-200 dark:scale-100 dark:rotate-0"
            aria-hidden
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const isActive = active === o.value;
          return (
            <DropdownMenuItem
              key={o.value}
              onSelect={() => setTheme(o.value)}
              className="gap-2"
              aria-checked={isActive}
              role="menuitemradio"
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{o.label}</span>
                <span className="truncate text-xs text-muted-foreground">{o.hint}</span>
              </span>
              <Check
                className={`size-4 shrink-0 text-emerald-600 dark:text-emerald-400 ${isActive ? "opacity-100" : "opacity-0"}`}
                aria-hidden
              />
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
          <ActiveIcon className="mr-1 inline size-3 align-[-2px]" aria-hidden />
          Currently on <span className="font-medium text-foreground">{active}</span>
          {active === "system" ? " — switching with the OS" : ""}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
