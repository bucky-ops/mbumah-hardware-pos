import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  // Ensure Prisma Client is bundled correctly for serverless (Vercel)
  serverExternalPackages: ["@prisma/client", "prisma"],

  // Image optimization config - works with Vercel's Image Optimization API
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
