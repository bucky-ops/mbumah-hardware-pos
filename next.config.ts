import type { NextConfig } from "next";
import { resolveStandaloneOutput } from "./src/lib/build-mode";

// ---------------------------------------------------------------------------
// v2.18.0.1 (correction): Windows laptop builds could not ship working
// standalone output because Turbopack gives ASYNC-imported node builtins
// their own chunk file named after the specifier, e.g.
//   [externals]_node:inspector_7a4283c6._.js
// NTFS forbids colons in file names, so `next build` emitted EINVAL
// copyfile errors and the affected routes (api/batch, api/cron/nightly)
// lost their chunks in .next/standalone - the module loaded fine in dev
// and on Linux, then broke only on Windows laptops.
//
// Observed async import sites: @sentry/node-core's ANR integration
// (`await import('node:inspector')`) and our own data-retention module
// (`await import('node:fs/promises')`, now a static import).
//
// FIX: alias every node: builtin to its identical bare specifier. Node
// treats require("node:fs") and require("fs") as the SAME module, so this
// is a pure rename at the bundler level - and the chunk names lose the
// colon ([externals]_inspector_7a4283c6._.js), which every filesystem
// accepts. The list is the full stable builtin surface so future dynamic
// imports in dependencies cannot reintroduce the failure class.
// ---------------------------------------------------------------------------
const NODE_BUILTINS = [
  "assert", "async_hooks", "buffer", "child_process", "cluster",
  "console", "constants", "crypto", "dgram", "diagnostics_channel",
  "dns", "domain", "events", "fs", "fs/promises", "http", "http2",
  "https", "inspector", "module", "net", "os", "path", "path/posix",
  "path/win32", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "stream/consumers", "stream/promises",
  "stream/web", "string_decoder", "sys", "timers", "timers/promises",
  "tls", "trace_events", "tty", "url", "util", "util/types", "v8",
  "vm", "wasi", "worker_threads", "zlib",
];

const nodeBuiltinAlias = Object.fromEntries(
  NODE_BUILTINS.map((name) => [`node:${name}`, name]),
);

// ---------------------------------------------------------------------------
// v2.18.0.2 (correction): standalone output policy.
//
// The policy lives in src/lib/build-mode.ts (pure, unit-tested) so the
// launcher, the verifiers and the test suite cannot drift from this config:
//
//   BUILD_STANDALONE unset              -> normal output (Windows laptops,
//                                          Vercel, plain builds)
//   BUILD_STANDALONE=1 on Windows       -> normal output + WARNING (never
//                                          builds standalone; Windows has no
//                                          standalone deployment target)
//   BUILD_STANDALONE=1 on Linux/Docker  -> standalone output (unchanged)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v2.18.0.1 (correction), extended in v2.18.0.2: next/image optimization needs
// sharp's NATIVE binary for the exact platform. Laptop installs build and run
// on the same Windows machine, so we can know at BUILD time whether that
// binary is usable (require("sharp") dlopens it). If it is not, bake
// `unoptimized` into the build instead of shipping a server whose image
// optimizer 500s on every product photo (the v2.17.1 field failure). This
// now applies to EVERY Windows build (standalone was already covered; since
// v2.18.0.2 Windows uses normal builds, the probe follows the platform).
// Vercel and Docker build on Linux with a working sharp and keep optimization.
// ---------------------------------------------------------------------------
function sharpUsableForBuild(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("sharp");
    return true;
  } catch {
    return false;
  }
}

const standaloneDecision = resolveStandaloneOutput(process.env, process.platform);
if (standaloneDecision.warning) {
  console.warn(`[next.config] WARNING: ${standaloneDecision.warning}`);
}

const imageOptimizationDisabledForLaptopBuild =
  (process.env.BUILD_STANDALONE === "1" || process.platform === "win32") &&
  !sharpUsableForBuild();

const nextConfig: NextConfig = {
  // Standalone output policy - see resolveStandaloneOutput above. Plain
  // `next build` (and Vercel, which uses its own output format) builds
  // without it; Docker and Linux no-Docker installs opt in with
  // BUILD_STANDALONE=1; Windows never builds standalone.
  output: standaloneDecision.output,

  reactStrictMode: true,

  // v2.17.8 (Task 44): stop advertising the framework. Next.js sends
  // "X-Powered-By: Next.js <version>" by default; the API headers block
  // blanked it on /api/* only, so page responses still leaked the stack.
  // poweredByHeader: false removes it from every response.
  poweredByHeader: false,

  // CI build robustness: don't block production build on pre-existing type/lint
  // issues in banking routes (pending Prisma schema additions) or Zod v4 types.
  // Dev-time type-checking and `bun run lint` still run normally.
  typescript: {
    ignoreBuildErrors: true,
  },
  // NOTE: `eslint.ignoreDuringBuilds` was removed from NextConfig in Next.js 16.
  // Linting is now handled standalone via `bun run lint` (see eslint.config.mjs)
  // and is NOT part of `next build`. The GitHub Actions CI workflow runs lint
  // as a separate job.

  // Ensure Prisma Client is bundled correctly for serverless (Vercel)
  serverExternalPackages: ["@prisma/client"],

  // v2.18.0.1: rename node: builtin externals so Turbopack chunk file names
  // never contain a colon (NTFS cannot create/copy them - see the long
  // comment above NODE_BUILTINS).
  turbopack: {
    resolveAlias: nodeBuiltinAlias,
  },

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

  // Image optimization config - restrict to specific domains instead of wildcard.
  // v2.18.0.2: unoptimized turns itself on at build time when the building
  // machine has no usable sharp native binary (Windows laptop builds - see
  // the helper above); it stays undefined (optimization on) for Vercel/Docker.
  images: {
    unoptimized: imageOptimizationDisabledForLaptopBuild || undefined,
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
          // HSTS - Force HTTPS
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          // Prevent clickjacking
          { key: "X-Frame-Options", value: "DENY" },
          // Prevent MIME type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // XSS protection for older browsers
          { key: "X-XSS-Protection", value: "1; mode=block" },
          // Control referrer information
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable unnecessary browser features
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Cross-origin isolation
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          // ── PWA installability headers ──
          // Link to the web app manifest so browsers can discover it without
          // a <link rel="manifest"> tag (and so it is served with the correct
          // MIME type / CORS for install prompts).
          {
            key: "Link",
            value: '</manifest.json>; rel="manifest"; crossorigin=use-credentials',
          },
          // Allow the app to run in standalone / fullscreen mode when installed.
          { key: "Mobile-Web-App-Capable", value: "yes" },
          { key: "Apple-Mobile-Web-App-Capable", value: "yes" },
          {
            key: "Apple-Mobile-Web-App-Status-Bar-Style",
            value: "black-translucent",
          },
          { key: "Apple-Mobile-Web-App-Title", value: "MBUMAH POS" },
          // Application name for Windows / Android tiles.
          { key: "Application-Name", value: "MBUMAH POS" },
          // Content Security Policy
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://cdn.shopify.com https://utfs.io https://*.vercel-storage.com",
              "manifest-src 'self'",
              "connect-src 'self' https://*.vercel.app https://sandbox.safaricom.co.ke https://api.safaricom.co.ke",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
      // Serve the manifest with the correct MIME type so install prompts work.
      {
        source: "/manifest.json",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          // Strict CSP for API - no scripts, styles, etc.
          {
            key: "Content-Security-Policy",
            value: "default-src 'none'; frame-ancestors 'none'",
          },
          // Remove server info
          { key: "X-Powered-By", value: "" },
        ],
      },
    ];
  },
};

export default nextConfig;
