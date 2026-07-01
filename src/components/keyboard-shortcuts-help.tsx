'use client';

import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Search, PanelLeftClose, ShoppingCart, Package, Users,
  BarChart3, CreditCard, Pause, X, Keyboard,
} from 'lucide-react';

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const shortcuts = [
  { keys: '⌘K / Ctrl+K', description: 'Focus search bar', icon: Search },
  { keys: '⌘B / Ctrl+B', description: 'Toggle sidebar', icon: PanelLeftClose },
  { keys: 'F2', description: 'Switch to POS tab', icon: ShoppingCart },
  { keys: 'F3', description: 'Switch to Inventory tab', icon: Package },
  { keys: 'F4', description: 'Switch to Customers tab', icon: Users },
  { keys: 'F5', description: 'Switch to Financial tab', icon: BarChart3 },
  { keys: 'F9', description: 'Process checkout', icon: CreditCard },
  { keys: 'F10', description: 'Hold current cart', icon: Pause },
  { keys: 'Esc', description: 'Clear search / close dialogs', icon: X },
  { keys: '? / Ctrl+/', description: 'Show this help', icon: Keyboard },
];

export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            Keyboard Shortcuts
          </DialogTitle>
          <DialogDescription>
            Use these shortcuts to navigate faster
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <div key={shortcut.keys} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm">{shortcut.description}</span>
                <kbd className="pointer-events-none inline-flex h-6 select-none items-center gap-1 rounded border bg-muted px-2 font-mono text-[11px] font-medium text-muted-foreground">
                  {shortcut.keys}
                </kbd>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
