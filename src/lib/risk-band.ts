// src/lib/risk-band.ts
//
// Shared credit-risk banding + utilization tone helpers — the SINGLE source of
// truth so the Customers directory, the Debt aging report and any future
// consumer (SMS templates, statement headers) can never drift apart.
//
// Client-safe: pure functions, zero imports. Score bands follow the credit.ts
// scoring convention (0–100 where HIGHER = healthier payer):
//   • ≥ 70 → STRONG  (emerald) — "Strong"
//   • ≥ 40 → WATCH   (amber)   — "Watch"
//   • <  40 → HIGH   (rose)    — "High risk"
// Utilization is INVERSE (higher % = more credit used = worse), toned
//   • ≥ 90 → rose   ·  ≥ 70 → amber  ·  else emerald.

export type RiskBandName = "STRONG" | "WATCH" | "HIGH";

export interface RiskBandInfo {
  band: RiskBandName;
  /** Short human label (credit-bureau language). */
  label: string;
  /** shadcn Badge outline classes — ALWAYS a complete literal (Tailwind JIT). */
  badgeClass: string;
  /** Text-only tone for compact inline mentions (e.g. "risk 82"). */
  textClass: string;
}

export function riskBand(score: number): RiskBandInfo {
  if (score >= 70) {
    return {
      band: "STRONG",
      label: "Strong",
      badgeClass:
        "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900",
      textClass: "text-emerald-700 dark:text-emerald-400",
    };
  }
  if (score >= 40) {
    return {
      band: "WATCH",
      label: "Watch",
      badgeClass:
        "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900",
      textClass: "text-amber-700 dark:text-amber-400",
    };
  }
  return {
    band: "HIGH",
    label: "High risk",
    badgeClass:
      "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900",
    textClass: "text-rose-600 dark:text-rose-400",
  };
}

export interface UtilTone {
  /** Progress indicator override — complete literal class (Tailwind JIT). */
  bar: string;
  /** Text tone for the % label beside the bar. */
  text: string;
}

/** Utilization bar/tone: rose ≥90, amber ≥70, emerald below. */
export function utilizationTone(util: number): UtilTone {
  if (util >= 90)
    return {
      bar: "[&_[data-slot=progress-indicator]]:bg-rose-500",
      text: "text-rose-600 dark:text-rose-400",
    };
  if (util >= 70)
    return {
      bar: "[&_[data-slot=progress-indicator]]:bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
    };
  return {
    bar: "[&_[data-slot=progress-indicator]]:bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
  };
}

/** Collection / repayment progress bar — always emerald (money IN is good). */
export const PROGRESS_PAID_BAR = "[&_[data-slot=progress-indicator]]:bg-emerald-500" as const;
