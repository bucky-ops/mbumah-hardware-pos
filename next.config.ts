import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone", // Not needed for Vercel — Vercel handles its own build output

  reactStrictMode: false,

  // Ensure Prisma Client is bundled correctly for serverless (Vercel)
  serverExternalPackages: ["@prisma/client"],

  // Allow dev requests from gateway proxy
  allowedDevOrigins: [
    "http://0.0.0.0:81",
    "http://0.0.0.0:3000",
    "http://21.0.8.40:81",
    "http://21.0.8.40:3000",
    "http://21.0.11.51:81",
    "http://21.0.11.51:3000",
    "http://localhost:81",
    "http://localhost:3000",
    "http://127.0.0.1:81",
    "http://127.0.0.1:3000",
  ],

  // Image optimization config — restrict to specific domains instead of wildcard
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
      {
        protocol: "https",
        hostname: "utfs.io",
      },
      {
        protocol: "https",
        hostname: "*.vercel-storage.com",
      },
    ],
  },

  // Security headers for all routes
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
