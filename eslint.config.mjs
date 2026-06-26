// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Production-grade ESLint configuration
// ─────────────────────────────────────────────────────────────────────────────
//
// This config layers the Next.js core-web-vitals + TypeScript presets (which
// ship sensible defaults for React Hooks, JSX, Next.js best-practices, and
// TS-specific rules) and then applies a strict, production-grade override
// block. Unlike the previous config (which turned nearly everything OFF),
// this one lets the preset defaults apply and ADDS explicit enforcement for
// the rules that catch real bugs in a financial/POS codebase.
//
// Severity policy:
//   • "error"   — rules that catch genuine bugs or security issues. Failing
//                 these blocks `bun run lint` and CI.
//   • "warn"    — rules that improve code quality but aren't worth blocking
//                 a deploy (e.g. `any` usage in a large legacy surface).
//                 Warnings surface in the lint output and PR review but do
//                 NOT fail the build.
//
// The `--fix` flag (used by `bun run lint --fix`) auto-corrects everything
// fixable: prefer-const, consistent-type-imports, no-unused-vars (via `_`
// prefix convention), etc.
// ─────────────────────────────────────────────────────────────────────────────

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [
  // Report unused eslint-disable directives as errors (flat-config way of
  // enforcing the old `no-unused-disable-directive` rule). Keeps the disable
  // comments honest — if a suppression becomes unnecessary after a fix, ESLint
  // flags it so it can be removed.
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  // ── unused-imports plugin ──────────────────────────────────────────────────
  // `eslint-plugin-unused-imports` provides AUTO-FIXABLE rules for unused
  // imports and variables. The stock `@typescript-eslint/no-unused-vars` is
  // NOT auto-fixable (ESLint can't safely know if a binding is referenced via
  // string eval), which leaves hundreds of unused imports accumulating in a
  // large codebase. This plugin safely removes unused import specifiers and
  // whole import statements on `--fix`, and reports remaining unused locals.
  {
    plugins: { "unused-imports": unusedImports },
  },
  {
    rules: {
      // ── TypeScript: catch real bugs, warn on style ─────────────────────────
      // `no-explicit-any` is "warn" (not error) — the codebase legitimately
      // uses `any` for Prisma JSON fields, third-party SDK payloads, and
      // rapid prototyping surfaces. Promoting to error would surface 100s of
      // sites without clear value; warnings keep them visible for cleanup.
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars/imports: delegate to `unused-imports` plugin which is
      // AUTO-FIXABLE (removes unused import specifiers + whole statements on
      // `--fix`). Keep the same `_`-prefix ignore convention for intentional
      // skips. The base TS rule is turned OFF to avoid duplicate reporting.
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Non-null assertion (`x!`) is a footgun — it silently suppresses the
      // null check. Warn so reviewers see it, but don't block (Prisma
      // relations + React refs use it legitimately in places).
      "@typescript-eslint/no-non-null-assertion": "warn",
      // `@ts-ignore` suppresses ALL errors on the next line; `@ts-expect-error`
      // is preferred because it errors if the suppression becomes unnecessary.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": "allow-with-description",
          "ts-expect-error": "allow-with-description",
          "ts-nocheck": true,
          "ts-check": false,
          minimumDescriptionLength: 10,
        },
      ],
      // Enforce `import type { X }` for type-only imports — cleaner emitted JS
      // and avoids runtime cycles. Auto-fixable.
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // `as const` is good; don't disable it (the old config did).
      "@typescript-eslint/prefer-as-const": "error",

      // ── React Hooks ─────────────────────────────────────────────────────────
      // Exhaustive-deps catches stale-closure bugs — the #1 source of
      // subtle React state bugs. Warn (not error) because the codebase has
      // intentional one-time-run effects (`[]` deps) that would fire many
      // warnings; reviewers can validate each.
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/purity": "warn",
      "react/no-unescaped-entities": "warn",
      "react/display-name": "off", // Next.js + memo() handles this; noise otherwise
      "react/prop-types": "off",   // TS handles prop types
      "react-compiler/react-compiler": "off", // opt-in later

      // ── Next.js ────────────────────────────────────────────────────────────
      // `<img>` is used for category images / logos where next/image's optimizer
      // isn't desirable. Warn so we can migrate incrementally.
      "@next/next/no-img-element": "warn",
      "@next/next/no-html-link-for-pages": "error",

      // ── General JavaScript correctness ─────────────────────────────────────
      "prefer-const": "error",          // catches accidental `let` that's never reassigned
      // `no-unused-vars` is handled by the `unused-imports` plugin (above) which
      // is auto-fixable; do not re-declare it here (would be a duplicate key).
      "no-console": [
        "warn",
        { allow: ["warn", "error", "info"] }, // allow warn/error/info; flag bare console.log
      ],
      "no-debugger": "error",
      "no-empty": ["error", { allowEmptyCatch: true }], // allow `catch {}` for control flow
      "no-irregular-whitespace": "error",
      "no-case-declarations": "error",
      "no-fallthrough": "error",        // missing `break` in switch = real bug
      "no-mixed-spaces-and-tabs": "error",
      "no-redeclare": "off",            // TS handles this
      "no-undef": "off",                // TS handles this
      "no-unreachable": "error",        // code after return = dead code
      "no-useless-escape": "error",
      "no-constant-condition": "warn",  // `while(true)` etc — usually intentional
      "no-dupe-keys": "error",          // duplicate object keys = bug
      "no-self-assign": "error",
      "no-unused-expressions": "warn",  // `foo && foo()` as statement — warn
      "valid-typeof": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "examples/**",
      "skills/**",
      "docker/**",
      "mini-services/**",
      "docs/**",
      "scripts/**",
      "prisma/migrations/**",
      "coverage/**",
    ],
  },
];

export default eslintConfig;
