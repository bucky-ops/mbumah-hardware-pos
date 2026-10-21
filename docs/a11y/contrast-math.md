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

## Fixed: the revenue modal's dark-mode voice + the VAT spark's stroke (v2.194.0)

The revenue modal (kpi-row.tsx) was built light-only (v2.176-era) while its
Dialog surface paints `bg-background` — in dark mode oklch(0.145 0.015 260).
Measured by `scripts/contrast-math-revenue-modal-v2194.mjs` (the literals
asserted FROM the component source, the dialog ground from globals.css
`:root`/`.dark`, the palette from the INSTALLED theme.css), the pre-fix dark
numbers were the modal's quiet failure: the stat grid's `text-slate-800`
VALUES measured **1.35:1** (the loudest numbers on the screen, near-invisible),
the `text-slate-500` labels 4.15:1, the net strip's 10px violet-800 label
4.13:1 over its `bg-violet-50/70` alpha sunk into the dark ground, and the
VAT strip's emerald-800 label 3.54:1 (emerald-900's 4.53:1 and violet-900's
4.97:1 passing hair-thin). Light mode was already sound (4.57–14.04:1).

v2.194.0 fixes the modal's dark voice with the house's proven pattern (the
panels' STATUS_CHIP family): both strips gain `dark:border-{c}-500/30
dark:bg-{c}-500/10` under `dark:text-{c}-300` labels and `dark:text-{c}-200`
week figures, the verdict chips' three states wear `dark:bg-{c}-500/10
dark:text-{c}-300 dark:ring-{c}-500/30`, the prior/net chips swap their
`bg-white/80` alpha for `dark:bg-{c}-500/20`, and the grid wears
`dark:text-slate-400` labels under `dark:text-slate-100` values. **26/26
families pass** — dark margins 6.37–18.05:1 (the fixed grid value the
widest), light unchanged (4.55–14.04:1; the flat slate verdict chip the
tightest, as everywhere). The new VAT spark's stroke (`#d97706`, amber-600 —
a third hue so emerald gross, violet net and amber VAT never merge) is
recorded under the 3:1 non-text bar for completeness: 3.06:1 light, 6.20:1
dark — the svg is aria-hidden decoration and the strip's figures speak the
face. The fix is a code change: this section closes as FIXED, not
reviewed-passing.

## Fixed: the transactions lens + the modal's REAL ground (v2.195.0)

THE DISCOVERY: v2.194.0's dark-voice numbers above were derived over the
DIALOG ground — but the modal's body panel (`rounded-xl ... bg-slate-50`,
no dark half) paints between the dialog and every interior token, and the
DOM composites against the NEAREST painted ancestor. Measured live
(agent-browser, the dark class forced): the dark dialog owned the page
while the panel stayed LIGHT, so `dark:text-slate-100` values sat on
near-white at **1.05:1** and the `-300` strip voices at 1.54–1.57:1 — the
v2.194.0 dark fix was true to its math and false to its surface.
`scripts/contrast-math-transactions-lens-v2195.mjs` proves the bug in
reverse (three discovery rows must stay under 2:1) and re-derives every
interior family over the REAL chain: dialog → panel → strip → chip.

