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
