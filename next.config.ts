import type { NextConfig } from "next";
import path from "path";

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

  // CRITICAL: Explicitly include Prisma engine files in the serverless bundle
  // Vercel's file tracer may miss the .prisma/client directory
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/.prisma/client/*.node",
      "./node_modules/.prisma/client/*.js",
      "./node_modules/.prisma/client/*.d.ts",
      "./node_modules/.prisma/client/schema.prisma",
      "./node_modules/@prisma/client/**/*",
    ],
  },

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