v2.195.0 fixes the ground: both body panels gain `dark:border-slate-700
dark:bg-slate-900` (the lens toggle's dark face since v2.187.0), and the
v2.194.0 tokens become true over it. **46/46 families pass** — the script
supersedes the v2.194.0 numbers (same tokens, truer grounds): light margins
4.55–14.00:1 (grid label and flat verdict chip the tight corners, 4.55:1),
dark margins 5.46–16.28:1 over the slate-900 panel (flat verdict chip
tightest), branch rows measured on the dialog ground they actually sit on
(7.25–13.33:1). The new transactions face rides the same audit: the card
stays white in BOTH modes by design (like every KPI card — the light voice
on it is correct; legacy line 4.77:1, the settled chip 6.26:1), and its
drill-down wears the blue family (strip label 8.21 light / 8.78 dark, week
figure 9.66 / 11.18, prior chip 6.72 / 6.73). Spark strokes recorded under
the 3:1 non-text bar (aria-hidden decoration; the figures speak): the
count face's `#2563eb` 5.17 card / 4.94 light panel / 3.45 dark panel, the
VAT amber re-derived over the panels 3.05 light / 5.59 dark, the title
glyph 5.04:1. The fix is a code change: this section closes as FIXED, not
reviewed-passing — and the v2.194.0 section above is annotated by this one
(same tokens, the ground the numbers are true over).

## Fixed: the debt ledger + the section headers' dark voice (v2.196.0)

THE DISCOVERY: the modal section headers ("The week by branch" and their
sub-lines) rode `text-slate-500` with NO dark variant since v2.176.0 — the
v2.195.0 audit measured the panel interiors and the rows but not the
headers between them. On the dark dialog the combination measures
**4.15:1** — a marginal but real gap under the 4.5 bar these 10-11px lines
must meet. v2.196.0 fixes all four headers and their sub-lines
(`dark:text-slate-400`, **7.53:1**) as part of the debt ledger's birth;
the pre-fix combination is pinned below the bar in reverse (3 discovery
rows) so it cannot return silently.

The new face — `scripts/contrast-math-debt-ledger-v2196.mjs`, **45/45
families pass** over the REAL chain (dialog → panel → strip → chip; the
ledger sections sit outside the panel on the dialog ground): light
4.55-14.00:1 (the slate-500 voices the tight corners at 4.55; rose strip
label 7.31, amount 8.88, share chip 5.59; status chips 4.87 amber / 5.88
red), dark 6.17-16.28:1 over the slate-900 panel (headline red-400 6.17,
rose strip 8.70-11.83, share chip stack 7.02, status chips 12.08 amber /
9.68 red on their -500/10 dialog stacks). The card stays white by design:
the ledger chip 5.88:1, the 20px-bold headline takes the 3:1 large-text
bar (3.82:1) and so does the red edge stroke (3.82:1). The composition
bar's pastel fills are DOCUMENTED DECORATION, deliberately not asserted:
the bar is aria-labeled and its figures spoken twice beside it (the card's
badges; the modal's four cells with shares), so asserting amber-400 against
the track would flatter the math, not inform it.

## Fixed: the reorder watchlist + the card face's re-hue (v2.197.0)

THE DISCOVERY: the low-stock card's hot number AND its icon rode
`text-orange-500` since the card shipped (v2.176.0 era) — orange-500 over
the card's white computes **2.89:1**, below even the 3:1 bar the 24px-bold
headline (large text) and the 14px icon (non-text UI) must meet. Unnoticed
because every prior KPI audit measured the MODALS' interiors; the mute
tiles' own voices were never on the ledger until the tile became a voice.
v2.197.0 re-hues the face to **amber-600** (**3.19:1** — passes both 3:1
bars; amber-500 would have FAILED at 2.15:1, which is why the face goes one
step deeper) and the pre-fix combinations are pinned below the 3 bar in
reverse (3 discovery rows). The MODAL's 24px headline count goes one step
deeper still (**amber-700**, 4.82:1 over the slate-50 panel): the debt
modal's headline held the full 4.5 text bar and the count face keeps that
stricter house line.

The new face — `scripts/contrast-math-stock-watchlist-v2197.mjs`, **49/49
families pass** over the REAL chain (dialog → panel → strip → chip; the
watchlist sections sit outside the panel on the dialog ground): light
4.55-14.00:1 (the slate-500 voices the tight corners at 4.55; amber strip
label 6.86, amount 8.74, items chip 4.86; coverage chips 4.87 amber / 4.93
orange / 5.88 red; the count amber-700 4.82; the qty/reorder pair 4.84),
dark 6.79-16.28:1 over the slate-900 panel (headline amber-400 10.39, strip
10.63-12.34, items chip stack 7.22, coverage chips 6.98-12.08 on their
-500/10 dialog stacks). The card stays white by design: the watchlist chip
4.87:1, the 24px-bold headline takes the 3:1 large-text bar (3.19:1) and so
do the icon and the amber edge stroke (3.19:1). The severity bar's pastel
fills are DOCUMENTED DECORATION, deliberately not asserted: the bar is
aria-labeled and its figures spoken twice beside it (the card's aria-label;
the modal's four cells with shares), so asserting amber-400 against the
track would flatter the math, not inform it.

## Fixed: the rental yard + the Expert OVERDUE badge's re-voice (v2.198.0)

THE DISCOVERY: the Expert panel's rental ledger has voiced its OVERDUE
badge `text-red-600` on `bg-red-50` since the Expert panel shipped — the
combination computes **4.36:1**, under the 4.5 bar the badge's 10px text
must meet. Unnoticed because the badge families were audited as a class
(v2.191's drill-down badges) on the drills' own -50 grounds — this badge
sits in the EXPERTS table, a different surface nobody re-measured when the
rental ledger shipped. v2.198.0 re-voices the badge to **red-700**
(**5.88:1** — the same voice the debt ledger's overdue status chip already
speaks) and pins the pre-fix combination below the 4.5 bar in reverse (1
discovery row).

The new face — `scripts/contrast-math-rental-yard-v2198.mjs`, **49/49
families pass** over the REAL chain (dialog → panel → strip → chip; the
yard sections sit outside the panel on the dialog ground): light
4.51-14.00:1 (the slate-500 voices the tight corners at 4.55; rose strip
label 6.36, amount 8.09, rentals chip 5.51; status chips 5.88 overdue red
/ 5.09 active emerald; days chip 5.51; the count rose-700 5.81; the rate
figure 6.31), dark 6.79-16.28:1 over the slate-900 panel (headline
rose-400 6.42, strip 8.09-10.63, chip stack 6.47, status chips 9.68 red /
8.22 emerald on their -500/10 dialog stacks). The card stays white by
design: the roster chip 5.51:1, the 24px-bold headline takes the 3:1
large-text bar (rose-600 4.51:1) and so do the icon and the rose edge
stroke (4.51:1). The breach-age bar's pastel fills are DOCUMENTED
DECORATION, deliberately not asserted: the bar is aria-labeled and its
figures spoken twice beside it (the card's aria-label; the modal's four
cells with shares), so asserting amber-400 against the track would
flatter the math, not inform it.

## Fixed: the lens toggle + the sweep's re-voices + the approval desk (v2.199.0)

THE DISCOVERY: the revenue modal's lens toggle has voiced its ACTIVE
GROSS chip white-on-`emerald-600` since v2.187.0 — the combination
computes **3.67:1**, under the 4.5 bar the chip's 10px uppercase text
must meet. Unnoticed because the toggle was audited at birth over the
OLD palette numbers (the round's notes recorded the INACTIVE voice's
4.75:1 and the ACTIVE net's 5.70:1 — both pass — and the gross chip
rode along on the emerald family's good name). v2.199.0 re-voices the
gross chip to **emerald-700 (5.37:1)**; the net chip (violet-600,
5.88:1) always passed and stays. Two sweep companions re-voice in the
same round: the login error line rode **red-600-on-red-50 (4.36:1)** —
the exact pairing v2.198.0 found on the Expert OVERDUE badge — to
**red-700 (5.88:1)**, and the Store Matrix's hot debt figure moved
red-600 → **red-700 (6.42:1)** for FAMILY ALIGNMENT (the pre-fix state
measures 4.76:1 with the installed palette — ABOVE the bar; the v2.159
"knife-edge 4.53:1" number came from the older palette — so this one is
honest consistency, not a violation; the house's hot REAL text speaks
red-700 and the siblings already do). All pre-fix states are pinned
below their bars in reverse (2 discovery rows) so the gaps cannot
return silently.

The new face — `scripts/contrast-math-approval-desk-v2199.mjs`, **42/42
families pass** over the REAL chain (card white; desk panel slate-50
light / slate-900 dark, painted dark on day one): light 4.55-14.00:1
(the hot number indigo-700 8.07; the qualifier/queue chips indigo-700 on
indigo-50 7.22; the draft/no-date chips slate-600 on slate-100 6.90; the
Nd-late chip amber-700 on amber-50 4.87 — the tight corner; the slate-500
voices 4.55-4.77), dark 5.72-16.28:1 over the panel (count indigo-400
5.72, labels slate-400 6.79, chips on their -500/10 stacks 6.16-10.63).
The org-console mover family — the a11y backlog's audit half — is
RECORDED here: emerald-700/red-700 light (5.37/6.42) and
emerald-400/red-400 dark over the bg-card token (9.55/6.39) **already
pass; no fix owed**. The desk's composition-bar fills follow the
v2.198.0 DOCUMENTED DECORATION law — aria-labeled on the bar and spoken
twice beside it (the card's aria-label; the modal's three cells with
shares) — deliberately not asserted (the lightest fill indigo-400
measures 2.85:1 on the light track, the darkest indigo-600 2.28:1 on the
dark track; the bar adds no figure the text does not already carry).

## Fixed: the branch doors' small print, re-voiced before ship (v2.200.0)

THE DISCOVERY (caught by the round's pre-derivation probe BEFORE the
first commit of the new faces): the branch KPI row's three new doors
(the day's ledger, the day's receipts, the basket ladder —
`src/components/dashboard/kpi-doors.tsx`) drafted their 10px window
notes and hour-axis labels as `text-slate-400` in light — **2.63:1** on
the white panel, under the 4.5 bar their small text must meet — with
`text-slate-500` in dark, **3.74:1** on the panels' own slate-900 (the
same miss on the dark half; the draft pair failed BOTH modes). The
shipped voice is **`text-slate-500 dark:text-slate-400`** — **4.77:1**
light / **6.79:1** dark — and the draft pair is pinned below the bar in
reverse in the round's script so the ghost cannot return silently.

The new faces — `scripts/contrast-math-branch-doors-v2200.mjs`, **28/28
checks pass** over the REAL chain (each door's panel paints bg-white
light / dark:bg-slate-900 dark from birth — the branch row's THREE new
mounts of the dark-panel law): light 4.73-17.84:1 (the method chips
emerald-700 on emerald-50 5.09 and teal-700 on teal-50 5.17, the status
chip emerald-700 on emerald-100 4.73 — the tight corner — and slate-600
on slate-100 6.90, the peak/busiest accents emerald-700/teal-700 on
white 5.37/5.39, the meta voice slate-500 4.77), dark 6.16-16.28:1 over
slate-900 (chips on their -500/10 stacks 6.16-10.43, the accents
emerald-300/teal-300 11.76/12.13, the meta voice slate-400 6.79). The
cards' edge/dot hues pass the 3:1 graphics bar (emerald-600 3.67,
teal-600 3.66, amber-600 3.19). The bars' pastel fills follow the
v2.198.0 DOCUMENTED DECORATION law — the key figures are aria-labeled
on the bar containers AND spoken twice beside (the day-ledger-peak
line, the day-receipts-busiest line, every bucket's count + share) —
deliberately not asserted: the light fills measure 1.86-2.10:1 by
design; the dark fills would pass even as graphics (5.08-5.59:1).

## Fixed: the -600 straggler family, closed on the branch dashboard (v2.201.0)

THE SWEEP (predicted by the v2.199.0 stage summary — "a systematic audit
of every remaining chip may still hide 4.3–4.4 stragglers" — and measured
by the round's pre-derivation probe, `scripts/probe-quiet-doors-v2201.mjs`,
BEFORE anything was re-voiced): sixteen small and mid-weight text voices
on the branch dashboard rode the red-600/rose-600 family over grounds too
light for them — the exact pairing v2.198.0 found on the Expert OVERDUE
badge and v2.199.0 found twice more. The five REAL violations, re-voiced
at source:

- the Alerts COUNT BADGE: white 10px bold on `bg-red-500` — **3.82:1** —
  → `bg-red-700` = **6.42:1**;
- the payment-method DEBT chip: `rose-600` on `rose-100` — **3.75:1** —
  → `rose-700` = **5.04:1**;
- the GIFT_CARD chip: `slate-500` on `slate-100` — **4.35:1** — →
  `slate-600` = **6.90:1**;
- the alert CRITICAL chip: `red-600` on `red-100` — **3.90:1** — →
  `red-700` = **5.26:1**;
- the debt-crisis BANNER sub-line and the trend badge's DOWN voice:
  `red-600` on `red-50` — **4.36:1** (the v2.199.0 login-error pairing,
  third instance) — → `red-700` = **5.88:1**.

RECORDED HONESTLY as ALIGNMENT, not violation: `red-600` on white
measures **4.76:1** on the installed palette — it PASSES the 4.5 bar —
so the KPI card values, the shift drawer's cash-out figure, the
top-customers' "Owes" line, the high-risk avatar initials and the debt
figures moved `red-600`/`rose-600` → `-700` as FAMILY ALIGNMENT with the
chip sweep (the v2.199.0 Store-Matrix precedent: consistency recorded as
consistency), plus margin against palette drift. The debt book's own
figures rode in at `rose-600` (a knife-edge **4.51:1** pass) and were
moved to `rose-700` light / `rose-300` dark (**6.06 / 9.29**) as the same
alignment.

The new faces — `scripts/contrast-math-branch-doors-v2201.mjs`, **43/43
checks pass** over the REAL chain (the debt book + the day's movers
panels paint their dark half from birth — the branch page's next two
mounts of the dark-panel law): light 4.77-6.90:1 (the risk chip rose-700
on rose-50 5.04 — the tight corner — the clear line emerald-700 on
emerald-50 5.09, the figures rose-700 6.06), dark 6.16-16.28:1 over
slate-900 (chips on their -500/10 stacks, the figures rose-300 9.29).
The doors' edge/dot hues pass the 3:1 graphics bar (rose-600 4.51,
violet-600 5.88). The five draft pairs are pinned below the bar in
REVERSE so the ghosts cannot return silently. The aging bar's segments
(emerald-500 2.46 / orange-500 2.89 on white) and the cards' hot rings
(rose-300 1.92) follow the v2.198.0 DOCUMENTED DECORATION law — the
figures are aria-labeled on the bar containers AND spoken twice beside
(the bucket cells' dot + label + amount + share; the warning banner; the
high-risk line) — deliberately not asserted.


## The org desk's six-hue vocabulary, measured before ship (v2.202.0)

THE PROBE (`scripts/probe-desk-doors-v2202.mjs`, **36/36**): the org
console's six new doors wear the /console KPI row's own face inventory —
orange revenue, blue transactions, amber stock, rose rentals, red debt,
indigo pending — and every voice was measured BEFORE anything shipped:
the `-700` accents **5.05-8.07:1** on the white panel, the `-50` chip
grounds **4.87-7.22:1**, the `-300` dark accents **8.88-12.34:1** on
slate-900, the `-500/10` dark chip stacks **8.05-10.63:1**, and the edge
bars **3.19-6.44:1** as graphics over the white card.

RECORDED HONESTLY as ALIGNMENT, not violation: the branches table's
overdue cell rode `text-red-600` on bg-card — **4.76:1** on the installed
palette, a PASS — and re-voiced to `red-700` (**6.42:1**) as the Task-188
family alignment plus margin against palette drift. The live dots are
aria-hidden decoration per the v2.198.0 law (the figure each hints at is
the card's own value text). The committed script —
`scripts/contrast-math-desk-doors-v2202.mjs`, **42/42** — pins the whole
vocabulary so it cannot drift silently.


## The week door's emerald family + the forecast line's re-voice (v2.203.0)

THE PROBE (`scripts/probe-week-doors-v2203.mjs`, **16/16**): the branch
dashboard's Sales trend card became the week's EMERALD door and every
voice was measured BEFORE anything shipped — the `-700`/slate accents
**4.77-9.81:1** on their light grounds (emerald-50 chips, slate-50
forecast block, amber-50 outlier banner), the chart's graphics against
the 3:1 non-text bar, and in dark the `-300` accents **6.79-12.02:1** on
slate-900 and the `-500/10` chip stacks.

RECORDED AS A FIX, not alignment: the trend chart's FORECAST DASHED LINE
rode amber-500 on white — **2.15:1, BELOW the 3:1 graphics bar** (the
legend text carried the figure, but the line is the graphic that carries
the forecast's position). The line and the legend swatch re-voiced to
amber-600 — **3.19:1** — and the ghost amber-500 value is pinned BELOW
the bar in REVERSE so the old voice cannot return silently. The trend
polyline (emerald-600 3.67:1) and the door's edge bar (emerald-600
3.67:1) pass untouched. The progress-bar track (emerald-100 light) and
the live dot are aria-hidden decoration per the v2.198.0 law — the
figures they illustrate are the text beside them. The committed script —
`scripts/contrast-math-week-doors-v2203.mjs`, **18/18** — pins the whole
family.
