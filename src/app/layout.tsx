import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Mbumah Hardware POS — Organization Console",
  description:
    "Mbumah Hardware POS & ERP — Organization Console Expert Information System. Your building partner in Juja. Multi-branch workspaces, debt (mkopo), rentals, M-Pesa, eTIMS and more.",
  keywords: ["Mbumah Hardware", "POS", "ERP", "Juja", "Kenya", "multi-branch", "M-Pesa", "eTIMS"],
  authors: [{ name: "Mbumah Hardware" }],
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
