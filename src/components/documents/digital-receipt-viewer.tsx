'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, Link2, Loader2, Maximize2, Minimize2, ScanLine } from 'lucide-react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

/**
 * DigitalReceiptViewer (v2.10.0)
 *
 * The in-app viewer behind every document QR: renders the SAME colored digital
 * copy the public /r/<docNumber> page shows (the children are the shared
 * DigitalDocumentView / DigitalDeliveryView components), with the two
 * behaviours the client asked for:
 *
 *  • SCROLL - in the default mode the receipt keeps its natural size inside a
 *    styled scroll area, so a long receipt can be scrolled through after
 *    clicking the QR or the "View receipt" button.
 *  • AUTOFIT - the toggle measures the receipt against the viewer box
 *    (ResizeObserver) and CSS-scales the whole receipt so it FITS ON SCREEN
 *    with no scrolling (handy for showing a customer or projecting).
 *
 * The "Open public page" button opens the exact URL encoded in the QR, so
 * staff can verify what a customer will see.
 */

interface DigitalReceiptViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title, e.g. "Digital receipt - INV-2026-0001". */
  title: string;
  /** Subtitle under the title, e.g. the document type label. */
  subtitle?: string;
  /** App-absolute path of the public page, e.g. "/r/INV-2026-0001". */
  publicPath?: string;
  /** The shared digital view components. */
  children: React.ReactNode;
}

const SCROLL_HINT = 'Scroll to read the whole receipt';

export function DigitalReceiptViewer({
  open,
  onOpenChange,
  title,
  subtitle,
  publicPath,
  children,
}: DigitalReceiptViewerProps) {
  const [autofit, setAutofit] = useState(false);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  // Render-time reset pattern: every time the viewer OPENS, start fresh in
  // scroll mode (the default experience is the scrollable receipt; autofit is
  // a deliberate opt-in per open). Adjusting state during render like this is
  // the React-endorsed alternative to a setState-in-effect reset.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setAutofit(false);
      setScale(1);
      setContentHeight(0);
    }
  }
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const sw = content.scrollWidth;
    const sh = content.scrollHeight;
    if (!cw || !ch || !sw || !sh) return;
    const next = Math.min(cw / sw, ch / sh, 1);
    setScale(Number.isFinite(next) && next > 0 ? next : 1);
    // Layout height is transform-independent, so this stays stable while
    // scaled (no feedback loop with the ResizeObserver).
    setContentHeight(sh);
  }, []);

  // Recompute the autofit scale while active (open, toggle, resize, theme).
  useLayoutEffect(() => {
    if (!open || !autofit) return;
    // Initial measurement MUST run synchronously before the first paint of
    // autofit mode (a full-size flash would defeat the purpose); the
    // ResizeObserver below only delivers asynchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(content);
    return () => ro.disconnect();
  }, [open, autofit, measure]);

  const copyLink = async () => {
    if (!publicPath || typeof window === 'undefined') return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      toast.success('Digital receipt link copied.');
    } catch {
      toast.error('Could not copy the link on this device.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-4 w-4 text-emerald-600" aria-hidden />
            {title}
          </DialogTitle>
          {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
        </DialogHeader>

        {/* Viewer toolbar - scroll / autofit / public page */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Switch
              id="receipt-autofit"
              checked={autofit}
              onCheckedChange={setAutofit}
              aria-label="Autofit - fit the whole receipt on screen"
            />
            <Label
              htmlFor="receipt-autofit"
              className="flex cursor-pointer items-center gap-1.5 text-xs font-medium"
              title="Fit the whole receipt on screen without scrolling"
            >
              {autofit ? (
                <Minimize2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
              ) : (
                <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              )}
              Autofit
            </Label>
          </div>
          <p className="text-[11px] leading-tight text-muted-foreground">
            {autofit
              ? 'Fitted to screen - scale ' + Math.round(scale * 100) + '%'
              : SCROLL_HINT}
          </p>
          <div className="ml-auto flex items-center gap-2">
            {publicPath ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={copyLink}
                  title="Copy the public link (same as the QR)"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">Copy public link</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    typeof window !== 'undefined' &&
                    window.open(`${window.location.origin}${publicPath}`, '_blank', 'noopener')
                  }
                  title="Open the public page a customer sees after scanning"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Public page
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {/* Receipt viewport: scroll mode (natural size + overflow) or autofit
            mode (measured CSS scale, no scrolling). The DOM tree is stable in
            both modes - only styles change - so the ResizeObserver stays
            attached to the same nodes. */}
        <div
          ref={containerRef}
          className={
            autofit
              ? 'h-[60vh] overflow-hidden rounded-lg border bg-stone-100 p-3 dark:bg-stone-900'
              : 'max-h-[60vh] overflow-y-auto custom-scrollbar rounded-lg border bg-stone-100 p-3 dark:bg-stone-900'
          }
        >
          <div
            style={
              autofit
                ? {
                    transform: `scale(${scale})`,
                    transformOrigin: 'top center',
                    height: contentHeight ? contentHeight * scale : undefined,
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }
                : undefined
            }
          >
            <div
              ref={contentRef}
              className="mx-auto w-full max-w-md"
              role="document"
              aria-label={title}
            >
              {children}
            </div>
          </div>
        </div>

        {!children ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Preparing the digital receipt…
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
