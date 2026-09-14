import { buildReceiptEscPos } from "@/lib/escpos";
import type { ReceiptData } from "@/lib/types";

/**
 * WebSocket raw-print client for thermal receipt printers (Task 3.1).
 *
 * WHY A LOCAL BRIDGE INSTEAD OF window.print()?
 *  - The browser sandbox cannot open USB devices without a user pairing
 *    dialog (WebUSB requires permission + claiming the printer interface,
 *    which collides with the OS driver that already owns /dev/usb/lp0), and
 *    window.print() goes through PDF spooling — slow, dialog-per-sale, no
 *    control over the paper cutter or drawer.
 *  - The industry POS pattern is a tiny LOCAL print agent listening on
 *    ws://localhost:9100 that forwards raw bytes straight to the device
 *    (/dev/usb/lp0 on Linux, a Windows shared printer via RAW passthrough).
 *    This page connects to that agent and streams ESC/POS bytes.
 *  - ESC/POS is dramatically faster than PDF spooling (bytes → paper, no
 *    rasterization) and supports hardware extras like the cash-drawer kick
 *    (ESC p) and status queries.
 */

export type PrinterState = "disconnected" | "connecting" | "connected" | "error";

type StateListener = (state: PrinterState) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

export class ThermalPrinter {
  private ws: WebSocket | null = null;
  private _state: PrinterState = "disconnected";
  private listeners = new Set<StateListener>();
  private url: string | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private everConnected = false;
  private manualClose = false;

  get state(): PrinterState {
    return this._state;
  }

  /** Subscribe to state transitions; returns an unsubscribe function. */
  onChange(cb: StateListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private setState(next: PrinterState): void {
    this._state = next;
    for (const cb of this.listeners) {
      try {
        cb(next);
      } catch {
        /* a broken subscriber must never kill the printer loop */
      }
    }
  }

  /** Open (or re-open) the bridge connection. Safe to call repeatedly. */
  connect(url: string): void {
    if (typeof WebSocket === "undefined") return; // SSR — no sockets on the server
    this.manualClose = false;
    this.closeSocket();
    this.url = url;
    this.setState("connecting");
    try {
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.everConnected = true;
        this.setState("connected");
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.manualClose) {
          this.setState("disconnected");
          return;
        }
        this.scheduleReconnect();
      };
      ws.onerror = () => {
        this.setState("error");
      };
    } catch {
      this.setState("error");
      this.scheduleReconnect();
    }
  }

  /** Close and STOP auto-reconnect (explicit user action). */
  disconnect(): void {
    this.manualClose = true;
    this.everConnected = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSocket();
    this.setState("disconnected");
  }

  /** Send raw ESC/POS bytes. Returns false when the bridge isn't open. */
  send(bytes: Uint8Array): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(bytes);
      return true;
    } catch {
      return false;
    }
  }

  private closeSocket(): void {
    if (!this.ws) return;
    this.ws.onopen = null;
    this.ws.onclose = null;
    this.ws.onerror = null;
    try {
      this.ws.close();
    } catch {
      /* already closing/closed */
    }
    this.ws = null;
  }

  /**
   * Auto-reconnect with capped backoff (1s → 2s → 4s → … → 30s), but ONLY
   * when the bridge had successfully connected before — otherwise a wrong
   * URL typed in Settings would retry forever.
   */
  private scheduleReconnect(): void {
    if (this.manualClose || !this.everConnected || !this.url) {
      this.setState("disconnected");
      return;
    }
    this.reconnectAttempt += 1;
    const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (this.reconnectAttempt - 1));
    this.setState("connecting");
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.url) this.connect(this.url);
    }, delay);
  }
}

/** App-wide singleton — Settings and the receipt flow share one socket. */
export const thermalPrinter = new ThermalPrinter();

// ── bridge URL persistence ───────────────────────────────────────────────────

const PRINTER_URL_KEY = "mbumah.printer.url";
export const DEFAULT_PRINTER_URL = "ws://localhost:9100";

export function getPrinterUrl(): string {
  if (typeof window === "undefined") return DEFAULT_PRINTER_URL;
  return window.localStorage.getItem(PRINTER_URL_KEY) || DEFAULT_PRINTER_URL;
}

export function setPrinterUrl(url: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PRINTER_URL_KEY, url);
}

// ── global receipt-print dispatch ────────────────────────────────────────────

export const PRINT_RECEIPT_EVENT = "mbumah:print-receipt";
export const PRINT_FALLBACK_EVENT = "mbumah:print-fallback";

let attachCount = 0;

/**
 * Route `mbumah:print-receipt` CustomEvents (detail: ReceiptData) to the
 * thermal bridge; when the bridge is down, re-dispatch `mbumah:print-fallback`
 * so the UI can fall back to browser printing. Reference-counted so mounting
 * from several components (or React StrictMode double-mount) never
 * double-attaches the listener.
 */
export function attachGlobalPrintListener(): () => void {
  if (typeof window === "undefined") return () => {};

  attachCount += 1;
  if (attachCount > 1) {
    return () => {
      attachCount = Math.max(0, attachCount - 1);
    };
  }

  const handler = (event: Event) => {
    const receipt = (event as CustomEvent<ReceiptData>).detail;
    if (!receipt) return;
    if (thermalPrinter.state === "connected" && thermalPrinter.send(buildReceiptEscPos(receipt))) {
      return; // bytes are on the wire
    }
    window.dispatchEvent(new CustomEvent<ReceiptData>(PRINT_FALLBACK_EVENT, { detail: receipt }));
  };

  window.addEventListener(PRINT_RECEIPT_EVENT, handler);
  return () => {
    attachCount = Math.max(0, attachCount - 1);
    if (attachCount === 0) {
      window.removeEventListener(PRINT_RECEIPT_EVENT, handler);
    }
  };
}
