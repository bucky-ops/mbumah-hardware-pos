import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: ['localhost:81', 'http://localhost:81'],

  // Do NOT add @prisma/client here - Next.js must trace it for the serverless bundle
  // The Neon serverless adapter uses WebSocket which needs to be external
  serverExternalPackages: ["@neondatabase/serverless"],

  // CRITICAL: Explicitly include Prisma engine files in the serverless bundle
  // Vercel's file tracer may miss the .prisma/client directory
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/.prisma/client/*.node",
      "./node_modules/.prisma/client/*.js",
      "./node_modules/.prisma/client/*.d.ts",
      "./node_modules/.prisma/client/schema.prisma",
      "./node_modules/@prisma/client/**/*",
      "./node_modules/@neondatabase/serverless/**/*",
      "./node_modules/@prisma/adapter-neon/**/*",
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
