import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  // NOTE: Do NOT add @prisma/client to serverExternalPackages on Vercel.
  // Next.js file tracing must include the Prisma engine binary (.prisma/client)
  // for the serverless functions to work. Using serverExternalPackages prevents
  // Next.js from tracing these files, causing 500 errors at runtime.
  serverExternalPackages: [],

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
