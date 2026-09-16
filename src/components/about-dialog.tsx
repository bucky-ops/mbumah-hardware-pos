'use client';

/**
 * AboutDialog (v2.7.0) — replaces the old "About this system" toast which
 * hardcoded "Version 1.0.0" (the app was on 2.6.x — the exact drift the
 * version-governance release v2.6.2 set out to kill; the toast was missed).
 *
 * The version shown here comes from src/lib/version.ts (package.json is the
 * single source), so this dialog can NEVER drift from /api/health, the
 * footer, the login screen or openapi.json again.
 *
 * Content is deliberately useful for support calls: exact build, license
 * scope, what the system does, and how to reach Mbumah support.
 */

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ShoppingCart,
  Boxes,
  ReceiptText,
  BarChart3,
  Gift,
  ShieldCheck,
  Smartphone,
  Keyboard,
  GitBranch,
  Globe,
  MapPin,
} from 'lucide-react';
import { APP_BUILD_LABEL } from '@/lib/version';

const FEATURES: { icon: React.ElementType; label: string; hint: string }[] = [
  { icon: ShoppingCart, label: 'Multi-branch POS', hint: 'Fast till for 5 stores' },
  { icon: Boxes, label: 'Inventory & UoM', hint: 'Stock, units, bundles' },
  { icon: ReceiptText, label: 'KRA eTIMS-ready', hint: 'Compliant receipts' },
  { icon: BarChart3, label: 'Reports & analytics', hint: 'Sales, profit, staff' },
  { icon: Gift, label: 'Gift cards & debts', hint: 'Loyalty and credit' },
  { icon: ShieldCheck, label: 'Role-based access', hint: 'Audited actions' },
];

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-y-auto max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-left">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-800 text-white text-lg font-bold shadow-sm">
              M
            </span>
            <span className="flex flex-col">
              <span className="text-base font-semibold leading-tight">MBUMAH HARDWARE POS &amp; ERP</span>
              <span className="text-xs font-normal text-muted-foreground">
                The operating system for Kenyan hardware businesses
              </span>
            </span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="text-left text-sm text-muted-foreground">
              One system for the till, the store room and the back office — built for
              Mbumah Hardware&apos;s branches, running from Nairobi to the world.
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* ── Version block — always in sync via src/lib/version.ts ── */}
        <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs" data-testid="about-version">
              Version {APP_BUILD_LABEL}
            </Badge>
            <Badge variant="outline" className="text-xs">
              <MapPin className="mr-1 h-3 w-3" /> Made in Kenya 🇰🇪
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <GitBranch className="mt-0.5 h-3 w-3 shrink-0" />
            This version matches <span className="font-mono">/api/health</span>, the
            footer, the login screen and the public API spec — all read one source
            (<span className="font-mono">package.json</span>), so support can trust it.
          </p>
        </div>

        {/* ── Feature grid ── */}
        <div className="grid grid-cols-2 gap-2">
          {FEATURES.map(({ icon: Icon, label, hint }) => (
            <div key={label} className="flex items-start gap-2.5 rounded-lg border p-2.5">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium leading-tight">{label}</span>
                <span className="block text-[11px] text-muted-foreground leading-tight">{hint}</span>
              </span>
            </div>
          ))}
        </div>

        <Separator />

        {/* ── Support block ── */}
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p className="flex items-center gap-2">
            <Smartphone className="h-3.5 w-3.5 shrink-0" /> Support:&nbsp;
            <a className="underline-offset-2 hover:underline text-foreground" href="tel:0795191909">0795 191 909</a>
            <span aria-hidden>·</span>
            <a className="underline-offset-2 hover:underline text-foreground" href="mailto:info@mbumahhardware.co.ke">info@mbumahhardware.co.ke</a>
          </p>
          <p className="flex items-center gap-2">
            <Keyboard className="h-3.5 w-3.5 shrink-0" /> Press <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">?</kbd> anywhere for keyboard shortcuts
          </p>
          <p className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 shrink-0" /> © {new Date().getFullYear()} Mbumah Hardware Ltd · All rights reserved
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
