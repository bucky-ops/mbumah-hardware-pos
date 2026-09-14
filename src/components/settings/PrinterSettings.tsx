"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cable, Printer, RefreshCw, Unplug } from "lucide-react";

import {
  DEFAULT_PRINTER_URL,
  PRINT_FALLBACK_EVENT,
  attachGlobalPrintListener,
  getPrinterUrl,
  setPrinterUrl,
  thermalPrinter,
  type PrinterState,
} from "@/lib/hardware/printer-client";
import { buildReceiptEscPos } from "@/lib/escpos";
import type { ReceiptData } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Static KRA-complete sample used for the "Test print" hardware check. */
const SAMPLE_RECEIPT: ReceiptData = {
  ref: "RCP-TEST-0001",
  createdAt: "2026-01-15T10:32:00Z",
  branchName: "Mbumah Hardware — Nairobi CBD",
  branchLocation: "Ronald Ngala St, Nairobi",
  cashier: "Achieng",
  customerName: "Walk-in",
  lines: [
    {
      description: "3in nails 5kg carton",
      qty: 2,
      uom: "BOX",
      unitPrice: 1150,
      discountPct: 0,
      lineNet: 2300,
      vatAmount: 317.24,
    },
    {
      description: "Wheelbarrow heavy duty",
      qty: 1,
      uom: "PCS",
      unitPrice: 4500,
      discountPct: 5,
      lineNet: 4275,
      vatAmount: 589.66,
    },
  ],
  grossSubtotal: 6800,
  discount: 225,
  vat: 906.9,
  total: 6575,
  vatInclusive: true,
  payments: [
    { method: "MPESA", amount: 5000, reference: "SBGH74K1P2" },
    { method: "CASH", amount: 1575, reference: null },
  ],
  balance: 0,
  kraPin: "P051234567X",
  buyerPin: "P0527654321K",
  invoiceNumber: "INV-2026-000123",
  cuSerial: "KG0CU2401X99",
  hsCodesSummary: "7317;8716",
  taxCategories: "A,B",
};

const STATE_BADGE: Record<PrinterState, { className: string; label: string }> = {
  connected: { className: "border-emerald-200 bg-emerald-100 text-emerald-700", label: "Connected" },
  connecting: { className: "border-amber-200 bg-amber-100 text-amber-700", label: "Connecting…" },
  error: { className: "border-rose-200 bg-rose-100 text-rose-700", label: "Error" },
  disconnected: { className: "border-stone-200 bg-stone-100 text-stone-600", label: "Disconnected" },
};

/**
 * Thermal printer bridge settings (Task 3.1): WS URL management, live state
 * badge, hardware test print, and the global receipt-print dispatcher.
 */
export function PrinterSettings({ className }: { className?: string }) {
  const [url, setUrl] = useState(() => getPrinterUrl());
  const [state, setState] = useState<PrinterState>(thermalPrinter.state);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const offState = thermalPrinter.onChange(setState); // initial value comes from useState initializer

    // Dedupe-safe global dispatcher: several mounts (or StrictMode double
    // mounting) reference-count a single listener.
    const detachPrint = attachGlobalPrintListener();

    const onFallback = () => toast.info("No thermal bridge — using browser print fallback");
    window.addEventListener(PRINT_FALLBACK_EVENT, onFallback);

    return () => {
      offState();
      detachPrint();
      window.removeEventListener(PRINT_FALLBACK_EVENT, onFallback);
    };
  }, []);

  const handleConnect = () => {
    const trimmed = url.trim() || DEFAULT_PRINTER_URL;
    setUrl(trimmed);
    setPrinterUrl(trimmed);
    thermalPrinter.connect(trimmed);
    toast.info(`Connecting to print bridge at ${trimmed}…`);
  };

  const handleDisconnect = () => {
    thermalPrinter.disconnect();
    toast.info("Print bridge disconnected.");
  };

  const handleTestPrint = () => {
    if (thermalPrinter.state === "connected") {
      setTesting(true);
      const ok = thermalPrinter.send(buildReceiptEscPos(SAMPLE_RECEIPT));
      setTesting(false);
      if (ok) {
        toast.success("Test receipt sent to the thermal printer.");
      } else {
        toast.error("Bridge dropped the payload — check the print agent.");
      }
      return;
    }
    toast.warning("Printer not connected — receipts will use the browser print fallback.");
  };

  const badge = STATE_BADGE[state];
  const connected = state === "connected";

  return (
    <Card className={cn("border-stone-200", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="size-4 text-emerald-700" aria-hidden />
          Thermal printer
        </CardTitle>
        <CardDescription>
          Raw ESC/POS over a local WebSocket bridge — no print dialogs, full cutter &amp; drawer
          control.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Printer bridge WebSocket URL"
            placeholder={DEFAULT_PRINTER_URL}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-[14rem] flex-1 font-mono text-sm"
            spellCheck={false}
          />
          {connected ? (
            <Button type="button" variant="outline" onClick={handleDisconnect}>
              <Unplug className="size-4" aria-hidden />
              Disconnect
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleConnect}
              disabled={state === "connecting"}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Cable className="size-4" aria-hidden />
              Connect
            </Button>
          )}
          <Badge variant="outline" className={badge.className} aria-live="polite">
            {badge.label}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleTestPrint}
            disabled={testing}
            className="border border-stone-200"
          >
            <RefreshCw className={cn("size-4", testing && "animate-spin")} aria-hidden />
            Test print
          </Button>
          {!connected && (
            <p className="text-xs text-amber-700">
              Bridge offline — receipts fall back to the browser print dialog until connected.
            </p>
          )}
        </div>

        <Alert>
          <Cable className="size-4" aria-hidden />
          <AlertTitle>Running a print bridge</AlertTitle>
          <AlertDescription>
            Start a tiny local agent that listens on the WebSocket port above and pipes raw bytes
            to your printer device. Example (not a bundled dependency):
            <code className="mt-1 block rounded-md bg-stone-950 px-3 py-2 font-mono text-xs text-stone-100">
              npx thermal-print-bridge --port 9100 --device /dev/usb/lp0
            </code>
          </AlertDescription>
        </Alert>
      </CardContent>

      <CardFooter className="text-xs text-muted-foreground">
        Receipts are encoded as ESC/POS (80 mm · 42 columns) with KRA eTIMS fields and a QR code.
      </CardFooter>
    </Card>
  );
}
