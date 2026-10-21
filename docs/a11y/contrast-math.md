# Contrast math — closing axe "color-contrast incomplete" findings

*Added v2.163.0. Recipe + tooling for the finding class axe cannot compute.*

## When to use this

axe-core reports `color-contrast` **violations** when it can measure the
painted colors and they fail. It reports **incompletes** when it *cannot*
measure — typically because the background is alpha-composited over
something it does not model: `backdrop-filter` glass cards, translucent
tokens (`text-muted-foreground/50`), gradients, or a sticky header
overlapping a scrolled row. An incomplete is **not a pass**; it is an
uncomputed number. This recipe computes it.

The login glass card carried 17 such incompletes until v2.162.0 closed
them all with manual blend math; the v2.149–v2.162 rounds used the same
math for every remaining alpha-token family. This document makes that
recipe mechanical so future surfaces close their own incompletes without
re-deriving it.

## The math (three steps)

1. **Convert every color to sRGB linear.** The design system speaks oklch
   (Tailwind v4 tokens). Use Björn Ottosson's oklch → sRGB conversion —
   the reference implementation is `oklchToSrgb()` in
   `scripts/contrast-audit-login.mjs` (committed, runnable standalone).
2. **Composite the real paint stack, bottom-up.** For each text family,
   determine what is ACTUALLY painted underneath it:
   page background → glass-card alpha layer (if any) → the element's own
   background → the text color on top.
   Alpha compositing is `out = top·α + bottom·(1−α)` per sRGB channel
   (pre-convert alpha layers to sRGB *before* blending, not after).
   Do this at 3–5 sample points when the background is a gradient — the
   worst corner decides.
3. **WCAG contrast against the ACTUAL painted background.**
   `(L1+0.05)/(L2+0.05)` with the WCAG relative-luminance definition.
   Thresholds: **4.5:1** for body-size text, **3:1** for large text
   (≥ 24px / 18.66px bold) and **3:1** for non-text UI components
   (icons, input borders, dismiss buttons).

## The two false-fail families (learned v2.162.0)

A naive first model produced wrong verdicts twice. Both mistakes are
background-model mistakes:

- **Badges ignore the glass.** Text sitting on its own solid badge
  background (`bg-primary text-primary-foreground`) must be evaluated
  against that solid color — NOT the glass blend behind the badge.
- **Outside-card text sits on the page.** The footer, separator dots and
  other elements outside the card composite against the page gradient,
  not the card's alpha layer.

Get the background model wrong and you will "fix" families that already
passed — or worse, pass families that still fail.

## The tool

`node scripts/contrast-audit-login.mjs` (repo root) audits the login
glass card in both themes: 38 checks, exit 1 on any failing family. It is
the reference implementation of all three steps above — copy its shape
for a new surface (new paint stack, new families) rather than writing the
math from scratch. Keep every fix in code with a **dated comment carrying
the before/after ratios** (the convention every a11y round since v2.148.0
follows), so the next auditor can re-derive the number without the
script.

## Conventions that fall out of the recipe

- Prefer **opaque tokens** on composite-heavy surfaces (the v2.147.0
  sticky-header lesson): an opaque `card` background kills the whole
  "partially obscured" incomplete class instead of modelling it.
- An `aria-hidden` decorative element with a contrast finding is still
  worth fixing when it is informational (dots, separators) — or remove it
  from the accessibility tree AND verify it is genuinely decorative.
- `color-mix(in oklab, var(--foreground) 80%, transparent)` is the
  theme-adaptive way to hit a ratio in both themes with one rule (the
  login placeholder fix, v2.162.0).
- Numerically-passing-but-unresolvable families stay recorded as
  "reviewed-passing" in the round's worklog entry, with the measured
  ratios — so the next axe run's identical incomplete is a known quantity,
  not a re-opened investigation.

## Reviewed-passing: the org console's muted-button family (v2.169.0)

The HR per-store expand button and its siblings (`bg-muted/40` +
`text-muted-foreground`, hover `bg-muted/70`) have been axe "incompletes"
since the alpha-token rounds — uncomputed, not unbroken. Computed with the
recipe by `scripts/contrast-math-muted-button-v169.mjs` (committed):

| surface        | ratio  | verdict |
| -------------- | ------ | ------- |
| light rest /40 | 5.73:1 | pass    |
| light hover /70| 5.53:1 | pass    |
| dark rest /40  | 5.48:1 | pass    |
| dark hover /70 | 5.29:1 | pass    |

All four corners clear the 4.5:1 small-text bar with margin (the 12px
button label). The family stays as-is — no code change, the numbers are
the deliverable — and the next axe run's identical incomplete is a known
quantity.

## Reviewed-passing: the desk roster's avatar-hue family (v2.190.0)

