// ============================================================================
// BUILD MODE POLICY (v2.18.0.2) - shared by next.config.ts and the tests.
// ============================================================================
// Standalone output exists for DOCKER and Linux deployments whose runner
// executes .next/standalone/server.js directly. Local Windows POS laptops
// build and run on the same machine with node_modules present, so they use a
// plain production build started with `next start`. That removes the entire
// standalone trace-copy phase from Windows, where NTFS filename rules (no
// colons) turned any future colon-bearing traced file into an EINVAL
// copyfile warning and a degraded .next/standalone output.
//
// Policy matrix (resolveStandaloneOutput):
//   BUILD_STANDALONE unset              -> normal output (Windows laptops,
//                                          Vercel, plain builds)
//   BUILD_STANDALONE=1 on Windows       -> normal output + warning (Windows
//                                          never builds standalone)
//   BUILD_STANDALONE=1 on Linux/Docker  -> standalone output (unchanged)
//
// Pure and dependency-free so it can run in the Next.js config loader, in
// scripts/verify-build-output.mjs mode detection and in the vitest suite.
// ============================================================================

export type BuildMode = "standalone" | "normal";

export interface StandaloneDecision {
  output: "standalone" | undefined;
  mode: BuildMode;
  warning?: string;
}

/**
 * Decide the Next.js `output` value from the build environment and platform.
 * Kept in sync with scripts/verify-build-output.mjs (mode detection) and
 * deploy/nodocker/* (which launcher start is used).
 */
export function resolveStandaloneOutput(
  env: Record<string, string | undefined>,
  platform: string,
): StandaloneDecision {
  if (env.BUILD_STANDALONE !== "1") {
    return { output: undefined, mode: "normal" };
  }
  if (platform === "win32") {
    return {
      output: undefined,
      mode: "normal",
      warning:
        "BUILD_STANDALONE=1 is ignored on Windows: local POS builds use a normal " +
        "production build started with `next start`. Standalone output is only " +
        "produced for Docker or Linux deployments.",
    };
  }
  return { output: "standalone", mode: "standalone" };
}
