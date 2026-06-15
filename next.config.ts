import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone", // Not needed for Vercel — Vercel handles its own build output

  typescript: {
    ignoreBuildErrors: true,
  },
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

  // Image optimization config — works with Vercel's Image Optimization API
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