The desk panel's six per-reviewer avatar hues (v2.65.0) have worn
alpha-composited dark chips since the day they shipped —
`dark:bg-{c}-500/20` over the row's paint with `dark:text-{c}-300` on
top — the page-composite class axe reports as color-contrast INCOMPLETE.
Computed with the recipe by `scripts/contrast-math-avatar-hues-v2190.mjs`
(committed; tokens read from the INSTALLED `node_modules/tailwindcss/theme.css`,
not from memory). The chip is 10px text (roster chips `font-medium`,
ledger initials `font-bold` — bold does not buy the 3:1 bar), so 4.5:1
applies, and the chip paints over THREE real row states — the worst
corner decides, so all three dark stacks are computed:

| hue     | light (700 on solid 100) | dark calm (slate-900) | dark hover (slate-800/50) | dark drilled (emerald-500/10) |
| ------- | ------------------------ | --------------------- | ------------------------- | ----------------------------- |
| emerald | 4.73:1 pass              | 8.41:1 pass           | 7.61:1 pass               | 7.10:1 pass                   |
| sky     | 5.10:1 pass              | 7.77:1 pass           | 7.04:1 pass               | 6.60:1 pass                   |
| violet  | 6.13:1 pass              | 7.74:1 pass           | 7.06:1 pass               | 6.80:1 pass                   |
| amber   | **4.54:1 pass** (tight)  | 8.69:1 pass           | 7.86:1 pass               | 7.53:1 pass                   |
| rose    | 5.04:1 pass              | 7.84:1 pass           | 7.21:1 pass               | 7.10:1 pass                   |
| teal    | 4.79:1 pass              | 8.60:1 pass           | 7.78:1 pass               | 7.26:1 pass                   |

**24/24 families pass** the small-text bar. Light is stack-independent
(the `-100` chip background is opaque — the row state cannot reach it);
the dark composites clear the bar with the widest margin in calm and the
narrowest in hover (the lightest painted row under the /20 hue layer).
Light amber is the family's tightest corner at 4.54:1 — worth knowing
before anyone reaches for a lighter amber chip. The family stays as-is —
no code change, the numbers are the deliverable — and the next axe run's
identical incomplete on the avatar chips is a known quantity.

## Reviewed-passing: the drill-down's status-badge families (v2.191.0)

The org dashboard's HR drill-down payroll cell wears three status-badge
families (LOCKED/POSTED emerald, DRAFT/APPROVED amber, VOIDED slate).
Light is the opaque `-50` chip; dark composites `{c}-950/40` (slate:
`-900/60`) over the card token — the alpha class axe reports as
color-contrast INCOMPLETE. Computed with the recipe by
`scripts/contrast-math-drilldown-badges-v2191.mjs` (committed; the card
token read from `src/app/globals.css`, palette from the INSTALLED
Tailwind theme). The badge is 10px `font-medium` → 4.5:1 applies:

| family                  | light            | dark (alpha over card) |
| ----------------------- | ---------------- | ---------------------- |
| emerald (locked/posted) | 5.09:1 pass      | 11.40:1 pass           |
| amber (draft/approved)  | **4.87:1** pass  | 12.09:1 pass           |
| slate (voided)          | 7.23:1 pass      | 12.20:1 pass           |

