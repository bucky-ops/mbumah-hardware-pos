import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone", // Not needed for Vercel — Vercel handles its own build output

  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  // Ensure Prisma Client is bundled correctly for serverless (Vercel)
  serverExternalPackages: ["@prisma/client"],

  // Allow cross-origin requests from sandbox/preview environments
  allowedDevOrigins: ["127.0.0.1", "localhost"],

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
