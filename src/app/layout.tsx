import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Providers } from "@/lib/providers";

// ── Font configuration ──────────────────────────────────────────────────────
// BOTH font variants use `preload: false`.
//
// Why: Next.js `next/font` emits `<link rel="preload">` tags for every font
// marked `preload: true`. On the login screen (the first surface most users
// hit), only the sans variant is actually painted — the mono variant is used
// in receipts, serial numbers, and code-like figures deeper in the app.
// Chrome logged a console warning about the unused preloaded mono font
// (`797e433ab948586e-s.p.29207c2f.woff2`) because it was fetched eagerly but
// never painted on the first viewport.
//
// Setting `preload: false` on BOTH variants defers font fetches until the
// CSS actually references them (via the `--font-geist-sans` /
// `--font-geist-mono` CSS variables). This eliminates the Chrome console
// warning entirely. The fonts are still cached on first paint of any element
// that uses them, so there is no perceivable latency cost — the only thing
// removed is the WASTED eager fetch of the mono woff2 on the login screen.
//
// `display: "swap"` ensures text is visible immediately with a system fallback
// and swaps to the web font once it arrives (no FOIT — Flash of Invisible
// Text).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  preload: false,
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
  display: "swap",
});

export const metadata: Metadata = {
  title: "MBUMAH HARDWARE - POS & ERP System",
  description:
    "Enterprise Point of Sale & ERP System for MBUMAH HARDWARE. Manage sales, inventory, customers, rentals, and financials — with offline-first checkout.",
  keywords: ["MBUMAH HARDWARE", "POS", "ERP", "Point of Sale", "Inventory", "Kenya"],
  authors: [{ name: "MBUMAH HARDWARE" }],
  manifest: "/manifest.json",
  applicationName: "MBUMAH POS",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MBUMAH POS",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
};

// PWA / standalone capabilities — allows the app to be installed as a
// standalone desktop or mobile app (Phase 3 offline-first foundation).
export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          {/* Vercel Analytics — resolves /_vercel/insights/script.js 404s */}
          <Analytics />
          {/* Vercel Speed Insights — real-user performance monitoring */}
          <SpeedInsights />
        </Providers>
      </body>
    </html>
  );
}