**6/6 badge families pass** the small-text bar — the dark composites
with the widest margins measured yet (the deep `-950` ground under the
bright `-300` text). Light amber is again the family's tightest corner
(4.87:1, the amber family's recurring signature). The badges stay
as-is — no code change, the numbers are the deliverable — and the next
axe run's identical incomplete on these chips is a known quantity.

## Reviewed-passing: the desk digest's avatar + status-chip families (v2.192.0)

The desk DIGEST panel (org dashboard, `panels.tsx` DeskActivity) wears two
chip families the report page's v2.190.0 table does not cover: the
per-reviewer avatar pills on THIS surface (the panel paints its ground
LITERALLY — `dark:bg-slate-900` on the section class, `bg-white` in light —
so the v2.190.0 numbers only transfer if the literal ground equals the card
token), and the timeline's four DESK_STATUS_CHIP statuses (PENDING amber,
APPROVED emerald, REJECTED rose, CANCELLED slate — light the opaque `-50`
chip, dark `{c}-500/10` or slate `-800/60` over the literal ground, with
the timeline row's own hover tint UNDER the translucent chip). Computed by
`scripts/contrast-math-digest-avatars-v2192.mjs` (committed; the ground
asserted FROM the component source, palette from the INSTALLED theme.css).
The chips are 10px text → 4.5:1 applies:

| family                    | light            | dark calm        | dark hover       | dark drilled |
| ------------------------- | ---------------- | ---------------- | ---------------- | ------------ |
| avatar emerald            | 4.73:1 pass      | 8.41:1 pass      | 7.61:1 pass      | 7.10:1 pass  |
| avatar sky                | 5.10:1 pass      | 7.77:1 pass      | 7.04:1 pass      | 6.60:1 pass  |
| avatar violet             | 6.13:1 pass      | 7.74:1 pass      | 7.06:1 pass      | 6.80:1 pass  |
| avatar amber              | **4.54:1** pass  | 8.69:1 pass      | 7.86:1 pass      | 7.53:1 pass  |
| avatar rose               | 5.04:1 pass      | 7.84:1 pass      | 7.21:1 pass      | 7.10:1 pass  |
| avatar teal               | 4.79:1 pass      | 8.60:1 pass      | 7.78:1 pass      | 7.26:1 pass  |
| status PENDING (amber)    | 4.87:1 pass      | 10.63:1 pass     | 9.81:1 pass      | —            |
| status APPROVED (emerald) | 5.09:1 pass      | 10.16:1 pass     | 9.38:1 pass      | —            |
| status REJECTED (rose)    | 5.51:1 pass      | 8.70:1 pass      | 8.11:1 pass      | —            |
| status CANCELLED (slate)  | **4.55:1** pass  | 6.08:1 pass      | 5.88:1 pass      | —            |

**36/36 families pass** the small-text bar. The avatar columns land
number-for-number on the v2.190.0 table — the literal `dark:bg-slate-900`
ground IS the card token (the transfer is now proven, not assumed), and
the light `-100` chips stay stack-independent. The status chips are the
new numbers: dark margins wide (the deep ground under the bright `-300`
text), light CANCELLED slate the tightest status corner at 4.55:1 with
light amber right behind (4.87:1 — the amber family's recurring
signature). The unknown-status fallback reuses the CANCELLED shape, so it
is covered by that row. The chips stay as-is — no code change, the
numbers are the deliverable — and the next axe run's identical
incomplete on these alphas is a known quantity.

## Reviewed-passing: the desk report's emerald action + status families (v2.193.0)

The desk REPORT page (`desk-report-view.tsx`) wears five emerald-voiced
surfaces the digest panel's v2.192.0 table does not cover: the ACTIVE
window/branch scope chips (the roving group's pressed face), the Print
button (the same literals as the active chip), the "File all visits"
button, the ledger's "via" chip, and the page's OWN REPORT_STATUS_CHIP
statuses (PENDING amber, APPROVED emerald, REJECTED rose, CANCELLED slate
— the digest timeline's same four states, but over a DIFFERENT ground).
The page paints no local bg: the real ground is the app BACKGROUND token
(the root layout paints `bg-background`) — dark oklch(0.145 0.015 260),
NOT the digest's literal slate-900 — so the v2.192.0 numbers do not
transfer and these are first numbers, not a re-run. Two honest wrinkles
the math must respect: the File-all button's LIGHT half is the family's
only light ALPHA (`bg-emerald-50/70` — composited over the light
background, unlike the opaque `-50` chips), and the ledger rows carry
their own hover tints (`hover:bg-emerald-50/40`,
`dark:hover:bg-emerald-500/5`) that sit UNDER the translucent dark chips
and under the via chip's own `slate-900/60` in BOTH row states. Computed
by `scripts/contrast-math-desk-report-chips-v2193.mjs` (committed; the
literals asserted FROM the component source, the palette from the
INSTALLED theme.css, the ground from globals.css). Everything here is
9-12px semibold/bold text → 4.5:1 applies:

| family                     | light            | dark calm        | dark hover       |
| -------------------------- | ---------------- | ---------------- | ---------------- |
| active scope chip / print  | 5.09:1 pass      | 10.70:1 pass     | 8.74:1 pass (print) |
| file-all (50/70 light alpha) | **4.73:1** pass (hover 100) | 11.62:1 pass | 9.72:1 pass |
| via chip                   | 5.37:1 pass      | 12.34:1 pass     | 12.05:1 pass (row-hover) / 10.70:1 pass (chip-hover) |
| status PENDING (amber)     | 4.87:1 pass      | 12.08:1 pass     | 11.33:1 pass     |
| status APPROVED (emerald)  | 5.09:1 pass      | 11.62:1 pass     | 10.80:1 pass     |
| status REJECTED (rose)     | 5.51:1 pass      | 9.70:1 pass      | 9.27:1 pass      |
| status CANCELLED (slate)   | **4.55:1** pass  | 6.46:1 pass      | 6.26:1 pass      |

**23/23 families pass** the small-text bar. The dark margins are the
widest of any surface yet measured over the background token (the deep
0.145 ground under the bright `-300` text), and the light corners repeat
the house's known signatures: CANCELLED slate the tightest status corner
(4.55:1, the same number the digest timeline reports — the `-50` chip is
stack-independent, so the grounds agree) with the amber PENDING right
behind (4.87:1). The file-all hover is the family's one new tight corner
(4.73:1, emerald-700 on the opaque emerald-100). The unknown-status
fallback reuses the CANCELLED shape, so it is covered by that row. The
chips stay as-is — no code change, the numbers are the deliverable — and
the next axe run's identical incomplete on these alphas is a known
quantity.
