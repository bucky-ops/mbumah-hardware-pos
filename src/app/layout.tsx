import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Providers } from "@/lib/providers";

// ── Font configuration ──────────────────────────────────────────────────────
// The login screen (and the majority of the UI) is rendered in Geist Sans, so
// we keep that font preloaded for the fastest first paint.
//
// Geist Mono is only used in niche places (receipts, code-like figures, serial
// numbers). Preloading it eagerly caused Chrome console warnings about an
// unused preloaded font (`797e433ab948586e-s.p.29207c2f.woff2`) on the login
// screen. Setting `preload: false` on the mono variant defers its fetch until
// it is actually referenced, eliminating the warning while keeping the sans
// font fast.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  preload: true,
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  // Do not preload the mono font — it is not used on the login / first-screen
  // surface, so an eager preload was wasted bandwidth + a console warning.
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
