import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone", // Not needed for Vercel — Vercel handles its own build output

  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  // Ensure Prisma Client is bundled correctly for serverless (Vercel)
  serverExternalPackages: ["@prisma/client"],

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
