# Changelog

All notable changes to Mbumah Hardware POS are documented in this file (Keep a Changelog format; versions follow package.json).

## [2.182.0] The branches table remembers

The org dashboard's branches table has been the org console's OTHER dense table since v2.149.0, and the Store Intelligence Matrix — its twin across the page — learned to sort (v2.180.0) and to remember (v2.181.0) while it stayed stock: arrival order, fixed columns, comfortable rows, every choice forgotten. This release the branches table learns the matrix's full owner vocabulary — sortable headers, hideable columns, drag-resizable widths and a compact-rows density — and remembers all of it through the SAME kind of versioned, corrupt-tolerant localStorage spine, under the table's OWN key so the two tables never share bytes.

### Added
- **`src/lib/org/branches-table-prefs.ts` (NEW)**: the branches table's spine — the matrix spine's twin (same honesty contract carried over verbatim) under the single key `mbumah.branches-table.prefs` carrying `v: 1` plus `widths`, `visible`, `sort` and `dense`. Pure (storage INJECTED), CORRUPT-TOLERANT by construction (garbage JSON, unknown version, non-object payload, hostile storage, quota refusal → the calm empty prefs; field-by-field validation keeps whatever is provably sound), BOUNDED (widths clamp 40–2000px, entry caps 32, key length 48).
- **`BRANCH_TABLE_COLS` — the ONE column spec**: the driven header, the visibility menu and the resize handler all read the same array (key/label/width/min/align/sortable for the nine columns); `workspace` stays unsortable (an action cell is not data); `week` sorts through the SAME by-storeId join its cells speak.
- **Sortable headers**: every data column's header is a real `<button>` driven by the matrix's OWN comparator (`sortMatrixRows` / `nextSortState` reused verbatim — one sort vocabulary across BOTH dense tables; numbers loudest-first, text A→Z, a branch with no week entry sorts LAST in both directions). The visible state rides the `BranchSortGlyph` (orange arrows when active, a muted chevron pair on hover/focus); the accessible state rides real `aria-sort` values on each th. Null sort → the API's arrival order, copied.
- **The export follows the sort**: `exportBranchesCsv` now maps the SAME `branchRows` memo the table body reads — the file mirrors what the owner sees (the matrix's v2.180.0 rule carried across the page). The other CSV sections keep their own joins.
- **Hideable + resizable columns**: every cell wraps in its column's visibility so a hidden column's td simply does not render; the header carries the matrix's drag-resize separator recipe (per-column min floor, saved width wins over the spec default, the drag lands as ONE debounced save).
- **The Compact-rows toggle**: the fourth tunable dimension — `[&_td]:px-2 [&_td]:py-1 [&_th]:py-1` pulls the padding in without touching a render body; `aria-pressed` carries the state and the orange pressed family marks it active.
- **The Columns menu speaks the memory**: a hint line ("Sort, hidden columns, widths and density save to this browser automatically.") plus a muted **Reset layout** item (RotateCcw) that restores stock and clears the key; the visible, polite `org-console-layout-note` line confirms the actions that have no other surface.
- **Restore after hydration + the debounced write-back**: stock first paint, saved layout second (`branchRestored` ref gates the write-back); every choice lands 250ms after the last change settles; a stock layout CLEARS the key outright; a refused save is silent.
- **Docs**: `multi-store-workspaces.md` gains the branches-table-remembers bullet and the `| Branches table · layout memory |` KPI row.

### Tests
- `src/tests/branches-table-prefs-v2182.test.ts` (NEW): the spine EXECUTED (round-trip, exact payload key set, clamping band, entry caps, junk dropping, unknown version/garbage/hostile storage → calm defaults, removeItem-less clear, save re-sanitizes), the component contract (spine import, restore effect source, SSR guards, debounce + stock-clear fork, Compact button + dense override, the Columns menu trio, the comparator reuse, the CSV-sorted-rows wiring, the column spec order, the visibility wrappers), the docs rows, and the release surfaces.
- `trend-doors-v2175`'s header pins evolved deliberately: the branches table's headers are now DRIVEN by `BRANCH_TABLE_COLS`, so the column-order pins moved from literal `<th>` markup to the spec's array order (same intent, one place).
- The EIGHT prior-round suites' package pins evolved to 2.182.0 (the treadmill tax, paid); the six head-pin suites re-anchored by `scripts/reanchor-head-pins.mjs` with the new counters (71/72/73/104).

## [2.181.0] The matrix remembers

The Store Intelligence Matrix has been owner-tunable since v2.18.3 — drag-resizable columns, hideable columns — and sortable since v2.180.0, but every one of those choices lived in component state and died with the panel: a reload, a tab switch, or a navigation reset the owner's matrix back to stock. This release the matrix remembers: ONE versioned, corrupt-tolerant localStorage spine carries every owner-tunable choice across reloads, plus a fourth tunable dimension (compact-rows density) and a visible escape hatch (Reset layout).

### Added
- **`src/lib/org/store-matrix-prefs.ts` (NEW)**: the ONE spine the matrix's memory speaks — `loadMatrixPrefs` / `saveMatrixPrefs` / `clearMatrixPrefs` / `parseMatrixPrefs` / `serializeMatrixPrefs` around the single key `mbumah.store-matrix.prefs` carrying `v: 1` plus `widths`, `visible`, `sort` and `dense`. Pure (storage INJECTED — the component hands `window.localStorage` guarded by its own `typeof window` check), so the spine runs under node test runners and stays honest under SSR. CORRUPT-TOLERANT by construction: garbage JSON, an unknown version, a non-object payload, a hostile storage or a quota refusal all degrade to the calm empty prefs — field-by-field validation keeps whatever is provably sound and drops the rest; widths clamp into a 40–2000px band with capped entries so a poisoned payload can never balloon storage or feed the layout engine nonsense.
- **Restore after hydration**: the server renders the stock matrix; the client's first paint matches it; THEN the saved layout takes over — a hydration mismatch is a bug, default-then-restore is a feature. The restore runs once on mount (`restored` ref gates the write-back so the restore's own setState calls are never mistaken for owner choices).
- **The debounced write-back**: every owner choice lands 250ms after the last change settles (a column drag repaints dozens of widths; storage takes ONE). A stock layout CLEARS the key outright — "nothing saved" is the honest shape of "no customizations" — anything else saves the whole payload through the lib, the ONE writer of the bytes. A refused save is silent: the matrix forgets on the next reload exactly as it always did, and never nags.
- **The Compact-rows toggle**: the header gains a fourth tunable dimension — compact rows pull cell padding in (`py-1`) and lower the header band (`h-8`), roughly 30% more rows on screen without touching a render body; the active state speaks in the console's orange accent with `aria-pressed` carrying it to screen readers, and the tooltip says the choice is saved with the layout.
- **The Columns menu speaks the memory**: a hint line ("Widths, hidden columns, sort and density save to this browser automatically.") tells the owner the persistence exists, and a muted **Reset layout** item (RotateCcw icon, `text-slate-500`) restores stock and clears the stored key — an exit, not an invite.
- **Docs**: `multi-store-workspaces.md` gains the matrix-remembers bullet and the `| Matrix · layout memory |` KPI row.

### Tests
- `src/tests/store-matrix-prefs-v2181.test.ts` (NEW): the lib EXECUTED (round-trip serialize→parse, exact payload key set, clamping, entry caps, junk-width/visible/sort dropping, unknown version and garbage JSON → empty prefs, hostile storage throws → false/empty, removeItem-less clear → empty payload written, stock-layout clear wiring, the 250ms debounce shape), the component contract (restore-on-mount source, the `restored` gate, stock-clear vs save fork, Compact button with `aria-pressed` + orange pressed state, the dense Table override, the hint line, the Reset item, lib-is-the-one-writer), the docs rows, and the release surfaces.
- The SEVEN prior-round suites' package pins evolved to 2.181.0 (the treadmill tax, paid); the six head-pin suites re-anchored by `scripts/reanchor-head-pins.mjs` with the new counters (70/71/72/103).

## [2.180.0] The matrix learns to sort

The Store Intelligence Matrix has been the expert console's densest table since v2.18.3 — resizable, hideable, exportable (v2.179.0's offline twin) — but its rows only ever appeared in the API's arrival order: an analyst scanning for the loudest debt or the busiest week had to do the scanning by eye. This release every data column's header becomes a real sort button, driven by ONE pure comparator shared by the table body AND the CSV export — the pixels and the file can never disagree about what "sorted" means.

### Added
- **`src/lib/org/store-matrix-sort.ts` (NEW)**: the ONE comparator the matrix speaks — `sortMatrixRows(rows, state, weekOf?)` plus `nextSortState` (same column flips, new column starts at its default), `defaultDirFor` (numeric columns loudest-first, text A→Z) and `toggledDir`. Pure: no React, no DOM, no clock; null state → arrival order, copied. SORT SEMANTICS: the week column sorts by `weekTotal` through the caller's join, and a store with NO trend entry sorts LAST in BOTH directions — honest absence never wins a loudest-first sort and never hides as a zero at the bottom of a smallest-first one (the v2.175.0 dash rule carried into ordering). Ties keep arrival order (`Array.sort` is stable); an unknown key returns arrival order (the lib never guesses a comparator).
- **Sortable headers**: every data column's header is a real `<button>` (the Actions label stays a plain span — nothing to sort there). Click sorts, click again flips; the resize separator stays OUTSIDE the button so drag and click can never fight. The visible state rides `SortGlyph` — lucide `ArrowUp`/`ArrowDown` in the console's orange accent when active, a muted `ChevronsUpDown` that only appears on hover or keyboard focus (`opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100` — a whisper, not a shout); the active column's label gains `font-semibold text-slate-900`. The accessible state rides `aria-sort` on each th (`ascending`/`descending`/`none` — real ARIA values, never the shorthand).
- **The export follows the sort**: `exportCsv` reads the SAME `sortedStores` memo the table body reads — the file mirrors what the owner sees, arrival order when nothing is sorted (the v2.178.0 "offline twin" philosophy completed).
- **TOLERANT by construction**: the sort state is component-local (resets with the panel, like widths and visibility); a store row satisfies the lib's structural `MatrixSortRow` shape as-is; a nullish trend block just means every week reads absent → the week column's honest-absence rule covers the whole table.
- **Docs**: `multi-store-workspaces.md` gains the matrix-sort bullet and the `| Matrix · sort |` KPI row.

### Tests
- `src/tests/store-matrix-sort-v2180.test.ts` (NEW): the comparator EXECUTED (numeric desc/asc defaults, text asc/desc, the flip via `nextSortState`, the week join through `weekOf`, absence LAST in both directions, stable ties, null state → copied arrival order, unknown key → untouched order, single-row and empty tables), the component contract (sort state + memo + the one-comparator wiring, sortable buttons excluding Actions, glyph vocabulary + aria-hidden, aria-sort real values, the separator outside the button, export-reads-the-sorted-rows), the docs rows, and the release surfaces.
- The SIX prior-round suites' package pins evolved to 2.180.0 (the treadmill tax, paid by hand — now including v2.179.0's own suite); the six head-pin suites re-anchored by `scripts/reanchor-head-pins.mjs` with the new counters (69/70/71/102).

## [2.179.0] The matrix reads the week

Three surfaces speak every branch's week — the dashboard's branches table (v2.175.0/2.177.0), the expert console's store strip (v2.176.0/2.177.0), and the branches CSV (v2.178.0) — but the Store Intelligence Matrix, the expert console's densest table, stayed week-blind: ten columns of today with no shape, no verdict, no prior. This release the matrix reads the week: a "Week 7d" column joins the table, its CSV export becomes the table's offline twin, and the workspace dialog speaks the week at the top. Still ZERO new queries — the `perStoreTrend` block has ridden every summary response since v2.174.0, and the page already polls it.

### Added
- **`src/lib/org/store-matrix-csv.ts` (NEW)**: the matrix's CSV bytes move out of the component into a PURE lib (no db, no network, no DOM — the generated stamp is passed in), and grow the week inline: `Week 7d (KES)`, `Prior week (KES)` and `Change (%)` ride after `Revenue`, the matrix's own reading order. `buildStoreMatrixCsv(stores, generatedAt, trend)` joins the trend block by `storeId` (never row order); numbers export raw (no thousands separators) under RFC-4180 quoting; the header is stable — a store with no trend entry, or a nullish/empty block, leaves its week cells EMPTY (the honesty lives in the cells, the columns never flicker).
- **The Change % is the SAME `weekDelta` verdict the chips speak** (imported from `summary-trend`, never re-derived): signed, round2'd, EMPTY when there is no comparison (missing/undefined/zero/negative prior), `0` for an exactly flat week — chip and file can never disagree. A closing note carries the v2.173.0 gross-vs-net divergence label into the file (`Note,Store week shapes are gross revenue — the expert console's revenue KPI is net of VAT`) and rides only when the trend block is present and non-empty.
- **The matrix's `Week 7d` column**: each cell stacks the store's gross week total (the strip's own "7-day revenue KES X" number, tabular), the muted 64×18 spark, and the `WeekDeltaChip` — the branches table's exact vocabulary sized to the cell; the tooltip composes `7-day revenue KES X (gross) · prior KES Y` when a prior exists; the accessible words ride `weekDeltaWords` as sr-only sentences; a store with no entry renders the calm aria-hidden dash. The column participates in visibility, drag-resize, and the header's new hover hint (`7-day gross revenue, week ending today`).
- **The workspace dialog speaks the week**: opening a store from the matrix renders the week at the top of the POS tab — shape, total, verdict in one orange-accent row (dark pairs kept), same tooltip, same sr-only clauses; no week in the block → the row never renders.
- **The export toast counts the week**: `Exported store_intelligence.csv · week by store` when the block rode, plain otherwise — the owner can tell at a glance whether the week made the file.
- **`StoreMatrix` gains the tolerant `trend` prop** (optional + nullable, `StoreMatrixTrendEntry` exported): the console page passes `summary.perStoreTrend` straight through — no second fetch, an older cached answer degrades to dashes, never a crash.
- **Docs**: `multi-store-workspaces.md` gains the matrix-week bullet and the `| Matrix · week by store |` KPI row.

### Tests
- `src/tests/store-matrix-week-v2179.test.ts` (NEW): the lib EXECUTED (byte-exact full-file pins with and without the week, the join by storeId never by order, the weekDelta parity assertion — the file's Change cell equals `weekDelta`'s own pct, 1270.38 / −64.62 pinned), the honesty rule (missing entry, undefined prior, zero/negative prior → empty Change cell; flat → `0`), the note gate (present and non-empty only), RFC-4180 quoting, the empty-stores shape, the component contract (column def, cell vocabulary, sr-only clauses, modal week row, toast parity, the lib-is-the-one-writer refactor), the page wiring (no second fetch), the docs rows, and the release surfaces.
- The five prior-round suites' package pins evolved to 2.179.0 (the treadmill tax, paid by hand); the six head-pin suites re-anchored by `scripts/reanchor-head-pins.mjs` with the new counters (68/69/70/101).

## [2.178.0] The export carries the week

The branches table speaks every branch's week — spark, verdict chip, prior week on hover — but the branches CSV (v2.112 lineage, sections through v2.154.0) ended at the desk digest: a file that could be read but not charted. This release the export becomes the offline twin of the table: a fourth section, "The week by branch (7d)", carries the drill-down's own rows with their verdicts, computed by the SAME classifier the chips speak. Zero new queries — the block has ridden every summary response since v2.174.0.

### Added
- **`buildBranchesCsv` grows its fifth parameter (`trend`)**: a `BranchTrendCsvRow[]` the caller pre-joins (the summary's `perStoreTrend` entry joined to its branch name by `storeId` — the drill-down's own join, `'Branch'` when a name cannot resolve, so no row is silently dropped). Present and non-empty, it appends the section: title line `The week by branch (7d)`, header `Branch,Revenue 7d (KES),Prior week (KES),Change (%)`, rows sorted loudest week first (the drill-down's sort; `Array.sort` is stable, so tied weeks keep their arrival order), then a closing note — `Note,Branch week shapes are gross revenue — the dashboard's org trend line is net of VAT` — carrying the v2.176.0 divergence label into the offline artifact.
- **The Change % is the SAME `weekDelta` verdict the chips speak**: signed (the sign IS the direction in a spreadsheet), round2'd by the same `variancePct` formula the org badge uses — chip and file can never disagree about the math, only about the data they were handed. Honest absence: a missing or non-positive prior week leaves the Change cell EMPTY — never a fabricated "+0%" or an invented infinity; an exactly flat week prints `0`, which IS a real comparison.
- **Honest absence, whole-block**: `trend` nullish or empty → the file ends byte-identically to the v2.177.0 shape (the section simply never existed) — an older cached summary degrades, never breaks.
- **The export note counts what it wrote**: `Exported branches_2026-10-20.csv · 4 sections` (singular handled) — the owner can tell at a glance whether the week (and the desk) made the file. The desk-unavailable suffix composes after the count as before.
- **The export button speaks its own busy state**: `aria-busy` while the desk read answers, the label swaps to `Exporting…`, and the download icon pulses (`animate-pulse`) — the desk fetch is the one async step, and the button no longer sits silently disabled.
- **Docs**: `multi-store-workspaces.md` gains the export bullet and the `| Export · week by branch |` KPI row; `payroll-run-lifecycle.md`'s branches-CSV contract is now the four-section contract.

### Tests
- `src/tests/branches-csv-week-v2178.test.ts` (NEW): the section EXECUTED (bytes pinned end-to-end, loudest-first with stable ties, the weekDelta parity assertion — the file's Change cell equals `weekDelta`'s own pct for the same inputs), the honesty rule (missing/undefined/zero/negative prior → empty cell, flat → `0`), the whole-block honest absence (nullish/empty → the exact v2.177.0 bytes), the caller contract (join by storeId, `'Branch'` fallback, no second fetch, the section-count note, the busy-state button), the docs rows, and the release surfaces.
- `console-org-v2154.test.ts` call-shape pin evolved deliberately (`desk,\n    );` → `desk,\n      trendRows,\n    );`) — the call grew its fifth argument.

## [2.177.0] The week by branch learns its own variance

The three trend surfaces speak every branch's week shape (v2.175.0 the table, v2.176.0 the strip and the drill-down) — but a shape without a verdict still forces the reader to do the math. This release every branch's week learns its own week-over-week verdict: up, down, or flat, drawn once, spoken once, hidden when there is no comparison. Still ZERO new queries — the prior-week per-branch slices have ridden the summary payload's `topMover` math since v2.174.0.

### Added
- **`src/lib/org/summary-trend.ts` gains `weekDelta`**: ONE honest classifier every delta chip speaks. The header card's rule, per branch: a branch with NO prior week has NO comparison — `null`, never a fabricated "+0%" or an invented ∞; a current week that exactly matches prior reads `flat` at 0%, which IS a real comparison and is spoken as one. The pct reuses the SAME `variancePct` formula the org badge uses, so a branch chip and the header badge can never disagree about the math — only about the data they were handed. Pure: numbers in, verdict out, no clock.
- **`GET /api/org/summary`**: each `perStoreTrend` entry gains `priorWeekTotal` — the SAME per-store prior-week slice the v2.174.0 top mover already computed (`priMap`; still zero new queries). Additive and round2'd; every existing key untouched.
- **`WeekDeltaChip` + `weekDeltaWords` (org primitives)**: ONE visible vocabulary for all three trend surfaces — up `emerald-700` / down `red-700` (the v2.159 contrast family the header badge speaks), flat calm `muted-foreground` (a week that didn't move is neither a success nor a failure), lucide `ArrowUpRight`/`ArrowDownRight`/`Minus` at h-2.5, tabular-nums at 10px. The chip is `aria-hidden` decoration; `weekDeltaWords` is its accessible twin ("Up 12.4% vs prior week" / "Flat vs prior week"), `null` when there is no comparison.
- **The dashboard's branches table**: the 7d cell stacks the chip under its spark; the tooltip gains the prior week (`7-day revenue KES X (gross) · prior KES Y`) exactly when a prior exists; a SECOND sr-only sentence speaks the verdict while the v2.175.0 base clause keeps its exact shape. No prior week → no chip, no words, nothing fabricated.
- **The expert console's store strip**: the same chip stacks under each card's spark, the same tooltip composition, the same second sr-only sentence — one week, one vocabulary, two surfaces.
- **The Revenue drill-down's week-by-branch rows**: each row carries its own verdict chip beside the gross week total (the rows now pass the prior week through — still the same payload entries, no new fetch).
- **TOLERANT by contract**: `priorWeekTotal?` is optional in all three perStoreTrend declarations (primitives, dashboard card, KPI row) — an older cached response degrades to no chip, never a crash.

### Tests
- `src/tests/branch-variance-v2177.test.ts` (NEW): `weekDelta` EXECUTED (the honesty rule, flat, rounding parity with `variancePct`), the API contract (`priorWeekTotal` from `priMap`, round2'd, additive), the tolerant declarations pinned in all three files, the three surface contracts (chip classes, tooltip composition, the byte-stable base sr-only clause + the second verdict sentence, honest absence), the drill-down pass-through, and the release surfaces.

## [2.176.0] The expert console reads the week by branch

The org dashboard's branches table has spoken per-branch week shapes since v2.175.0, but the expert console (`/console`) — the other org surface, already polling the SAME `/api/org/summary` response every 30 seconds — stayed shape-blind. This release the week's shape reaches the expert console: no new queries, one shared vocabulary.

### Added
- **The store strip draws each branch's week**: every branch card in the console's store strip carries its own muted slate sparkline (the dashboard table's exact vocabulary — 72×20, `#64748b`, the same `Sparkline` primitive), joined by `storeId` from the `perStoreTrend` block the page already fetches. The gross week total rides the card's title tooltip and an sr-only clause; a branch with a quiet week draws the honest flat line, and an older cached summary without the block keeps a calm dash row at spark height — never a fabricated shape. The card's workspace door is untouched.
- **The Revenue drill-down lists the week by branch**: the KPI row's revenue trend modal keeps its org-wide net-of-VAT spark as the lead and now speaks the branches underneath — one row per branch (spark + name + gross week total), joined by `storeId`, sorted loudest week first, under an explicit note that the branch shapes are gross while the org line is net of VAT (the recorded cross-surface divergence, now labeled at the exact place both meet). TOLERANT: a branch manager without matrix access (or an older cached answer) sees the org-wide story only — nothing fabricated, nothing broken.
- **`OrgSummaryData` (the expert console's type) grows the tolerant `perStoreTrend?`** — the same declaration the org dashboard's card speaks, so both surfaces share one contract.

### Tests
- `src/tests/expert-week-v2176.test.ts` (NEW): the executed join (by storeId, never row order), the loudest-first sort with tie stability, the tolerant degradations (null block, missing entry, empty stores), the strip + modal render contracts (muted slate 72×20, title tooltip + sr-only, the dash row, the net-vs-gross note, the honest-absence rendering), the page wiring (no second fetch — the props ride the polled summary), the doc rows, and the release surfaces.

## [2.175.0] The week reaches every branch row

The trend strip named which branch moved the week (v2.174.0) but the branches table below it stayed shape-blind — a wall of today-only digits. This release the week's shape reaches every branch row, and the mover's name becomes a door.

### Added
- **`src/lib/org/summary-trend.ts` gains `storeSparks`**: ONE branch's revenue spark — the rows belonging to that store filtered from the shared week-row set, bucketed by the SAME `sparkBuckets` math the header spark speaks (half-open per-day buckets, honest zeros when the branch's week is empty — a quiet branch draws a flat line, never a gap). Pure as ever: the caller passes every anchor in.
- **`StoreTrendSlice` / `TrendMover` carry workspace identity** (`slug` / `subdomain` / `isActive`) as pure pass-throughs — the lib never derives or validates URLs; the winner rides the same identity fields the branches table speaks so the card can deep-link through the SAME safe resolver.
- **`GET /api/org/summary`**: the week-row `findMany` gains `storeId` in its select (the SAME rows now feed the per-branch sparks — no second query), and the response gains `perStoreTrend` (`Array<{ storeId, spark[7], weekTotal }>`, keyed by `storeId`) additively. `topMover` carries the winner's `slug`/`subdomain`/`isActive`. Role gate and every existing key untouched.
- **The card**: the branches table gains a **7d trend** column beside "Revenue today" — the same `Sparkline` primitive at 72×20 in muted slate (`#64748b`, so a table full of sparks never out-screams the header cards), the week total on the cell's title tooltip + an sr-only clause, `w-[84px]` so the digits to the right stop dancing. `TrendFooter`'s mover name becomes a new-tab anchor when `resolveBranchWorkspace` builds a URL (underline + hover + focus-visible ring + tiny external-tab arrow + sr-only "opens in a new tab"), plain text otherwise — the safe-builder contract verbatim. Both payloads are TOLERANT (`perStoreTrend?`, optional link fields): an older cached response degrades to muted dashes and plain text, never a crash.

### Tests
- `src/tests/trend-doors-v2175.test.ts` (NEW): `storeSparks` math EXECUTED (per-store filtering, bucket placement at the millisecond boundaries, honest zeros, the `days` param, purity), the identity pass-through (winner carries slug/subdomain/isActive, absent fields stay absent, no URL logic in the lib), the API contract (storeId in the select, `perStoreTrend` additive + keyed, mover identity, role gate untouched), the card contract (the 7d column, muted-slate stroke, sr-only + title, the anchor's new-tab/rel/classes/testid, the plain-text fallback), and the doc rows.

## [2.174.0] The trend names which branch moved

The trend strip said "the week moved −7.14%" but not WHO moved it. This release the strip names the branch — the top mover — computed by the same pure lib from two per-store groupBys riding the same `Promise.all`, with the same honesty rules as the variance badge.

### Added
- **`src/lib/org/summary-trend.ts` gains `topMover`**: from per-store `{ current, prior }` slices it returns the store with the largest ABSOLUTE week-vs-prior delta, signed — a branch that fell hardest is named as readily as one that jumped. The delta is money-safe (`toDec`/`round2`). Honest silences: no prior data anywhere → `null` (the honest-variance rule); every branch exactly flat → `null` (a flat week names no mover); fewer than two stores → `null` ("top" among one is noise). Ties break alphabetically for determinism. The card, not the lib, decides what a `null` means (no line).
- **`GET /api/org/summary`**: two per-store groupBys (the current and prior week windows, `_sum.totalAmount` + `_count._all` from the same two queries) join the existing `Promise.all`; each trend block gains `topMover` (`{ storeId, storeName, current, prior, delta, variancePct } | null`) additively. Names come from the active-store list — a sale whose store has no active name is counted but never spoken.
- **The card**: `TrendFooter` grows an optional `mover` — a `Top mover <name> <signed delta>` sub-line (`data-testid="metric-trend-revenue-mover"` / `"metric-trend-transactions-mover"`, tabular-nums, emerald-700/red-700 with the dark `-400` steps), with the `±%` clause shown only when the mover's own prior > 0 — a zero week has no percentage, never an invented ∞. Tolerant: an older cached response without `topMover` degrades to the strip exactly as it shipped in v2.173.0.

### Tests
- `src/tests/trend-names-mover-v2174.test.ts` (NEW): the math EXECUTED (the max-|delta| winner in both directions, the honest nulls, the alphabetical tie-break, the zero-week mover, round2 money safety, the count path, purity), the API contract (both windows, both metrics from one query, additive exposure, role gate untouched), the card render contract (optional mover, sign prefixes, the `prior > 0` % gate, class families, both testids), and the doc rows.

## [2.173.0] The first screen learns to trend

The owner's landing console answered "how much today?" and stopped there — the week's shape (rising, falling, flat) lived only in the expert console. This release the combined metrics speak the same trend language, computed once on the server and decorated honestly.

### Added
- **`src/lib/org/summary-trend.ts` (NEW, pure)**: the 7-day trend math — `trendWindows` (today's midnight, the 7-day window starting 6 days back, the prior window starting 13 days back — mirrors the kpi-summary windows), `variancePct` (the same `((current − prior) / prior) × 100` round2'd; 0 when prior has no data), `sparkBuckets` (gross amounts into 7 half-open per-day buckets, oldest → newest) and `countBuckets` (the same buckets, 1 per row). No db, no fetch, no `Date.now` — the caller passes every anchor in.
- **`GET /api/org/summary` gains a `trend` block**: revenue and transactions each carry `{ spark[7], weekTotal, priorWeekTotal, variancePct }`, computed from two aggregates + one row fetch riding the existing `Promise.all`. GROSS by contract — the trend decorates the "Revenue today" StatCard whose value is the gross `_sum.totalAmount`; a net-of-tax spark under a gross headline would be a lying adjacency. (The expert console's kpi-summary computes revenue NET of tax — a pre-existing cross-surface divergence between the two consoles' "Revenue" labels, recorded in v2.173.0, deliberately not reconciled here.)
- **The card renders the trend strip** on the Revenue and Transactions cards (`data-testid="metric-trend-revenue"` / `"metric-trend-transactions"`): the Sparkline primitive the expert console already speaks (aria-hidden decoration; the numbers are the content), a week-vs-prior variance badge (emerald-700 up / red-700 down — the v2.159 contrast lesson; dark mode lifts to the -400 steps), and a "7d … · prior …" microcopy line. The badge renders ONLY when `priorWeekTotal > 0` — no prior data means NO comparison, never a fabricated "+0%". `trend?` is tolerant (optional + nullable): an older cached response degrades to the plain cards, never crashes the first screen.

### Tests
- `src/tests/first-screen-trend-v2173.test.ts` (NEW): the window/bucket/variance math EXECUTED (midnight anchors, the −6d/−13d windows, half-open bucket boundaries at the millisecond, oldest→newest ordering, empty input → honest zeros, prior=0 variance), the gross semantics pinned structurally (no `taxAmount` anywhere in the lib), the API's `trend` contract (same `SALE` + `['COMPLETED','PARTIAL']` vocabulary, additive response keys, role gate untouched), the card render contract (Sparkline reuse, testids, badge classes, the `priorWeekTotal > 0` gate, tolerant `trend?`), and the doc rows.

## [2.172.0] The card expects the tick

"Last tick 3h ago" was history; the operator still had to arithmetic their way to "is the heartbeat on time?". This release the Automation card answers it directly, computed from the ledger read's own anchors so the browser clock never enters the math.

### Added
- **`src/lib/org/tick-expectation.ts` (NEW, pure)**: the next-tick expectation — three honest states. **On-time** (emerald): "Next tick due 13:00 UTC (16:00 EAT) — the hourly dispatcher's slot." **Overdue** (amber): fires only once `now` runs past the current top-of-hour slot + a 15-minute grace window AND no tick of any dispatcher has landed since the slot began — "Heartbeat overdue — no tick since 14:00 UTC (17:00 EAT), 5m past the 15-minute grace window." **Unarmed** (muted): while CRON_SECRET is unset nothing pings the hourly dispatcher, so the line names Vercel's daily slot ("Pinger not armed — the next expected tick is Vercel's daily slot 03:00 UTC (Wed 21 Oct 2026 · 06:00 EAT)") and never cries wolf.
- **`GET /api/org/automation` cadence object gains `vercelHourUtc: 3`** — the daily slot's UTC hour as a number the card consumes without parsing a cron string (tolerated optional on the card for older responses, default 3 in the lib).
- **The card renders the expectation line** (`data-testid="automation-expectation"`, role="note") under the Last-tick row: a solid state dot (decorative, aria-hidden) + the full sentence as visible text — no tooltip, no tab stop, nothing compressed, so the pill machinery has nothing to add.

### Tests
- `src/tests/card-expects-tick-v2172.test.ts` (NEW, 17 tests): the slot/next-slot/Vercel-slot math EXECUTED (boundaries: exact instants roll, grace flips at the millisecond), the three sentences byte-pinned in both timezones, posture deferral, tolerance (absent vercelHourUtc, unparseable anchors), class families, the wire anchors, the render contract, and the doc chronology.

## [2.171.0] The denial names its gate

v2.170.0 made the refused tick visible — but the sentence said only THAT the gate refused, not WHICH one. The rows already carry `metadata.path`, so the refusal feed gets the same shape the failed ticks have had since v2.166/v2.169.

### Added
- **`GET /api/org/automation` returns `deniedTickStamps` + `deniedTickGates`** — the refusal feed behind the count: exact stamps (ISO, newest first, ≤10) and each row's `metadata.path` folded tolerantly to the gate's short name ('hourly' | 'nightly'; null where the path is absent, garbage, or unknown). Same window, same cap, same tolerance rules as the failed-tick feed.
- **The denied pill's sentence is computed once** (`deniedTickTooltip` — the failed-tick pill's one-truth rule from v2.167.0) and now says WHICH gate refused: `Recent refusals: 1 at the hourly gate, most recent Tue 20 Oct 2026 · 16:52 EAT` — with the honest `· and N more` valve when the count outruns the ≤10 feed. Title, sr-only and the visible bubble all read the helper; rows without a readable path render the bare sentence, never a guess.
- **A single-gate suffix on the pill itself**: when EVERY listed refusal named the same gate AND the list is complete (the count does not outrun the feed — unseen rows could belong to the other gate), the pill appends `· hourly` / `· nightly`; mixed or unknown gates render no suffix.

### Tests
- `src/tests/denied-names-gate-v2171.test.ts` (NEW, 10 tests): the API's feed query + tolerant path fold + exposure + read-only, the card's interface fields, the helper's single-source base/cause strings + per-gate counts + most-recent stamp + valve, the suffix completeness guard, the three surfaces with the untouched amber/HINT_BUBBLE contract, the doc chronology, and the v2.170.0 gate pins.
- `denied-tick-speaks-v2170.test.ts` re-anchored (2 assertions, dated): the sentence moved into the helper; the parallel read grew `deniedRows`.

## [2.170.0] The refused tick speaks

A tick that sends the WRONG `x-cron-secret` used to vanish: the gate returned 403, no ledger row was written, and the exact moment the pinger's secret went stale left the Automation card green with an aging tick and no explanation — the one silent failure mode inside the arming walkthrough's card read.

### Added
- **Both dispatcher gates write a `CRON_TICK_DENIED` WARN row** when a tick's `x-cron-secret` does not match the armed `CRON_SECRET` AND the request at least sent a non-empty value (`/api/cron/nightly` + `/api/cron/hourly`, identical discriminator). A misconfigured-but-honest tick — the pinger with a stale GitHub secret, a curl with a typo — always sends a secret, while anonymous scanners and the Vercel-managed scheduler send nothing: the ledger records real attempted ticks, never scanner noise, and an unauthenticated caller cannot write rows by spamming the endpoint. The row carries only `metadata.path` (never secret material), the 403 body is byte-identical, and the write is catch-guarded so the refusal stays deterministic.
- **`GET /api/org/automation` returns `deniedTicks7d`** — refused ticks counted in the same 7-day window as the failed ticks, so the card's two amber signals never disagree about the window they describe.
- **The card grows an amber "N denied ticks in 7d" pill** beside the posture badge with the full v2.167/v2.168 hint treatment — title tooltip, tab stop, sr-only copy, and a visible-on-focus bubble ("Ticks the tick gate refused while armed — a secret was sent but did not match. The usual cause is a stale CRON_SECRET on one side of the arming walkthrough; the refused tick ran nothing."). Zero denials render nothing; absence (older responses) and zero are equally silent via the tolerant `?? 0` guard. The two-read verification walkthrough now ends on the card alone when the secrets disagree.
- **The bubble recipe lives in one place**: the v2.168.0 popover class string moves into the module-level `HINT_BUBBLE` constant — the sub-job chip bubble rides it bare, the failed-tick pill and the denied pill append the `normal-case tracking-normal` prose override. Three surfaces, one home.

### Tests
- `src/tests/denied-tick-speaks-v2170.test.ts` (NEW, 9 tests): both gates' discriminator + write-before-refuse order + catch-guard, path-only metadata (secret material banned inside the systemLog call), byte-identical 403 body, untouched fail-open path, the API's window + exposure + read-only, the card's tolerant guard + amber family + three-surface sentence order + shared-constant counts, and the doc chronology (v2.170/v2.169/v2.168 notes, ledger bullet, two-read sync).
- `keyboard-visible-v2168.test.ts` re-anchored (2 assertions, dated): the recipe literal moved into the constant, so the suite now pins the single home + the card's constant references instead of the duplicated string.

## [2.169.0] The pill names the heartbeat

The failed-tick sentence dated every red tick but never said WHICH heartbeat failed. Since v2.165.0 every ledger row names its dispatcher — the sentence now says so, and the axe-incomplete question on the console's quiet grey buttons is answered with arithmetic instead of a repaint.

### Added
- **`GET /api/org/automation` returns `failedTickDispatchers`** — a parallel array (same order/length as `failedTickStamps`, null where a row predates v2.165.0 or carries no name), read tolerantly from each row's own TOP-LEVEL `metadata.dispatcher` (the field v2.165.0 standardized on every ledger row). The findMany's select grows the metadata column — one field on ≤10 rows, same window, same cap. This is NOT the coupling the v2.167.0 assessment declined (that idea rode the stamps on the dispatchers' INTERNAL result shapes); the distinction is pinned in a dated comment and in tests.
- **The pill's sentence grows a parenthetical per named stamp**: `Failed ticks: Tue 20 Oct 2026 · 06:48 EAT (hourly) · …` — the single-source `failedTickTooltip` helper now maps stamps then zips the parallel array by index (a null, an out-of-range index, or an older response without the array renders the bare stamp, never a guess). The v2.167.0 helper pins (the guard, the stamps map, the "and N more" comparison) are preserved verbatim; title, tab stop, sr-only and the visible bubble all upgrade together.
- **The muted-button family is computed, not guessed** (`docs/a11y/contrast-math.md` + `scripts/contrast-math-muted-button-v169.mjs`): the HR per-store expand button family (`bg-muted/40` + `text-muted-foreground`, hover `/70`) had been an axe "incomplete" since the alpha rounds — computed per the recipe: light rest **5.73:1**, light hover **5.53:1**, dark rest **5.48:1**, dark hover **5.29:1** — all four corners clear 4.5:1. Reviewed-passing: no code change, the numbers are the deliverable.
- **The shell-bubble sweep is assessed on the record** (the v2.168.0 option #1): after v2.168's link sweep, the org console's remaining title-only surfaces are either NON-interactive (badges, status chips — not tab stops by design, so focus bubbles do not apply) or REDUNDANT (the "Open branch workspace" links' visible text already carries the full intent). The recipe stays LINK-scoped; recorded in the round's test suite and worklog.

### Tests
- `src/tests/pill-names-heartbeat-v2169.test.ts` (NEW, 10 tests): the API's metadata select + tolerant dispatcher guards + parallel exposure + read-only, the dated not-the-coupling comment, the card's interface field + verbatim v2.167 helper pins + parenthetical contract, the four tooltip surfaces, the doc chronology, and the contrast-math deliverable.

## [2.168.0] The hints become visible

v2.167.0 made the card's hints keyboard-REACHABLE — a focus ring says "here", not "why". This round the sentence itself becomes visible at the moment of focus, the card's self-explaining suffixes gain their own tooltips, and the org console's remaining title-only links learn to speak.

### Added
- **Visible-on-focus hint bubbles** (`org-console.tsx`): while a keyboard user focuses a hinted sub-job chip or the failed-tick pill, the SAME sentence the hover tooltip says renders in a popover bubble overlaying the line below — `absolute left-0 top-full` (an overlay, so the two-row chip area never reflows), `pointer-events-none`, `bg-popover`/`text-popover-foreground` (the token pair, dark-safe by construction), `group-focus-visible:block`. The bubble is `aria-hidden` — the sr-only line already spoke it once; sighted keyboard users get the words, assistive tech hears them exactly once. The pill's bubble overrides its 9px uppercase display type (`text-[11px] font-normal normal-case tracking-normal`) so the stamps read as prose.
- **The suffixes speak for themselves**: the reaper chip's `· reaped N` / `· clean` suffix carries an honest tooltip — "The reaper deleted N expired session(s) — the sweep's own ledger count" / "The reaper swept and deleted nothing — zero expired sessions at tick time" — and a failure chip's `· HTTP N` suffix names its source ("the dispatcher's own recorded result, not a guess").
- **The title-only links learn to speak**: the HR tiles echo their title sentence to screen readers (`{title && <span className="sr-only"> — {title}</span>}` inside the Link — "Open headcount report", "Resolve in HR assets…"); the per-branch People & payroll deep links fold the hover sentence INTO the accessible name (`aria-label="Open the People & Payroll tab pre-filtered to {branch}"`) — one truth, two surfaces, the title stays for the mouse.
- **The doc says what the card now does** (`docs/cron-operations.md`): the heartbeat section gains "The hints become visible (v2.168.0)" beside the v2.167.0 note — the chronology, not a replacement.

### Tests
- `src/tests/keyboard-visible-v2168.test.ts` (NEW, 13 tests): the bubble recipe and its same-lookup guard (an unhinted chip renders no bubble, never a guess), the no-reflow absolute-overlay pin, the speak-once aria-hidden contract, the popover token pair (no alpha families), the v2.167.0 focusability contract re-pinned untouched, both suffix tooltips, the StatCard sr-only echo + branch accessible-name fold, and the doc notes.

## [2.167.0] The hints reach the keyboard

v2.166.0's ownership hints and exact failed-tick stamps lived in native `title` tooltips — invisible to a keyboard and to a screen reader. The hints stop being mouse-only: what the hover said, the tab order and the assistive line now say too.

### Added
- **Hinted sub-job chips are focusable** (`org-console.tsx`): a chip with an ownership hint becomes a tab stop (`tabIndex` conditioned on the SAME lookup as the title — an unknown name never becomes a dead tab stop) and wears a family-colored focus ring as the affordance (`focus-visible:outline-none focus-visible:ring-2` + `ring-emerald-600` for ok / `ring-red-600` for a failure, `ring-offset-1`) — full-opacity families, the card's contrast discipline extended to focus.
- **Every hint and exact stamp rides an sr-only copy**: the chip carries `<span class="sr-only"> — {hint}</span>` (guarded by the same hinted lookup, so unhinted chips stay silent); the failed-tick pill and the Last-tick line carry their exact EAT sentences too. Exactly three sr-only copies live in the card.
- **The failed-tick sentence is computed ONCE**: a pure `failedTickTooltip(automation)` helper now feeds BOTH the native `title` and the sr-only line — two surfaces, one truth, the keyboard copy can never drift from the hover copy. The v2.166.0 honesty contract (absent stamps → `undefined` → no tooltip invented) is preserved verbatim.
- **The register closes over all nine** (`docs/cron-operations.md`): the sub-job table grows from six rows to nine — the nightly dispatcher's exclusive sub-jobs (`reconciliation`, `retention`, `hr-report-digests`) had only lived in the cadence prose since v2.165.0 — and a drift pin asserts every `AUTOMATION_SUBJOB_HINTS` key has a row in the table (Option #1, both directions).
- **The "stamps via ledger metadata" idea is assessed on the record** (Option #3): a dated comment in `src/app/api/org/automation/route.ts` documents why the separate `findMany` stays — riding the stamps on ledger metadata would couple the read to each dispatcher's internal result shape (`results` vs `ledgerResults`) to save one indexed query on a card read. Assessed, deliberately not built.

### Changed
- `src/tests/keyboard-hints-v2167.test.ts` (NEW, 13 tests): focusability/focus-ring/sr-only contracts, the single-source tooltip helper and its honesty guards, the three-copy card count, the nine-key drift pin against the register, the doc notes, and the API's on-the-record assessment (still read-only). `chip-hints-v2166.test.ts` re-anchors the table-heading pin with a dated note (six → nine).

## [2.166.0] The chips explain themselves

A first-time owner staring at the Automation pulse card should not need the cron guide open in another tab — the sub-job chips now say what they own at the point of reading, and a red day is datable without leaving the card.

### Added
- **Sub-job ownership tooltips** (`org-console.tsx`): every sub-job chip carries a one-line `title` — "Pumps the outbound message queue…", "Drains the KRA eTIMS submission retry queue…", "Deletes sign-in sessions whose expiry has passed (expiresAt only)" — the card-sized echo of `docs/cron-operations.md`'s sub-job register (the doc stays canonical; the map is static UI copy). Chips with a hint wear `cursor-help`; an UNKNOWN sub-job name renders bare — the card never invents ownership for a job it has not met.
- **The failed-tick pill speaks its exact ticks**: `GET /api/org/automation` now returns `failedTickStamps` — the ISO timestamps (newest first) of up to 10 `CRON_DISPATCH_PARTIAL_FAILURE` rows behind the 7-day count (same `since` window, so count and list can never disagree). The pill's tooltip lists them in EAT ("Failed ticks: Mon 19 Oct 2026 · 14:02 EAT · …") with an honest "· and N more" when the count outruns the 10-stamp cap; absent stamps (older responses) render no tooltip at all.
- **docs/cron-operations.md**: the cadence section now states BOTH dispatchers carry sub-jobs (hourly SIX, nightly FOUR since v2.165.0) — the prose previously read as if only the hourly dispatcher had children; the heartbeat section documents the chip hints and the pill's 10-stamp cap.

### Changed
- `src/tests/chip-hints-v2166.test.ts` (NEW, 10 tests): the hint map covers exactly the nine names both dispatchers can emit, the tooltip/affordance contract, the never-invent rule, the API's take-10 same-window read (still read-only), the card's EAT/and-N-more/undefined-honesty, and both doc notes.

## [2.165.0] Every heartbeat writes its ledger

Until now the nightly dispatch (reconciliation, retention, HR digests) left no always-row — a healthy nightly tick was invisible to the Automation pulse, and the session reaper swept only once a day (the hourly tick is a single daily shot on Vercel Hobby). Both heartbeats now write the same ledger, name themselves, and the reaper rides both.

### Added
- **The nightly dispatcher folds the session reaper** (`/api/cron/nightly`) as its fourth sub-job: a SECOND daily sweep at 02:30 UTC, 30 minutes ahead of the hourly tick — a frozen or failed 03:00 deployment can no longer leave expired sessions unreaped for a day. The overlap is provably harmless: the reaper is one idempotent `deleteMany` on the indexed `expiresAt` column (expiresAt only, never `lastActiveAt`).
- **The nightly always-row**: the nightly dispatch writes its own `CRON_DISPATCH_TICK` INFO ledger row (the identical contract hourly has carried since v2.159.0, with the same `ledgerEntry` promotion of the reaper's honest deleted count) — the Automation pulse card can now show the nightly heartbeat, not just the hourly one.
- **Dispatcher identity on every ledger row**: both dispatchers stamp `metadata.dispatcher` (`'hourly'` / `'nightly'`); `GET /api/org/automation` parses it tolerantly (absent or garbage on pre-2.165 rows → the field is simply omitted) and the card renders it.
- **The card's Last tick line speaks its source and its exact stamp** (`org-console.tsx`): a `· nightly dispatcher` / `· hourly dispatcher` source label (full-opacity muted-foreground — the card's contrast discipline holds) rendered only when the row named one, and a tooltip carrying the exact EAT stamp ("Tick recorded Mon 20 Oct 2026 · 13:09 EAT") so an operator diffing two ticks never arithmetic's their way back from "3h ago".
- **docs/cron-operations.md**: the arming section gains the two-read verification (the Actions tab's green run + the card's amber→emerald posture flip — arming is not done until it is OBSERVED done); the ledger section documents both writers and the dispatcher identity; the sub-job table and the contracts section state the both-dispatcher fold rule (idempotent jobs only, the overlap must be provably harmless).

### Changed
- `src/tests/cron-pulse-v2159` and `src/tests/automation-reaper-v2164` re-anchored (dated notes) to the dispatcher-stamped metadata shape.

## [2.164.0] The pulse speaks the reaper

Automation that nobody can see is automation that can silently die — so the org console's Automation pulse card now speaks the session reaper's own sweep, and the docs carry the spec parity appendix the last three rounds kept deferring.

### Added
- **The tick ledger promotes the reaper's count** (`/api/cron/hourly`): the dispatcher's new `ledgerEntry` carries `deleted` from the session-reaper's response body onto BOTH ledger rows (the always-row and the partial-failure WARN) — but ONLY when it is a non-negative finite number (garbage is dropped, never invented). Other sub-jobs and older ticks simply lack the field.
- **`GET /api/org/automation` passes it through**: `SubJobResult.deleted?` — the tolerant guard accepts honest absence or a real non-negative number (a string `"3"` or a negative never does), keeping pre-2.164 ledger rows readable.
- **The Automation pulse card speaks it in two places** (`org-console.tsx`): the reaper chip gains `· reaped N` / `· clean` (tabular-nums, the HTTP-status suffix's own dress; absent/garbage renders nothing) and a sky **"N reaped" header pill** (dark-twinned, title-carried) when the last tick's count is positive — session hygiene where the eye lands first, honest silence at zero.
- **docs/payroll-run-lifecycle.md — the Spec parity appendix**: every EMS spec Stage-4 phase (4.1→v2.18.5 … 4.8→v2.20.0) mapped to the release that delivered it, plus the deepening rows (gate surfaces, a11y sweeps, idle, reaper) and the parity rule: releases, never intents.
- **docs/cron-operations.md**: the sub-job register — all SIX dispatcher sub-jobs in a table with ownership and scope notes (the reaper's expiresAt-only discipline), the ledger's v2.164.0 extension, and the card's new surfaces.

## [2.163.0] The session reaps itself — and the door swings back

The session table finally gets its janitor (Task 156's session-hygiene sweep), and the idle sign-out's door swings back — sign-in returns the colleague to the page they were reading, validated end-to-end against open redirects.

### Added
- **`GET /api/cron/session-reaper`**: one `deleteMany` on the indexed `expiresAt` column, wrapped in `runWithoutTenant` (Session is a global, tenant-exempt table), gated by the same `x-cron-secret` pattern as every sibling cron route (fail-open with a WARN when CRON_SECRET is unset). Every sweep leaves an INFO `SESSIONS_REAPED` ledger row — a reaped-zero sweep is a healthy outcome and still traces.
- **`src/lib/session-reaper.ts`**: the pure summary contract — honest plurals, an honest zero ("No expired sessions to reap — the session table is clean."), garbage counts degrade to the zero case. No db, no clock.
- **The reaper joins the hourly dispatcher** (`/api/cron/hourly`) as the sixth sub-job — the same fold pattern as etims-retry / debt-reminders / b2c-recovery (Vercel Hobby's two-cron limit keeps scheduled jobs out of vercel.json). Idle-expiry deletion stays the portal guard's own enforcement path; the reaper only owns sessions nobody will ever present again.
- **The return path** (`src/lib/session-idle.ts` grows): `safeReturnPath` — the paranoid `?next=` validator (same-origin relative paths only; protocol-relative `//`, scheme-like `javascript:`, backslashes, control characters and >512-char values all degrade to null, and null is never an error) — and `buildPortalReturnHref` (`/?next=<encoded>` or plain `/`). The idle overlay (`SelfServiceIdleWatch`) now remembers `window.location.pathname` at timeout and carries it on its Sign in link; the server-side PortalNote gains a `returnPath` prop wired from all six `loadSelfPortal` page callers (payslips / attendance / leave / goals / documents / home); `LoginScreen` reads `?next=` at submit time and that path WINS over the role-based default (first-sign-in password rotation still gates first).
- **`docs/a11y/contrast-math.md`**: the one-page recipe for closing axe "color-contrast incomplete" findings by blend math (Ottoson oklch→sRGB, real paint-stack compositing, the two background-model false-fail families), with `scripts/contrast-audit-login.mjs` committed as the reference implementation.

### Changed
- **Idle overlay + portal notes gain the return hint**: "Signing in brings you straight back to this page." — the promise is now spoken where the click happens (both the client overlay and the server-rendered notes).

## [2.162.0] The portal's thirty minutes

The self-service portal reuses the till's idle-timeout contract — server-enforced, surface-scoped — and the login front door closes its last unknown with a manual glass-card contrast audit.

### Added
- **`src/lib/session-idle.ts`**: the pure idle contract — `SELF_SERVICE_IDLE_MS` (30 minutes, the till's own cadence since v2.6.0), `idleExpired` (boundary `>=` the window; a missing or unparseable `lastActiveAt` stamp degrades to NOT-expired — garbage never invents a lockout), and the stable **401 `SESSION_IDLE_EXPIRED`** payload shape. No db, no network, no clock reads (`now` is always a parameter).
- **Server-side enforcement, scoped to the portal surface**: `selfServiceGuard` now checks `Session.lastActiveAt` on every `/api/self-service/*` request — expired → the session ROW is deleted (the 24h cookie cannot be replayed) and the request answers 401 `SESSION_IDLE_EXPIRED`; fresh → the window SLIDES (the request re-stamps `lastActiveAt`). `loadSelfPortal` does the same on every SSR page render, showing the honest "Signed out for your safety" note (Clock icon + Sign in) instead of employee data. The column existed from day one ("Track session activity") with zero readers until now.
- **`SelfServiceIdleWatch`**: the client half, mounted once in `SelfServiceProviders` — it imports the SAME `useIdleTimeout` hook the POS shell uses (the spec's literal "reuse ... safely" answer), POSTs `/api/auth/logout` on timeout (client and server agree — no zombie cookie), and renders an `alertdialog` overlay whose only action is Sign in (focus-managed, dark-paired, focus-visible ring).
- **docs/hr/self-service.md**: "The thirty-minute contract (v2.162.0)" — the spec's two idle questions (line 843.6 unattended tills AND self-service; line 1068.7 reuse safely) answered in the mechanism's own words, including why the till surface is untouched and why no background polling exists to keep the window alive.

### Changed
- **The login glass-card's last a11y unknown is closed by math**: axe could only report 17 "color-contrast incomplete" findings (it cannot compute alpha-over-backdrop backgrounds); `contrast-audit-login.mjs` does the blend math (page gradient → glass alpha → element) for every text family in both themes. Fixed: CardDescription /70→/80 (4.25→5.25:1 light), the forgot-password link primary/80→foreground/90 + permanent underline (3.90→6.29:1), footer base muted→foreground/80 (2.28→5.25:1), separator dots /50→/80 + aria-hidden (2.71→5.25:1), the error-dismiss X destructive→red-800 light (1.81→3.34:1, non-text 3:1 bar), and `.login-input::placeholder` via a theme-adaptive color-mix rule (2.28→5.25:1). Badge and pill families verified passing on their own painted backgrounds.

## [2.161.0] The payslip goes home

The employee can finally take their payslip PDF home from the portal — with the honest lifecycle gate — and the Phase 4.7 Lighthouse acceptance criterion is re-measured and documented on the SSR-complete portal.

### Added
- **`GET /api/self-service/me/payslips/[id]/pdf`**: the employee's own payslip PDF, reusing the HR PDF route's exact builders (`buildPayslipView` + `buildPayslipPdf` — one source of truth, masking cannot drift). Own-data rule enforced by the query scope (a payslip that is not yours is a 404, never a 403); statutory ids masked unless the caller holds `hr.employee.unmask.pii` (computed server-side); **409 NOT_ISSUED** for any payslip the run has not posted yet (rows become immutable payslips only at issuance), with a plain-language reason.
- **The honest issuance flag** on both self-service payloads (`listMyPayslips`, `getMyPayslip`): `issued: payslipIssuedAt !== null`. `issuedAt` keeps its createdAt fallback for display-only callers.
- **The portal dialog affordance** (`payslips-view.tsx`): a Download PDF anchor when `issued === true`, an honest "PDF download unlocks once this payslip is issued" note when `issued === false`, and silence when the field is absent (an older offline cache — never a false promise). The affordance lives in the dialog because the payslip row is a `<button>` and an anchor nested inside a button is invalid HTML. Issued list rows also show their issuance date.
- **`scripts/seed-e2e-v161.cjs`**: the QA matrix seed — one POSTED September run with an issued payslip (PS-2026-0901) for the portal QA employee, keeping the October draft as the refusal path.

### Changed
- **docs/hr/self-service.md**: the Lighthouse section gains the v2.161.0 re-measure row — **Performance 92, Accessibility 100, Best Practices 96, SEO 100, TBT 153 ms** on the SSR-complete portal (the v2.24.0 row predated the v2.28.0 SSR completion) — spec acceptance 10 (Lighthouse above 90) HOLDS; the 4-point BP cost is the Vercel-only `/_vercel/*` insights scripts 404ing on the local daemon (environment, not the app). A "The payslip goes home" section records the PDF contract.

## [2.160.0] The spec's own paths

Phase 4.6 literal spec-path parity closes — the EMS spec's three payroll report routes now exist verbatim — and the login front door closes its last a11y finding.

### Added
- **The three spec-path alias routes** (`src/app/api/payroll/exports/p10/route.ts`, `src/app/api/payroll/exports/statutory/route.ts`, `src/app/api/payroll/liability-report/route.ts`): each RE-EXPORTS its canonical handler (`/api/hr/reports/p10` and `/api/hr/reports/statutory-liability`) — same guard, same roles, same audit rows, same CSV, zero duplicated logic, so the spec path and the canonical path can never drift. The handlers only read query params, never the request path, so behavior is byte-identical.
- **`scripts/verify-spec-paths.mjs`**: the mechanical half of the spec governance contract — asserts every Phase 4.6 and Phase 4.7 path from the spec's "Create:" lists exists on disk (33 paths: 25 API routes + 8 pages), and that the three aliases still re-export their canonical handlers by resolving the import specifier to the canonical module. Wired into `npm run verify:v2-160-0`.

### Changed
- **The login screen is a landmark** (`src/components/login-screen.tsx`): the content column becomes a `<main>` landmark — the axe best-practice "region" rule had flagged all nine content blocks (tagline, card header, form fields, footer) as living outside every landmark; the decorative background layers (particles, dot grid, hardware icons) are now explicitly `aria-hidden`.
- **The keyboard beacon is visible** (`src/app/globals.css`): the `.login-input:focus` pulse ring rises from ambient-glow alphas (0.15/0.25 — measured ~1.6:1 against the glass card, a halo rather than an indicator) to 0.35/0.5, and the focused border from 0.5 to 0.7 alpha. Same amber hue, same 2s pulse.

### Docs
- `docs/payroll-run-lifecycle.md`: the B2C section now points at `docs/cron-operations.md` for the production cadence story (the backoff windows only regain meaning once the hourly pinger is armed), and a "The spec's own paths (v2.160.0)" section records the alias re-export shape and the parity gate.

## [2.159.0] The dispatcher keeps its hours

v2.158.0 made the production cron reachable; this release makes it PUNCTUAL and VISIBLE — the designed hourly cadence gets an off-Vercel keeper, and every tick leaves a ledger row a human can read.

### Added
- **The cron-hourly GitHub Actions workflow** (`.github/workflows/cron-hourly.yml`): scheduled hourly (`0 * * * *`, plus `workflow_dispatch` for manual arming) — pings the production dispatcher with the `x-cron-secret` header and turns red on any non-200, non-success payload, or failed sub-job. Closes the Hobby-cadence gap: Vercel fires the dispatcher daily (`0 3 * * *`), the B2C backoff windows (2m-30m) and reminder semantics were designed hourly; the pinger restores them without Vercel Pro. Setup contract documented in the workflow header (Vercel `CRON_SECRET` env + repo secret + optional `PROD_URL`).
- **The tick ledger** (`src/app/api/cron/hourly/route.ts`): every completed dispatch writes one `CRON_DISPATCH_TICK` INFO systemLog row carrying the full sub-job results (`[{name, ok, status}]`). The partial-failure WARN kept for severity filtering; the ledger is the always-row — before this, a healthy tick left NO trace and no reader could tell "all green" from "never ran".
- **`GET /api/org/automation`** (ORG_ROLES parity with `/api/org/summary`): the latest ledger tick (timestamp + per-sub-job results), the 7-day partial-failure count, the honest server-side tick-gate posture (`Boolean(process.env.CRON_SECRET)`), and the cadence truth. Read-only over `rawDb` under `runWithoutTenant`; ledger metadata parsed tolerantly (garbage yields empty chips, never a throw).
- **The Automation pulse card** on the org console (before the audit feed): last-tick line, per-sub-job chips (emerald-700 ok / red-700 failed with HTTP status), the 7-day failed-tick badge, the CRON_SECRET posture badge (emerald armed / amber unset), and the both-schedulers cadence line. Every state honest: loading skeletons, a pre-first-tick empty state, an error state with Retry that says the read failure is not a dispatch failure, and an unparseable tick that keeps the stamp while rendering no chips.

### Changed
- **POS dashboard trend affordance reads at 9px** (`src/components/pos/dashboard-stats.tsx`): the click-affordance arrow drops its `/50` alpha (full `text-muted-foreground` ≈ 5.76:1) and admits it is decoration (`aria-hidden`); the 9px trend percentage moves `red-600` → `red-700` (knife-edge 4.53:1 → 5.9:1), dark pairs kept.

### Docs
- `docs/cron-operations.md`: the production cron story in order (the v2.16.0 401 wall, the v2.158.0 pass-through, the v2.159.0 cadence + ledger), the pinger arming steps, the ledger/card contracts, and the rules new scheduled work must inherit (no proxy edit needed; idempotency required).

### Tests
- `src/tests/cron-pulse-v2159.test.ts` (20 NEW): workflow contract ×4 (hourly schedule, secret header, honest failure, setup), dispatcher ledger ×4 (tick row, results parity, WARN kept, vercel.json truth), automation route ×5 (org-roles parity, read-only org-wide, 7-day tail, tolerant parse, secret posture), card contract ×5 (fetch lifecycle, all honest states, named region, cadence line, contrast families), style pins ×2. Console-changelog counters re-anchored 48/49/50/81.

## [2.158.0] The wake-up call gets through

The round's real bug find, caught by probing the freshly-shipped sweep route: the edge proxy 401'd every cron tick — in production — since the workspace proxy landed.

### Fixed
- **The cron pass-through** (`src/proxy.ts` Layer 5): Vercel Cron sends UNAUTHENTICATED GETs; every `/api/cron/*` route carries its own `x-cron-secret` gate (403 on a wrong secret, fail-open with a WARN systemLog when `CRON_SECRET` is unset — the documented, deliberate route contract), but the edge auth layer 401'd every tick BEFORE the route gate ran. `/api/cron/outbox`, `/api/cron/hourly`, `/api/cron/b2c-recovery` all measured 401 on the production deployment (and the siblings since the proxy landed): the hourly dispatcher, its folded sub-jobs (outbox pump fallback, etims-retry, debt-reminders, payments-sweeper) and the v2.155.0 B2C auto-recovery sweep never fired in production. The fix passes `/api/cron/` through to the in-file gates — zero new trust at the edge (GET-only handlers, rate limiting intact, wrong secrets still 403 in-route, defense in depth preserved).

### Tests
- Full suite 3149/3149 (160 files); verify-v2-158-0 pinning the pass-through guard shape (the cron check precedes the session check, the route-level secret gates untouched).

## [2.157.0] The last alphas go home

The fifth consecutive lesson-64 re-audit layer — and the last: the remaining muted-alpha tokens and two emerald fills.

### Fixed
- **The remaining muted alphas reach full strength** (3 sites): `text-muted-foreground/80` → bare `text-muted-foreground` in the POS product-card stock line (the axe-flagged 3.82:1 node), the currency switcher, and the admin updates-safety note. With /60 and /70 gone in v2.156.0, the codebase now carries NO alpha-muted muted-foreground text tokens.
- **Two white-on-emerald-500 fills deepen** (2.47:1 → 5.49:1): the debt-plan status fill and the export-history status fill move to `bg-emerald-700 border-emerald-700` — the same standing family as v2.155.0's button fills.

### Tests
- Full suite 3149/3149 (160 files); verify-v2-157-0 pinning the zero-alpha invariant and the emerald fills.

## [2.156.0] The amber family settles

The lesson-64 re-audit on the shipped v2.155.0 build surfaced the next render-state layer: the amber text family and the muted-alpha helper lines. Same standing fix, ridden to the end in-round.

### Fixed
- **The amber text family deepens** (166 sites across the tabs): `text-amber-600` → `text-amber-700` (3.17-3.19:1 on white/gray-50 → 5.03:1; the axe-flagged nodes were transactions' summary twin and gift-cards' hover link, the rest were one re-audit away per lesson 64). Hover pairs move one step (`hover:text-amber-800`, 4 pairs); `focus:text-amber-600` → `focus:text-amber-700` (2); no `dark:text-amber-600` existed, dark pairs (`dark:text-amber-400`) untouched.
- **The muted-alpha helper lines reach full strength** (57 sites): `text-muted-foreground/60` (28) and `/70` (29) → bare `text-muted-foreground` — the 9-10px flagged nodes measured 2.51:1 and 3.07:1; full muted is 5.76:1. No `dark:text-muted-foreground/N` existed, so dark renders are untouched by construction (lesson 66 held).
- Prior-round pins re-anchored by the committed script (its first real use): v2149's amber-600-forbidden pin, v2153's amber regex pin, v2154's muted/70 pin restored to forbid the OLD tokens; source-moved pins (retention's amber pair, the desk Briefcase icon) ride with their sources.

### Tests
- Full suite 3149/3149 (160 files); lint 0 errors on changed files; verify-v2-156-0 pinning the token families and the reanchor script's own contract.

## [2.155.0] Recovery that never sleeps

The "persistence" half of the B2C retry story: the disciplined retry gate v2.33.0 built finally stops waiting for someone to open the run dialog, and the POS tabs' never-audited family gets the same contrast discipline the console family earned.

### Added
- **B2C auto-recovery sweep** (`src/lib/hr/payroll/b2c-recovery.ts`, route `/api/cron/b2c-recovery`, folded into the hourly dispatcher as `b2c-recovery`): walks every posted/locked run still holding unpaid money (oldest first, capped 25 runs/tick) and re-sends only latest-FAILED, unsettled payslips whose `evaluateB2CRetryGate` allows; stuck PROCESSING past `B2C_STALE_PROCESSING_MS` triggers one re-query sweep. One source of truth with the UI — `pickB2CRecoveryActions` reads the run's `summariseRunB2CState`, so the cron can never be more aggressive than the run dialog, only more punctual. Idempotency inherited (an active transaction is never re-sent, so overlapping ticks cannot double-pay); ceiling-blocked payslips stay human-only; per-run isolation (one bad run is recorded, the tick continues); audit rows carry the sentinel actor `system:b2c-recovery`; production without Daraja credentials and without `MPESA_B2C_ALLOW_MOCK` early-outs honestly before touching the database.
- **The run dialog tells the truth** (`payroll-run-dialog.tsx`): a `b2c-auto-recovery-note` line renders on posted/locked runs with the disburse permission — the backoff chips are advisory, not the only path home, and ceiling-blocked rows still wait for a human.

### Fixed
- **The 19-tab POS shell passes the contrast bar** (seven tabs carried the tinted-bg failures the console family had already fixed): `text-green-600` → `green-700` (174 sites — the POS KPI trends, transactions' totals, reports' growth chips), `text-emerald-600` → `emerald-700` (170 sites — rentals' bold chips, gift-cards' balances), `text-sky-600` → `sky-700` (21 sites — financial's sky-tinted chips), white-text fills `bg-emerald-600` → `bg-emerald-700` with hover `bg-emerald-800` (31 fills — payroll's "Disburse via M-Pesa", tax, invoices, delivery), the debt-plans "Create Plan" gradient deepened (`from-emerald-600 to-emerald-700`), and debt-plans' 10px `muted-foreground/70` → full `muted-foreground`. Dark-mode hover semantics preserved (`dark:hover:bg-emerald-600` on the run dialog); the heatmap's `dark:bg-emerald-600/60` untouched.
- Prior-round pin tests re-anchored to the sweep (v2.148's emerald-700 pin, v2.149's forbidden-token pins, v2.146's Sun icon) — the pins now forbid the OLD tokens, which is stronger than before.

### Tests
- `src/tests/b2c-recovery-v2155.test.ts` (14): pure selection (gate-allowed only, blocked never, stale-only re-query, settled no-op), the mock-discipline early-out, sentinel ctx, benign NOTHING_TO_RETRY as skip, per-run error isolation, route secret gate, dispatcher fold, dialog truth line.
- Full suite 3149/3149 (160 files); lint 0 errors on all changed files; tsc 411 source-only = stash-baseline (zero net new).

## [2.154.0] Buttons that read in the dark

The a11y campaign rode to the surfaces the console sweeps never reached — the unauthenticated login screen and /hr/reports dark mode — and found one real axe violation hiding app-wide.

### Fixed
- **Dark primary buttons read their own blue** (`globals.css`): the dark block's `--primary` is a mid blue (≈ #568de9) while its `--primary-foreground` stayed near-white — 3.15:1 on every dark `bg-primary` surface (first flagged on /hr/reports' "Apply period"). The foreground flips to a cool near-black (~5.5:1 on the same blue). All 36 `text-primary-foreground` usages sit on primary-family fills, so nothing else regresses; the 108 `text-primary` usages are why the background token never moved (darkening `--primary` would have broken primary-as-text on dark cards).
- **Dark orange CTAs lose the white text** (`globals.css`): the orange fill never changes between themes, but the dark block flipped `--accent-orange-foreground` to near-white — every `bg-accent-orange` button (login submit, customers/inventory actions) measured ~2.2:1 in dark mode. The dark block now mirrors the light block's warm near-black, one pair for both themes.
- **The login screen passes on both glass cards** (`login-screen.tsx`): the footer's muted/70 links measured ~1.7:1 and the muted/30 separators ~1.2:1 on the light glass card — they wear theme-adaptive foreground alphas now. The dark-gradient branding (white/40 → white/70) and the support-critical version badge (white/25 → white/55) clear their navy background; the destructive dismiss icon drops its 70% alpha.

### Added
- **The branches CSV carries the desk report** (`branches-csv.ts`, `org-console.tsx`): a third section — the desk's yesterday digest (visits, corrections cleared, distinct reviewers, requests, busiest branch, most active reviewer, per-branch visits) — fetched org-wide from the review-activity read. A refused or shapeless read exports without the section and the note says so; the branches export is never blocked by the morning note.
- **The export note follows up** (`org-console.tsx`): after downloading, the note grows an Open link to the fresh blob — eyeball the file in a new tab without hunting the downloads folder. One live blob at a time (the previous URL is revoked on re-export), and the button is honestly busy during the fetch.

### Tests
- console-org-v2154.test.ts (13): the dark token pairs, the primary-foreground-on-primary-fill safety sweep, the login token contract, the desk section bytes + honest zeros + RFC-4180 quoting + the v2.152.0 byte pins, and the handler's fetch/tolerance/Open-link contract.

## [2.153.0] The tinted cards tell the truth

The v2.152.0 re-audit's six nodes, probed with the lesson-65 discipline — check the PARENT background, never assume white. The alert cards' own tints were the missing variable.

### Fixed
- **The alert-card titles clear their tints** (`panels.tsx`): the Decision Support rows sit on `bg-red-50` / `bg-blue-50`, where `text-red-600` measured 4.41:1 and `text-blue-600` 4.75:1 (on the knife edge). `SEV_TEXT` moves to red-700 / blue-700 (5.9:1 / ~6.6:1); warning already spoke amber-700.
- **The alert detail line clears every tint** (`panels.tsx`): `text-slate-500` measured 4.27–4.55:1 across the three tints (under or on the 4.5 edge depending on tint) — `text-slate-600` computes ~6.9:1 on all of them.
- **The Live Feed's active filter keeps its dark text** (`panels.tsx`): the active chip wore white (the Button default `text-primary-foreground`) on `bg-orange-500` — 2.15:1, the same failure the v2.148.0 amber pill fixed. It now wears `text-slate-950` (8+:1) with the fill unchanged.
- **The 60d debt-aging badge clears** (`kpi-row.tsx`): `text-orange-600` measured 3.2:1 — `text-orange-800` (7.0:1); the 90d+ badge's red-600 already cleared 4.83:1.
- **The People & payroll module finishes its pass** (`people-payroll-by-branch.tsx`): the `— headcount, cost, absence…` hint line moves slate-400 → slate-500 (dark:slate-400 kept), and the five amber-600 links move to amber-700 (3.19 → 4.52:1) with hover tones deepened to match.

## [2.152.0] Counts that read

The v2.151.0 re-audit's six contrast nodes, each probed numerically and fixed at its true root — three were animation frames, not rest states.

### Fixed
- **The slide-in no longer dims its text** (`globals.css`): `console-slide-fade` ramped opacity 0→1, and the Expert Console's alerts rows re-animate on every poll — axe kept catching `text-red-600` at 3.36:1 mid-fade on rows that measure 4.83:1 at rest. The keyframe is transform-only now; the entrance still reads, and contrast is measurable at every frame for every `anim-slide-fade` user (alerts, chat messages, matrix rows, the store strip).
- **The overdue badge clears with margin** (`store-matrix.tsx`): `text-red-700` on `bg-red-100` measured 4.53:1 — inside the rounding noise axe resolves as a fail. `text-red-800` on the same tint is 5.9:1.
- **The Action queue's warning count clears** (`panels.tsx`): `text-orange-600` measured 3.2:1 on the outline badge — `text-orange-800` (7.0:1) with `dark:text-orange-300` for the dark queue.
- **The console footer's health score keeps its colour** (`chrome.tsx`): the footer sits on `bg-white` in light mode, so the v2.149.0 light-token choice (`emerald-400`) measured 1.97:1 there — the footer now speaks `text-emerald-700 dark:text-emerald-400` (and `amber-700 dark:amber-400` for the warning tone); the always-dark rail's own bright tokens are untouched.
- **The desk report's small print finishes the pass** (`desk-report-view.tsx`): the sixteen `text-slate-400 dark:text-slate-500` pairs unify to `text-slate-500` (the dark half already was slate-500 — dark rendering byte-identical, light 2.9 → 4.76:1), and the twenty-one bare light-context tokens gain `dark:text-slate-400` so dark mode keeps its brighter token exactly as it rendered.

### Added
- **The branches CSV export carries both tables** (`lib/org/branches-csv.ts`, `org-console.tsx`): `buildBranchesCsv` takes the summary's `hrPerStore` rows and appends a "People & payroll by branch" section — headcount, cost, absence rate, latest payroll period + status (honest empty cells when a branch has no runs), expiry alerts — so one download carries everything the console shows. Absent or empty input: the file ends exactly as v2.149.0 shipped it (pinned byte-identical).

### Verified
- The v2.151.0 six-node violation class is resolved at rest AND mid-animation; the numeric probes (lab-aware) recorded in the worklog.

## [2.151.0] The last slate family

The v2.150.0 re-audit's remaining contrast cluster: 15 `text-slate-400` nodes at 7–11px on white across the Expert Console's module tiles, empty states and specialist-console captions (2.9:1) — the same family the earlier sweeps fixed on the other files, hiding here.

### Fixed
- **The light-surface slate family finishes its sweep** (`experts.tsx` ×18, `primitives.tsx` ×1): module-tile labels and sub-lines, empty-state rows ("Everything is above its reorder level.", "No M-Pesa transactions recorded yet.", …), journal/audit/rental captions and the `text-[7px]` tile label all move `text-slate-400` → `text-slate-500` (4.76:1 on white). No `dark:` pairs existed in either file to preserve. The desk-report's deliberate `text-slate-400 dark:text-slate-500` pairs stay untouched (measured clean live).

### Verified
- axe on the Expert Console: the 15-node contrast violation is gone; the buttons and triggers stay named; 390px holds.

## [2.150.0] The header wraps too

The v2.149.0 re-audit's follow-up pass (lesson 64 in its purest form: the fix round's first live audit found what the pre-release audit could not, because the bigger failure had masked it).

### Fixed
- **The org console header wraps at 390px** (`org-console.tsx`): the right group — the `Mbumah Hardware Owner - STORE_OWNER` Badge plus the Global Chat button — was a no-wrap flex row whose min-content measured 419px, pushing the page to `scrollWidth` 435 at a 390 viewport. At v2.148.0 the branches table's 1012px had dominated and hidden it; the shell fix unmasked it. The group now carries `flex-wrap max-w-full min-w-0` and the long role Badge wraps inside itself (`whitespace-normal`), so the page measures 390 with the chip and button on their own lines.
- **The named scrollers carry their names legally** (`org-console.tsx`): both scroll wrappers took `aria-label` on a bare `<div>` — axe `aria-prohibited-attr` (the generic role may not be named). Both are now `role="region"` (the v2.148.0 pattern), so "Branches, scrollable table" and "People and payroll by branch, scrollable table" are announced instead of flagged.

### Verified
- 390px: `/org/dashboard` measures `scrollWidth` 390 (was 435 after the v2.149.0 shell fix, 1012 before it).
- axe: the org console's aria-prohibited-attr incomplete is gone; the contrast incomplete's remaining node is the known short-content family on data-dependent text.

## [2.149.0] The console fits the phone

The acceptance sweep moved onto the unified console pair and the org surfaces with axe-core 4.12 at desktop and 390px. The Organization Console broke the spec's "No horizontal scroll" line at 390px (measured `scrollWidth` 1012), the Expert Console carried two unnamed filter comboboxes (axe `button-name`, critical) and a contrast cluster across its store cards, and the org console's own amber family passed only on large-text margins. Every finding is fixed at its root — the deepest one at the shared shell, so both consoles inherit it.

### Fixed
- **The 390px width contract holds on the org console** (`unified-console.tsx`, `org-console.tsx`): the branches table's ~978px intrinsic min-content propagated through the `overflow-x-auto` wrapper (a block scroll container does not zero its min-content contribution) into `<main>`, whose cross-axis auto margins (`mx-auto`) sized it to fit-content — the whole console rendered 1012px wide at a 390px viewport. The shell's `<main>` now carries `w-full min-w-0` (it stretches to the container; `max-w-7xl` still caps desktop), and both scroll wrappers carry `min-w-0` themselves. The table scrolls inside its panel; the page stays one screen wide.
- **The HR drill-down table escapes horizontally** (`org-console.tsx`): its wrapper was `overflow-y-auto` only — a six-column table with no horizontal escape (carried defect). Now `min-w-0 overflow-x-auto overflow-y-auto`.
- **The org console's amber family passes at cell size** (`org-console.tsx`, 5 mounts): `text-amber-600` measured 3.19:1 on the white card — the `text-xs` absence/expiry/low-stock cells need 4.5:1 (they are not large text), and the `text-xl` KPI value only cleared large-text 3:1 on a thin margin. All move to `text-amber-700` (4.52:1) with `dark:text-amber-400` preserved.
- **The Expert Console's filter comboboxes have names** (`panels.tsx`): the Recent Activity Timeline's Action and Role triggers were the axe `button-name` critical pair — unlabeled Radix triggers (the v2.147.0 lesson: the name goes on the `SelectTrigger`, never the Select root). Now `aria-label="Filter timeline by action"` / `"Filter timeline by role"`.
- **The store cards' chip and meta text clears the bar** (`console/page.tsx`): the 9px ACTIVE chip moved `text-emerald-600` → `text-emerald-700` (3.65 → 5.0:1), the inactive chip and the `KES 0 · 0 txns` meta line moved `text-slate-400` → `text-slate-500` (2.9 → 4.76:1).
- **The light-surface slate family is swept** (`panels.tsx` ×19, `kpi-row.tsx` ×10, `store-matrix.tsx` ×6): the axe incomplete's biggest class — `text-slate-400` at 10–12px on white — moves to `text-slate-500` across the alerts/queue/timeline/chat/live-feed/desk-activity panels, the KPI row's sub-lines and trend-dial labels, and the matrix's store meta. `dark:text-slate-400` pairs are preserved verbatim (slate-400 is the correct bright token on dark). The matrix's data-zero placeholders move `text-slate-300` → `text-slate-500` (1.97:1 was a hard fail on real content).
- **The Welcome banner clears 4.5:1 across its whole gradient** (`dashboard-tab.tsx`): the white h1's worst corner measured 2.54:1 over the gradient's `#10b981` light end — the end darkens one step to `#047857` (white on it computes 5.49:1), carried from v2.148.0's incomplete list.

### Added
- **The branches table leaves as CSV** (`org-console.tsx`, `lib/org/branches-csv.ts`): the org console's Branches section gains **Export CSV** — surface parity with the Store Intelligence Matrix's export. A pure builder (`buildBranchesCsv`) emits the documented column header, raw numbers (no thousands separators, so spreadsheets re-import them as numbers), RFC-4180 quoting (commas and quotes in branch names never break a row), and a generated-stamp header line; the download is a client-side blob named `branches_YYYY-MM-DD.csv` with a polite `aria-live` confirmation naming the file.
- **Scroll regions are keyboard-reachable on the org console** (the v2.148.0 rule, applied where the wrappers now actually scroll): the branches table wrapper and the HR drill-down wrapper take `tabIndex={0}` with honest `aria-label`s and `focus-visible` rings.
- **`docs/payroll-run-lifecycle.md`** seeds the v2.18.9 phase's landing pad with the four contracts that already ship: gate, accessibility (v2.147.0), shell (v2.148.0), width (v2.149.0), contrast.

### Verified
- axe re-runs on the audited renders: `/org/dashboard` 0 violations (was 0 + a 2-node incomplete whose family is now token-passing), `/console` 0 violations (was 2 — the critical button-name pair + the 10-node contrast cluster), `/org/desk-report` 0 violations.
- 390px: `/org/dashboard` measures `scrollWidth` 390 (was 1012); `/console` and `/org/desk-report` hold at 390.

## [2.148.0] The shell meets the bar

The acceptance sweep moved to the surface every user lands on — the authenticated org shell (sidebar, top bar, dashboard) — with axe-core 4.12 at desktop and 390px. The HR surfaces came back clean (the v2.147.0 header fix propagates from the shared layout; `/hr/reports` measured 0 violations, every input labeled, all ten report tabs visible at 390px), but the shell itself was carrying real debt: ten colour-contrast failures, two keyboard-unreachable scroll regions, and a family of names sitting on roles that may not carry them. Every finding is fixed at its root token, and two keyboard affordances join the shell.

### Fixed
- **Notification count badges pass on their own token** (`app-sidebar.tsx` ×2, `top-bar.tsx`): white on `bg-red-500` measured 3.8:1, and the `animate-pulse` let axe catch a mid-dimmed frame at 2.44:1 — a badge that fails contrast for half of every pulse cycle was never passing. Critical is now white on `bg-red-600` (4.83:1) with the pulse dropped (the bounce-in entrance already announces); the warning variant reads `text-slate-950` on `bg-amber-500` (8.65:1) instead of white on amber (2.15:1). Same contract at all three mount points (expanded rail, collapsed rail, top bar bell).
- **The dark rail's quiet text clears the bar** (`app-sidebar.tsx`): section labels (`MAIN`, `SALES & CREDIT`) and the F2–F5 kbd hints move `text-slate-500` → `text-slate-400` — 3.74:1 was a violation on 10px text; 6.6:1 keeps the hierarchy.
- **The dashboard's muted-on-white family clears the bar** (`dashboard-tab.tsx`, 25 sites): `text-slate-400` on white measured 2.63:1 — chart y-axis and hour labels, donut "today" and legend amounts, empty-state second lines, list timestamps, rank numerals, footer notes — all move to `text-slate-500` (4.75:1). "All stock healthy" moves `text-emerald-600` → `text-emerald-700` (3.65 → 5.5:1). The zero-sales trend badge moves to `text-slate-600` on its `bg-slate-100` pill (2.4 → 7.0:1).
- **Scroll regions are keyboard-reachable** (axe `scrollable-region-focusable`, ×2 live on the dashboard + one latent in the search panel): the recent-sales, system-activity, customer-rankings and urgent-alerts lists are plain `<ul>`s — no focusable child, so keyboard users could never scroll them. Each gains `tabIndex={0}` with an honest `aria-label` and a `focus-visible` ring so the affordance is visible; the top bar's search results panel gets the same treatment (its empty state has no focusable children either).
- **Names move onto roles that may carry them** (axe `aria-prohibited-attr`): the non-interactive KPI cards rendered `aria-label` on a bare `<div>` — the generic role prohibits naming — and now spread `role="group"` (the interactive variant keeps its `role="button"` + keyboard handler); the zero-sales badge takes `role="note"` (the v2.147.0 pattern) so its full coaching line is announced; the top bar's live clock takes `role="timer"`, the ARIA role for an incrementing time display, so "Current date and time" is a legal name; the alert popup host's viewport takes `role="region"` for the same reason.
- **The live re-audit caught its own stragglers** (re-run on the rebuilt build before release): the org console's branch summary hint rode `text-muted-foreground/80` — 3.61:1 on the muted toggle, and even full `muted-foreground` computes ~4.4:1 there — now `text-slate-600` (~7:1); the alert viewport's name became a legal one (`role="region"`); the shell footer's alpha-muted family (version label `/50` at 2.1:1, the online-status chip and the Shortcuts button `/60` at 2.51:1) moved to full `muted-foreground` (~4.6:1) with the Shortcuts hover strengthening to `text-foreground`.

### Added
- **The skip link** (`main-app.tsx`): `Skip to main content` is the shell's FIRST focusable element — hidden until focused (`sr-only` / `focus:not-sr-only`), surfaced as a dark pill top-left on first Tab, and Enter moves focus into `<main id="main-content" tabIndex={-1}>`, past the sidebar and the ten-link top bar. `tabIndex={-1}` on the target makes focus truly LAND there (arrow keys scroll the content region) instead of the browser scrolling silently while focus stays behind.
- **The New Payroll Run dialog's "Last run" chip wears the outcome dot** (`payroll-picker-attempts-dot`): the same `aria-hidden` tone dot the runs-table headers (v2.146.0) and the gate card's period picker (v2.144.0) speak — emerald PASSED, amber BLOCKED, muted otherwise — so "what did the gate last say?" reads the same way on every surface. The chip's own words still carry the outcome for assistive tech.

### Verified
- axe-core re-run on the audited render: the ten contrast violations and both scrollable-region violations clear; the aria-prohibited-attr family is reduced to the reviewed-passing remainder (decorative `aria-hidden` nodes).
- The shell at 390px measures `scrollWidth` 390 (no horizontal scroll), and `/hr/reports` holds the spec line at both 390px and desktop with axe clean (0 violations, 27 passes).

## [2.147.0] The gate passes the keyboard

The EMS spec's acceptance lines name two things every surface must hold: "No horizontal scroll on supported viewports" and "Accessibility passes". A scoped sweep over the HR workspace (axe-core 4.12 on the desk and the payroll page, plus a manual keyboard-only walk) found the ten-link header nav was the single unclipped element pushing every HR page to 1141px at 390px width, the desk's period picker read to assistive tech as an unnamed button, and the split line's `aria-label` sat on a role that may not carry one. All three are fixed at their root; nothing else moved.

### Added
- **The header wraps instead of the page scrolling** (`(shell)/hr/layout.tsx`): the header row swaps its fixed `h-14` for `min-h-14 flex-wrap`, and the nav itself wraps (`flex-wrap justify-end`) — at 390px the links drop to their own row with every item visible and tappable (no hidden overflow, no scrollbar affordance to discover), and desktop is untouched. Nav links compact slightly on phones (`text-[13px] px-2.5`) and keep their desktop size from `sm:` up.
- **The desk's controls wrap** (`hr-timesheet` toolbar): the picker, batch door, lens trio, CSV and refresh held one 726px row that only fit a desktop; `flex-wrap` lets them settle into tidy rows on phones.
- **The desk's approval table gains the shadcn scroll wrapper**: the table measured 398px against a 390px phone — an 8px creep from `whitespace-nowrap` cells that scrolled the PAGE. Inside `relative w-full overflow-x-auto` the creep scrolls the table's own strip, and the page never does (the payroll runs table already had this wrapper).

### Fixed
- **The desk's period picker is named** (axe `button-name`, critical): the `aria-label` sat on the `Select` root, which Radix never forwards to the trigger button — axe read `hr-timesheet-scope-picker` as an unnamed button and a screen reader announced "October 2026" with no idea what the choice was for. The label moves onto the `SelectTrigger` itself ("Scope the timesheet desk to a payroll period"); the dead root attribute is removed. The payroll page's own triggers were already label-associated and stay untouched.
- **The split line may carry its name** (axe `aria-prohibited-attr`, serious): `aria-label` on a plain `<span>` is prohibited by the ARIA `generic` role, and axe's support matrix additionally wants an explicit role before trusting a label on a `p` ("not well supported on a p with no valid role attribute"). The `hr-timesheet-split` element becomes `<p role="note">` (`m-0 inline-flex`) — `note` is the section role for content ancillary to its neighbours, which is exactly what the split is beside the total chip, and it accepts author naming — so the full words ("2 pending days — 1 weekday · 1 weekend") reach assistive tech through the front door.

### Verified
- Keyboard-only path on the desk, live: Tab reaches every control in DOM order; Enter toggles the lens trio; the scope picker opens with Enter, arrows through periods, and commits with Enter (the scope line re-speaks honestly); the approve buttons are reachable and focus-visible rings read on every control (`:focus-visible` confirmed matching by probe).
- axe-core full-page re-run: the critical `button-name` and serious `aria-prohibited-attr` findings clear; the remaining `color-contrast` incompletes were probed numerically and pass (the design system's `muted-foreground` on card computes ≥ 4.5:1 — axe could only not resolve the alpha backgrounds).

## [2.146.0] The table wears the same dots

The picker's period dots (v2.144.0) and the desk's day-kind counts lived on different pages than the questions they answer: the runs table's collapsed header said nothing about what the gate last said, and the desk's count chip hid the weekday/weekend shape the lenses imply. Both answers move onto the surfaces where the questions arise. Pure layer + two pages + one docs line: no new fetch, no new endpoint.

### Added
- **The runs table's period outcome dots** (`payroll-period-gate-outcome`): each period group's header wears its last prepare-attempt outcome as a tone dot — emerald PASSED, amber BLOCKED, muted otherwise — the picker's own dot (same classes, same `title` pattern, `aria-hidden` decoration) riding the table's collapsed state. ONE definition of "last": the SAME `listTimelinePeriods` computation the picker reads (clock-based, `summarizeGateTimeline` inside), looked up by the group's own period name. Honest absence: a period with no labeled attempts in the window (or a failed timeline read) wears nothing.
- **The toggle's aria-label carries the word**: `…payroll period — last gate attempt BLOCKED` when the trail holds an outcome, so screen readers get what the dot shows.
- **The desk's split line** (`hr-timesheet-split`): the two counts the lens trio implies, printed under the total chip, always visible without lensing — weekday count beside a Briefcase icon in the weekday chips' amber, weekend count beside a Sun icon in the weekend chips' sky, separator muted, `tabular-nums` throughout. The `aria-label` speaks the full words ("2 pending days — 1 weekday · 1 weekend"); the `title` names the honesty rule.
- **`deskDaySplit` + `deskSplitLabel`** (`attendance-desk.ts`): the split composes `deskWeekdayDays`/`deskWeekendDays` themselves — ONE definition of each kind, never a second parser. Garbage days count in NEITHER bucket (the total chip keeps speaking the whole row); a lone kind speaks alone; an all-garbage row renders no split at all; non-array reads zero, never a guessed pair.

### Changed
- `docs/PAYROLL_LEDGER_ZERO_RUNS.md` gains a "Related contracts" section pointing at `docs/hr/payroll-run-lifecycle.md`'s "Gate surfaces and contracts" — the gate family's honesty rules live one link away from the ledger drawer's doc.
- The desk's "Pending days" cell stacks the count chip and the split line (`flex flex-col items-start gap-1`); nothing else in the row moved.

## [2.145.0] The desk lens learns weekdays

The weekends-only lens (v2.140.0) answered "who worked the weekend?"; the mirror question — "show me just the working-week days" — still needed an eyeball. The lens completes the pair as a three-way day-kind filter (the gate card's outcome trio's own shape), and the persisted preference grows without abandoning old browsers. Pure layer + desk only: no new fetch, no new endpoint.

### Added
- **`deskWeekdayDays`** (`attendance-desk.ts`): `deskWeekendDays`'s honest sibling — valid non-weekend days, order preserved. Garbage drops from BOTH day-kind lenses (an unreadable day belongs to no day-kind view and only to All) and stays counted in the row's total chip either way.
- **The day-kind lens trio** (`hr-timesheet-lens{-all,-weekends,-weekdays}` on the desk): the joined segmented control in the toolbar — ALL neutral, WEEKENDS sky (the weekend chips' own tint), WEEKDAYS amber (the weekday chips' own tint). Each member speaks `aria-pressed` and its own label; the count chip keeps speaking the row's total (a view, never a rewrite).
- **`DeskLensPref`** (`'all' | 'weekends' | 'weekdays'`): the persisted preference's three-value era. The storage KEY is unchanged; the legacy boolean `'1'` still reads `'weekends'` — a reader who chose the weekend lens keeps it across the upgrade, never a silent reset. `'all'` REMOVES the key (the old turn-off's own no-litter rule); a dead storage reads All, never a crash.

### Changed
- The desk's strip composes through the three-way ternary BEFORE the strip builder, so the `+N` overflow stays honest about exactly what the lens shows on every path; the strip's `data-lens` marker carries the lens word (`weekends`/`weekdays`).
- Both honest empties keep their own voices: "no weekend days" and "no weekday days" — a row that has none of the lensed kind says so rather than vanishing.
- `docs/hr/payroll-run-lifecycle.md`: the desk-surface contract names the day-kind lens and the legacy-`'1'` migration rule.

## [2.144.0] The lens learns the other outcome

"Show me the stops" got a lens (v2.142.0); the mirror question — "show me the times the gate said YES" — still had to be scanned by eye. The blocked-only boolean becomes a three-way outcome lens, and the period picker's items wear each period's newest attempt's outcome as a tone dot. Pure-layer only plus the card: no new fetch, no new endpoint.

### Added
- **The outcome lens trio** (`GateTimelineLens` + `gateTimelineLensFilter` in `gate-timeline.ts`, `payroll-gate-timeline-lens{-all,-blocked,-passed}` on the card): the joined segmented control in the card's rounded-full quiet-control family — ALL is the neutral unfiltered view, BLOCKED wears its own rose family, PASSED its own emerald family (the row badges' own tones — the lens dresses as the rows it keeps). Each member speaks `aria-pressed` and its own label; the header chip keeps speaking the route-built ALL count.
- **The picker's outcome dots** (`payroll-gate-timeline-period-outcome`): each period item wears its newest attempt's outcome as a tone dot — emerald PASSED, amber BLOCKED, muted otherwise — with the word in the `title` (the dot is `aria-hidden` decoration; the option's text still announces the period and its attempt count).
- **Per-period last outcome** (`GateTimelinePeriod.lastOutcome`/`lastAtIso`): computed through `summarizeGateTimeline` itself — ONE definition of "last outcome" everywhere on the card, clock-based, ties falling back to the route's deterministic array order.

### Changed
- `scopeGateTimeline`'s lens option is now `lens: 'all' | 'blocked' | 'passed'` (was `blockedOnly: boolean`); `filterGateTimeline` is superseded by `gateTimelineLensFilter`. The UNKNOWN rows survive ONLY under `all` — an unreadable outcome is honestly neither passed nor blocked, so neither lens may claim it. A garbage lens degrades to the unfiltered view, never a guessed filter.
- **The lens-empty note speaks the PASSED voice**: "No passed attempts in this period/window — the attempts on record were stopped or unreadable." The scope-empty (amber) guard now reads the lens state explicitly (`timelineLens === 'all'`).
- Both composition sites (the card memo and the export) read `lens: timelineLens` — one state, one truth; a Passed-only CSV is the audit artifact, filtered by the same rules the card shows.

## [2.143.0] The story scopes itself

The lens (v2.142.0) answered "show me the stops"; it could not answer "what did the gate do in OCTOBER". The read (v2.141.0) already carries each run's payroll period name, so this release makes the story scope itself — no new fetch, no new endpoint: a pure period list, a pure period ∩ lens filter, and an export filename that says when the story is scoped.

### Added
- **The period scope** (`listTimelinePeriods` + `scopeGateTimeline` in `gate-timeline.ts`, `payroll-gate-timeline-period-picker`): a client-side picker of the periods present in the current window, first-appearance ordered (the route feeds newest-first, so the picker lists the newest period first), each item speaking its own attempt count. "All periods" is a real option — unlabeled runs never vanish from the view, they only step aside when a period is picked. Rendered only when the window actually contains a labeled period: a one-period store never wears a dead control.
- **The scoped count line** (`payroll-gate-timeline-scoped`): when a period is picked, the pure summarizer re-runs on the scoped set and its counts wear their own quiet line — attempts · runs · last outcome — while the header chip keeps speaking the route-built ALL count (a view preference never rewrites the whole story).
- **Row-label scoping** (`payroll-gate-timeline-run-N`): any row's period label scopes the card on click — the story narrows itself from the row you are reading, with hover underline, focus-visible ring, and a per-period aria-label.

### Changed
- `scopeGateTimeline` is the card's ONE composition point (period ∩ BLOCKED lens): the scoped set feeds the rows, the show-all bound, the scoped line, and the export alike. With both dimensions off it returns a copy — the caller's array is never mutated; an unknown period is an honest empty, never a silent unscoped view.
- **The export follows both dimensions** and the filename says it (`gateTimelineCsvFilename`): a scoped export downloads `gate-activity-<period-slug>-YYYY-MM-DD.csv` so a scoped file and the full-window export never look alike in a downloads folder; the clock is injected (the consent filenames' own pattern). The whole-window-never-viewport contract is unchanged.
- **Both honest empties keep their own voices**: a scoped set that empties (the period stepped outside the bounded window) speaks amber ("No attempts from this period inside the current window — the read is bounded…"); the lens-empty stays rose and now names the period when one is picked ("No blocked attempts in this period — every prepare got through.").
- `docs/hr/payroll-run-lifecycle.md`: the store-timeline contract names the period scope.

### Tests
- `src/tests/gate-period-v2143.test.ts` (21): the period list (distinct labels, first-appearance order, DISTINCT runs per period, unlabeled rows never invent an entry, non-array), the scope filter (either dimension alone, both intersect, order preserved, copy semantics, unknown period → [], non-array), the filename (unscoped shape, slug discipline, injected clock), the card contract (picker presence, route-built chip, scoped line, one composition point, export scope + filename, row-label click, both empties), and the pure module's head.
- `scripts/verify-v2-143-0.mjs` (fresh).
- `console-changelog` unread counters re-anchored for 2.143.0 joining the feed.

## [2.142.0] The activity answers back

The Gate activity card (v2.141.0) kept the whole story readable but not workable: a manager hunting the stops scanned every PASSED row by eye, and the audit story could not leave the screen. And the New-run picker — which already wears the gate's pending counts (v2.137.0) — said nothing about what happened the LAST time someone prepared the selected period. This release gives the card a lens and a print door, and the picker its parity chip.

### Added
- **The blocked-only lens** (`filterGateTimeline` + `payroll-gate-timeline-blocked-only`): one toggle filters the card to BLOCKED attempts — aria-pressed speaks the state, the rose family when on (the BLOCKED outcome's own family, dark twins included). A view preference, not a data change: the summary chip keeps speaking ALL attempts, the lens composes BEFORE the show-all bound ("Show all N" speaks what the lens shows; a PASSED row can never smuggle into a blocked-only view), and a window with no blocked attempts renders an honest rose note ("every prepare got through") rather than an empty card.
- **The gate activity CSV export** (`buildGateTimelineCsv` + `escapeGateCsvCell` in `gate-timeline.ts`, `payroll-gate-timeline-export`): the RFC 4180 family's newest member (after discipline-ledger, discipline-list, and the timesheet desk). Header pinned `attempted_at,period,run_status,outcome,verdict,actor` — counts and verdicts, never employee codes or pay fields (the verdict text speaks counts, not identities, so an export can never become a surveillance list). CRLF, quote-on-need, double embedded quotes, nulls export empty (an unreadable clock exports '', never a guess), and the serializer NEVER re-sorts: what the card shows is what prints. The export carries the WHOLE window the read returned — never the 8-row viewport (a display bound must never silently truncate an audit artifact) — with the lens applied. Client-side blob (`gate-activity-YYYY-MM-DD.csv`), the desk export's own pattern; disabled while loading or when the visible set is empty.
- **The picker's last-run attempts chip** (`payroll-picker-attempts-chip`): the SAME `buildGateAttemptChip` the runs table wears, now under the New-run picker's gate preview line for the SELECTED period — built from the runs the page already holds (the list is createdAt-desc, so the first match is the newest), ZERO new fetch. Tone follows the last outcome (emerald/amber/muted); honest absence: a period with no runs, or a pre-v2.138 run with no trail, renders nothing — the chip never invents an attempt.

### Changed
- `docs/hr/payroll-run-lifecycle.md`: the store-timeline contract now names the lens (view preference, composes before the bound) and the export contract (whole window, never the viewport; counts and verdicts only).

### Tests
- `src/tests/gate-activity-v2142.test.ts` (19): the serializer (header pin, CRLF, quote matrix, no-sort, empty-cell honesty, junk-row skip), the lens filter (order preserved, UNKNOWN never passes, non-array), the card contract (aria-pressed + rose family + dark twins, lens-before-bound composition, lens-empty note, export disabled-when-empty, window-not-viewport pin), and the picker chip (from memory, honest absence, parity with the table's chip).
- `scripts/verify-v2-142-0.mjs` (12 checks, written fresh).
- `console-changelog` unread counters re-anchored for 2.142.0 joining the feed.

## [2.141.0] The gate tells its story across runs

The gate's history lived inside each run: the dialog told one run's trail, the table counted one run's attempts — but "how has the gate behaved across every run?" meant opening run after run. And the desk's weekends-only lens (v2.140.0) reset on every navigation, so an anomaly hunt meant re-toggling all morning. This release reads the trail across runs and lets the lens keep its preference.

### Added
- **The store gate timeline** (`buildGateTimeline` + `summarizeGateTimeline` in `src/lib/hr/payroll/gate-timeline.ts`, served by `GET /api/payroll/gate-timeline`): the SAME append-only `PayrollRunGateEvent` rows read ACROSS runs — newest 120, with run period/status context attached in the same read, actor labels resolved in the ONE-query fallback ladder (name → email → 'Unknown user'). Movement is computed CHRONOLOGICALLY (the caller feeds oldest-first): a verdict moves from the attempt before it, whatever run each belonged to — a run boundary does not reset the comparison. Window honesty: the payload says `window: 120` and `totalEvents`, so the card can never pretend it saw more than the read took. Read-only; store-scoped; rides the gate read-right quartet (`hr.payroll.read.all` × HR_MANAGER/BRANCH_MANAGER/STORE_OWNER/ACCOUNTANT).
- **The Gate activity card** (`payroll-gate-timeline` on /hr/payroll): newest-first rows with outcome badges (emerald/amber/muted families, dark twins), the frozen strip's exact verdict words, the sky `moved` pill where the verdict changed, EAT stamps + actor + run label + run status in tabular-nums, a summary chip ("N attempts · M runs · last PASSED"), its own Refresh, and best-effort degrade BY DESIGN — a timeline failure wears the card's rose error + Retry, never the page's. Honest states: skeleton while loading, an emerald "no gate attempts on record yet" for a store that has never prepared, a "Show all N attempts" toggle past eight rows, and a window line when the ledger outgrew the read.
- **The lens keeps its preference** (`readDeskLensPref`/`writeDeskLensPref` + `DESK_LENS_STORAGE_KEY` in `attendance-desk.ts`): the weekends-only lens persists per browser over localStorage — guarded reads degrade to OFF (never a crash), turn-off REMOVES the key rather than littering a stale `0`, and the toggle's title now says the lens keeps its setting.

### Changed
- `docs/hr/payroll-run-lifecycle.md`: the gate-contract section now names the store timeline (movement chronologically across runs, bounded window spoken, best-effort card) and the lens's persistence contract alongside the existing six surfaces.
- The run dialog's `onChanged` now also re-reads the gate activity — a prepare/submit/approve that moved the trail refreshes the card alongside the table.

### Tests
- `src/tests/gate-timeline-v2141.test.ts` (24): the pure builder (chronological movement, cross-run movement never resetting, garbage rows degrading, junk dropping), the summary rollup (counts, distinct runs, last outcome by clock), the lens prefs (read/write/exception guards, key removal), the route (guard quartet, store scoping, desc→chronological reversal, window honesty), the card contract (newest-first render, moved pill, summary chip, empty/error/skeleton, toggle, refresh wiring), and the desk lens contract (init from storage, persist on flip).
- `scripts/verify-v2-141-0.mjs` (12 checks, written fresh).
- `console-changelog` unread counters re-anchored for 2.141.0 joining the feed.

## [2.140.0] The desk finds its weekends

The weekend tint (v2.138.0) made a Saturday punch stand out, but a long strip still buried it — a Monday-morning review asking "who worked the weekend?" had to count sky chips by eye. And the run dialog's frozen-verdict strip (the dialog's counterpart of the table's verdict chip) went without the compact attempts surface the table has worn since v2.139.0. This release gives the desk a lens and the strip its chip.

### Added
- **The weekends-only lens** (`deskWeekendDays` + `hr-timesheet-weekends-only`): one toggle filters every desk day strip to its real Sat/Sun date-onlys, in order, garbage never passing (`deskDayIsWeekend` is the only gate). The lens composes BEFORE `deskDayStrip`, so the `+N` overflow stays honest about exactly what the lens shows — a hidden weekday can never smuggle into the count. A row with no weekend days renders an honest "no weekend days" note (`hr-timesheet-strip-empty`) rather than vanishing; the amber count chip keeps speaking the row's total, because the lens is a view preference, not a data change. The toggle speaks `aria-pressed`, wears the sky family when on (the weekend chips' own family, dark twins included), and is disabled only while the pending read is in flight — scopes and receipts never clear it.
- **The attempt chip on the dialog's frozen-verdict strip** (`payroll-run-gate-attempts-dialog`): the same `buildGateAttemptChip` surface the runs table wears, now beside the frozen verdict it belongs to — built from the `gateTrail` the dialog already holds (no extra fetch). Tone follows the last outcome (emerald/amber/muted); a run with no trail renders nothing (the chip never invents an attempt); the History icon + title point at the full Gate trail directly below.
- **The gate contract section** (`docs/hr/payroll-run-lifecycle.md`): all six gate surfaces named in one place — frozen verdict (v2.135.0), gate trail (v2.138.0), attempt chip (v2.139.0/v2.140.0), timesheet desk (v2.136.0), batch receipt (v2.139.0), weekends-only lens (v2.140.0) — each with its honesty rule (append-only, same clock, never a bulk write path, never a guessed count).

### Tests
- `src/tests/desk-lens-v2140.test.ts` (14): the lens's pure half (order, garbage exclusion, junk-input degradation ×3), the lens-over-strip composition (off = v2.136.0 behavior untouched, on = weekends only with honest overflow, weekend-heavy rows, no-weekend honesty ×4), the dialog chip (trail-built, inside the strip, honest absence, trail-pointer title ×4), the desk UI contract (aria-pressed + sky family, composition pin, lens marker + empty note, loading-only disable ×4), and the docs contract pins (six surfaces + the trail's core promises ×2).
- `scripts/verify-v2-140-0.mjs` (11 checks, written fresh).
- `console-changelog` unread counters re-anchored for 2.140.0 joining the feed.

## [2.139.0] The table counts the attempts

The v2.138.0 trail lived only inside the run dialog — the runs TABLE (the surface managers actually stare at) still answered "what did the gate say" without "how many tries did it take". And on the desk, a Monday-morning backlog meant one click-wait per employee. This release puts the count on the table and gives the desk a batch door.

### Added
- **The attempts chip on the runs table** (`payroll-run-gate-attempts`): beside the frozen verdict, `buildGateAttemptChip` speaks `1 attempt · last PASSED` / `N attempts · last BLOCKED` from the run's own trail — count via the list route's `_count.gateEvents` (one query, no per-run fetch), outcome via the newest-clock row (createdAt breaks ties). Tone follows the outcome (emerald/amber/muted UNKNOWN); honest absence: zero rows, null, or a non-positive/garbage count renders NOTHING, never a guessed attempt. The chip and the verdict sit in one flex-wrap row (no collision on narrow screens), the History icon + title point at the dialog's full trail.
- **The desk's "Approve all"** (`hr-timesheet-approve-all`): walks EVERY pending row through the ONE audited per-employee approve service — client-side sequential loop, same URL, same body shape, NEVER a new bulk write path. Failures never abort the walk; the label keeps an honest count ("Approving 2/6…"); single-flight both directions (the batch rides `approvingId`, so every single button and the batch itself disable while anything is in flight).
- **The batch receipt** (`buildBulkApproveSummary` in the desk's pure module): one strip, three tones — full success ("Approved 3 days across 2 employees."), partial ("Approved 2 days for 1 of 3 employees — 2 approvals failed; retry from their rows." with a line per loser: code, name, reason), total failure ("No approvals landed — nothing was approved."), and the raced-batch honesty ("Nothing left to approve — every listed day was already approved."). Null when the batch never ran.

### Changed
- `GET /api/payroll/runs` grows the additive trail surface: `gateAttemptCount` + `gateLastOutcome` per run (the read stays read-only and store-scoped); the page's `PayrollRunDto` carries both optional/null-safe.
- The desk clears BOTH notes on a scope change — an old receipt never describes new data.

### Tests
- `src/tests/run-attempts-v2139.test.ts` (24): the chip builder (singular/plural, UNKNOWN degradation, honest absence ×6, numeric strings, purity), the receipt builder (full/partial/total/raced/empty), the runs route (count + newest-clock outcome pins, read-only pin), the table chip (beside-the-verdict wrap, tone families + dark twins, dialog-pointer title, additive DTO), and the desk batch (exact single-approve contract ×2, single-flight, honest progress label, receipt testids, notes cleared on scope change, end-of-batch refetch).

## [2.138.0] The verdict keeps its every attempt

The v2.135.0 snapshot froze THE verdict on the run — but it refreshes in place, so "how did the verdict move between attempts" evaporated on every re-prepare. And on the timesheet desk, a Saturday punch wore the exact same chip as a Tuesday one. This release gives the verdict a memory and the weekend a tint.

### Added
- **The gate verdict trail** (`PayrollRunGateEvent`, append-only): every prepare attempt appends ONE row — outcome (`PASSED`/`BLOCKED`), the SAME clock the run's snapshot froze (`blockedAt`/`passedAt` shared between snapshot and trail row), prepare's own tally (`gateTally`, parity by construction), and the actor. The blocked path appends alongside its snapshot update; the passing path appends INSIDE the re-prepare transaction (one moment, two records, nothing lost to a crash between them). Rows are never updated or deleted — re-prepare attempts stack up honestly.
- **The trail in the run dialog**: a "Gate trail" block under Run history, oldest first — outcome chip (emerald PASSED / amber BLOCKED / muted UNKNOWN), the frozen strip's own words via the v2.135.0 parser, the EAT stamp, the actor, and a sky **"moved"** marker on the row where the verdict text differs from the attempt before it (the whole point, surfaced). Honest absence twice over: no trail renders nothing; a PRE-v2.138.0 PREPARED run gets one dashed note that it predates the trail.
- **The pure trail builder** (`src/lib/hr/payroll/gate-trail.ts`): `buildGateTrail` never dedupes (two identical attempts are two rows — that IS the history), tolerates garbage (an unreadable summary still speaks, muted, "Verdict unreadable"; an unreadable clock says so; unknown outcomes wear UNKNOWN; junk ids drop), and marks movement by comparing consecutive verdict texts.
- **The weekend tint** (timesheet desk): `deskDayIsWeekend` (Sat/Sun through UTC parts) + `deskDayStrip` grows a parallel `shownDays` array (additive — labels and days stay aligned), and weekend chips wear the sky family with an honest title ("Sat 17 — weekend day") — an anomaly spotlight, not a judgement.

### Changed
- `GET /api/payroll/runs/[id]` grows the additive `gateTrail` block: one read, store-scoped, oldest-first, capped at 50, actor labels resolved in the SAME one-query actor map, best-effort (a trail failure empties the block, never the run view).
- The v2.135.0 freeze tests re-anchor to the shared-clock spelling (`blockedAt`/`passedAt`) — the contract they pin (both paths stamp the snapshot) is unchanged; v2.138.0 just gives each stamp its trail sibling.

### Tests
- `src/tests/gate-trail-v2138.test.ts` (22): the builder (order, movement marking, no-dedupe, garbage degradation, clock honesty, UNKNOWN outcomes, junk-id drops), the schema + both append points (shared clocks, in-tx pass, append-only pin), the detail route (oldest-first/cap/store scope, best-effort catch, pure builder + actor labels), the dialog (trail block, sky moved chip, outcome icons, absence note, additive prop), and the weekend tint (UTC correctness, parallel arrays, garbage exclusion, sky dark twins).
- `scripts/verify-v2-138-0.mjs` (13 checks, written fresh).
- `console-changelog` unread counters re-anchored for 2.138.0 joining the feed.

## [2.137.0] The picker sees the gate

The gate's pre-flight lived on the desks — the gate panel, the timesheet desk — but the prepare INTENT itself was blind: the "Start a payroll run" dialog listed periods with no hint of what the gate would later say. And the timesheet desk's pending list had no export door while its ledger siblings (case list v2.115.0, access ledger v2.118.0) both print. This release closes both gaps.

### Added
- **The gate preview rides the periods list** (`GET /api/payroll/periods`, additive `gatePreview`): pre-flight inside the prepare intent. The SAME unapproved + employee where as the run gate (run-gate.ts parity), fetched ONCE for the store (pending days are bounded — the desk exists to clear them) and bucketed per period in memory (`bucketPendingDays`, pure), so the list never runs one query per period. Consent is period-independent: ONE count (`consentRecord: { none: { withdrawnAt: null } }`) rides every row honestly — it would block any period's prepare. A preview failure degrades to `null`; the periods list never dies and the picker says "unavailable", never a guess.
- **The picker wears the gate** (`CreateRunDialog`): each period item carries the gate's own words as chips — rose "N missing consent", amber "N unapproved day(s)" (prepare's loop order: consent first) — mono, tabular numerals, dark twins; the selected item's chips carry into the trigger, so the intent starts pre-flight. Under the picker, a compact preview line (`gatePreviewLine`) names the consequence ("prepare would block until cleared"), and when unapproved days are pending it carries the amber door to `/hr/timesheets` (own tab, aria-labelled, the door family's fourth member).
- **The pending list prints itself** (`src/lib/hr/timesheet-desk-csv.ts` + desk toolbar): the RFC 4180 family's newest member — exact header pin (`employee_code, employee_name, pending_days, first_day, last_day, pending_dates`), CRLF, quote-on-need, double embedded quotes, `pending_dates` joined with ';' inside one cell, trailing newline. The serializer never re-sorts: what the desk shows is what prints. Honesty pin: the column set IS the desk row's column set — the row type has no field for pay data, so an export can never become a payslip preview or an approval by spreadsheet. Button disabled when nothing is pending; aria says "never pay data".

### Changed
- `PayrollPeriodDto` grows the optional `gatePreview` field (additive, null-safe for cached payloads).

### Tests
- `src/tests/timesheet-desk-v2137.test.ts` (24): the serializer (header pin, join/quote/escape matrix, empty export, no-sort pin), the preview math (bucketing, overlap double-count honesty, garbage degradation, chip order/plurals/silence, the three preview-line voices), the periods route (parity where, one-count consent, in-memory bucketing pin, null-degrade pin), the picker (chips, line, door, dark twins, additive DTO), and the desk export (rows-as-shown, disabled-when-empty, never-pay-data aria).
- `scripts/verify-v2-137-0.mjs` (12 checks, written fresh).
- `console-changelog` unread counters re-anchored for 2.137.0 joining the feed.

## [2.136.0] The second door finds its desk

The remediation door shipped in v2.135.0 had one leaf: a missing-consent row could walk to the Privacy tab's consent ledger, but a TIMESHEET_NOT_APPROVED row could only read its own explanation — the approve route was API-only, so the gate's second block had nowhere to be fixed from the UI. This release gives that block its desk.

### Added
- **The timesheet desk** (`/hr/timesheets`, new nav slot right after Payroll): one row per employee with unapproved timesheet days — code, name, a pending-day count chip, and the exact days as chips ("Mon 05", "Tue 06"…, overflow "+N more" — never a hidden day). Each row's Approve stamps that employee's whole pending range through the ONE `approveTimesheet` service (`POST /api/attendance/timesheets/approve`), buttons disable while one approval is in flight (no double-stamp), and the desk refetches after each stamp. Scope picker rides the payroll periods (newest OPEN period by default) with an "All pending days" escape; the scope line, pending total, and checked stamp speak in the gate's own words (`formatEatStamp`).
- **The pending read** (`GET /api/attendance/timesheets/pending`): the desk's data, gate-parity by construction — the same unapproved where (`checkIn: { not: null }`, `timesheetApprovedByUserId: null`), the same employee where (ACTIVE, not deleted, store-scoped), grouped by the pure builder in the gate's own `employeeCode asc` order. A `periodId` scopes the read to that period's dates; an unknown or cross-branch period is an honest 404 (`PERIOD_NOT_FOUND`, the gate read's mirror). Read-only by construction; rides the runs list's read-right quartet (`hr.payroll.read.all`, `HR_MANAGER`/`BRANCH_MANAGER`/`STORE_OWNER`/`ACCOUNTANT`).
- **The pure desk layer** (`src/lib/hr/attendance-desk.ts`): `groupUnapprovedByEmployee` (the gate's order, day sort + dedupe, missing code wears the em-dash), `deskDayLabel` ("Mon 19" through UTC parts — date-only semantics can never drift a day for a Kenyan manager), `deskDayStrip` (first 12 chips, honest "+N" that counts garbage days too), `deskRangeLabel` ("1 Oct – 31 Oct 2026"; the year prints once when shared). Garbage degrades, never guesses.
- **The second door** (gate panel): a `TIMESHEET_NOT_APPROVED` blocked row now carries its own amber door — `Timesheet desk` — deep-linking `?employee=<id>` (encoded), own tab, `rel="noopener noreferrer"`, aria-labelled with the person it fixes, the amber family the block code already wears. The consent door survives unchanged: one gate, two doors, same shape.

### Changed
- The desk answers the door's deep link: `?employee=<id>` highlights that row (amber ring, `aria-current`), a dismissible chip names the row the gate sent you for, and the param is stripped once on mount (the payroll `run=` param's own pattern) so a refresh never re-focuses a stale employee.
- HR nav grows a "Timesheets" slot between Payroll and Performance — the door's target sits adjacent to the door.

### Tests
- `src/tests/timesheet-desk-v2136.test.ts` (20): the pure grouping (gate order, UTC date-only reduction, dedupe, garbage degradation, em-dash fallback, name tie-break), the day strip (UTC weekday labels, overflow honesty, garbage counted-not-labeled), the scope line (shared/cross-year), the pending route (quartet, parity where, honest 404, read-only pin), the desk page (approve posts the range, in-flight disable, focus-param contract, honest states, styling contract), the gate door (deep link, amber family, consent door intact), and the nav slot.
- `scripts/verify-v2-136-0.mjs` (12 checks, written fresh): the route's parity strings, the desk's approve/focus/styling pins, the door's deep link, the nav slot, and the release discipline.
- `console-changelog` unread counters re-anchored for 2.136.0 joining the feed.

## [2.135.0] The verdict leaves a paper trail

The v2.133.0 gate door speaks the verdict live — but the verdict evaporated the moment it was spoken. Prepare's own gate evaluation left NO trace on the run it protected: a clear prepare proved nothing, and "what did the gate say when THIS run went through?" had only folklore for an answer. This release freezes the verdict onto the run record at prepare time, so the lifecycle's front door becomes auditable history.

### Added
- **The frozen gate verdict** (`PayrollRun.gateCheckedAt` + `gateSummary`, additive nullable columns): prepare's own loop now tallies the gate verdict it acted on — `{ total, clear, missingConsent, timesheetNotApproved, codes }` — and stamps it onto the run on BOTH paths. The blocked path freezes the stop alongside the persisted issues (`errorMessage`); the success path freezes the pass inside the re-prepare transaction (refreshed on every re-prepare). The snapshot is prepare itself — parity by construction, never a re-read; engine guardrails stay in `errorMessage`, the tally speaks only the gate's two words.
- **The pure verdict module** (`src/lib/hr/payroll/gate-verdict.ts`): `parseGateVerdict` is the tolerant reader — null for pre-v2.135.0 rows, arrays, malformed shapes, tallies that do not add up, or unknown codes; a garbage `checkedAt` degrades to null while the summary survives. `buildGateVerdictText` speaks the live panel's own words in its own order ("N clear · N missing consent · N timesheet pending"; zero counts never speak, and an empty month says "0 clear" — the truth even when awkward). `gateVerdictTone` is the wardrobe switch the UI keys emerald/amber off.
- **The remediation door** (gate panel): a `MISSING_CONSENT` blocked row now carries the door to where the fix lives — the Privacy tab's consent ledger (grant has lived there since v2.119.0). Own tab (`target="_blank"` `rel="noopener noreferrer"`), aria-labelled with the person it fixes, violet house styling with hover AND focus-visible affordances. A `TIMESHEET_NOT_APPROVED` block has no desk yet — it gets honest text, never a link that would 403 or 404.

### Changed
- The runs table wears each run's verdict under its status badge (the same slot the "waiting since" stamp speaks from): "5 clear · 19 Oct 12:30 EAT" in an emerald chip, block counts in amber — tabular numerals, dark twins, `ShieldCheck` mark. Runs prepared before v2.135.0 render NOTHING — honest absence, never a guessed history.
- The run detail dialog speaks the same frozen strip ("Gate at prepare: 5 clear · 12:30 EAT") with the staleness honesty line ("the live gate may have moved since"), and a pre-v2.135.0 prepared run gets one plain dashed note that it predates the paper trail.
- The runs list API exposes `gateCheckedAt`/`gateSummary` additively (null-safe for old rows); the detail API rides the whole-run payload unchanged.

### Tests
- `src/tests/payroll-gate-verdict-v2135.test.ts` (21): the tolerant parser (well-formed verdicts, pre-v2.135 nulls, arrays, impossible tallies, unknown/duplicate codes, garbage clocks), the verdict text (panel's words and order, honest zero, plurals), the tone switch, the freeze contract (both paths stamped, the tally's two-word vocabulary), the honesty contracts (UI parses through the builder, absence renders nothing, the dialog's strip + absence note), the remediation door (consent-branch only, own tab, aria family), and the styling contract (dark twins on both tones, tabular numerals, focus-visible rings).
- `scripts/verify-v2-135-0.mjs` (11 checks, written fresh): schema columns inside PayrollRun, the freeze on both paths, the additive list exposure, the parser-not-guess UI pins, the consent-only door, and the release discipline.
- `console-changelog` unread counters re-anchored for 2.135.0 joining the feed.

## [2.134.0] The gate opens onto empty months

The v2.133.0 pre-flight gate door rode the runs table's period headers — and the runs table only renders periods that HAVE runs. A freshly opened month (zero runs — every month's starting state) rendered nowhere, so the lifecycle's front door was locked exactly when it matters most: before the FIRST run of the month is prepared. This release unlocks it from the outside.

### Added
- **The pure empty-month builder** (`emptyPeriodRows` in `src/lib/hr/payroll/run-groups.ts`): given the periods the API knows and the groups the runs built, it names the periods the runs table will never render. Matching is by period NAME — the same key `groupRunsByPeriod` groups by (the house rule the grouping already stands on). Every row carries the period's REAL id (a run-less period has no run to borrow `payrollPeriodId` from — the header door's `runs[0]` trick has nothing to borrow from), its lifecycle status verbatim (an unknown or missing status degrades to `''` — the chip renders UNKNOWN, never a guessed state), and a deterministic newest-month-first order (startDate descending, name-ascending tie-break). VOIDED periods are NOT filtered out — the gate has an honest verdict for them. Pure: no db, no network, no env; wide DTOs flow through unnarrowed.
- **The pre-flight months section** (`src/app/(shell)/hr/payroll/page.tsx`): renders on the Runs tab only when a run-less period exists, below the runs ledger so the money table's story stays intact. Each row speaks the month's own words — name, a mono lifecycle chip (OPEN emerald / VOIDED amber / everything else muted ink), the date range and pay date in tabular numerals with an honest "pay date not set" fallback — and carries the SAME Gate door the period headers carry: same `ShieldCheck` affordance, same aria family (`Check the {period} run gate`), same single loader (`toggleGate` → `loadGate`), same `GatePanel` verdict with its clear/blocked/voided/failed states. The gate stays open under the row that opened it, keyed by the period's real id.

### Changed
- The gate is now one gate with two doors: the header rail door (periods with runs) and the pre-flight row door (periods without). Both share the loader, the panel, and the v2.133.0 parity-pinned verdict — no third implementation to drift.

### Tests
- `src/tests/payroll-preflight-empty-v2134.test.ts` (16): the pure builder (name-keyed filtering against the run groups, real period ids, verbatim status pass-through with honest degradation, newest-first ordering with the tie-break pinned, both empties honest — no periods → no rows, fully-run months → no rows, wide DTO unnarrowed) and the page contract (section renders only when a run-less period exists, the shared door rides `toggleGate(row.periodId, …)` — never the borrow trick, the honesty copy, the stable testid family, the UNKNOWN-not-guessed chip, the pay-date fallback) plus the styling contract (dark twins on every colored surface, tabular stamps, hover + focus-within affordances, the header-rail door letterform, and the inset panel's testid distinct from the table's).
- `console-changelog` unread counters re-anchored for 2.134.0 joining the feed.

## [2.133.0] The gate speaks first

The run's guardrails (consent, timesheets) always enforced themselves inside `preparePayrollRun` — but their verdict only surfaced AFTER a failed prepare attempt, as an amber card of issues. This release asks the SAME gates the SAME question BEFORE anyone tries: a pre-flight, read-only gate read per payroll period — the EMS spec Phase 4.6 lifecycle's front door.

### Added
- **The pre-flight gate read** (`src/lib/hr/payroll/run-gate.ts` + `GET /api/payroll/runs/gate?periodId=`): for one period, every active employee's gate verdict — consent gate (`withdrawnAt: null`), timesheet gate (`hasUnapprovedTimesheet`), evaluated independently, reported in prepare's own block order (`MISSING_CONSENT` first, then `TIMESHEET_NOT_APPROVED`). `deriveGateState` is pure: the first block in prepare's loop order is the state; an employee failing both gates carries both codes with nothing hidden, only ordered. The read mirrors prepare line for line — same employee where and order (`ACTIVE`, store-scoped, `employeeCode asc`), same consent where, same timesheet helper — and the parity is pinned by tests: if prepare's gates ever change, the pins fail and the desk must be re-mirrored. Read-only by construction (no create/update/delete, no run created, no payslip computed); an unknown or cross-branch period is an honest 404; a voided period is REPORTED as voided, not checked.
- **The Gate door on the period header** (`src/app/(shell)/hr/payroll/page.tsx`): a `ShieldCheck` "Gate" pill on the period header's right rail — beside the Ledger door, never inside the fold (the v2.100.0 rail rule). One loader, a fresh fetch per open (the consent drawer's openHistory pattern); the toggle closes the same door; Retry reuses the door's period. The verdict renders as an inset panel row under the header: counts speak first (`N clear · N missing consent · N timesheet pending · checked EAT`), a voided period gets its own amber strip ("This period is voided — runs are closed; the gate has nothing to gate."), a clear gate gets an emerald strip ("The gate is clear — prepare would proceed for all N active employees."), and blocked employees speak per-person in prepare's own words with a rose/amber mono badge, both codes visible when both fail ("prepare would report MISSING_CONSENT first"). A failed read renders an honest rose strip with a period-scoped Retry — never a silent spinner.

### Changed
- The runs route family gains a read-only sibling: the gate route rides the runs list's own read-right quartet (`hr.payroll.read.all` × HR_MANAGER / BRANCH_MANAGER / STORE_OWNER / ACCOUNTANT) — seeing the gate is part of reading the desk, not part of running payroll.

## [2.132.0] The columns bend, the branch files itself

Two beats, one desk: the consent ledger's export-honesty theme reaches its fourth door — the WHOLE branch files itself, every in-scope employee's consent cycles in one flat CSV built by the drawer's own serializer — and the reports tables learn to bend, closing the EMS spec Phase 4.8 acceptance's last unsatisfied table affordance (sticky headers, column visibility, CSV export and print PDF already shipped).

### Added
- **The branch-level consent export** (`src/app/api/hr/privacy/consent/export/route.ts`, `exportConsentTimelines` in `src/lib/hr/data-protection.ts`): GET behind the ledger's own guard trio (`hr.report.branch` × HR_MANAGER / STORE_OWNER / BRANCH_MANAGER — a branch-level extract is a view right taken broadly, never a decision right), read-only by construction, answering `text/csv; charset=utf-8` with an attachment disposition and `Cache-Control: no-store`. The service queries the ledger's own scope where (`deletedAt: null` + `employeeScopeWhere`, take 200), orders employees by lastName/firstName and each employee's consent records grantedAt-ascending, and serializes through `buildConsentTimelineCsv` — the drawer's own serializer whose row type already carries employee_code/employee_name, so the bulk file adds no column the drawer never showed. `consentTimelinesCsvFilename()` names the file `consent-timelines-{date}.csv`.
- **The Export-all door** (`src/app/(shell)/hr/reports/page.tsx`): a violet outline button beside the consent card's Refresh, rendered only when the ledger has rows (an empty ledger files nothing), carrying the honesty tooltip "One flat CSV: every in-scope employee's consent cycles — who, when, and what purpose. Never content." The fetch rides the cookie session; the filename comes from the Content-Disposition. A failed export speaks: a rose `role="status"` line — "The export could not be built — nothing was downloaded." — replaces the silence, and the button's busy state spins while the file builds.
- **The shared clock, extracted**: `stoodDaysBetween(grantedAt, withdrawnAt)` in data-protection.ts — whole days floored server-side, `null` while a consent stands, negatives clamped to 0. `listConsentHistory` and `exportConsentTimelines` both ride it (pinned: the day math lives exactly once).
- **Resizable columns** (`src/lib/hr/column-resize.ts` + the reports page): drag a column's right edge to resize, double-click the edge to reset. The mechanics are pure and unit-tested — `clampColWidth` (88–480 px band), `nudgeColWidth` (start + pointer travel, clamped), `loadColWidths` (a corrupted or foreign localStorage value degrades to an empty map, never a broken desk). The drag itself is delegated ONCE to the tabs container: a pointerdown within 8 px of a resizable th's right edge opens it, the move/up halves ride window listeners so a drag that leaves the table still lands, and hovering the band shows `col-resize`. Widths persist per browser in localStorage under their column key — two tables sharing a "Period" column share their width on purpose. All 59 data columns across the ten report tables are resizable; the two 2-column headcount breakdowns stay fixed by design (a resize affordance there is noise).

### Changed
- `listConsentHistory` refactored onto the extracted `stoodDaysBetween` — behavior identical, the clock now shared with the branch export.
- Every resizable TableHead carries `data-resize-key`, a live width style, and an edge tooltip ("Drag the right edge to resize · double-click the edge to reset"); a column never dragged renders exactly as before. The keyboard path to column control remains the visibility Select, as shipped.

## [2.131.0] The reports speak their failures

v2.130.0 taught the Privacy tab's three desks to speak; the other eight report loaders still caught into the shared null state — an eternal skeleton, with (at best) a generic note ABOVE the tab that actually went dark and no retry anywhere near it. This release closes the loop: every load on the reports surface either speaks on its own tab or carries its own note, and every success leaves a stamp saying WHEN the numbers were fetched.

### Added
- **Failure strips on all eight report tabs** (`src/app/(shell)/hr/reports/page.tsx`): the six aggregate desks (headcount / employment cost / absence / turnover / time-to-hire / statutory — one `Promise.all`), P10 and leave-utilisation each catch into their own `failed` flag (set true in the catch, cleared on success) and render an honest rose strip with a Retry on the tab itself: "The headcount desk could not be loaded — the numbers stay dark rather than guess." (and the seven siblings). A failed load nulls its data first, so the strip replaces the skeleton — never live data.
- **One strip family**: the three v2.130.0 privacy strips and the eight new ones share a single `ReportFailureStrip` component — same rose frame with dark twins, now with a warning glyph (AlertTriangle) and an in-flight retry spinner (Loader2). The strip carries `role="status"`, a `data-testid` per desk, and a distinct retry `aria-label`.
- **The honesty stamp**: every successfully loaded report renders "Updated HH:MM" (24-hour clock, tabular, muted) — on the six aggregate tabs and leave/P10 as a caption above the numbers, on the privacy desks beside their counts. No stamp means not fetched yet; a dark desk shows the strip, never a stamp.
- **In-flight refresh feedback**: `loadConsent` / `loadErasure` / `loadRetention` (and the P10 / leave loaders) own busy flags; the consent Refresh button and every Retry disable and spin while the fetch runs — a slow or dead API can never read as a dead button.

### Changed
- **Loads leave the shared error alone**: `load()` / `loadP10` / `loadLeaveUtil` no longer write into the page-level ErrorNote — that surface is reserved for actions (adjustments, sweeps, holds, drill-downs), where it always belonged. Loader failures speak through their own strips.
- The v2.130.0 test contract re-anchors to the family component: the same testids and retry labels now ride `ReportFailureStrip` props, and the rose frame lives exactly once (11 new + re-anchored assertions in `src/tests/reports-speak-failures-v2131.test.ts`).

## [2.130.0] The timeline files its copy

The consent timeline drawer (v2.129.0) grew an Export CSV door — the export-honesty theme's third beat (v2.115 case list → v2.118 access ledger → now the consent timeline). The same round fixes the Privacy tab's honesty gap this work exposed: a card whose ledger fails to load used to spin "Loading…" forever (the catch folded a failure into the same null state that "not yet answered" renders as); every card now speaks its failure with a rose strip and a retry.

### Added
- **The timeline CSV serializer** (`src/lib/hr/consent-timeline-csv.ts`): `buildConsentTimelineCsv(rows)` — RFC 4180 cells (quote on comma/quote/CR/LF, double embedded quotes), CRLF line endings, header row first, nulls become empty cells, timestamps become ISO strings (a garbage timestamp degrades to an empty cell, never "Invalid Date" on file). The header is the ledger's own column set, pinned exactly: `cycle,state,granted_at,withdrawn_at,stood_days,purpose,policy_version,employee_code,employee_name`. `consentTimelineStateLabel` speaks the chips' own two words (WITHDRAWN / STANDING, derived from `withdrawnAt`, never free text); a standing cycle leaves `withdrawn_at` and `stood_days` empty — an open consent has no honest day count to write down. `consentTimelineCsvFilename` sanitizes the employee code into `consent-timeline-{code}-{date}.csv`. The confidentiality contract is the row type itself: no content field exists, so an export can never become a back door.
- **The drawer's Export CSV door** (`src/app/(shell)/hr/reports/page.tsx`): an outline button (FileDown icon) rides the timeline footer, rendered ONLY when the ledger has rows (an empty ledger files nothing). The tooltip states the honesty: "Only who, when, and what purpose are exported — the ledger's own columns, never more." The export maps the drawer's own payload (the employee's code and name ride every row) through the pure serializer with the house Blob-download mechanics.

### Fixed
- **The Loading-forever spin** (Privacy tab): `loadConsent` / `loadErasure` / `loadRetention` caught a failed fetch into `null` — the same state "not yet answered" renders as — so an expired session or a network failure left the card spinning forever. Each loader now carries its own `failed` flag (set true in the catch, cleared on success), and each card renders an honest rose error strip with dark twins and a Retry button: "The consent ledger could not be loaded — the desk stays dark rather than guess." (and the erasure-queue and retention-desk siblings). Skeletons remain the not-yet-answered state; failure and loading stay distinct.

### Tests
- `src/tests/consent-timeline-csv-v2130.test.ts` (18): the serializer's RFC 4180 discipline (exact header pinned; WITHDRAWN row files ISO stamps + day count; STANDING row leaves withdrawn/stood cells empty; input order preserved; quote-on-need with double embedded quotes; garbage timestamp → empty cell; CRLF everywhere with the trailing line ending), the state label and filename sanitization, the confidentiality contract (the row type's fields are exactly the ledger's columns — no note/description/salary/content field can exist; the header array is named as the line that must change), the drawer door's manners (testid, per-employee aria-label, honesty tooltip, rendered only with rows, riding the pure serializer with the payload's own identity), and the failure-speech fix (three per-card error strips with retries, rose + dark twins ×3, each loader's failed flag declared/set/cleared exactly three times, skeletons distinct from failures).

## [2.129.0] The ledger shows its timeline

The consent ledger's `re-granted ×N` chip (v2.128.0) counted an employee's append-only consent history; this round the history becomes readable. A History door on every consent row opens a timeline drawer that reads the ledger the way it is stored: cycle by cycle, oldest first, verbatim — what was granted, when it was withdrawn, how many whole days it stood, and whether it still stands.

### Added
- **The consent timeline read-back** (`src/lib/hr/data-protection.ts`): `listConsentHistory(session, employeeId)` serves ONE employee's full `ConsentRecord` ledger, scope-checked like every ledger read (a cross-branch or deleted id 404s — `CONSENT_HISTORY_NOT_FOUND` — it does not leak). Events arrive oldest → newest (a timeline reads like a ledger) with 1-based `cycle` numbers (every value ≥ 2 is a re-grant cycle) and `stoodDays` computed SERVER-side — whole days between grant and withdrawal, floored from the exact span; a standing consent reports `stoodDays: null` because an open consent has no honest day count, only a standing-since date. The response carries `standing` (the newest cycle has no `withdrawnAt`) so the drawer can state the run-gate consequence without recomputing anything.
- **The history route** (`src/app/api/hr/privacy/consent/[employeeId]/history/route.ts`): `GET` behind the ledger's identical guard — `hrGuard('hr.report.branch', VIEW_ROLES)` (HR_MANAGER / STORE_OWNER / BRANCH_MANAGER). History is a VIEW right, never a decision right: reads are not reserved to settings managers.
- **The History door + timeline drawer** (`src/app/(shell)/hr/reports/page.tsx`): a ghost History button rides every consent row's action cell — rendered for EVERY viewer of the ledger, deliberately outside the `canDecide` branch. It opens a dialog drawer (`hr-privacy-consent-history`) rendering an `<ol>` timeline: an emerald dot for a standing cycle, amber for a withdrawn one (both with dark twins, rims matching the dialog surface), a cycle chip, an indigo `re-grant` chip on every cycle ≥ 2 — the door behind the v2.128.0 `re-granted ×N` counter — a `stood N days` tabular chip on closed cycles (server-computed, tooltip states the span), the consent's purpose and policy version, and the granted/withdrawn stamps in the page's shared date format. The footer says what the ledger says: "N records on file · append-only — nothing is edited or deleted", plus the honest consequence ("The newest consent stands; the run gates on it." / "No active consent stands; the run reports MISSING_CONSENT until a re-grant."). Loading, error-with-retry (the retry reuses the door's employee through the single loader), and the empty-ledger zero ("No consent records on file — the run reports MISSING_CONSENT until a grant.") all render honestly; every state reset rides `closeHistory` so one employee's history never greets the next open.

### Tests
- `src/tests/consent-history-v2129.test.ts` (14): the timeline's ledger honesty (oldest → newest with 1-based cycles; `stoodDays` floors a 28.5-day span to 28; standing consents report `null` days and `standing: true`; all-withdrawn flips `standing` false; an empty ledger answers with zero events while still identifying the employee), the scope discipline (missing/out-of-scope 404s with `CONSENT_HISTORY_NOT_FOUND`; the query pins `deletedAt: null` and the scope where), the route's guard trio + dynamic-param read, and the drawer's source contract (the door outside the decision gate, dialog/timeline/dot testids, the append-only footer, the all-four-state close reset, the retry path, and the dark twins).

## [2.128.0] The record stands corrected

The v2.127.0 governance round published an audit-coverage inventory whose one honest gap — "linkPortalAccount/unlinkPortalAccount write no audit row — fix queued" — was itself a false finding. Both mutators have written hash-chained UPDATE/EMPLOYEE rows since v2.39.0, pinned by tests and now live-verified against the database. This round corrects the record the honest way (with re-runnable evidence, not a silent edit), and completes the carried withdrawn-consent re-grant loop: the consent ledger now shows its own append-only history.

### Added
- **The re-grant trace** (`src/lib/hr/data-protection.ts`): the consent ledger's read-back carries `priorGrants` — the append-only history depth. Because `grantConsent` refuses while an active record stands, every record beyond the first is a withdraw-then-re-grant cycle; `priorGrants ≥ 1` is the ledger's honest "this consent was withdrawn once". The field rides every row (ACTIVE, WITHDRAWN, NONE — always the truth: 0 when there is no history).
- **The re-grant marker** (`src/app/(shell)/hr/reports/page.tsx`, styling): the Privacy tab's consent card renders an indigo `re-granted ×N` chip (History icon, dark-mode twin) beside the status chip — only when the history exists. The tooltip states the count and the append-only reason ("N earlier records stay on file (append-only ledger)"). Status chips keep their own testids and tones; the marker never replaces a state, it annotates one.
- **The withdrawn-consent re-grant loop** (carried since v2.121.0, closed by E2E): grant → roster chip ACTIVE → withdraw → roster chip flips withdrawn + Privacy chip WITHDRAWN → re-grant → roster chip ACTIVE again + `re-granted ×1` marker on the Privacy tab. The loop ran through the real UI with the append-only ConsentRecord rows and the GRANT/WITHDRAW audit rows verified in the database afterwards.

### Changed
- **docs/EMS_AUDIT_COVERAGE.md corrected** (Phase 4.8 acceptance 8 completes honestly): §4 is now "Known gaps — NONE (a correction, recorded 2026-10-19, v2.128.0)" — the false finding is quoted, then refuted with evidence a reviewer can re-run (the v2.39.0 code, the portal-link test pin, the live POST/DELETE → AuditLog verification). The Employees domain row claims **5/5** mutators including the portal-link pair; the raw count is corrected to **98 `hrAudit` call sites across 30 files** (the v2.127.0 note of 96 under-counted by 2). The method lesson is written into the doc: a coverage claim is verified per MUTATOR, not per FILE, and a named gap is verified against the code before it is published — an unverified gap claim is itself a defect in the record.

### Tests
- `src/tests/consent-regrant-v2128.test.ts` (14): `priorGrants` folds honestly (re-granted-ACTIVE reads 1; first-time reads 0; withdrawn-only history counts its depth; two full cycles read 2; NONE reads 0), the Privacy tab's marker contract (renders only when priorGrants > 0, indigo chip + dark twin + testid + append-only tooltip, status chips untouched), and the doc-correction pins (§4 states NONE with evidence; the false claim cannot return; the code really audits both mutators — the doc follows the code, never the reverse).

## [2.127.0] The desk says goodbye

The schema declared WITHDRAWN terminal from day one, but nothing could set it — a candidate who pulled out stayed movable forever while the pipeline pretended to offer them a future. This round opens the WITHDRAWN door: the desk can record the candidate's own exit, the API refuses the exits it must refuse, and the row reads as history. The round also publishes the two governance inventories the EMS spec's Phase 4.8 asks for (audit coverage; security headers and rate limits).

### Added
- **The WITHDRAWN door** (policy + service + route + desk): every live status gains the `withdraw` action in `PIPELINE_ACTIONS` and `interviewActions` (both branches — a pending draft never traps the door); terminal states still allow nothing. `withdrawApplicant` refuses HIRED ("use the employee offboarding flow"), refuses REJECTED/WITHDRAWN ("already left the pipeline"), sets WITHDRAWN + `dataRetentionUntil` on the SAME 90-day clock a rejection starts (`REJECTION_RETENTION_DAYS`, single-sourced — leaving the process, whichever direction, starts the same window), and audits UPDATE/APPLICANT with the retention days in metadata. `POST /api/recruitment/applicants/[id]/withdraw` rides the identical `hr.recruitment.manage` + `RECRUITMENT_WRITE_ROLES` gate; the note is OPTIONAL (an empty body is a valid withdrawal), rides the audit log only, and is clamped to 500 chars. 404 for the missing, 409 for the already-gone or already-hired.
- **The desk's violet door** (`src/app/(shell)/hr/recruitment/page.tsx`): a violet "Withdraw…" ghost button beside Reject…, arming a violet row whose copy says whose decision this is and what clock it starts ("This records the candidate's own exit — their data is kept 90 days, then anonymised"). The note input is optional ("rides the audit log"); Confirm posts the trimmed note (undefined when empty) and announces the retention sentence. Cross-disarm intact: `disarmAll` clears the arm and its note.
- **Withdrawn reads as history** (styling): WITHDRAWN wears its own slate badge tone (`StageTone 'withdrawn'` — neither rejection's rose nor hire's emerald), the row sits on a muted slate band, the name drops to muted foreground, and an italic explainer line ("Candidate withdrew from the process") sits under the email where actions used to live. The counts strip already told the truth (terminal candidates are not "in pipeline").
- **Audit coverage inventory** (`docs/EMS_AUDIT_COVERAGE.md`, Phase 4.8 acceptance 8): every service mutator accounted for across 12 domains (96 `hrAudit` call sites in 30 files, verified by scan) — audited, deliberately silent, or named as a gap. The one honest gap: `linkPortalAccount`/`unlinkPortalAccount` write no audit row (flagged, fix queued — the gap table is expected to shrink, never grow silently).
- **Security headers and rate limits documented** (`docs/EMS_RBAC_MATRIX.md` new section, Phase 4.8 acceptance 7): the nine route headers with the defence each buys, plus all eight rate-limit tiers (AUTH 5/15min through WEBHOOK 60/min) with the brute-force handoff — the defences a reviewer can probe are written down, not tribal knowledge.
- **Tests** (`src/tests/recruitment-withdraw-v2127.test.ts`, 17): the policy table (withdraw beside existing actions, both interview branches, terminal emptiness, slate tone), the service refusals and the shared retention constant, the route gate/optional-note/status-map pins, the no-schema-change pin, and the desk's violet door + history treatment.

### Security
- The withdraw route adds no new permission surface — the identical write gate as reject/stage/offer, and the service refuses the transitions that would launder history (a hired candidate cannot "withdraw" past their own hire; a rejected candidate cannot be re-exited). The withdrawal note is clamped and audit-only — no new PII column, no second surface to police. The 90-day retention window applies to withdrawn candidates exactly as to rejected ones, so the retention sweep's existing machinery anonymises them with zero new sweep code.

## [2.126.0] The pipeline shows its steps

Task 140's option 1: harden what the hiring round (v2.125.0) exposed and let the desk record what it actually observed. Three changes move the recruitment pipeline from "buttons that work" to "a record you can trust": every stage is recordable with its outcome and notes, one live offer per candidate, and the terms the desk sent stay visible on the row.

### Added
- **The stage arm** (`src/app/(shell)/hr/recruitment/page.tsx` + `src/lib/hr/recruitment-policy.ts`): the desk hard-coded INTERVIEW_ONE + PASS on a single "To interview" button — history written from a script, not from observation. "Record stage…" now arms a sky row with the FULL stage list (SCREENING → OFFER), the outcome (PENDING/PASS/FAIL), and optional notes, confirmed before anything is written. The stage list lives once as `PIPELINE_STAGES` in the policy module; the service's `recordStage` validation imports the same list, so the desk can never offer a stage the API refuses. Success notes name the step and its outcome ("SCREENING recorded — PASS for Grace Wanjiru.").
- **The duplicate-draft guard** (`src/lib/hr/recruitment-service.ts` + offer route): `approveAndSendOffer` approves `offers[0]`, so a stacked second DRAFT would silently orphan the first. `createOffer` now refuses while a DRAFT pends ("A DRAFT offer is already pending for this applicant — approve and send it before drafting another (DUPLICATE_DRAFT).", mapped to 409). The desk already hid the button while a draft pends; now the API refuses it outright.
- **The offer chip** (applicants GET + desk): the terms the desk sent used to vanish — the applicants GET now rides the LATEST offer of any status (`orderBy createdAt desc, take 1`) and the pipeline row prints "Offer sent 2026-10-19 · KES 32,000" (ACCEPTED/DECLINED/EXPIRED speak plainly; DRAFT stays silent — the approve hinge is its voice) under the stage badge. `formatOfferKes` prints integer-cents KES with thousands separators and degrades unreadable input to an em dash, never a fake 0.
- **The closed date**: CLOSED jobs print "closed 2026-10-19" in the job meta line.
- **Tests** (`src/tests/recruitment-v2126.test.ts`, 20): the one-list pins (service imports PIPELINE_STAGES, no local STAGES/retention copies), `formatOfferKes` and `offerChipLabel` behaviour tables, the duplicate-draft guard + 409 mapping, the stage-arm desk pins with the hard-coded jump EXORCISED, and the v2.125.0 door anchors.

### Changed
- `REJECTION_RETENTION_DAYS` is single-sourced in the policy module; the service imports it (the local copy is gone — nothing left to drift). The v2.125.0 suite re-anchored to the latest-offer include and the DRAFT-keyed hinge.

### Security
- The stage arm writes through the SAME `hr.recruitment.manage` route and the SAME service validation as before — no new surface, one new source of the allowed-stage list that both sides read. The duplicate-draft guard closes a real audit-trail hazard (two DRAFT rows where the approver's intent is ambiguous) rather than a display nit, and the chip exposes only what the desk itself already sent — no new PII leaves the pipeline.

## [2.125.0] The desk starts hiring

Task 139's dead-surface discovery, root-caused this round: the dev database held zero RecruitmentJobs and zero Applicants while /hr/recruitment sat in the navigation — and the E2E proved WHY: a one-line permission drift (`hr.recruitment.read.branch` omitted STORE_OWNER while every route whitelisted it, and no HR_MANAGER exists in the seeded org) 403'd EVERY living user, so the pipeline could never start — the same dead-surface family as consent (v2.119.0), onboarding (v2.120.0), and legal holds (v2.122.0). This release fixes the drift, makes the recruitment desk fully operable and honest: candidates can leave the pipeline, jobs can stop intake, offer terms are never fabricated, and readers see their true posture.

### Added
- **The dead-surface fix** (`src/lib/hr/permissions.ts`): `hr.recruitment.read.branch` gains STORE_OWNER, aligning the permission map with the routes' READ_ROLES, the new policy module, and the RBAC matrix (which documents the owner as "all" on recruitment). Before this one-line fix the guard 403'd the owner on every GET while the route's own role list said yes — the permission map is the source that fails closed, and it was the only place the owner was missing.
- **The reject door** (`src/app/api/recruitment/applicants/[id]/reject/route.ts`): `rejectApplicant` existed in the service since v2.18.6 (it sets REJECTED + the 90-day `dataRetentionUntil` the retention sweep reads) but NO route exposed it — candidates that went nowhere were stuck in the pipeline forever. The new POST requires a rejection reason ("A rejection reason is required — it rides the audit log."), refuses re-rejection ("Applicant has already left the pipeline.", 409), and returns the retention date.
- **The close door** (`POST /api/recruitment/jobs/[id]/close`): nothing ever set the schema's CLOSED status — jobs stayed OPEN forever. `closeJob` closes only OPEN jobs, stamps `closedAt`, audits "Job closed to new applicants.", and the job stays listed with its pipeline visible; `createApplicant` refuses CLOSED jobs by its own status check.
- **The pipeline policy** (`src/lib/hr/recruitment-policy.ts`): a PURE client-safe module — the single source of truth for the role gates (READ: HR_MANAGER/BRANCH_MANAGER/STORE_OWNER; WRITE: HR_MANAGER/STORE_OWNER) that were hand-copied across five route files, and the status→action map (`actionsForStatus`, `stageBadgeTone`, `canCloseJob`, `isTerminalCandidate`) the desk previously encoded as scattered ternaries. Terminal statuses (HIRED/REJECTED/WITHDRAWN) allow nothing — history, not buttons that 403.
- **The offer handoff, closed** (`src/app/api/recruitment/applicants/route.ts` + desk): the E2E walk caught a SECOND dead segment — `createOffer` leaves the applicant INTERVIEW, and only the approve-and-send PATCH (existing, never rendered by any UI) moves them to OFFER, so the old desk's Hire button was unreachable. The applicants GET now includes the pending DRAFT offer, the policy gains `interviewActions(hasDraftOffer)`, and the desk swaps "Draft offer…" for an amber "Approve & send" (PATCH `?offerId=`) while a draft is pending — the pipeline can finally reach Hire.
- **The honest desk** (`src/app/(shell)/hr/recruitment/page.tsx` rebuilt): a counts strip (open jobs · in pipeline · hired, computed from live data); two-step arms for Reject (rose row demanding a reason — "Their data is kept 90 days, then the retention window anonymises it."), Draft offer (amber row demanding REAL terms — monthly KES salary + start date, empty inputs), and job Close (confirm row); outcome notes (role=status) report what just happened; honest empty states ("No jobs yet — hiring starts with a job."); stage badges with per-tone colors (sky interview, amber offer, emerald hired, rose rejected); job rows show description, openings, applicant counts, and opened date with a hover-revealed Close.
- **Tests** (`src/tests/recruitment-v2125.test.ts`, 22): policy behaviour (action map, the draft-offer hinge, tones, close rule, role gates, purity), route pins (write gates from the policy, reason required, service wording), the dead-surface root cause (read.branch admits the owner), the fabricated-terms exorcism (no `3_000_000`, no `86400000`), and the desk pins (arms, handoff, counts, read strip, honest empties).

### Changed
- **canWrite rides the jobs GET envelope** (computed server-side from the policy roles), so BRANCH_MANAGER readers get a sky read strip ("Read access — you can follow the pipeline, but only HR managers and the store owner open jobs, move candidates, and hire.") instead of forms whose submissions would 403.
- **The offer desk never invents terms**: the old "Draft offer" button hard-coded KES 30,000.00 and a +7-days start date — fabricated data. The desk now demands the real numbers. The What's-New feed leads with the desk; the unread-counter test re-anchored for the 2.125.0-fed feed.

### Security
- Both new routes are write-gated with the SAME guard triplet as their siblings (`hr.recruitment.manage`, HR_MANAGER/STORE_OWNER from the policy module — one source of truth across all five recruitment routes), every mutation audits with actor attribution, rejection reasons ride the audit log while candidate content never leaves the pipeline, and the read posture is computed server-side — the client cannot render itself into a write it does not hold.

## [2.124.0] The broom answers the desk

Task 138 option 1: the dry run (v2.123.0) shows what the nightly sweep WOULD anonymise — but a settings manager who saw a backlog still had to wait for the cron. This release gives the decision a door: a manual "Sweep now" run that executes the exact same audited function the nightly cron runs, asks twice because anonymisation is destructive, and reports per scope where the action lives.

### Added
- **Sweep now door** (`src/app/(shell)/hr/reports/page.tsx`, retention card): a card-level "Sweep now…" button renders ONLY for settings managers (`canDecide` — everyone else's desk is unchanged). Arming shows a rose confirm row quoting the live backlog ("N rows would be anonymised immediately." with singular/plural, or the honest zero "Nothing is in scope — held scopes are skipped, in-window rows are untouched."), then Confirm sweep / Cancel. Arming one action disarms the other (release arm ↔ sweep arm).
- **The manual run route** (`POST /api/hr/privacy/retention-sweep`): `hrGuard('hr.report.branch')` read guard + in-handler 403 `DECISION_FORBIDDEN` (the erasure / consent / legal-hold decision pattern verbatim), then `runHrRetentionSweep(session.organizationId, session.userId)` — the EXACT function the nightly cron executes, with actor attribution. A manual run can never diverge from the nightly one: legal holds skip, redacted rows stay invisible, every anonymised batch audits `RETENTION_*`. The envelope carries `results` plus `sweptAt`.
- **The pure outcome humaniser** (`src/lib/hr/sweep-outcome.ts`): `describeSweepOutcome` turns the per-scope results into the card's own note — "Sweep ran — 2 rows anonymised (2 applicant records)." with held scopes named as skipped ("Held scopes were skipped (1)."), the honest "nothing to anonymise; every scope sits inside its window." on a zero run, and the ROSE truth when the answer is unreadable (never a fake success). Client-safe: no db import.

### Changed
- After a manual run the desk refetches, so the dry-run counts (v2.123.0) drop to the zero the sweep just made true — the preview and the door close each other's loop. The What's-New feed leads with the door; the unread-counter test re-anchored for the 2.124.0-fed feed (2.110.0→13, 2.109.0→14, 2.108.0→15, 2.77.0→46).

### Security
- The manual run is gated exactly like every other decision on the desk: the read is `hr.report.branch`, the run is `hr.settings.manage` only (403 `DECISION_FORBIDDEN` otherwise), the execution is the nightly function itself — same holds, same redaction guards, same `RETENTION_*` audits with the acting user attributed — and the outcome note names what was anonymised per scope without ever exposing record contents.

## [2.123.0] The sweep shows its hand

Task 137 option 2: the retention desk could say the sweep runs nightly, but never WHAT it would sweep. This release adds the dry run — per-scope counts of what the next nightly run would anonymise, computed with the exact same criteria the sweeper executes, so the desk and the sweep can never disagree about what "in scope" means.

### Added
- **Next sweep column** (`src/app/(shell)/hr/reports/page.tsx`, retention card): each scope row now carries a dry-run label — "N in scope", "N waiting behind the hold" (amber, matching the hold vocabulary), "nothing to sweep", or "nothing waiting" — computed server-side and carried on the DTO (the page still never imports the service module). The column header's tooltip discloses the dry run; a held row's tooltip says what releasing would unblock.
- **Backlog counts strip** (`hr-privacy-retention-sweep-count`): a second line under the holds strip answers "N rows would be anonymised on the next nightly run", with an honest zero state ("nothing to sweep tonight — every scope sits inside its window") and a pacing disclosure when the backlog exceeds one night ("the sweep takes up to 500 per night").
- **The dry run** (`previewRetentionSweep`, `src/lib/hr/data-protection.ts`): three `count()` queries — one per scope, changing nothing. A held scope still reports its backlog with `held: true`: the hold freezes the sweep, not the truth about what releasing would unblock. `sweepableTotal` sums over non-held scopes only — what the next run actually targets.

### Changed
- **Single source of truth for "in scope"** (`src/lib/hr/data-protection.ts`): the sweep's three inline WHERE clauses are now three pure, exported where-builders (`applicantSweepWhere` / `disciplinarySweepWhere` / `attendanceSweepWhere`) consumed by BOTH the executing sweep and the preview counts; the `REDACTED (retention)` marker rides every clause as a shared constant, so an already-anonymised row is invisible to both. No behaviour change — the refactor was verified clause-for-clause.
- The What's-New feed leads with the dry-run story; the unread-counter test re-anchored for the 2.123.0-fed feed (2.110.0→12, 2.109.0→13, 2.108.0→14, 2.77.0→45).

### Security
- The preview is read-only by construction: it rides the desk's existing read guard (`hr.report.branch` + the VIEW_ROLES trio), counts instead of selects (no personal data crosses the wire — a number and a label per scope), and its WHERE clauses are the sweep's own by shared code rather than by promise. Rows already carrying the redaction marker are excluded from every count, so the desk can never inflate the backlog with data that is no longer personal.

## [2.122.0] The hold takes the desk

The retention mechanism gets a surface (Task 136 option 7): the nightly sweep has anonymised expired personal data scope by scope since v2.20.0 and legal holds have always been able to block it — but a hold could only be set by a raw HrSetting write. This release puts the desk on the Privacy tab: the reviewable policies, their live hold state, and the decisions that pause or resume a scope.

### Added
- **Retention & legal holds card** (`src/app/(shell)/hr/reports/page.tsx`, Privacy tab): the third Data Protection Act posture card lists every scope in `HR_RETENTION_POLICIES` with its humanised window ("3 years after updatedAt", "the row's own expiry (dataRetentionUntil)" — computed server-side and carried on the DTO so the client never imports the service module), its legal basis, and a hold chip — amber "On hold" (with the held-since date in the tooltip) or slate "Sweeping nightly". A counts strip answers "N of 3 scopes on hold", amber-tinted when any scope is paused.
- **The desk read** (`GET /api/hr/privacy/retention`): `hrGuard('hr.report.branch')` with the consent ledger's VIEW_ROLES trio, folding `HR_RETENTION_POLICIES` with the live `legalHold:<scope>` HrSetting rows — presence with value `true` IS the hold, the exact representation `getLegalHolds` (the sweep's single reader) already obeys. `canDecide` mirrors the erasure gate.
- **The hold decision** (`POST /api/hr/privacy/legal-hold`): reserved to `hr.settings.manage` (`canDecideErasure` — the same key that decides erasures and consent records; others get 403 `DECISION_FORBIDDEN`). Setting creates the row (value `true`, `updatedByUserId` stamped) and refuses 409 `HOLD_ACTIVE` when one stands; releasing DELETES the row (no dead settings linger) and refuses 409 `NO_ACTIVE_HOLD` when nothing is held. Unknown scopes answer 400 `UNKNOWN_SCOPE` naming the valid list; non-boolean `held` answers 400 `INVALID_HELD`. Both decisions audit `LEGAL_HOLD_SET` / `LEGAL_HOLD_RELEASED` on the `legalHold:<scope>` key (HrSetting resource).
- **Two-step release**: the sweep resuming is the destructive direction, so Release… arms an inline rose confirm row ("Release? The sweep resumes on its next run.") before `Confirm release`; setting a hold is one click. The outcome reports in the card's own note (`role="status"`, emerald/rose — the report-where-the-action-lives lesson), never the page-level banner three cards away.

### Changed
- The What's-New feed leads with the hold story; the unread-counter test re-anchored for the 2.122.0-fed feed (2.110.0→11, 2.109.0→12, 2.108.0→13, 2.77.0→44).

### Security
- The decision gate fails closed exactly like its siblings: the read is `hr.report.branch` + VIEW_ROLES, the write is `hr.settings.manage` only, both decisions are audit-logged with field-name-only metadata (scope + held — never record contents), and the release path deletes only rows whose value is `true` — a stale or tampered row can neither block the sweep invisibly nor survive a release it should not have.

## [2.121.0] The roster reads the room

Consent visibility where HR actually works (v2.120.0's option 1): the consent ledger (v2.119.0) and the onboarding capture (v2.120.0) both exist — but the roster, the surface HR lives in all day, still answered nothing about consent. This release overlays the ledger onto /hr/employees, so the roster answers the payroll run's read at a glance and the Privacy tab keeps the authoritative detail.

### Added
- **Consent chips on the roster** (`src/app/(shell)/hr/employees/page.tsx`): a "Payroll consent" column (desktop table) and a compact chip (mobile cards) fed by the SAME ledger the Privacy tab reads (`GET /api/hr/privacy/consent`) — emerald Active / amber Withdrawn / slate None on file, tones mirroring the consent card EXACTLY so a color never means two things. Each chip's tooltip says its MISSING_CONSENT truth aloud instead of relying on color; a row outside the view's first-200 window renders a muted dash whose tooltip points at the authoritative ledger — never a look-alike consent state.
- **Counts strip in the filter bar** (`hr-employees-consent-counts`): "N active · W withdrawn · M without consent" with the without-consent phrase rose-tinted when nonzero — the same sentence and honesty as the Privacy tab's counts line, with a tooltip that admits it counts the whole consent view, not the filtered list.

### Changed
- The consent overlay fetch rides its own effect (cleanup-guarded, refreshed with the list's reload key) and maps ONLY the three known statuses — an invented status can never render a look-alike chip.
- The What's-New feed leads with the roster story; the unread-counter test re-anchored for the 2.121.0-fed feed (2.110.0→10, 2.109.0→11, 2.108.0→12, 2.77.0→43).

### Security
- The overlay degrades HONESTLY behind the ledger's guard: `GET /api/hr/privacy/consent` stays `hr.report.branch` + VIEW_ROLES (deliberately excluding ACCOUNTANT, who may still see the roster), and when the fetch 403s — or fails at all — the column, chips, and counts hide WHOLESALE. Absence of the view is never rendered as absence of consent; the page carries no consent vocabulary a denied role could misread, and the authoritative ledger remains the Privacy tab.

## [2.120.0] The roster captures its consent

Onboarding-time consent capture (v2.119.0's option 1, fully realized): the discovery that shaped this round is that POST /api/hr/employees had NO UI surface at all — hiring happened only through raw API calls (another dead-surface pattern, same family as v2.119.0's consent records), and a fresh hire onboarded without a ConsentRecord would block the next payroll run on MISSING_CONSENT forever. This release gives hiring a face: an onboarding dialog on the Employees page that files the hire AND the consent they signed, through the same audited path the Privacy tab uses.

### Added
- **Onboarding dialog** (`src/app/(shell)/hr/employees/page.tsx`): an "Onboard employee" door on the roster — first/last name required, job title, phone, hire date (defaults today), basic salary, and the schema's exact employment-type vocabulary (PERMANENT/CONTRACT/CASUAL/PROBATION/INTERN — no client invention). The success state shows the new hire's code and the honest consent outcome; "Onboard another" resets, "Open record" lands on the detail page.
- **Onboarding-time consent capture** (`POST /api/hr/employees` + `consentPayrollProcessing`): ticking the checkbox files the new hire's payroll-processing consent (purpose PAYROLL_PROCESSING, lawful basis CONSENT, policy hr-policy-2026-01) through the SAME audited `grantConsent` path the Privacy tab's decision routes use — one source of truth for the vocabulary, `PRIVACY_CONSENT_GRANTED` audit included. A consent glitch never loses the hire: the 201 keeps the employee and rides back an honest `{ granted: false, reason }` outcome.
- **Pure outcome interpreter** (`src/lib/hr/onboard-consent.ts` `describeOnboardConsent`): folds the route's consent field into the three sentences the dialog can show — emerald "Consent captured" (policy + grant date), amber "No consent on file" (with the MISSING_CONSENT truth), rose "Consent not captured" (with the reason code). Garbage input degrades honestly to rose/UNKNOWN, never to a granted look-alike.

### Changed
- `GET /api/hr/employees` now surfaces `canCreate`, resolved through the SAME `hr.employee.create` permission key the POST guard pins — the server decides who sees the onboard door, the page renders what the answer says (the consent card's canDecide pattern, applied to hiring). The list load switched to a raw fetch because the affordance rides outside `data`.
- The What's-New feed leads with the onboarding story; the unread-counter test re-anchored for the 2.120.0-fed feed (2.110.0→9, 2.109.0→10, 2.108.0→11, 2.77.0→42).

### Security
- The boundary is a written contract: onboarding capture records a FACT of the hiring paperwork ("the employee signed the consent form") and is available to anyone who may create an employee (`hr.employee.create`); the data-protection DECISIONS — grant/withdraw outside onboarding — stay reserved to `hr.settings.manage` (403 DECISION_FORBIDDEN on the consent routes), and `withdrawConsent` is deliberately not even imported by the employees route (pinned by test). The vocabulary is never re-declared in the route (pinned), a strict `=== true` gates the grant, and every onboarding grant lands in the audit trail with employee id, purpose, and policy version — never content.

## [2.119.0] Consent works

Spec Phase 4.8 acceptance-6 release: "Consent records work." Until now the ConsentRecord table was write-only at intake (recruitment applicant consent) and read by exactly one gate — the payroll run's MISSING_CONSENT guardrail — with no product surface to grant, withdraw, or even see an employee's consent. This release closes the loop: a read-back consent ledger on the Privacy tab, plus grant/withdraw decisions, both audit-logged and scope-checked.

### Added
- **Consent ledger** (`src/lib/hr/data-protection.ts` `listConsentRecords`, `GET /api/hr/privacy/consent`, Privacy tab card on `/hr/reports`): every in-scope employee's data-processing consent state — Active (emerald) / Withdrawn (amber) / None on file (slate) — with the latest record's policy version, granted and withdrawn dates, in one batched query (scope rides `employeeScopeWhere`, take 200). The status folds ALL records (the payroll gate does not filter by purpose), so the chip on screen is the answer the run check will compute.
- **Consent decisions** (`grantConsent`, `withdrawConsent`, `POST /api/hr/privacy/consent/grant|withdraw`): Grant writes a NEW ConsentRecord (append-only — a withdrawn consent keeps its row and its dates; the new grant carries the current policy version) and refuses 409 when an active one stands; Withdraw stamps `withdrawnAt` on every active record and refuses 409 when nothing active stands. Both are reserved to settings managers (`canDecideErasure` → `hr.settings.manage`, 403 DECISION_FORBIDDEN otherwise) and write `PRIVACY_CONSENT_GRANTED` / `PRIVACY_CONSENT_WITHDRAWN` audit events with employee + policy metadata — never content.

### Changed
- The Privacy tab's counts line reads "N active · W withdrawn · M without consent", with the without-consent phrase rose-tinted when nonzero — those are the employees the next payroll run will report MISSING_CONSENT for; zero stays honest and quiet. The erasure card is untouched and coexists beneath the consent card.
- The What's-New feed leads with the consent story; the unread-counter test re-anchored for the 2.119.0-fed feed (2.110.0→8, 2.109.0→9, 2.108.0→10, 2.77.0→41).

### Security
- The ledger reads only what the session's employee scope already admits (same `employeeScopeWhere` as the erasure list, `hr.report.branch` + VIEW_ROLES guard); decisions re-check `hr.settings.manage` in-handler (the erasure decision pattern), fail closed on out-of-scope employees (404), and the audit metadata carries the employee id, purpose, policy version, and count — never the scope text or any personal content. The payroll gate's read (`withdrawnAt: null`) is untouched and pinned by a source contract; withdrawal is now reachable, so the gate is finally enforceable through the product instead of a dev-only seed script.

## [2.118.0] The ledger files its copy

Export-honesty release: the Restricted access ledger (v2.117.0) grows the same CSV door the case list has worn since v2.115.0 — the filtered ledger window exports content-free as `access-ledger-YYYY-MM-DD.csv`, with exactly the columns the screen shows. The compliance trail can now leave the desk on paper without the confidentiality contract leaving with it.

### Added
- **Ledger CSV export** (`src/lib/hr/discipline-ledger-csv.ts`, `src/app/(shell)/hr/discipline/page.tsx`): a violet CSV button on the ledger toolbar writes `access-ledger-YYYY-MM-DD.csv` from the FILTERED rows (event filter and window included) — columns `when_iso, event, who, case_id, case_employee`, RFC 4180 escaping, CRLF line endings, header row first, nulls as empty cells. The button disables on an empty filtered set and its tooltip says the contract aloud: only who, when, and which case are exported.
- **Pure serializer** (`buildAccessLedgerCsv`, `escapeLedgerCsvCell`, `ledgerEventLabel`): same shape as the v2.115.0 list serializer — kept out of the page so the escaping rules are unit-testable, with the column set pinned by tests as the one line that must change (and fail its guard test) if a content column is ever proposed.

### Changed
- The ledger counts line emphasizes refused attempts: when a window holds denials, the "N denied" phrase wears a rose tint (`hr-discipline-ledger-denied-count`) with its own tooltip — refusals are the part a reviewer scans for; zero stays honest and quiet.
- The What's-New feed leads with the export story; the unread-counter test re-anchored for the 2.118.0-fed feed (2.110.0→7, 2.109.0→8, 2.108.0→9, 2.77.0→40).

### Security
- The export cannot outgrow the screen: the CSV maps `ledgerVisible` (the filtered rows) through a row type with no description/resolution-notes field, and the header set is pinned content-free by tests; the serializer reuses the RFC 4180 discipline (quote-on-need, doubled embedded quotes, CRLF) so names with commas or quotes cannot corrupt the file or smuggle cells. No new route, no new guard key, no new query — the door reads client-side state the session already fetched under `hr.discipline.manage`.

## [2.117.0] The ledger reads the room

Compliance-visibility release: v2.115.0 made restricted reads leave a trail, v2.116.0 read that trail back per record; v2.117.0 reads it back across ALL cases — a read-only Restricted access ledger on the discipline desk, over the same content-free audit events. Spec Phase 4.7's confidentiality story now has an org-level surface: who has been opening restricted records lately, who has been refused, and when.

### Added
- **Restricted access ledger** (`src/app/(shell)/hr/discipline/page.tsx`, `src/app/api/hr/discipline/restricted-access/route.ts`, `src/lib/hr/discipline-service.ts`): a second card on the desk listing every `DISCIPLINARY_RESTRICTED_VIEWED` / `_DENIED` event on the session's visible cases, newest first — when (relative time with the exact date on hover), what (violet "Open" / rose "Denied" chips), who (batch-resolved user name), and which case (a ghost door that opens the same detail dialog the list uses — an open from the ledger is itself a logged restricted read, and the ledger proves it on refresh).
- **`listRestrictedAccess`** (`src/lib/hr/discipline-service.ts`): the SAME `employeeScopeWhere` as `listCases` answers the query (fail-closed — a branch manager sees their branch's events only); zero visible cases short-circuits before any audit query; the window is clamped by `clampLedgerWindow` (non-numeric/absent → 30 days, hard cap 90 — a stray `?days=9999` can never become an unbounded scan); the payload takes at most 200 rows and is content-free (who, when, which case's employee — never the description or resolution notes).
- **Pure ledger helpers** (`src/lib/hr/discipline-ui.ts`): `clampLedgerWindow` (default fallback + cap), `foldAccessLedger` (name joins with honest null degradation, denied flag, unrelated-action filter), and `relativeTimeLabel` ("just now" / "Nm ago" / "Nh ago", then calendar-day "Nd ago" — future timestamps clamp to "just now", garbage is null and the UI falls back to the absolute date).

### Changed
- The What's-New feed leads with the ledger story; the unread-counter test re-anchored for the 2.117.0-fed feed (2.110.0→6, 2.109.0→7, 2.108.0→8, 2.77.0→39). The v2.116.0 single-case trail and the ledger now coexist as two read-backs over one trail (pinned by a source contract).

### Security
- The ledger adds no new exposure surface: it answers only to `hr.discipline.manage` (the guard key is pinned), scopes through the same employee scope as the list it sits under, its payload is pinned content-free by tests (serialized rows never contain the description), and the deny path of the trail is untouched — the ledger reports refusals without naming who was refused beyond what the audit log already holds for the same roles.

## [2.116.0] The trail reads back

Loop-closing release: v2.115.0 made restricted reads *write* an audit trail; this release lets the discipline desk *read* it back, in the two places a decision actually happens — the record's own detail dialog and the case list. The trail stays content-free: it names who and when, never the description.

### Added
- **Access trail in the detail dialog** (`src/lib/hr/discipline-service.ts`, `src/lib/hr/discipline-ui.ts`, `src/app/(shell)/hr/discipline/page.tsx`): a granted restricted read now returns the folded history of its case — `buildAccessTrail` (pure, order-independent, null-honest) turns the case's `DISCIPLINARY_RESTRICTED_VIEWED` / `_DENIED` audit rows into "last opened by <name> · <date> · N prior opens · M denied attempts". The trail is queried *before* the current view writes its own event, so "last opened by" always means the previous reader, never the in-flight caller. A restricted record with no prior trail says so honestly: "This is the first logged view of this restricted record."
- **Trail badges on the case list** (`src/app/(shell)/hr/discipline/page.tsx`): restricted rows carry a compact "N opens" chip (honest at zero) fed by one index-backed `auditLog.groupBy` over the page's restricted case ids — a record that has been quietly opened many times is visible before anyone clicks it. STANDARD rows carry no trail field at all (their reads are not logged, and the DTO says so by absence).
- **`restrictedViews` on the list DTO and `accessTrail` on the detail DTO**: aggregate metadata only — counts, moments, and the last viewer's resolved name (`User.name`); the denied actor's identity stays in the security log, the read-back counts refusals without naming who was refused.

### Changed
- The What's-New feed leads with the read-back story; the unread-counter test re-anchored for the 2.116.0-fed feed (2.110.0→5, 2.109.0→6, 2.108.0→7, 2.77.0→38). The v2.115.0 suite re-anchored for the read-back query (empty defaults = first logged view). The CSV serializer's column contract is pinned untouched by tests — no trail column, still no description column.

### Security
- The read-back adds no new place for sensitive text to live: the summary is folded from the same audit events the security log already holds, the trail query admits exactly the two confidentiality actions (pinned by tests), the deny path never reads the trail back (no trail rides a 403), and a viewer whose name cannot resolve degrades to "an unknown user" rather than a fabricated label.

## [2.115.0] The restricted read leaves a trace

Confidentiality-hardening release: grievance confidentiality (EMS spec Phase 4.7 acceptance 5) was enforced at the detail level since v2.19.0 — descriptions stayed out of lists and behind an explicit allow-list. This release makes the enforcement *traceable*: a restricted read (granted or denied) now leaves an audit record, and the discipline desk grows the search, filters, countdown chips and honest CSV export a working caseload needs.

### Added
- **Restricted-read audit trail** (`src/lib/hr/discipline-service.ts`): `getCaseDetail` writes `DISCIPLINARY_RESTRICTED_VIEWED` when a permitted role opens a RESTRICTED record (actor, role, case id, store — the metadata carries the confidentiality flag, never the description text), and `DISCIPLINARY_RESTRICTED_DENIED` on the allow-list's 403 path, so the refusal is as traceable as the grant. Today the route guard admits exactly the allow-listed roles, so the denied path is defence in depth — the trace exists the day the guard's key ever widens.
- **The discipline desk matures** (`src/app/(shell)/hr/discipline/page.tsx`): employee search (client-side on the already-loaded list), a type filter (warning / grievance / investigation), a live counts line ("N of M cases shown · R restricted"), a filtered-empty state distinct from the true zero, and amber "in Nd" countdown chips on OPEN warnings inside 14 days (past-due never renders — the sweep retires those before the list is built).
- **The case list exports honestly** (`src/lib/hr/discipline-list-csv.ts`): a pure RFC 4180 serializer behind the toolbar's CSV door — columns are exactly the list payload's (case id, employee, type, severity, status, confidentiality, issued, expires); descriptions and resolution notes have no column, so the export can never become a back door around the detail view's gate.
- **The detail dialog says what the audit does**: restricted records wear a violet "Viewing this restricted record is logged to the audit trail." note — the logging is visible to the person it concerns, not a silent background behavior.

### Changed
- The restricted rows in the list carry a violet "Restricted" chip beside the lock icon (the lock alone was easy to scroll past).
- The What's-New feed leads with the traceability story; the unread counter test re-anchored for the 2.115.0-fed feed (2.110.0→4, 2.109.0→5, 2.108.0→6, 2.77.0→37).

### Security
- The audit trail stores no case content: metadata names `confidentiality: 'RESTRICTED'` and nothing else — the trail proves access happened without itself becoming a copy of the sensitive data. The CSV serializer's column set is pinned by tests, so a future column proposal that carries the description fails the build, not a breach review.

## [2.114.0] The assets half of the alert opens its door

Door-completion release: v2.113.0 made the People & Payroll panel's expiry count split honestly — documents became a door, overdue assets stayed text because the assets list was session-scoped. This release teaches the assets list org-scoped, windowed reads, so the second half of the alert opens its own door too.

### Added
- **The overdue-assets door** (`src/components/finance/people-payroll-by-branch.tsx`, `src/lib/workspace/links.ts`): the expiry cell's assets half renders as a link to `/hr/assets?overdue=1&storeId=<id>` (built by the pure `buildOverdueAssetsHref`) with aria-label, title, hover manners and a visible focus ring — same amber family as the documents door, `+N` compact form when the documents door is present, full-size when it is the only alert. Zero halves never render as links; roles the list would refuse keep the same honest text as before.
- **`GET /api/hr/assets` grew two honest query params**: `?overdue=1` mirrors the panel's `assetsOverdue` definition exactly (status ASSIGNED with `dueReturnOn` in the past, deleted excluded) so the door lands on the number the alert promised, and wins over any conflicting status filter; `?storeId=` is honored only for org-scope roles whose organization owns the store (via `storeInOrganization`, fail-closed) or when it matches the session's own store — any other request silently keeps the session scope.
- **The Assets page grew the door's landing** (`src/app/(shell)/hr/assets/page.tsx`): an "Overdue only" toggle (amber, `aria-pressed`, disabled status select while on — overdue assets are assigned by definition), link-seeded `(from link)` chip that retires on the first filter touch, filters mirrored into the URL (shareable views, refresh-stable), a live assignment count, and the same store-scope honesty notice the employees list rides on (only claims a mismatch when a row actually names another store).

### Changed
- `listAssets` (`src/lib/hr/asset-service.ts`) accepts `storeId` + `overdue` filters; the DTO already carried the row's `storeId`, so the mismatch notice needed no schema change.
- The What's-New feed leads with the two-doors story; the unread counter test re-anchored for the 2.114.0-fed feed (2.110.0→3, 2.109.0→4, 2.108.0→5, 2.77.0→36).
- The v2.113.0 panel pin re-anchored (`canOpenExpiry` → `canOpenDocs`) now that a second, parallel gate (`canOpenAssets`) exists beside it.

### Security
- Scope never widened by request: the assets list verifies organization ownership server-side before honoring any explicit branch (`storeInOrganization`, fail-closed); the overdue filter exposes assignment rows the roles already hold — no new data leaves the server; the panel's door is gated client-side on `ASSET_LIST_READ_ROLES` (mirroring the route's `hr.asset.manage` guard) so it can never promise a view the role would be refused.

## [2.113.0] The dead columns open their doors; the HR roster finally exists

Bug-fix-and-doors release: QA found the HR workspace nav's oldest link (`/hr/employees`) landing on a 404 — the page had never shipped. This release builds it, and the People & Payroll panel's last two dead columns (latest run, expiry alerts) become real doors that land somewhere useful.

### Added
- **The `/hr/employees` list page** (`src/app/(shell)/hr/employees/page.tsx` — NEW, fixes the 404): search (name/code/job title, debounced, server-side `?q=`), status filter, and an **expiring-documents toggle** backed by the new `expiringWithinDays` service filter — only employees holding documents whose expiry falls inside `[now, now+N days]`, each annotated with `expiringDocuments` + `nearestExpiry` (a count and a date; the PII contract holds). Desktop table + mobile cards; every row opens the employee record; precise empty states; `(from link)` chip on a link-seeded toggle until first touch; `Clear filters` counts what it clears.
- **The latest-run door** (`src/components/finance/people-payroll-by-branch.tsx`, `src/lib/workspace/links.ts`): `hrPerStore.latestPayroll` now carries `runId` (additive server join in `src/lib/hr/reports.ts`), and the panel's latest-run cell renders as a link to `/hr/payroll?run=<id>` (built by the pure `buildRunDeepLinkHref`) with aria-label, title, hover manners and a visible focus ring. Stale summaries without a run id degrade to the same honest text — never a dead link.
- **The expiry door**: the alerts count splits honestly — the documents half is a link to `/hr/employees?expiring=90&storeId=<id>` (`buildExpiringEmployeesHref`); the assets half stays text because the assets list is session-scoped and a cross-branch door would promise a view it cannot open. Zero halves never render as links. Mobile cards reuse the same cells — one implementation, two surfaces.
- **`?run=` deep link on /hr/payroll**: a lazy initializer seeds the run dialog straight from the URL; a mount effect strips the param once, so a refresh never re-opens a stale dialog; the dialog's own fetch fail-closes when the run is not the session's to see.

### Changed
- **`GET /api/hr/employees` grew two honest query params**: `?expiring=<days>` (clamped 1..365 by `parseExpiringDays`; anything else ignored) and `?storeId=` honored **only** for ORG-scope roles (the same scope model `/api/org/summary` serves) and only when `storeInOrganization` proves the store belongs to the caller's organization — fail-closed 403 on any miss. Branch-scoped roles keep their session store exactly as before; client storeId stays ignored for them.
- The What's-New feed leads with the doors story; the unread counter test re-anchored for the 2.113.0-fed feed (2.110.0→2, 2.109.0→3, 2.108.0→4, 2.77.0→35).
- The shared `OrgSummaryData.hrPerStore` type carries `runId`; the org console and the SPA tab share the same panel, so both homes gained the doors in one move.

### Security
- Scope never widened by request: the employees list verifies organization ownership server-side before honoring any explicit branch (`storeInOrganization`, fail-closed); the expiring filter exposes counts and dates only — never document names, types, or contents; `/hr/payroll?run=` opens the dialog but the run detail endpoint still answers only what the session may see; the doors are display selectors over views the roles already hold.

## [2.112.0] The branch picker hands you the payroll ledger

Reach-and-manners release: branch listings grow a "People & payroll" affordance — the v2.111.0 deep link's natural consumer, in BOTH homes (the Branch Selector's cards and the Organization Console's Workspace column) — and October's BONUS run completed the last leg of the payroll lifecycle (manual disbursement) as the round's live end-to-end proof.

### Added
- **People & payroll hand-over, two homes** (`src/lib/workspace/links.ts`, `src/components/workspace/branch-selector.tsx`, `src/components/workspace/org-console.tsx`): every branch card in the Branch Selector and every row of the Organization Console's Branches table offers "People & payroll" — a new-tab link to `/?tab=people-payroll&branch=<storeId>` built by the pure `buildPeoplePayrollDeepLink`. The selector stays available (one-tab-per-view, spec Phase 8); the shell consumes the deep link exactly as designed: tab applied after rehydrate, branch seeds the panel filter, "(from link)" until first touch. The org console is the owner's real branch-browsing home — that is where the affordance earns its keep.
- **Honest gating**: the affordance renders only for `ORG_SUMMARY_ROLES` — the exact roles the People & Payroll tab honors (`TAB_CONFIG`) — so it can never promise a view the role would be refused. E2E-verified both ways: warehouse@ (multi-store, not an org-summary role) sees the cards with NO payroll door; owner@ sees the door and the tab honors it. Inactive stores never offer the door.
- **The payroll lifecycle's last leg walked in the open**: October's BONUS run (POSTED, five payslips PENDING, KES 197,772.60) was disbursed by hand through the run dialog — every payslip flipped PAID, `paidAt` stamped on the run, the payroll group heard about it (digest + per-employee paid notices), and the lifecycle UI moved to its settled state. Prepare → approve → post → disburse: every leg now has a live E2E on the books.

### Changed
- **Branch cards learned some manners** (styling): a quiet hover lift (`hover:shadow-md`), the branch's own branding color ringing its dot on hover (light and dark via `group-hover:ring-current`), a visible `focus-within` border path for keyboard users, and an emerald-tinted outline variant for the payroll affordance with dark variants — on both homes. All transitions 200ms, all tokens (no raw hex outside the existing branding-color fallback).
- The What's-New feed leads with the hand-over story; the unread counter test re-anchored for the 2.112.0-fed feed (2.110.0→1, 2.109.0→2, 2.108.0→3, 2.77.0→34).

### Security
- The hand-over widens nothing: the link is a display selector over tabs the session can already see; the branch param remains a client-side filter over already-authorized rows; the server guards (`/api/org/summary` ORG_ROLES-only, HR report permission) still fail-closed. `target="_blank"` carries `rel="noopener noreferrer"` like every external-facing link in the selector.

## [2.111.0] The app speaks deep links; every settled run opens its door

Reach-and-auditability release: deep links into the People & Payroll tab (`?tab=` + `?branch=`), run-detail doors on the ledger drawer's settled-run chips, and the October BONUS run walked the full maker-checker lifecycle (approved by a different actor, posted with its journal) as the round's live end-to-end proof.

### Added
- **Deep links** (`src/app/(shell)/page.tsx`): a URL may name the tab (`?tab=<id>`). The boot effect validates the id against TAB_CONFIG and applies it AFTER the persisted store's async rehydrate settles (a synchronous write would be overwritten), then strips the param — a refresh returns to the persisted tab. Unknown ids are ignored silently.
- **Branch deep links** (`src/app/(shell)/tabs/people-payroll-tab.tsx`): `?branch=<storeId>` seeds the shared panel's filter. Every user change mirrors into the URL via `history.replaceState` (no navigation, no history entry); leaving the tab strips the param so a stale filter cannot haunt the next mount. While the filter still holds the link's value (and only then) the count reads "showing 1 of 5 (from link)".
- **Run-detail doors** (`src/app/(shell)/hr/payroll/page.tsx`): the ledger drawer's zero-run chips (slate, violet focus ring) and missing-journal chips (rose, rose focus ring) are real buttons with honest aria labels. Clicking hands the run to the run-detail dialog — the ledger drawer closes first, so two dialogs never stack. An audit starts from the line, not from a hunt.
- **The October BONUS run completed its lifecycle** (live data): prepared and submitted by SUPER_ADMIN, approved by STORE_OWNER (a distinct actor — maker-checker holds), posted with its journal and payslip numbers. The period drawer now shows three posted entries plus the quiet zero run.

### Changed
- `PeoplePayrollByBranch` accepts `defaultBranchId` and `onBranchFilterChange`; every mutation path (select AND Reset) reports through one `changeBranch` funnel.
- The What's-New feed leads with the deep-link story; the unread counter test re-anchored for the 2.111.0-fed feed (2.109.0→1, 2.108.0→2, 2.77.0→33).

### Security
- The deep links widen nothing: `?tab=` only selects among tabs the session can already see (a role-locked tab still renders its locked state, and server guards still fail-closed on every fetch); `?branch=` is a client-side filter over already-authorized rows. No URL value is trusted beyond choosing what to display — no navigation targets, no redirect surface.

## [2.110.0] The drawer knows a zero when it sees one; the people panel learns to filter

Honesty-and-reach release: the payroll period ledger's missing-journal alarm stops firing on zero-value runs (a long-running false alarm on the seeded 0-value LOCKED REGULAR October run), the People & Payroll shared panel gains a per-branch filter, and the period-journal API carries each run's payable truth so the drawer's classification reads server numbers, never guesses.

### Added
- **Zero-run honesty in the period ledger** (`src/lib/hr/payroll/period-journal.ts`): `PeriodLedger` grows a `zeroRuns` bucket — settled runs with nothing payable (totalNet 0 at 2dp) and no journal are surfaced in their own quiet block ("nothing was payable, so no journal posts — correct by design") instead of tripping the red missing-journal alarm. The alarm keeps its teeth: a settled run that owed money without an entry still fires "this must never happen".
- **Payable truth on the wire** (`GET /api/payroll/period-journal`): the runs select now reads `totalNet` and feeds it to the builder, so the value-aware split (money → alarm, dust → quiet) is decided on server numbers at 2dp precision — a float hair (0.004) is still a zero run, and a fake zero can never mask a real debt.
- **Per-branch filter on the People & Payroll panel** (`src/components/finance/people-payroll-by-branch.tsx`): a native select ("All branches" + each branch), a "showing X of Y" count and a Reset affordance, styled to the panel's design system (orange focus ring, dark variants). The filter is ONE pure function (`filterBranchRows`) feeding BOTH the desktop table and the mobile cards; it narrows, never reorders, and an unknown id is an honest empty state, never a silent fallback to all. Because it lives inside the shared panel, the Finance & Insights tab and the Expert Console both get it from one implementation.
- **Documentation**: docs/PAYROLL_LEDGER_ZERO_RUNS.md (the value-aware classification contract) and the filter contract added to docs/PEOPLE_PAYROLL_BY_BRANCH.md.

### Changed
- The period ledger drawer's empty state also counts zero runs before claiming "Nothing posted in this period yet."
- The What's-New feed leads with the zero-run story; the unread counter test re-anchored for the 2.110.0-fed feed (2.108.0→1, 2.107.0→2, 2.77.0→32).

### Security
- No new endpoints and no widened reads: the period-journal route keeps its exact guard (hr.payroll.read.all, the runs list's roles), tenant scoping, and payload shape (additive `zeroRuns` only). The filter is client-side over already-authorized rows — selecting a branch cannot fetch anything the caller could not already read.

## [2.109.0] People and payroll joins Finance and Insights; console navigation and icons unified

Information-architecture release directed by product feedback: the per-branch people and payroll drill-down moves under Finance and Insights, the two consoles share one implementation, the Expert Console gains a Home action back to POS, and the navigation order and icons are made deterministic.

### Added
- **People and Payroll tab (Finance and Insights)**: the "People and payroll by branch" panel now has its own tab in the main SPA's Finance and Insights group (id `people-payroll`, UserCog icon, offered to exactly the roles /api/org/summary's guard serves: SUPER_ADMIN, STORE_OWNER, ACCOUNTANT; locked in the sidebar for everyone else). The tab reads the same additive hrPerStore block the consoles read; per branch it shows headcount, employment cost (KES, thousands separators), absence rate, latest payroll run, and expiry alerts.
- **Shared panel component** (`src/components/finance/people-payroll-by-branch.tsx`): one implementation, two homes (Expert Console collapsed by default, the new tab expanded by default). Missing data shows precise reason codes (PAYROLL_RUN_NOT_AVAILABLE, PERMISSION_DENIED, HR_DATA_SOURCE_UNAVAILABLE, API_ERROR_SAFE), never blank, undefined, NaN, or fabricated numbers. Desktop renders a dense table with a sticky header, mobile renders cards, neither scrolls horizontally.
- **Expert Console Home action**: a Home button (Home icon, accessible name "Back to POS", testid `console-home-pos`) in the /console header, placed first in the actions row so it cannot overlap badges or menus. It returns to the POS workspace through ONE internal helper (`goHomeToPos`: sets the pos tab in the app store, assigns "/"), so it cannot become an open redirect.
- **Unified console shell** (`src/components/console/unified-console.tsx`): Organization Console and Expert Console render through one shared shell (mode "organization" / mode="expert") that unifies the mode contract, the skip-to-content landmark, and the main landmark, while each console keeps its own header design and every existing capability (see docs/CONSOLE_MERGE_PARITY_MATRIX.md).
- **Documentation**: docs/NAVIGATION_INFORMATION_ARCHITECTURE.md, docs/ICON_SYSTEM.md, docs/CONSOLE_MERGE_PARITY_MATRIX.md, docs/FINANCE_INSIGHTS_NAVIGATION.md, docs/EXPERT_CONSOLE_HOME.md, docs/PEOPLE_PAYROLL_BY_BRANCH.md.

### Changed
- **Navigation order**: the workspace links (Branch Selector, Organization Console, Expert Console, Global Chat) moved below the navigation rail so their visible order now follows the Admin module exactly: Admin, Branch Selector, Organization Console, Expert Console, Global Chat.
- **Icons**: Admin wears ShieldCheck; Branch Selector wears Building2; Organization Console wears Network; Expert Console keeps Gauge; Global Chat keeps MessagesSquare (clearly a chat icon, consistent with the app's existing chat surfaces). Every TAB_CONFIG entry carries a required icon (type-enforced), with no duplicate ids or labels.
- **The Expert Console page consumes the shared panel**; the old inline per-branch table was removed (its logic lives only in the shared component now).

### Security
- The people-payroll tab is offered to exactly the roles the org-summary endpoint's guard serves; the server re-validates every request and fail-closes (no HR module or no HR report permission means no hrPerStore block).
- The Home action navigates through one internal helper that accepts no external URL, so it cannot become an open redirect.
- One shared database and storeId tenant isolation are unchanged; no destructive database operations were performed.

## [2.30.0] Payroll tab leave/attendance contract fix + manager approval UX completion

QA-caught crash fix with a feature completion pass. Browser QA on v2.29.1 reproduced "Unable to load Payroll" (`SectionErrorBoundary:Payroll`, `TypeError: Cannot read properties of undefined (reading 'firstName')`) the moment the Payroll tab was opened with the seeded PENDING leave request in the database — the first leave request in any store crashed the whole tab. Root cause: the Leave sub-tab rendered `l.employee.firstName` / `l.leaveType.name`, but `GET /api/leaves` returns FLAT DTOs (`employeeName`, `employeeJobTitle`, `leaveTypeName`… — no nested objects); the interface in the tab described a shape the API never shipped. The Attendance sub-tab carried the identical latent bug (`r.employee.firstName` vs the flat `/api/attendance` DTO) and would have crashed on the first attendance record. A second latent bug hid underneath: the approve/reject buttons sent lowercase `action: 'approve' | 'reject'` while `PUT /api/leaves` requires UPPERCASE `'APPROVE' | 'REJECT'` — every decision click would have 400'd even without the crash. The seeded PENDING request from v2.29.1 is what finally exposed both.

### Fixed
- **Leave sub-tab crashed the Payroll tab on the first leave request**: rewritten against the real flat DTO (`employeeName`, `employeeJobTitle`, `photoUrl`, `leaveTypeName`, `leaveTypeCode`, `isPaid`, `isStatutory`, `workingDays`, `halfDay`, `reason`, `rejectionReason`, `returnDate`, `approvedAt`, `emergencyContact`). The Attendance sub-tab received the same contract fix (`employeeName`, `employeeJobTitle`, `overtimeHours`, `lateMinutes`). A static contract test (`src/tests/lib/payroll-tab-contracts.test.ts`) now forbids `l.employee.*` / `r.employee.*` / `l.leaveType.*` / `l.days` reads in the tab and pins the flat field names, so the shape drift can never ship again.
- **Approve/reject actions 400'd**: the mutation now sends the UPPERCASE actions the API requires, and the toast copy no longer reads "APPROVEd successfully".
- **Approving leave never incremented `usedDays` (silent balance corruption)**: QA exercising the approve flow found the manager-approved request left the employee's balance at `used: 0`. Root cause: Prisma returns Decimal columns as decimal.js objects whose `valueOf()` is a STRING, so the inline arithmetic in `updateLeaveBalanceOnStatusChange` did `usedDays + days` as string concatenation (`"0" + "2" = "02"`) and `round2()` collapsed it to 0 — every approval since the Decimal migration silently refunded the taken days. (The REJECT path only looked healthy because `-` coerces numerically — exactly the asymmetry that hid the bug.) All transitions now route through the pure, Decimal-safe `leaveStatusTransitionDelta` (Number() coercion at the boundary, unit-tested with a decimal.js `valueOf` stub), and `PUT /api/leaves` additionally runs the idempotent aggregate-derived `recomputeBalances()` after every decision, which also HEALS balances corrupted by the old bug.
- **The same Decimal trap, closed everywhere it was live in the leave domain**: `GET /api/leaves?balances=true` computed `availableDays` with a bare `+` — a 21-day allocation rendered as **"210 of 21 d available"** (the QA screenshot caught it: `"21" + "0"` = `"210"`, then `-` coerced numerically). `getOrCreateLeaveBalance` computed the same corrupt `available` (so the POST leave-balance guard could never trip), the POST handler inflated `pendingDays` the same way (`"3" + 2` → 32 days once a balance already had pending rows), and the legacy payroll run's overtime reducer (`sum + Decimal`) concatenated multiple overtime records into garbage totals. All four sites now coerce with `Number()` before arithmetic. (TypeScript flagged every one of these as pre-existing TS2365/TS2363 baseline errors — the audit traced them and closed the live ones in the leave/attendance/payroll path; remaining flagged sites in other domains are listed in the worklog for a dedicated hygiene round.)
- **Attendance rows crashed on Decimal-serialized strings (QA-caught on the rebuilt build)**: setting the attendance date range to a window WITH records crashed the tab again — `TypeError: workingHours.toFixed is not a function`. `GET /api/attendance` serializes the Decimal columns (`workingHours` / `overtimeHours` / `lateMinutes`) through `Response.json`, where decimal.js' `toJSON` emits a STRING — calling `.toFixed()` on it throws. The rows (and the Avg Hours reducer, which would have string-concatenated the same way) now read every numeric field through the tab's `toNum()` money-guard; the contract test extends to forbid direct `.toFixed()` on DTO fields.

### Added
- **Reject-with-reason dialog**: rejecting a request now requires a reason (`rejectionReason`), persisted by the existing `PUT /api/leaves` contract and displayed to the employee as "Declined: …" in their self-service portal (the portal already rendered the field — the manager side just never collected it). Rejected rows show the reason inline (truncated with tooltip).
- **Request details dialog** ("View" on every row): full decision context — type, status, from/to, working days, paid/unpaid, half day, expected return, the employee's stated reason, rejection reason, emergency contact, and the decision timestamp — with Approve/Reject actions inline for PENDING rows.
- **Balances panel**: `GET /api/leaves?balances=true` always returned per-employee balance rows, but the tab (and the generic `apiFetch` helper, which unwraps only `data`) dropped them. A new `apiFetchEnvelope` helper preserves the full response envelope, and the new Balances card lists each employee × leave type with available/allocated days, a color-coded utilisation progress bar (emerald <50%, amber 50–79%, rose ≥80%), and pending-day counts. The pure presentation rules live in `src/lib/leave-tab.ts` (`balanceTone`, `balanceUtilization`, `initialsOf`, `leaveTypeStyle`) with unit coverage.
- **Tests**: 22 new cases (902 total) — the static contract guard (6), presentation-helper units (9: tone buckets incl. NaN fail-soft, utilization clamps, initials edge cases, per-code badge colors), and the balance-transition delta units (7: the Decimal `valueOf` stub reproducing the exact `"0" + "2" = "02"` trap, every transition row, negative/NaN/undefined clamps).
- **scripts/verify-v2-30-0.mjs** (`npm run verify:v2-30-0`): static checks over the flat-DTO rewrite, the uppercase actions, the envelope helper, the Decimal-safe transition delta + the recompute healing call, the pure module's directive-free state, the contract test's coverage, and version metadata (including the `mbumah.releaseVersion` lockstep check).

### Changed
- **Styling pass on the leave desk (and attendance table)**: status accent rails on request rows (amber PENDING / emerald APPROVED / rose REJECTED), initial avatars, type-colored badges (per-leave-type color families from `leaveTypeStyle`), tabular numerals on all date/time columns, hover elevation on cards and balance rows, spinner states on decision buttons, and an overtime/late-minutes sub-line on attendance rows.

## [2.29.1] Correction: SSR portal pages crashed when calling formatters imported from the client module

Correction release. QA on the v2.29.0 production build caught `/employees/me/payslips` crashing ("Something went wrong") for every employee with payslips; the regression hunt then surfaced a second latent instance of the same bug on the documents page.

### Fixed
- **Server pages called client-module functions during the server render**: the v2.29.0 payslips page imported `formatKes` from `@/components/hr/self-service-ui` — a `'use client'` module. On the server, plain-function exports of a client module are client REFERENCES, not functions, so invoking one inside the server component threw and the whole route hit the crash boundary. The formatter was moved to the import it was architected for (`@/components/hr/self-service-format`, the directive-free pure module both graphs can import — the same one `home-view.tsx` already used). The documents page had the identical latent bug with `formatDate`: it rendered fine only because the QA account had zero documents — any employee with a dated document would have crashed that route too. Both imports now come from the pure module; no other portal page imports formatters (statically verified).

### Added
- **Regression guard** (`src/tests/lib/self-service-server-format.test.ts`, 8 cases): statically enforces that all six `/employees/me/*` server pages never import `formatKes`/`formatDate` from the client module, that the two corrected pages import them from the pure module, and that the pure module stays directive-free (`'use client'`/`server-only` free) — the boundary violation can never ship again.
- **scripts/verify-v2-29-1.mjs** (`npm run verify:v2-29-1`): static checks over both corrected imports, the other four pages, the pure module's directives, the guard's coverage, and version metadata.

## [2.29.0] Self-service depth: SSR payslip year switcher, leave provisioned for everyone, email-log CSV export

Feature release (post-EMS polish round). Deepens the just-SSR'd self-service portal (v2.28.0) with the payslip year dimension, closes the leave happy-path gap (the dev data had zero leave types, so the request form was unreachable), and gives admins the offline audit affordance carried over since v2.26.0.

### Added
- **SSR payslip year switcher** (`/employees/me/payslips`): the page reads a validated `?year=YYYY` search param (anything non-4-digit falls back to the unfiltered latest-60 window) and renders a segmented-control switcher — "All years" plus every year the employee actually has payslips in, derived by the new pure-DB helper `listMyPayslipYears` (distinct `getUTCFullYear` buckets over the same 60-row window the list reads, newest first; a UTC bucket matches the `Date.UTC` bounds the list endpoint filters with, so a viewer's timezone can never put a period in the wrong year). Switching years is plain `<Link>` navigation — every view is server-rendered. Each view gains a `tabular-nums` summary line ("N payslips · KSh X net", `aria-live="polite"`).
- **Email-log CSV export** (`Admin` → Email delivery log → "Export CSV"): `GET /api/notifications/logs?format=csv` streams the full filtered history (active status/type filters apply; pagination ignored; hard cap 2 000 rows as a runaway guard) as RFC 4180 CSV — `text/csv; charset=utf-8`, dated `Content-Disposition` filename, `Cache-Control: no-store`. The branch short-circuits BEFORE the paginated query so an export never pays for the page fetch + count. The serializer lives in its own pure module (`src/lib/email-log-csv.ts`: comma/quote/CR/LF cells quoted, embedded quotes doubled, nulls → empty cells, dates → ISO, `message_id` pulled from parsed metadata, `triggered_by` as `Name <email>`); the viewer renders the export as a real anchor whose href carries the active filters — the download always matches what is on screen.
- **Leave provisioned for everyone** (`scripts/qa-seed-leave-dev.mjs`, idempotent): upserts the five standard Kenyan leave types (ANNUAL 21 / SICK 10 / MATERNITY 90 / PATERNITY 14 / COMPASSIONATE 5, statutory flags per the Employment Act, carry-forward rules on ANNUAL only) and grants every employee a current-year balance per type (`allocatedDays = defaultDaysPerYear`, carry-forward 0 — usage stays owned by `recomputeBalances`, mirroring `grantBalance` semantics). Dev DB before this round: **0 leave types, 0 balances** — the portal request form was unreachable; after: 5 types, 30 balances (6 employees × 5 types), and the request-dialog happy path is QA-able end to end.
- **Tests**: 10 new cases (872 total) — `email-log-csv.test.ts` (7: plain cells, quote/comma/CR/LF escaping with doubled quotes, null→empty + ISO dates, header row + CRLF framing, full row shape incl. `message_id`/`triggered_by`/error, absent-metadata empty cells) and `payslip-years.test.ts` (3: distinct years newest-first over the 60-row window with the same `take: 60` contract asserted, UTC bucketing not viewer-local, empty list without payslips).
- **scripts/verify-v2-29-0.mjs** (`npm run verify:v2-29-0`): static checks over the year helper (UTC bucket + window), the page's param validation + SSR switcher + summary line, the serializer + route short-circuit + role gate + viewer anchor, the seed's idempotency + type coverage, and version metadata (including the `mbumah.releaseVersion` lockstep check added after the v2.28.0 near-miss).

## [2.28.0] Self-service SSR completion: the whole portal server-renders, plus the notification "Email failed" filter

Feature release (post-EMS polish round). Closes the longest-standing item on the self-service list (carried since v2.24.0): the five remaining client-side portal pages — payslips, attendance, leave, goals, documents — are now server components behind one shared guard, so every `/employees/me/*` route arrives with its data already in the HTML. The notification center gains an "Email failed" filter so a broken digest send is one tap away.

### Added
- **SSR completion across the self-service portal**: `payslips`, `attendance`, `leave`, `goals` and `documents` are now server components (`export const dynamic = 'force-dynamic'`) that render through the SAME services the API routes expose (`listMyPayslips`, `listMyAttendance`, `listMyLeave`, `listMyGoalProgress` + `listMyPerformanceReviews`, `listMyDocuments`) — LCP ≈ FCP on all six portal routes, matching the v2.24.0 home-page remediation. The API routes remain for the interactive islands and programmatic consumers.
- **Shared portal guard** (`self-portal.tsx`): one `loadSelfPortal(permission)` implementation of the signed-in → module-enabled → employee-linked contract, shared by all six pages (previously inlined only on the home page; the client pages rendered bare error notes with a sign-in affordance divergence). The guard returns the resolved employee or the ready-to-render `PortalNote`.
- **Notification-center "Email failed" filter**: a new filter tab (rose `MailX` marker) that narrows the feed — active AND dismissed lists — to digest copies whose email delivery FAILED, backed by the pure fail-soft predicate `isFailedEmailDigest` in `digest-notification-view.ts`. The tab appears only when the feed actually carries `hr_digest` rows, so it is never dead chrome.
- **Styling pass (shared header)**: all six portal pages now render one `SelfPageHeader` — gradient icon tile (per-page tone), title, supporting line, optional action slot — plus per-card polish: payslip cards carry status accent rails (emerald POSTED / amber LOCKED), attendance tiles and rows gain hover states and tabular numerals, leave/goal/document cards gain consistent hover elevation, and the attendance month line names the month explicitly.
- **scripts/verify-v2-28-0.mjs** (`npm run verify:v2-28-0`): static checks over the shared guard, the five SSR pages (server-only, force-dynamic, permission, service), the preserved offline contracts (cache keys `mbt_self_payslips_cache_v1` / `mbt_self_payslip_v1:<id>`, connection-tracked offline banner), the POST-then-`router.refresh()` flows, the filter predicate + tab gating, and version metadata.
- **Tests**: 4 new cases (862 total) covering `isFailedEmailDigest` — matching rows, non-matching rows (SENT / no stamp / other types), fail-soft behavior on malformed input (null / scalar / array), and junk-tolerant matching.

### Changed
- **Leave request and review acknowledge flows** now `router.refresh()` the server render after a successful POST instead of hand-refetching JSON — the dialog closes onto freshly server-rendered balances/requests/reviews.
- **Payslips offline banner** now tracks the browser's real connection (`online`/`offline` events) instead of a failed fetch — accurate now that the list itself is server-rendered; the offline cache-first behavior of the breakdown dialog is unchanged.
- **docs/hr/self-service.md**: the "portal pages remain client components" caveat is replaced by the v2.28.0 SSR-completion section (guard consolidation, service-rendered reads, preserved offline contracts, shared header).

## [2.27.0] Delivery intelligence: per-recipient delivery expansion, digest rows that link to their schedule

Feature release (post-EMS polish round). Closes the two remaining delivery-observability gaps from the v2.25.0/v2.26.0 loop: a delivery attempt now expands to show exactly which addresses it was addressed to, and the notification center's digest copies finally tell you what happened to the email — and jump straight to the schedule that produced them.

### Added
- **Per-recipient delivery expansion** (Reports → Schedules → History): every delivery-history row is now expandable (chevron + `aria-expanded`, full-row button with focus ring) and reveals a per-recipient chip list parsed server-side from the envelope's address column — each chip carries the attempt's outcome glyph (✓/×/…) and a tooltip ("address — attempt FAILED"). The row header now shows the parsed address count instead of the metadata-derived number, so the two can never disagree. Expansion collapses automatically when the panel closes or another schedule's history opens.
- **Digest-row intelligence in the notification center**: HR digest copies (v2.24.0) previously rendered as generic info rows — a FAILED email looked identical to a healthy one. The `/api/notifications` route now flattens each digest copy's `Notification.metadata` through a pure fail-soft mapper (`parseDigestNotificationExtras`, shape-guarded, allow-list only) into three feed fields: `emailStatus` renders a delivery chip ("Email sent" emerald / "Email failed" rose), `manual` renders a sky "manual" marker, and `scheduleId` renders a violet **"Manage schedule"** affordance next to "Open report" that navigates to `/hr/reports?tab=schedules&schedule=<id>`. Digest rows also gain a violet left accent rail so they scan as a distinct class at a glance.
- **Per-schedule deep-link highlight** (Schedules tab): the reports page reads a new `?schedule=<id>` query param and passes it into the Schedules tab, which scrolls the matching card into view and ring-highlights it (violet ring, offset) for four seconds — so "Manage schedule" lands you on the exact schedule, not just the tab.
- **Tests**: 9 new cases (858 total / 46 files) — `hr-schedule-deliveries.test.ts` extends the delivery mapping with `recipientList` parsing (joined pair, messy input with spaces/empty/address-less fragments, single recipient) and the new mapper test file `digest-notification-view.test.ts` covers the full fail-soft contract (valid payloads, null/non-string input, malformed JSON, non-object JSON, shape-guard drops, allow-list behavior).
- **scripts/verify-v2-27-0.mjs** (`npm run verify:v2-27-0`): static checks over the service parser, the UI expansion + reset semantics, the mapper + route flattening + API types, the notification-center chips/deep link, the reports-page param pass-through, the card highlight, and version metadata.

## [2.26.0] Delivery ops console: admin email log viewer, digest recipient management, schedule write scope

Feature release (post-EMS polish round). Completes the delivery-observability loop started in v2.25.0 with an ops-facing surface: the Admin tab gains a read-only viewer over the (now durable) email delivery log, scheduled digests gain in-place recipient management with live validation, and schedule writes are finally as fail-closed as schedule sends.

### Fixed
- **Schedule PATCH/DELETE bypassed the branch scope (fail-closed doctrine violation)**: `updateSchedule` and `deleteSchedule` accepted any schedule in the organization from any role the route guard admits — including BRANCH_MANAGER. A branch manager could edit, pause or delete an org-wide or another branch's schedule, or worse, add their own address to an org-scope digest and start receiving aggregates of branches they must never see (send/preview/history have been fail-closed since v2.24.0; writes were not). Both writes now run `assertScheduleScope` (BRANCH managers may only manage their own branch's schedule; org-wide stays out of their scope; `STORE_SCOPE_FORBIDDEN` 403 otherwise), the PATCH/DELETE routes pass the real actor role/store, and the UPDATE/DELETE audit rows carry the actual actor identity instead of the synthetic `SYSTEM`.

### Added
- **Admin email delivery log viewer** (`Admin` tab → "Email delivery log"): a read-only console over `/api/notifications/logs` — the endpoint restored in v2.25.0 that no UI consumed until now. Every outbound email attempt (receipts, low-stock alerts, HR digests, …) is listable with status filters (ALL/SENT/FAILED/PENDING chips), a type filter mirroring the API whitelist, 15-per-page pagination with a total counter, 60s auto-refresh, and per-row expansion showing the delivery error, the parsed metadata (messageId, scheduleId, reportKey, actor), and the attributed user when known. Status/type chips and all interactive elements carry dark variants and focus rings; subject/recipient truncate with tooltips to keep the dense table scroll-free on mobile.
- **Digest recipient management** (Reports → Schedules): every schedule card's recipient chips and a new "Recipients" action open an editor dialog — one address per line, live per-address validation (invalid addresses highlighted red, valid ones green), automatic dedupe/trim/lowercase mirroring the server rules, a save button that stays disabled until the draft is valid and actually changed, and inline surfacing of scope errors (the new 403). Saving PATCHes `recipients` and refreshes the list; the next scheduled fire uses the updated list.
- **Tests**: 6 new cases (849 total / 45 files) — schedule write scope: BRANCH manager org-wide PATCH 403 with no DB write, other-branch PATCH 403, own-branch PATCH succeeds with recipients normalized (trim/lowercase/dedupe) and the real actor audited, org-role PATCH of org-wide still allowed, DELETE 403 + real-role audit on success, 404 precedence before scope checks.
- **scripts/verify-v2-26-0.mjs** (`npm run verify:v2-26-0`): static checks over the scope enforcement + audit attribution, the route actor pass-through, the viewer component/filters/pagination + admin-tab mount, the recipient editor affordances, and version metadata.

## [2.25.0] Digest delivery observability: durable email log, delivery history, dry-run preview

Feature release (post-EMS polish round). Makes email delivery observable end to end: the delivery log that the central email service has been trying to write since the email feature shipped actually persists now (the Prisma model had never been created), every scheduled digest gains a per-schedule delivery history with health dots, and a new dry-run preview shows exactly what the next digest email will contain — without sending anything.

### Fixed
- **The email delivery log was silently dead since it shipped (P0 latent)**: `src/lib/email-service.ts` writes every outbound attempt to `db.notificationLog`, and `GET /api/notifications/logs` reads the same table — but the `NotificationLog` model had never been added to `schema.prisma` (verified against the full git history). Writes were swallowed by the best-effort try/catch (emails still sent, history lost) and the logs endpoint failed at runtime for the only roles allowed to call it (SUPER_ADMIN / STORE_OWNER). The model now exists (`notification_logs` table: type, recipient, subject, status PENDING|SENT|FAILED, error, metadata JSON, sentAt), with a `User` relation on `ON DELETE SET NULL` so history survives user deletion, indexes on (type, createdAt), (status, createdAt), userId and createdAt, and a migration for the `migrate deploy` path (drifted databases converge via the schema-sync fallback as before). Attribution semantics unchanged: a failed log write still never masks the send result.

### Added
- **Per-schedule delivery history** (`GET /api/hr/reports/schedules/[id]/deliveries`): the last 10 `HR_REPORT_DIGEST` delivery attempts for a schedule, correlated via the `metadata.scheduleId` the digest sender stamps on every send (scheduled sweep and manual alike). Read-only and fail-closed on the same scope as send-now: BRANCH managers may read only their own branch's schedule (`STORE_SCOPE_FORBIDDEN` 403 otherwise, org-wide schedules included); org roles may read any schedule of their organization; unknown schedules 404. The Schedules tab renders it as an inline expandable panel (status chips, timestamps, recipient counts, manual-send markers, the provider error line) plus a "health dots" strip — the last 10 sends as green/red/amber dots with per-dot tooltips and an accessible summary label.
- **Dry-run digest preview** (`GET /api/hr/reports/schedules/[id]/preview`): computes exactly what the next email would contain through the same governed report functions and fail-closed scope as a real send — without sending email, writing any log/notification, or touching `lastRunAt`/`lastStatus`. The new `nextScheduleRunAt` helper computes the next due instant from the frequency slot AFTER both "now" and the last run (manual sends never move the cadence; DAILY/WEEKLY/MONTHLY semantics mirror `isScheduleDue`). The Schedules tab opens it in a dialog styled like the email itself: gradient header strip with report name/period/scope, headline stat grid, the aggregate table, recipient chips, the next scheduled send time, and the aggregates-only notice. When the report has no data for the period the dialog shows the reason instead of the stats.
- **Notification bell a11y**: the sidebar bell (both expanded and collapsed variants) now has an accessible name with the unread count ("Notifications (3 unread)") plus `aria-haspopup="dialog"`; previously it was an icon-only button with no name (caught in browser QA with a tree search for named buttons).
- **Tests**: 23 new cases across two files — `hr-schedule-deliveries.test.ts` (nextScheduleRunAt DAILY/WEEKLY/MONTHLY including the lastRunAt cadence guard; deliveries 404/403/metadata mapping/limit capping/malformed-metadata fallback; preview 404/403 + the pure-read assertion set: no email, no NotificationLog row, no notification row, no lastStatus stamp; unavailableReason path) and `email-delivery-log.test.ts` (SENT row with sentAt + messageId metadata, provider-failure row, Resend error-payload variant, unconfigured-key row, invalid-recipient row without touching the provider, and the log-write-failure-never-masks-the-result contract). Suite: 843 tests / 45 files.
- **scripts/verify-v2-25-0.mjs** (`npm run verify:v2-25-0`): static checks over the schema/migration/relation, the service scope + correlation contracts, the pure-read preview, the UI affordances, the bell a11y, and version metadata.

### Changed
- `tsc` baseline improves 477 → 473: restoring the missing model fixed the five pre-existing "type 'never'" errors in `/api/notifications/logs` and shrank the select-type mismatch noise in `/api/notifications/settings`.

## [2.24.0] Slim self-service portal (Lighthouse 94), digest send-now, in-app digest copies

Feature release (post-EMS polish round). Closes the documented Lighthouse blocker by splitting the app router into route groups and server-rendering the self-service home (performance 81 → 94, TBT 350 → 170 ms), and completes the digest loop with an on-demand "Send now" plus notification-center copies of every digest outcome.

### Added
- **Route-group bundle scoping**: the root layout now renders only the document shell; the POS provider stack (React Query, auth/app stores, alert popups, toaster) moved into the new `(shell)` route group, while `/employees/me` lives in `(selfservice)` with a slim `SelfServiceProviders` (theme + crash boundary + console error logging only). URLs are unchanged. The self-service portal no longer boots the POS runtime, which used to cost ~2.3 s of main-thread work on the Lighthouse mobile CPU.
- **Server-rendered self-service home**: `/employees/me` is now a server component — session via the new `getSessionFromCookies()` (cookies()-based RSC session resolution with the same expiry/lockout semantics as the request path), dashboard payload via the same `getMyDashboard` service the API route uses, HTML streamed with real content (`home-view.tsx`; LCP 3.9 → 2.5 s, LCP score 0.53 → 0.89). The offline localStorage mirror is preserved by a tiny client island (`cache-writer.tsx`) writing the same cache key. Attendance clock times now render with an explicit Africa/Nairobi timezone (previously viewer-local). Pure formatters moved to the directive-free `self-service-format.ts` so server components can call them (a `'use client'` module's functions may not be invoked from the server).
- **Digest "Send now"** (`POST /api/hr/reports/schedules/[id]/send-now`): sends a schedule's aggregate digest immediately without touching the cadence (`lastRunAt` stays — a manual send is not a schedule fire; `lastStatus`/`lastError` reflect the last attempt). Scope is fail-closed: BRANCH managers may only send their own branch's schedule (`STORE_SCOPE_FORBIDDEN` 403 otherwise, org-wide schedules included); org roles may send any schedule of their organization. Every send is audit-logged with the real actor and a `manualSend` marker.
- **In-app digest copies**: every digest outcome — scheduled sweep or manual send — writes a notification-center copy (`Notification` category `HR`) addressed to the schedule creator / acting user, with the digest headline (aggregate-only), the delivery status, and a deep link to the exact report tab (`/hr/reports?tab=…&storeId=…`). Successes stay quiet (info); failed deliveries ride priority HIGH so the alert popup host surfaces a silently broken cadence. The `/api/notifications` feed gained an `hr_digest` section (user-addressed, read via `runWithoutTenant` like the security rows), the Alerts panel renders them with a chart icon, visible "Open report" affordance and deep-link navigation, and the Schedules tab confirms each manual send with an inline result banner.
- **Tests**: 5 new `sendScheduleNow` cases (404 unknown/cross-org, BRANCH out-of-scope 403, own-branch SENT with `lastRunAt` untouched + actor-attributed audit + quiet notification, FAILED stamps + HIGH-priority copy, SKIPPED no-data path still writes the copy). Suite: 820 tests / 43 files.
- **scripts/verify-v2-24-0.mjs** (`npm run verify:v2-24-0`): static checks over the route-group layout, slim providers, SSR home + cache island, formatter extraction, send-now route/service contract, digest notification wiring, feed/UI handling, and version metadata.

### Fixed
- **Bodyless POSTs through the lean `apiSend` helper were rejected with 415** ("Content-Type must be application/json"): the helper omitted the Content-Type header whenever the body was undefined, and the proxy's `validateContentType` requires it on POST/PATCH. QA caught this on the new digest send-now button; the same latent defect silently broke goal acknowledge (`/api/self-service/me/reviews/[id]/acknowledge`) and goal recompute (`/api/hr/goals/[id]/recompute`). The helper now always declares the header, matching the main `lib/api` request wrapper.
- **The committed Prisma schema has carried `provider = "sqlite"` since v2.18.4.0**: a local postinstall provider flip was committed despite the schema header documenting `postgresql` (production builds were never affected - `vercel-build` re-runs `setup-prisma-provider.mjs` against the real `DATABASE_URL` before `prisma generate`). The committed schema is restored to `postgresql`, and the Security & Schema CI job gained a flip-proof guard that reads the provider from the git OBJECT and fails any commit carrying a non-postgresql provider.

### Changed
- `docs/hr/self-service.md`: the Lighthouse blocker section is resolved with the measured v2.24.0 table (81 → 94) and the two-layer remediation record (route groups + SSR home).

## [2.23.0] Per-branch HR drill-down, scope-aware digests, self-service perf pass

Feature release (post-EMS polish round). Adds the organization console's per-branch "People & payroll" drill-down with deep links into per-branch report views, per-branch scoping for reports and scheduled digests with fail-closed store enforcement, and the first authenticated Lighthouse measurement of the self-service portal (performance 73 → 81, accessibility 100).

### Added
- **Per-branch report drill-down** (`?storeId=` on the six report routes): ORG-scope callers (SUPER_ADMIN/STORE_OWNER/HR_MANAGER/ACCOUNTANT) can narrow any aggregate report to one branch. Fail-closed by construction — the store must belong to the caller's organization (`STORE_NOT_FOUND` 404), BRANCH-scope callers are rejected outright (`STORE_NARROWING_FORBIDDEN` 403; they are already scoped to their own store), and even a hostile storeId cannot widen access because the org-membership condition stays ANDed in every where-clause. The /hr/reports page reads `?storeId=` from the URL (bookmarkable), shows a clearable "Branch: <name>" chip, and appends the filter to every tab's fetch.
- **Org-console "People & payroll by branch"**: `GET /api/org/summary` now embeds an additive `hrPerStore` block (headcount, month cost, absence rate, latest payroll run, expiry alerts per branch — the exact tile definitions reused via grouped queries + per-store counts) and BOTH org consoles render it: the expert console (/console) as a collapsed "People & payroll by branch (n)" panel with per-branch rows deep-linking into `/hr/reports?tab=…&storeId=…`, and the workspace console (/org/dashboard) as an expandable table with sticky headers, status badges and dark variants. Rows carry store names only — aggregates stay PII-free.
- **Per-branch scheduled digests**: the Schedules tab gains a "Branch scope" selector (All branches / per branch, fed by the new session-scoped `GET /api/hr/stores`) and schedule cards badge the scoped branch. Enforcement is scope-aware server-side: BRANCH managers are PINNED to their own store (`STORE_SCOPE_FORBIDDEN` 403 on any other store — a manager can never schedule a digest for a branch they cannot see), ORG scopes may target any store of their organization or leave it org-wide, and the digest sweep computes branch-scoped reports under a BRANCH_MANAGER-scoped synthetic session exactly as before.
- **Authenticated Lighthouse measurement** (`scripts/qa-lighthouse-authed.mjs`): launches Chrome with a persistent profile + CDP, seeds the SPA's `mbt_token` cookie via `document.cookie` on an origin page, then drives `lighthouse@12 --port` against the same instance so instrumented tabs share the cookie jar (passing the cookie as an extra HTTP header does not persist across the page's own fetches — the naive run measured a 401 error state as the LCP element and invalidated the scores). Results and the documented blocker for the remaining performance gap are recorded in docs/hr/self-service.md per the spec's clause.
- **Self-service perf pass**: the app-wide alert popup poll no longer fires on mount — the first fetch is deferred to `requestIdleCallback` (2s fallback) after authentication, taking it out of the hydration/render critical path (TBT 580 → 350 ms, performance 73 → 81 on the measured build). `ProgressMeter` gained an accessible-name prop and all three call sites pass contextual labels (`aria-progressbar-name` now passes; accessibility 95 → 100, zero weighted failures).
- **Tests**: 10 new cases (store-narrowing validation incl. cross-org 404 + BRANCH 403, narrowed where-clause keeping org membership, per-store console rows mirroring the tile math with an aggregates-only assertion, BRANCH manager store pinning, ORG store target validation). Suite: **815 tests / 43 files**.
- **scripts/verify-v2-23-0.mjs** (`npm run verify:v2-23-0`): static checks over the narrowing service contract, route threading, console/filter UI, scope-aware schedule enforcement, the Lighthouse recipe, and version metadata.

## [2.22.0] B2C retry recovery, scheduled report digests, trace hardening

Feature release (post-EMS polish round). Adds targeted recovery for failed or stuck M-Pesa B2C payroll disbursements, scheduled email digests for every aggregate HR report, and hardens the payslip trace parser against legacy trace shapes.

### Added
- **M-Pesa B2C retry + stuck-status recovery** (`POST /api/payroll/runs/[id]/disburse-mpesa` with `mode`): `retry-failed` re-sends only payslips whose latest B2C attempt FAILED and which are still unpaid (a payslip with an active PENDING/PROCESSING/COMPLETED transaction is never touched, so double-payment stays structurally impossible; a no-op run answers `NOTHING_TO_RETRY 409`); `refresh-stuck` re-queries Safaricom via the Daraja Transaction Status endpoint (`/mpesa/transactionStatus/v1/query`, `TransactionStatusQuery`) for PROCESSING transactions with no result callback for 10 minutes (`B2C_STALE_PROCESSING_MS`) — an accepted query makes Safaricom re-emit the result on the existing webhook, which settles the payslip through the same idempotent path. Mock mode (staging opt-in) resolves stuck transactions immediately with a SIM receipt so hermetic QA exercises the full settle loop. Every run GET now embeds an additive, PII-free `disbursement` block (per-payslip attempts, last status, settled) that powers the new run-dialog affordances: **Retry failed (n)** and **Check status (n)** buttons, plus per-payslip state chips ("B2C failed · retry ready", "B2C processing · n attempts") with explanatory tooltips, in light and dark variants.
- **Scheduled HR report digests** (`/hr/reports → Schedules` tab): any of the six aggregate reports (headcount, employment cost, absence, turnover, time to hire, statutory liability) can be emailed on a DAILY/WEEKLY/MONTHLY schedule with a UTC send hour. Additive `HrReportSchedule` model (`hr_report_schedules`), CRUD routes (`/api/hr/reports/schedules[/id]`, soft delete), and a CRON_SECRET-gated sweep (`/api/cron/hr-report-digests?force=1` for ops) wired into the nightly dispatcher. Digests are computed at send time through the same governed, fail-closed report service (a store-scoped schedule runs under a BRANCH_MANAGER-scoped synthetic session; org schedules under SUPER_ADMIN-org) and rendered with a branded, escaped HTML template + plain-text variant — **aggregates only, never names / national IDs / raw ids**. Delivery outcome is stamped on the row (`lastRunAt/lastStatus/lastError`) and surfaced as status chips + summary counters in the Schedules tab; every send is audit-logged (`REPORT_SCHEDULE`).
- **Tests**: 25 new cases (legacy trace normalisation incl. the QA-caught 500 shape, net-from-identity derivation, retry idempotency + NOTHING_TO_RETRY, per-payslip state aggregation without PII, stuck-transaction recovery, freshness guard, schedule validation, due-date catch-up semantics, sweep SENT/FAILED/SKIPPED stamping, force mode, aggregates-only digest assertion). Suite: **805 tests / 42 files**.
- **scripts/verify-v2-22-0.mjs** (`npm run verify:v2-22-0`): 50+ static checks over the parser hardening, recovery service contract, schedule schema/RBAC/sweep wiring, nightly dispatch, UI affordances, and version metadata.

### Fixed
- **STORE_OWNER and ACCOUNTANT were locked out of /hr/reports entirely** (v2.20.0 regression, QA-caught): the report routes gate on `hr.report.branch`, whose role list lacked both roles, so the guard denied them before the scope resolver — which explicitly grants them ORG scope — ever ran. The permission map now includes both roles (additive, commented); the scope resolver remains the fail-closed authority for how much each caller sees. Surfaces: interactive report tabs, P10, org-console HR tiles, and the new schedules CRUD. Regression-tested in hr-permissions.test.ts.
- **Payslip trace dialog returned 500 on legacy computationTraces** (QA-caught on the v2.21.0 QA build): traces written before `rateTableIds`/`trace` existed (early engine versions, external triggers, QA fixtures) crashed `describePayslip` on `result.rateTableIds.length`. `parseTrace` now normalises every optional array, accepts the `engineSteps` alias, lifts legacy string step logs to the `{step, detail}` contract, and derives `netCents` from the gross − deductions identity when missing — only the identity-bearing fields stay mandatory. The hermetic seed now writes the exact engine shape, and the pre-existing legacy rows double as a live regression fixture.

## [2.21.0] M-Pesa B2C payroll disbursement + org-console deep links + payroll UI polish

Feature release (post-EMS polish round, spec Phase 4.6 optional M-Pesa B2C). Adds the optional payslip disbursement channel, makes the org-console HR tiles one-click deep links into the exact report, and upgrades the payroll run dialog with a lifecycle stepper, colored payment states, and per-payslip M-Pesa receipts.

### Added
- **M-Pesa B2C payslip disbursement** (`POST /api/payroll/runs/[id]/disburse-mpesa`, STORE_OWNER + `hr.payroll.disburse`): sends every pending payslip with net pay above zero to the employee's registered number as a Daraja B2C `SalaryPayment`. One payslip has at most one active disbursement transaction (additive nullable `MpesaTransaction.payrollDetailId` column) so re-running the action skips instead of double-paying; employees without a phone number are skipped with a reason and per-employee initiation failures never abort the batch.
- **Settlement webhooks** (`/api/payments/mpesa/b2c/result`, `/api/payments/mpesa/b2c/queue-timeout`): the result webhook claims the callback exactly once per transaction (atomic `callbackReceived` claim), settles successful payslips `PAID` with an `MPESA-<receipt>` reference through the append-only bypass (audit logged), and leaves failed transfers `PENDING` for retry. Security mirrors the C2B callback contract: HTTP Basic credentials (constant-time compare), optional IP allowlist, SecurityEvent logging on every rejection, rate limited.
- **Explicit mock mode**: without Daraja B2C credentials the disbursement completes with `SIM…` receipts so QA exercises the full loop; development defaults to mock, a production build must opt in via `MPESA_B2C_ALLOW_MOCK=true` (staging/hermetic QA, audit-recorded), and without the opt-in production refuses with `B2C_NOT_CONFIGURED` — money movement is never silently simulated. Real mode keeps payslips `PENDING` until Safaricom reports the result.
- **Org-console HR tile deep links**: the five "People & payroll" tiles now link to their exact destination (`?tab=headcount|cost|absence` into /hr/reports, the payroll tile into /hr/payroll, expiry alerts into /hr/assets) with hover/focus affordances and keyboard focus rings; /hr/reports tabs are deep-linkable via `?tab=` (bookmarkable via replaceState, unknown values fall back to headcount).
- **Payroll run dialog styling pass**: animated lifecycle stepper (Prepare → Submit → Approve → Post → Disburse → Lock) with done/current/todo states and ARIA labelling; colored payment status badges (PENDING slate / PAID emerald / FAILED rose / HELD amber) in light and dark variants; M-Pesa receipt chips on paid payslips; B2C confirmation dialog with the pending payslip count and net total before sending, plus a structured result summary (initiated / already active / skipped / failed / mock receipts).
- **Tests**: 15 new cases (state guard, production mock refusal + staging opt-in, phone/amount validation, idempotent re-run, no-phone skip, per-employee failure isolation, mock settlement, webhook settlement exactly once, duplicate delivery, failed-result handling, trace-shape gate + stored-columns payslip fallback). Suite: **780 tests / 41 files**.
- **scripts/verify-b2c.mjs** (`npm run verify:b2c`): static checks over the schema column, Daraja payload, idempotency branch, webhook auth contract, UI affordances, and deep links.
- **Docs**: docs/hr/payroll-run-lifecycle.md (disbursement section rewritten for both paths), docs/EMS_ENV_AND_DEPLOYMENT_NOTES.md (B2C env variables and webhook registration).

### Security
- The B2C result webhook stays public for Safaricom but is credentialed exactly like the C2B callback (Basic auth constant-time, IP allowlist, SecurityEvent rows); settlements are idempotent and the payslip-side writes go through the append-only bypass with audit events.
- Mock disbursements are impossible in production without the explicit `MPESA_B2C_ALLOW_MOCK` opt-in, eliminating any path that could mark payslips paid without a real Daraja transaction or an explicit manual confirmation.

### Fixed
- **Payslip views degraded to 0.00 when the stored computationTrace was missing or schema-mismatched** (row stubs from external triggers/imports). `buildPayslipView` now falls back to the authoritative `PayrollDetail` columns (the same stored lines the P10 register reads) with engine-stable line codes, keeping the gross − deductions = net identity exact; statutory identifiers stay masked in the fallback path.

## [2.20.0] EMS HR reporting, P10, org-console tiles, retention & erasure

Feature release (Stage H, EMS Phase 4.8 — final EMS phase). Completes the module with the six governed HR reports, the P10 statutory register reproduced from stored payroll lines, five HR tiles in the organization console, per-record-type retention with legal hold, and Data Protection Act erasure handling with recorded decisions.

### Added
- **Six HR reports** (`/api/hr/reports/{headcount,employment-cost,absence,turnover,time-to-hire,statutory-liability}`): aggregates only — per-employee rows carry employeeCode + job title, never names, national IDs, or raw ids. Scope model: STORE_OWNER/HR_MANAGER/ACCOUNTANT see the organization (hr.report.all), BRANCH_MANAGER sees their own branch (session-resolved), everyone else is denied fail-closed. Employment cost mirrors the engine's employer match (NSSF + AHL). All reports accept `?from=&to=`.
- **P10 statutory register** (`/api/hr/reports/p10?year=&format=csv|json`): **reproduces from stored posted payroll lines** — every figure reads the immutable PayrollDetail columns of POSTED/LOCKED runs in the tax year; nothing is recomputed, so the register always matches the journals and payslips. Groups by employeeCode with months + TOTAL row; CSV follows the repo export conventions and every export writes a `P10_EXPORTED` DATA_EXPORT audit event.
- **/hr/reports workspace**: dense tables with sticky headers, per-table column-visibility toggles, CSV export, print-to-PDF (dedicated print styles), no horizontal scroll on supported viewports (vertical scroll containers with max height), no badge overlap, no raw ids. Tabs: Headcount · Employment cost · Absence · Turnover · Time to hire · Statutory · P10 · Privacy.
- **Organization console HR tiles** (spec: headcount, employment cost, absence, payroll status, expiry alerts): `GET /api/org/summary` now embeds an `hr` block computed when the HR module is on and the caller holds an hr report permission; the console renders a five-tile "People & payroll" section (additive — an HR failure never breaks the console) linking to /hr/reports.
- **Retention per record type + legal hold**: `HR_RETENTION_POLICIES` (applicant rejection data per its own dataRetentionUntil; closed disciplinary cases 3y; attendance device data 2y — all documented, reviewable defaults, not legal advice). The nightly `GET /api/cron/retention` now also runs the per-organization HR sweep, which **anonymises in place** (`REDACTED (retention)`) so foreign keys and audit history stay intact, and **skips scopes under legal hold** (`HrSetting legalHold:<scope>=true`). Batch audit events per scope.
- **Erasure requests (Data Protection Act posture)**: additive `ErasureRequest` model + `/api/hr/privacy/erasure-requests` family. Opening is one-PENDING-per-employee; **execution erases non-statutory personal data only** (document files + notes, review narratives, contact fields) and lands `PARTIALLY_EXECUTED` with `retentionApplies=true` because payroll/audit rows keep statutory retention; rejection requires a decision reason and a legal basis; both are recorded with the decider id. Decisions reserved to `hr.settings.manage` (SUPER_ADMIN). Full audit coverage.
- **Ride-along**: `scripts/qa-seed-stage-g-dev.mjs` committed (Stage G hermetic QA seed, previously local-only).
- **Tests**: 16 new cases (report scoping incl. fail-closed roles, aggregate/no-raw-id payloads, employer-match math, P10 grouping/CSV/year filtering from stored lines, org tiles math, retention windows + legal hold + anonymisation, erasure execution/partial-execution/rejection contracts). Suite: **760 tests / 39 files**.
- **scripts/verify-stage-h.mjs** (`npm run verify:stage-h`): 50+ static checks over report routes/guard composition, P10 stored-lines contract, dense-table acceptance contract, tile payloads, retention/legal-hold wiring, erasure decision recording, docs, and version.
- **Docs**: docs/hr/reporting.md, docs/hr/data-protection.md, docs/hr/documents-and-retention.md.

### Security
- Reports and P10 are permission-gated with deny logging; aggregate payloads carry no names or raw identifiers; the P10 export is audit logged as DATA_EXPORT.
- Erasure decisions are SUPER_ADMIN-only with the decision, legal basis, and decider recorded; statutory records are never erased.
- Retention sweeps anonymise instead of hard-deleting and honour legal holds; each scope outcome (held/anonymised count) is audit logged.
- Security headers and rate limiting remain the platform-layer controls documented in docs/hr/data-protection.md (CSP/HSTS/COOP/CORP via the proxy; login rate limiting via x-ratelimit-*).

### Note
This completes the EMS implementation phases (4.1–4.8, Stages A–H). Remaining non-code items: statutory rate tables keep verifyWithCounsel=true pending owner review; Lighthouse ≥90 on /employees/me is scheduled against the production build in the next maintenance window (dev-mode scores are not representative — documented in docs/hr/self-service.md).

## [2.19.0] EMS performance, goals, assets, discipline, and employee self-service

Feature release (Stage G, EMS Phase 4.7). Adds the performance console (review cycles, reviews, calibration, POS-computed goals), asset assignments with authorization-gated recovery, disciplinary cases with automatic warning expiry and grievance confidentiality, and the mobile-first employee self-service portal at /employees/me.

### Added
- **Review cycles** (`/api/hr/performance/cycles`): DRAFT → ACTIVE → CLOSED state machine — a cycle needs at least one review to activate, CLOSED is terminal, calibration happens only while ACTIVE. Duplicate names rejected per organization.
- **Performance reviews** (`/api/hr/performance/reviews`): DRAFT → SUBMITTED → ACKNOWLEDGED → CALIBRATED. One review per (cycle, employee); ratings must be integers 1–5; only the assigned reviewer or HR edits/submit; the employee acknowledges their own review through self-service (`POST /api/self-service/me/reviews/[id]/acknowledge`); calibration is HR-only. **Ratings and narratives never appear in list payloads** (spec sensitive-data rule) — only the permission-gated single-review detail returns them.
- **Goals with POS-sourced computation** (`/api/hr/goals`): SALES_TOTAL / SALES_COUNT goals aggregate the linked employee's completed SalesTransaction rows (cashierId ← Employee.userId, scoped to the branch and the goal window, which metricConfig can override) — the value is computed, never typed; typed writes to POS-sourced goals return 409 POS_GOAL_READONLY. ACHIEVED flips automatically at target, MISSED after the window passes without achievement. All money math on Prisma.Decimal. `/recompute` refreshes on demand; self-service recomputes read-only for display.
- **Asset assignments** (`/api/hr/assets`): issue assets with tags/serials/condition-out and expected-return dates; RETURN records the condition back in; **LOST / DAMAGED require a named recovery authorizer** — an active user holding hr.asset.manage who must differ from the acting user (no self-authorization) — plus mandatory notes. Overdue assignments flagged in list payloads; `/api/hr/performance/authorizers` lists eligible authorizers (excluding the caller).
- **Disciplinary cases** (`/api/hr/discipline`): WARNING / GRIEVANCE / INVESTIGATION with 1–5 severity. **Warnings expire automatically** — a lazy sweep flips OPEN warnings past their expiry to EXPIRED on list/detail reads and writes one batch audit event. **Grievance confidentiality**: grievances default to RESTRICTED; case descriptions never appear in list payloads (any confidentiality level) and RESTRICTED detail is readable only by HR_MANAGER / STORE_OWNER / SUPER_ADMIN. Resolve requires resolution notes; double-closing is a 409.
- **Employee self-service portal** (`/employees/me` + `/api/self-service/me/*`): dashboard (profile with tenure, latest payslip, leave availability, today's attendance, goal progress), payslips (list + full breakdown dialog + plain-language stored computation), attendance (records + month summary tiles), leave (balances with availability meters, request form via the governed leave service, request history), goals (+ own reviews with acknowledge), and documents (metadata + verification status + 90-day expiry warnings). Every endpoint resolves the Employee row through the session User (`Employee.userId`) and **ignores client-supplied identity parameters entirely** — cross-employee reads are structurally impossible. Unlinked accounts get 403 NO_EMPLOYEE_PROFILE. Statutory ids stay [REDACTED] in self-view unless the caller holds hr.employee.unmask.pii.
- **Offline payslip view**: the payslip list and each opened payslip are cached to localStorage and render with an "offline" banner when the device cannot reach the API (spec acceptance 8).
- **Mobile-first self-service shell**: sticky header, mobile bottom tab bar (6 tabs, safe-area aware), desktop inline nav, gradient hero profile card, rounded stat tiles with icons, progress meters, and status badges with full dark-mode variants.
- **RBAC (additive)**: new permission key `hr.documents.read.own` (all staff roles) for the self-service documents endpoint; existing hr.performance.*/hr.asset.*/hr.discipline.* keys wired through hrGuard with deny logging.
- **HR workspace nav**: Performance, Assets, and Discipline consoles linked from the /hr header; lightweight `/api/hr/performance/people` picker endpoint returns id/name/jobTitle only (no PII-grade fields).
- **Tests**: 50 new cases across stage-g-performance, stage-g-goals, stage-g-assets-discipline, and stage-g-self-service (state machines, maker-of-review rules, list-payload masking, POS computation with Decimal parity, recovery authorization matrix, expiry sweep, confidentiality gates, guard composition, cross-employee denial, leave error mapping). Suite: 744 tests / 37 files.
- **scripts/verify-stage-g.mjs** (`npm run verify:stage-g`): 60+ static checks over routes, guard composition, sensitive-data rules, recovery authorization, POS-goal computation, self-service scoping, RBAC keys, UI surface, and docs.
- **Docs**: docs/hr/performance.md, docs/hr/assets-and-discipline.md, docs/hr/self-service.md.

### Security
- Self-service endpoints compose a dedicated guard: session → HR module flag → hr.* permission (deny-logged) → employee-link resolution, in that order, with fail-closed responses.
- Review ratings, case descriptions, and document notes are excluded from every list payload; RESTRICTED grievances additionally require elevated roles on the detail fetch.
- Recovery authorization is enforced server-side (role + active + not-self); the UI authorizer list also excludes the caller.
- All Stage G mutations write hash-chained audit events with field-name-only metadata.

### Note
Phase 4.8 (HR reporting/P10/org-console tiles/compliance hardening) is the next FEATURE slot: v2.20.0 per the version scheme (2.19.0 onward).

## [2.18.9] EMS payroll run lifecycle: maker-checker, idempotent posting, payslips, corrections

Feature release (Stage F completion, EMS Phase 4.6). Wraps the v2.18.8 engine in the governed run lifecycle: state machine, maker-checker approvals, idempotent journal posting through the existing accounting helper, payslip issuance with zero-dependency PDFs and plain-language traces, and reverse-and-replace corrections. Issued payslips are append-only.

### Added
- **Payroll run state machine**: DRAFT → PENDING_APPROVAL → APPROVED → POSTED → LOCKED, with REJECTED (approver sends back with a reason), VOIDED (pre-post cancellation), FAILED. Illegal transitions return 409 INVALID_TRANSITION; the state vocabulary and transition map are exported from `src/lib/hr/payroll/run-service.ts`.
- **Maker-checker (spec rule 21)**: `preparedByUserId` is captured at submit; `/approve` refuses the same user with 403 MAKER_CHECKER_VIOLATION regardless of role — no role combination (including SUPER_ADMIN) bypasses it. Corrections apply the same rule to their own requests.
- **Prepare-time gates** (`POST /api/payroll/runs/[id]/validate`): computes every active employee through the engine and blocks the run with per-employee reason codes — MISSING_CONSENT, TIMESHEET_NOT_APPROVED (unapproved attendance days), RATE_TABLE_MISSING / OVERLAPPING_RATE_TABLES, NEGATIVE_NET, DEDUCTION_CAP_EXCEEDED. Blocked runs stay DRAFT with the issue list persisted; nothing posts.
- **Idempotent posting** (`POST /api/payroll/runs/[id]/post`): aggregates stored integer-cent traces per account (5200/5210/5215 debits; 2210/2215/2220/2225/2250/2240 credits), asserts the aggregate balances (JOURNAL_IMBALANCE otherwise), verifies chart-of-accounts readiness (MISSING_CHART_ACCOUNT), then posts one combined journal through `createJournalEntry` with `idempotencyKey = payroll-run:{runId}` — a retried post returns the same entry and never double-journals. Payslip numbers (PS-YYYYMMDD-NNNN, gapless per-store sequence) are issued at post time; posting a replacement run flips its APPROVED corrections to APPLIED.
- **Payslip presentation**: `GET /api/payroll/runs/[id]/payslips` and `/api/payroll/payslips/[id]` return shaped views where national ID, KRA PIN, NSSF/SHIF numbers, bank account, and M-Pesa numbers are [REDACTED] unless the viewer holds hr.employee.unmask.pii; `/trace` renders the computation in plain language ("NSSF is deducted first; PAYE is computed on gross pay minus NSSF…") with the exact rate-table ids; `/pdf` streams a valid PDF 1.4 built by a zero-dependency writer fed by the already-masked view (the writer has no database access).
- **Corrections: reverse and replace** (`/api/payroll/corrections`): UNDERPAYMENT posts DR 5200 / CR 2240 for the signed delta and opens an idempotent SUPPLEMENTARY replacement run; OVERPAYMENT posts the reverse; REVERSAL re-uses the engine journal of the original payslip with debits and credits swapped. The replacement run goes through the normal maker-checked lifecycle; PayrollDetail rows are never edited.
- **/hr/payroll console**: status-colored run table with gross/deductions/net columns, lifecycle action bar that disables approval for the preparer (with an inline maker-checker explanation), blocked-employee issue cards with code badges, per-payslip trace expansion and PDF download, corrections queue with request dialog (payslip picker, signed amount with adjusted-net preview, ≥10-char reason) and maker-checked approve/reject. Payroll nav item added to the HR workspace.
- **Schema (additive)**: PayrollRun lifecycle fields (idempotencyKey unique, prepared/approved/rejected/posted/locked user+timestamps, journalEntryId), PayrollDetail issuance fields (payslipNumber unique, rateTableIds, roundingAdjustmentCents, computationTrace, payslipIssuedAt), and the new PayrollCorrection model (type, signed integer-cent amount, status, journalEntryId, replacementRunId). Sequence prefix PS registered in sequence.ts.
- **docs/hr/payroll-run-lifecycle.md**: state machine diagram, permission matrix, gate and posting contracts, corrections design, storage conventions.
- **scripts/verify-payroll-lifecycle.mjs** (`npm run verify:payroll-lifecycle`): static contract checks — state machine exported, maker-checker present, posting idempotency key, all Phase 4.6 routes compose hrGuard, PII masking, no float math in the lifecycle service, audit coverage.
- **Tests**: 22 cases in src/tests/lib/payroll-run-lifecycle.test.ts (state machine legality, maker-checker refusal, gate blocking with issue lists, engine-parity computation, balanced idempotently-keyed posting, replay no-op, missing-account block, correction immutability, reversal line swap, replacement-run creation).

### Note
Statutory rate tables still carry verifyWithCounsel=true pending owner review. Disbursement is manual confirmation (M-Pesa B2C remains optional future work). P10/statutory extracts and HR reporting land in v2.19.0 reading the stored payslip lines.

### Legacy compatibility
- `/api/payroll/runs` GET keeps the legacy POS Payroll-tab contract (periodName, numeric money fields per the v2.3.1 decimal fix, detailCount, status/payrollPeriodId filters) alongside the new lifecycle fields, so the existing tab keeps rendering.
- `POST /api/payroll/runs?process=true` (legacy "run payroll now") no longer auto-posts — that would bypass maker-checker, which the spec forbids. It now maps to prepare + submit-for-approval: payslips are computed and the run lands in PENDING_APPROVAL for a separate approver. The run detail console is /hr/payroll.
- `POST /api/payroll/runs/[id]/void` now requires hr.payroll.approve (STORE_OWNER) and records the caller-supplied reason in the audit metadata; voiding remains impossible once a run is POSTED or LOCKED (use corrections).
- **Proxy auth correction (affects the whole /hr workspace)**: the edge authentication gate accepted only Authorization: Bearer, while `getSessionFromRequest` (v2.16.0) also resolves the `mbt_token` workspace session cookie — so every cookie-authenticated page fetch (the /hr pages attach no Authorization header) was 401'd at the edge before reaching route guards. Layer 5 now accepts the same "header wins, cookie is a bootstrap fallback" pair; mutations still pass the CSRF gate first, and route guards still validate the token against the DB session.

## [2.18.8] EMS payroll engine: the hard gate

Feature release (Stage F of the EMS implementation protocol, Phase 4.5). Ships the pure computation engine and passes the payroll hard gate: golden fixtures and property tests green before any payroll UI exists. The run lifecycle with maker-checker and journal posting lands next (Phase 4.6).

### Added
- **Pure payroll engine (src/lib/hr/payroll/)**: integer-cents computation with no Prisma, React, or Next imports. Rate resolution from versioned tables (RATE_TABLE_MISSING and OVERLAPPING_RATE_TABLES guardrails), progressive PAYE bands with personal relief, NSSF Tier I and II on pensionable basic with employer match, SHIF with minimum contribution, Affordable Housing Levy with employer match, proration for unpaid leave, per-line-floored overtime, casual day rates, commission, and other deductions. NEGATIVE_NET blocks any run whose deductions exceed gross. Consent is a guardrail (MISSING_CONSENT).
- **Balanced journal construction**: buildPayrollJournal maps the computed payslip onto the reserved payroll chart (5200, 5210, 5215, 2210, 2215, 2220, 2225, 2250, 2240) and asserts debits equal credits before returning; JOURNAL_IMBALANCE is unreachable by construction but enforced. The idempotencyKey flows from the caller for replay-safe posting in the lifecycle release.
- **Golden fixtures**: ten hand-verified cases (below-band, band boundary, top band, NSSF exemption, Tier II slice, casual day rates, unpaid-leave proration, overtime, commission, other deductions) with frozen integer-cent expectations, plus the zero-gross minimum-SHIF case as a guardrail assertion. Property tests: net identity (net = gross - deductions exactly), journal balance, replay determinism, integer-only money, monotonic net across gross, rateTableId on every statutory line, and historical recompute equality.
- **docs/hr/payroll-worked-examples.md**: five hand-checkable worked examples an accountant can verify manually.
- **scripts/verify-payroll-engine.mjs**: source guarantees (no float, no server imports, complete guardrail vocabulary, frozen fixtures).
- **Tests**: 23 cases in src/tests/lib/payroll-engine.test.ts.

### Note
Rates remain versioned data with verifyWithCounsel=true. The engine consumes resolved tables as plain data; the run lifecycle (Phase 4.6: state machine, maker-checker, journal posting through createJournalEntry, payslip issuance) follows as the next EMS release.

## [2.18.7] EMS attendance and leave: replay-safe punches, timesheet gating, idempotent balances

Feature release (Stage E of the EMS implementation protocol, Phase 4.4). Extends the existing AttendanceRecord, LeaveRequest, and EmployeeLeaveBalance models additively and reuses the Shift system as the source of truth for till duty.

### Added
- **Attendance punch (/api/attendance/punch)**: server time is authoritative (client timestamps ignored), duplicate punch IN is suppressed per day, and punches carry an optional idempotencyKey so an offline replay returns the existing record unchanged (AttendanceRecord.idempotencyKey unique, nullable).
- **Timesheet approval (/api/attendance/timesheets/approve)**: approves a day range per employee; hasUnapprovedTimesheet() is the payroll gate implementing the TIMESHEET_NOT_APPROVED guardrail, and attendanceShiftVariance() surfaces attendance/Shift mismatches without mutating either system (ghost-shift logic remains canonical in the Shift API).
- **Leave (/api/leave/)**: balance-checked request submission (INSUFFICIENT_LEAVE_BALANCE and PERIOD_MISMATCH guardrails), approve and reject with optional delegation (LeaveRequest.delegateApproverUserId), balance grants that never overwrite usage aggregates, and recomputeBalances() deriving used/pending entirely from the request table so repeated runs are drift-free. Month-end spanning ranges recompute per leave year.
- **Schema extensions**: AttendanceRecord gains idempotencyKey, timesheetApprovedByUserId/At, sourceDevice; LeaveRequest gains delegateApproverUserId.
- **Tests**: punch replay, duplicate suppression, first-punch creation, punch-out refusal, recompute idempotency (two runs identical), and balance-row creation (8 cases in src/tests/lib/hr-attendance-leave.test.ts).

## [2.18.6] EMS recruitment, onboarding, and till access gating

Feature release (Stage D of the EMS implementation protocol, Phase 4.3). Builds on the 2.18.5 foundations. Additive schema only.

### Added
- **Recruitment pipeline (/api/recruitment/)**: job creation and listing, applicant registration with mandatory consent (ConsentRecord with purpose, scope, policy version, lawful basis), stage recording with outcome tracking, offer drafting in integer cents, owner-tier offer approval and send, and hiring conversion. Rejections set a 90-day data retention window (dataRetentionUntil) and hired applicants can no longer be rejected.
- **Applicant to employee conversion**: idempotent per (storeId, applicant email); a repeat call returns the existing employee and a same-email duplicate heals the provenance link instead of creating a second row. Provenance is preserved via Applicant.convertedEmployeeId. Conversion creates the standard onboarding plan and schedules a probation-end notification (persistent Notification row with a deep link).
- **Onboarding (/api/hr/onboarding/)**: plan creation from template, idempotent task completion with completion auditing, and sign-off that refuses while any blocksTillAccess task is open (409 TILL_ACCESS_BLOCKED with the named tasks). isTillAccessGranted() is the single gating function the POS can consult before granting till permissions to a probationary employee.
- **HR workspace pages**: /hr/recruitment (open jobs, consent-gated applicant registration, pipeline with stage-appropriate actions) and /hr/onboarding (plan cards with task checklists, blocks-till badges, sign-off gating state).
- **Tests**: till access gating (denies with no plan, denies with open blocking tasks, grants on completion and sign-off), conversion idempotency and duplicate healing, and the consent requirement (8 cases in src/tests/lib/hr-onboarding.test.ts).

## [2.18.5] EMS foundations: HR workspace, employee records, and versioned statutory rate tables

Feature release opening the Employee Management System (Stage C of the EMS implementation protocol, Phases 4.1 and 4.2 core). Builds on the audit deliverables (docs/EMS_INFRASTRUCTURE_AUDIT.md) and the 2.18.4.0 corrections. Additive schema only; the existing POS, payroll, and attendance behavior is untouched.

### Added
- **EMS foundation layer (src/lib/hr/)**: typed role constants (HR_MANAGER and EMPLOYEE join the platform as data, no enum migration), the hr.* permission matrix with fail-closed checks and the maker-checker role split, the PII masking service (strip for lists, mask for details, permission-gated unmask), the HR audit service wrapping the hash-chained audit trail, and the data-driven HR_MODULE_ENABLED flag (HrSetting row, 30-second cache, default on) with a calm kill switch.
- **HR API surface (/api/hr/)**: employees list and create (branch-resolved from the session; client storeId ignored outside the documented SUPER_ADMIN path), employee detail with masked statutory identifiers and an audit-logged unmask parameter, employee update and archive (soft delete), document registration and verification with expiry tracking, org-scoped rate table reads, and the module settings endpoint. Every route composes the shared hrGuard: feature flag, hr.* permission, store scope, and deny logging through the existing SecurityEvent path.
- **HR workspace UI (/hr)**: overview with branch-scoped headcount, casual worker count, in-force rate tables, and module status; an employees list with sticky-header dense table, search, and inline create; an employee detail view with statutory identifier masking, permission-gated unmask (banner explains the audit trail), pay summary, and a documents list with verification badges.
- **Versioned statutory rate tables**: hr_rate_tables and hr_rate_table_rows store PAYE bands, personal relief, NSSF Tier I and II, SHIF, and the Affordable Housing Levy as insert-only data with instrument references and verifyWithCounsel=true. Seeded idempotently by scripts/seed-rate-tables.mjs (wired into vercel-build). Rates are reviewable defaults, not legal advice.
- **Additive schema (21 models)**: EmployeeDocument, Position, PayGrade, SalaryStructure, SalaryComponent, EmployeeSalaryComponent, RateTable, RateTableRow, RecruitmentJob, Applicant, ApplicationStage, Offer, OnboardingPlan, OnboardingTask, ReviewCycle, PerformanceReview, Goal, DisciplinaryCase, AssetAssignment, ConsentRecord, HrSetting; Employee gains reportingToId and deletedAt.
- **Verification**: scripts/verify-ems-infrastructure-audit.mjs (audit reproducibility), scripts/verify-hr-isolation.mjs (route guard composition and safe 404s), plus unit tests for the permission matrix (fail-closed, maker-checker split) in src/tests/lib/hr-permissions.test.ts.

## [2.18.4.0] EMS infrastructure corrections: payroll accounting readiness and employee PII masking

Correction release required by the EMS implementation gate (docs/EMS_IMPLEMENTATION_GATE.md). Fixes the two P0 blockers that prevented the Employee Management System from building on a safe foundation. All changes are additive; no existing flow, route, or record is altered destructively.

### Fixed
- **Employee PII export masking (P0-1)**: the employee CSV export (Data Exports dashboard) now masks national ID, KRA PIN, NSSF number, NHIF number, and bank account name by default for every role. Unmasked output requires the acting user to be SUPER_ADMIN or STORE_OWNER (PII unmask permission), and every employee export writes a hash-chained audit event (action EXPORT, metadata piiIncluded, reason string; field names only, never values). Names, contacts, job data, and salary figures remain readable as before.
- **Gift card liability account mapping**: the account helper mapped GIFT_CARD_LIABILITY to code 2300, which the seeded chart of accounts defines as a supplier payable, so gift card journal movements could post against a supplier account. Gift card liability now resolves to 2400 (Gift Cards Outstanding), matching the seed and the auto-create default.
- **Rental deposits account classification**: the helper's auto-create default for 1400 disagreed with the seeded chart (LIABILITY versus ASSET). The default now matches the seeded reality; posting directions were always explicit at call sites and are unchanged.
- **Idempotent account seeding**: the seed created accounts with bare create calls, crashing on partially initialized databases. Both account loops now upsert by (organizationId, code) and never overwrite an operator-modified row.

### Security
- **JournalEntry.idempotencyKey (nullable, unique)**: createJournalEntry performs a replay lookup when a key is provided and returns the existing entry instead of creating a duplicate, so a retried payroll post can never double journal. This is the posting-safety prerequisite for EMS payroll.
- **Payroll chart of accounts**: seed adds ten reserved accounts: 2210 PAYE Payable, 2215 NSSF Payable, 2220 SHIF Payable, 2225 Housing Levy Payable, 2230 HELB Payable, 2240 Net Pay Payable, 2250 Other Deductions Payable, 2260 Payroll Clearing, 5210 Employer NSSF Expense, 5215 Employer Housing Levy Expense.
- **Payroll account healing script**: scripts/seed-payroll-accounts.mjs idempotently upserts the payroll accounts for every organization on existing databases (wired into vercel-build after sync-db-schema; safe to run manually on desktop installs). It never modifies existing rows and reports present/expected counts.

### Documentation
- Added the twelve EMS audit deliverables on docs/ems-infrastructure-audit (audit, evidence, gate, risk register, data model delta, integration map, RBAC matrix, migration plan, test plan, environment notes, security and privacy notes, README hygiene findings).
- Added scripts/verify-hr-privacy.mjs and scripts/verify-hr-schema.mjs plus a masking unit test (src/__tests__/lib/hr-privacy.test.ts).

## [2.18.4] Organization console expert diagnostics and branch slug repair

Feature release completing the expert information minimum from the release integrity audit (Finding 3) and bundling the planned maintenance residuals of the audit sequence (Findings 15, 16, 19, 20, 23, 25 hygiene documentation and test visibility). This release supersedes no one: it stacks directly on v2.18.3.2, keeps every existing route and contract intact, and the maintenance residuals land as documentation and test-report hygiene rather than behavior changes.

### Added
- **Expert console snapshot (`/api/org/expert-console`)**: one SUPER_ADMIN/STORE_OWNER endpoint that answers the operator's three questions per branch (can the workspace open, why not, what next) plus the release identity, the workspace routing configuration as the server sees it, the acting user record, an org KPI roll-up with a documented health breakdown, and the per-branch diagnostics. Rate limited per user and client IP (30 per minute); org-wide reads follow the runWithoutTenant pattern of the existing org routes.
- **Branch diagnostics (`/api/org/branch-diagnostics`, `/[storeCode]`, `/refresh`)**: the per-branch diagnostics list, a single-branch lookup resolved by slug, code or store id (404-safe), and a force-refresh variant that bypasses the 60 second schema-probe cache and writes an ORG_DIAGNOSTICS_REFRESH audit entry. Every operational figure comes from batched groupBy queries (about ten queries total for all stores) and degrades to zeros or unknown instead of failing the response.
- **Diagnostics data layer (`src/lib/org/diagnostics.ts`)**: the documented reason-code vocabulary (ORG_DIAGNOSTIC_REASON_CODES), the pure slug derivation shared with the repair routes (canonical mappings: juja-main, thika, ruiru, nairobi-cbd, nakuru), the reason classifier with calm remediation text, and a 60-second cached schema drift probe running the two cheapest checks from /api/health/schema. Probe failures report drift or unknown; they never throw.
- **Branch slug repair (`/api/org/slug-repair/preview` + `/apply`)**: a non-mutating preview that lists planned fixes and conflicts, and a guarded apply that is SUPER_ADMIN-only, confirm-gated, refuses PostgreSQL with migration guidance, runs scripts/backup-db.mjs first and aborts when the backup fails, never overwrites or renames another store, derives the subdomain only when it is empty, audits ORG_SLUG_REPAIR_APPLIED (WARN), and is idempotent (a second run reports "Nothing to repair.").
- **Expert panel in the Branches table (`src/components/workspace/org-console.tsx`)**: a per-row Expert affordance opening a dialog with slug, subdomain, status, reason code, remediation, schema status and missing columns, and the last checked time. Copy diagnostics (with an aria-live confirmation), Refresh, and Open path workspace actions. Loading and error states are calm text with retry; Escape closes; status is always carried by text.

### Fixed
- **Maintenance residuals bundled as planned**: the hygiene items from the audit sequence land in this release as documentation rather than code changes: the database migration policy (db:push with preflight, backup and additive repair locally; prisma migrate deploy only, operator-run, in production) and the migration of slug writes for broken stores from ad-hoc scripts to an audited, confirm-gated API where a local backup is mandatory.

### Docs
- docs/org-console-expert-information.md: API shapes, the reason-code table with remediation text, the safety rules, and UI notes.
- docs/org-console-roadmap.md: the deferred expert modules sequenced from v2.18.5 (Inventory and Debt) through v2.18.9 (operator experience groundwork), building on the existing /console modules.
- docs/database-migration-policy.md: local SQLite convergence policy and the production PostgreSQL migration boundary (the updater never runs migrate deploy against production automatically).
- docs/TEST_AUDIT_REPORT.md and docs/TEST_AUDIT_REPORT.json: the full test inventory (27 files), role and module matrices, risk register (including the documented 471 strict-typecheck baseline and the 16 pre-existing vitest failures, unchanged by this release), acceptance checklist, and the recommendation to run the full vitest suite in CI.

### Tests
- 15 new unit cases cover the slug derivation (canonical mappings, prefix tolerance, punctuation variants, unusable names) and the diagnostics classification (ready, missing-slug, store-inactive, workspace-disabled, schema drift and probe caching, batched aggregates, degradation) with the database mocked (`src/tests/lib/org-diagnostics.test.ts`).
- New release verification script (`scripts/verify-org-console-expert-info.mjs`, npm run verify:org-console-expert) statically checks the role gate, the reason-code contract, the slug repair guards, and the documentation set.

## [2.18.3.2] Tenant isolation and payment-safety corrections

Correction release completing the security and tenant isolation residuals from the release integrity audit (Findings 17, 18, 21, 22): STK Push retries can no longer double prompt the customer, deleting the engraved admin is durably audited, the schema health endpoint is role-gated in production, and the heavy operational endpoints are rate limited.

### Fixed
- **STK Push idempotency (`src/lib/mpesa-idempotency.ts` + stkpush route)**: the M-Pesa callback already settles exactly once (terminal-state gate, atomic claim, one-receipt-per-store constraint); the remaining double-prompt window is now closed. Callers may send an optional `idempotencyKey`; when a matching push (same store, normalised phone and amount, status PENDING or PROCESSING) exists within a 10 minute window, the existing push is returned with `duplicate: true` and no second Daraja request is fired. Omitting the key keeps the previous behavior unchanged; the dedupe lookup is best-effort and can never block payment initiation. No schema change.
- **Engraved admin deletion audit (`src/app/api/users/[id]/route.ts`)**: a blocked DELETE of the engraved administrator now writes a durable `USER_DELETE_BLOCKED` security log (WARN) with the acting account and target metadata before the existing 403 `ENGRAVED_ADMIN_PROTECTED` response.
- **Schema health role gate (`src/app/api/health/schema/route.ts`)**: in production the drift picture is restricted to SUPER_ADMIN and STORE_OWNER; outside production (trusted local desktop mode) any signed-in role keeps working. Rate limited per client IP (10 per minute) because the probes run real database queries.
- **System heal rate limit (`src/app/api/system/heal/route.ts`)**: the full repair and power-on-self-test scan is capped per client IP (5 per hour) ahead of the existing authentication and role checks.

### Tests
- 7 new unit cases cover the dedupe query: match and miss paths, phone normalisation, store scoping, the PENDING/PROCESSING restriction, the default window, and the unusable-phone guard (`src/tests/lib/mpesa-idempotency.test.ts`).

## [2.18.3.1] Updater activation guards and dual-mode start

Correction release completing the updater and build safety residuals from the release integrity audit (Finding 12 detail and the start-command fallback): the build log scanner now catches the remaining fatal failure classes before an update is activated, and the package start command delegates to the dual-mode launcher instead of assuming a standalone build exists.

### Fixed
- **Build log scan coverage (`scripts/verify-build-output.mjs`)**: the fatal-everywhere scan now includes `Cannot find module`, webpack `Module not found`, Prisma drift error `P2022`, and `prisma:error` log lines, in addition to the existing compile, build-error, type-error, and standalone trace-copy checks. The updater refuses to activate a release whose build log contains any of them; the `P2022` pattern is boundary-guarded so unrelated digit sequences never trip it.
- **Dual-mode start (`package.json`)**: `npm start` / `bun start` previously ran `.next/standalone/server.js` unconditionally, which fails on a normal (non-standalone) build, for example on Windows where BUILD_STANDALONE is ignored by policy. The start command now runs `deploy/nodocker/start-server.mjs`, the existing launcher that applies the repo .env (env-wins precedence), starts the standalone server when one was built, otherwise falls back to `next start` against the plain build output, and fails fast with clear guidance when no build output exists.

### Tests
- 6 new unit cases cover the added fatal patterns, the every-mode contract, and the boundary guard against false positives (`src/tests/lib/build-output-policy.test.ts`).

## [2.18.3.0] Branch workspace reason codes in the organization console

## [2.18.3.0] Branch workspace reason codes in the organization console

Correction release completing the branch workspace foundation residuals found by the release integrity audit (Findings 1 and 7, re-verified with evidence against the unified lineage): the org console Workspace column now states the precise reason a workspace cannot open instead of a generic unavailable message, and the branch workspace route gained a server-side layout guard.

### Fixed
- **Precise Workspace badges (`src/components/workspace/org-console.tsx`)**: the Workspace column now renders "Missing branch slug", "Branch inactive", or "Workspace disabled" with a remediation hint in the tooltip, replacing the single generic "Branch workspace unavailable" text. A "Path fallback ready" chip appears when a public host had to fall back from a branch subdomain to the path workspace. Text always carries the meaning; color never does.
- **Reason-code resolver (`src/lib/branch-workspace.ts`)**: new pure `resolveBranchWorkspace` exposes `href`, `usedMode` (subdomain or path) and `unavailableReason` (`missing-slug`, `store-inactive`, `workspace-disabled`) from the exact same rules the href builder has used since v2.18.0.0; `getBranchWorkspaceHref` remains a thin wrapper with an unchanged contract, plus `isLocalWorkspaceHost` for callers that must tell local path mode from a fallback.
- **Workspace route layout guard (`src/app/stores/[slug]/layout.tsx`)**: placeholder slugs ("undefined"/"null") are rejected server-side with a calm message before any database query, valid requests get a server-resolved screen-reader status region with the store name and location, and raw database errors never surface. The layout is not an authorization boundary: the gateway and every API route keep re-validating access.
- **VERSION file alignment**: the root VERSION file had drifted to 2.18.1 while package.json and the running app reported 2.18.3; the file is restored as the single full-version surface (2.18.3.0) with package.json keeping the three-part base 2.18.3 per the release versioning policy.

### Tests
- 15 new unit cases cover the precise reason codes, the used-mode classification, placeholder-slug handling and host classification (`src/tests/lib/branch-workspace.test.ts`, 43 cases green).

## [2.18.3] Organization Console — Expert Information System on the unified lineage

Feature release completing the reconciliation promised by the v2.18.2 sandbox branch (`release/v2.18.2.1-org-console`): the org-console **product work** now runs natively on the 88-model PostgreSQL-canonical lineage with multi-tenant auth, instead of the parallel 43-model SQLite implementation. The sandbox branch remains archived as a prerelease; this release supersedes it.

### Added
- **Expert console at `/console`** (`src/app/console/` + `src/components/org/{chrome,kpi-row,store-matrix,experts,panels,primitives}.tsx`): dark glassmorphism chrome with official brand logo, health gauge, KPI command row, **Store Intelligence Matrix** (rendered from the real `Store` rows via `/api/stores`), Decision Support, Recent Activity, Global Chat, Live Feed, and the 9 domain expert modules (Inventory, Debt/Mkopo, Rentals, Financials, Suppliers, M-Pesa, eTIMS, Audit, System). Every figure comes from live main-lineage APIs; sections whose endpoint denies the caller degrade to an explicit "unavailable" state — never a fake number.
- **`/api/org/kpi-summary`**: org-level KPI aggregate (revenue, transactions, low stock, overdue, debt, pending, health breakdown) computed with `runWithoutTenant` and role-gated (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER / ACCOUNTANT / INVENTORY_MANAGER).
- **`SectionErrorBoundary`** wraps every console section: a crash in one panel degrades to a styled retry card instead of blanking the console.
- **Sidebar entry point**: org-wide roles get an "Expert console" link in the app sidebar workspace links (`buildExpertConsoleUrl`).
- **Official brand assets**: vector logo master (`public/logo.svg`), PNG/WebP renditions, favicon/icon marks and `docs/BRAND.md` guide.

### Reconciliation notes (per docs/PUSH_RELEASE_INSTRUCTIONS.md §5, closed by this release)
- Console product work re-targeted from `Branch`→`Store`, `Transaction`→`SalesTransaction` data surfaces; no new data models were required — the unified schema already covers every expert domain.
- Console data flows through the lineage's real auth (`requireAuth`/`requireRole` + store-scope guards) — no standalone scrypt sessions.
- Multi-branch workspaces and subdomain routing remain the lineage's existing, authoritative implementation.

### Quality
- `eslint`: 0 errors (401 pre-existing warnings unchanged). `tsc --strict`: 0 errors in all ported files (471-error baseline on pre-existing lineage files unchanged). `vitest`: 551 passed / 16 failed / 20 skipped — identical to the pre-port baseline (no regressions introduced).

## [2.18.1] Branch manager user-store binding

Feature release binding every branch to its own manager account. Each branch manager signs in with a unique email and lands directly in their own branch workspace; the branch is determined by the database relation (User.storeId plus an ACTIVE StoreMembership row), never by client input, email parsing, cookies, headers, or URLs.

### Added
- **One branch manager per store in the seed (including Juja Main)**: the seed now upserts five branch managers (Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru) by email, so repeated seeding never duplicates users and never overwrites existing names, phones or passwords. Each manager also receives an ACTIVE StoreMembership row for the workspace layer. The Juja Main manager (juja.manager@mbumahhardware.co.ke) closes the one-store gap in the previous seed.
- **Ensure-pass on already-initialized databases**: the seed's first-boot guard previously skipped databases that already had users, so older installations never received the Juja Main manager. A new idempotent ensure-pass runs on every seed invocation and creates any missing manager and membership without touching other data; failures are logged and never break boot.
- **Post-login redirect for branch-bound roles**: BRANCH_MANAGER and CASHIER sign-ins now land in their own branch workspace (subdomain URL when the current host is subdomain-capable, otherwise /stores/{slug}/dashboard). The target comes from the database relation through the login response's store summary (slug, subdomain and status added to it). Accounts with no branch assignment are sent to the new /account/pending-branch page instead of the organization console; accounts whose store has no slug configured stay on the pinned root app. The /api/auth/me response gained flat storeSlug / storeName / workspaceModeHint aliases.
- **User-creation hardening**: BRANCH_MANAGER and CASHIER require a storeId at creation time, enforced in the Zod schema and again in the route handler; the assigned store must exist, be ACTIVE, and belong to the caller's organization. Every user creation now also writes a tamper-evident, hash-chained AuditLog entry next to the existing SystemLog rows.
- **Branch manager schema repair (scripts/repair-branch-manager-schema.mjs, npm run db:repair-branch-managers)**: raw-SQL additive repair for users.storeId / users.isActive, deterministic storeId backfill for branch-bound users from the {town} email convention, duplicate email detection before the unique index, backup-first with automatic restore, idempotent no-op on healthy databases, and a hard refusal for PostgreSQL with migration guidance.
- **Branch manager verification (scripts/verify-branch-manager-users.mjs, npm run verify:branch-manager-users)**: read-only proof that every store has exactly one bound manager, emails are unique, bindings resolve, memberships are ACTIVE, and no account stores a plaintext or missing password value.
- **Documentation**: docs/branch-manager-users.md (binding rules, seeded credentials, canonical demo email domain decision, repair and verification), a README credentials pointer, and a What's New entry.

### Fixed
- **Seed stage 24 no longer fails silently on SQLite**: the global-chat createMany used skipDuplicates, which the SQLite connector does not support; every local database skipped the global chat messages. The messages are now inserted idempotently behind the existing count guard.

### Security
- Branch-bound roles cannot exist unassigned: the API rejects the shape at two layers, and an unassigned account is redirected away from the organization console at sign-in.
- Cross-branch access remains blocked server-side (403 or safe 404) with SecurityEvent audit rows; this release adds no new access surface and changes no tenancy behavior.
- Demo passwords remain bcrypt hashes (cost 12); no plaintext credential storage anywhere.

## [2.18.1] Branch manager user-store binding

Feature release binding every branch to its own manager account. Each branch manager signs in with a unique email and lands directly in their own branch workspace; the branch is determined by the database relation (User.storeId plus an ACTIVE StoreMembership row), never by client input, email parsing, cookies, headers, or URLs.

### Added
- **One branch manager per store in the seed (including Juja Main)**: the seed now upserts five branch managers (Juja Main, Thika, Ruiru, Nairobi CBD, Nakuru) by email, so repeated seeding never duplicates users and never overwrites existing names, phones or passwords. Each manager also receives an ACTIVE StoreMembership row for the workspace layer. The Juja Main manager (juja.manager@mbumahhardware.co.ke) closes the one-store gap in the previous seed.
- **Ensure-pass on already-initialized databases**: the seed's first-boot guard previously skipped databases that already had users, so older installations never received the Juja Main manager. A new idempotent ensure-pass runs on every seed invocation and creates any missing manager and membership without touching other data; failures are logged and never break boot.
- **Post-login redirect for branch-bound roles**: BRANCH_MANAGER and CASHIER sign-ins now land in their own branch workspace (subdomain URL when the current host is subdomain-capable, otherwise /stores/{slug}/dashboard). The target comes from the database relation through the login response's store summary (slug, subdomain and status added to it). Accounts with no branch assignment are sent to the new /account/pending-branch page instead of the organization console; accounts whose store has no slug configured stay on the pinned root app. The /api/auth/me response gained flat storeSlug / storeName / workspaceModeHint aliases.
- **User-creation hardening**: BRANCH_MANAGER and CASHIER require a storeId at creation time, enforced in the Zod schema and again in the route handler; the assigned store must exist, be ACTIVE, and belong to the caller's organization. Every user creation now also writes a tamper-evident, hash-chained AuditLog entry next to the existing SystemLog rows.
- **Branch manager schema repair (scripts/repair-branch-manager-schema.mjs, npm run db:repair-branch-managers)**: raw-SQL additive repair for users.storeId / users.isActive, deterministic storeId backfill for branch-bound users from the {town} email convention, duplicate email detection before the unique index, backup-first with automatic restore, idempotent no-op on healthy databases, and a hard refusal for PostgreSQL with migration guidance.
- **Branch manager verification (scripts/verify-branch-manager-users.mjs, npm run verify:branch-manager-users)**: read-only proof that every store has exactly one bound manager, emails are unique, bindings resolve, memberships are ACTIVE, and no account stores a plaintext or missing password value.
- **Documentation**: docs/branch-manager-users.md (binding rules, seeded credentials, canonical demo email domain decision, repair and verification), a README credentials pointer, and a What's New entry.

### Fixed
- **Seed stage 24 no longer fails silently on SQLite**: the global-chat createMany used skipDuplicates, which the SQLite connector does not support; every local database skipped the global chat messages. The messages are now inserted idempotently behind the existing count guard.

### Security
- Branch-bound roles cannot exist unassigned: the API rejects the shape at two layers, and an unassigned account is redirected away from the organization console at sign-in.
- Cross-branch access remains blocked server-side (403 or safe 404) with SecurityEvent audit rows; this release adds no new access surface and changes no tenancy behavior.
- Demo passwords remain bcrypt hashes (cost 12); no plaintext credential storage anywhere.

## [2.18.0.3] Branch workspace store-context and repair correction

Correction release completing the branch workspace unavailable diagnosis: the store context resolver now derives the branch slug from the `/stores/{slug}/...` pathname itself, the proxy publishes resolved workspace context headers, and a safe raw-SQL repair script restores the store workspace columns on drifted local SQLite databases. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.3` lives in the `mbumah.releaseVersion` metadata block, the root `VERSION` file and every app-reported version surface.

### Added
- **Pathname slug derivation (`extractSlugFromPathname`)**: `resolveStoreContext` resolves path-mode workspaces from a bare `/stores/{slug}/...` pathname when the caller passes no explicit slug, so a request to `/stores/thika/dashboard` needs no separate slug plumbing. An explicit non-empty slug still wins; the missing-slug short-circuit only fires when neither source can resolve (unit tested).
- **Resolved workspace context headers**: the proxy sets `x-resolved-store-slug`, `x-resolved-store-subdomain` and `x-resolved-workspace-mode` (`subdomain` on rewritten subdomain requests, `path` on `/stores/{slug}/...` pages). Advisory only; API routes and server components keep re-resolving server-side and the store ID is never transported in a header.
- **Safe store workspace schema repair (`scripts/repair-branch-workspace-store-schema.mjs`)**: adds missing `slug` / `subdomain` / `status` columns to the stores table of a local SQLite database, backfills deterministic slugs from the branch names (case-insensitive, tolerant of the "MBUMAH HARDWARE - " display prefix), derives subdomains from slugs, and creates the unique indexes only after duplicate checks pass. The script uses raw SQL only (no Prisma model queries), backs the database up first, rehearses on a scratch copy, is idempotent, restores the backup on any failure, and refuses PostgreSQL with migration guidance instead.
- **Database preflight in `scripts/verify-branch-workspace.mjs`**: a read-only check of the local SQLite stores table (missing columns, stores without slug, duplicate slugs/subdomains, non-ACTIVE stores) with a pointer to the repair script; skips cleanly for PostgreSQL URLs, missing databases and runtimes without node:sqlite.
- **Documentation**: store-context-resolution.md gains the pathname derivation, resolved-context headers and the local database repair walkthrough; branch-workspaces.md links the repair path.

### Fixed
- **Path-mode store resolution no longer depends on callers pre-parsing the URL slug**: empty explicit slugs with a resolvable `/stores/{slug}/...` pathname resolve the branch instead of answering missing-slug (the short-circuit remains for genuinely unresolvable requests and still makes no database call).

## [2.18.0.2] Updater release selection, Windows build mode and Prisma config correction

Correction release covering the defects visible in the field report of a Windows laptop updating from 2.17.7 straight to v2.18.0.0: the updater treated a four-part correction tag as the next normal release, the build ran with standalone output it did not need on Windows, and the Prisma CLI warned about the deprecated package.json configuration block. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.2` lives in the `mbumah.releaseVersion` metadata block, the root `VERSION` file and every app-reported version surface.

### Added
- **Validated release selection (`scripts/release/parse-version.mjs`, `validate-tag.mjs`, `select-release.mjs`)**: the updaters no longer take GitHub's `releases/latest` verbatim. Every release tag is parsed and validated against the release rules: three-part tags are normal releases, four-part tags are correction hotfixes that are only valid while their three-part base release exists, hotfix numbers stop at .5, prerelease suffixes are rejected. Invalid tags are ignored and reported (`Ignored invalid release tag: ...` with the reason) instead of being installed. The selector never downgrades and never jumps a 2.17.7 machine to a four-part tag.
- **Update channels (`UPDATE_CHANNEL`)**: stable (default, three-part releases only), hotfix (three-part releases plus valid hotfixes for the installed base), manual (explicit `-ToVersion`, still validated). `UPDATE_DRY_RUN=1` prints the current version, the latest valid stable release, the latest valid hotfix for the installed base, the selected release with its reason, and what would happen, then changes nothing.
- **Update state file**: the script updaters publish their progress to `%USERPROFILE%\mbumah-pos-data\update-state.json` (same schema as the staged updater's `updater/update-state.json`): current/pending version, state (idle through activated, rolled-back, failed), progress, backup path, build log path, channel, rollback availability.
- **Pre-build checks**: free disk space (fail under 2 GB, warn under 5 GB), database file writability, dependency manifest presence, and an install-location advisory when the app lives under Downloads, Compressed or OneDrive folders (recommendation: `C:\MbumahPOS`).
- **Build log capture and scanning**: updaters write every build to `mbumah-pos-data/logs/build-{version}-{timestamp}.log`; `scripts/verify-build-output.mjs` scans that log and fails the update on real build errors in every mode, and on the standalone trace-copy failure class (`EINVAL`, `Failed to copy traced files`) whenever a standalone build was expected.
- **Release safety gates in CI**: `verify:prisma-config`, `verify:release-selection` and `verify:windows-build` run in the Security & Schema job so the release rules and the build-mode wiring cannot regress silently.
- **Documentation**: docs/windows-local-builds.md, docs/standalone-output.md, docs/prisma-config.md, docs/updater-release-channels.md, docs/release-versioning.md, plus a troubleshooting entry.

### Fixed
- **Updater release selection (field report: 2.17.7 updated to v2.18.0.0)**: four-part correction tags are no longer treated as the next feature release. On the stable channel a 2.17.7 machine now moves to the latest valid three-part release (for example v2.18.0), and a machine already on the hotfix's base picks the hotfix. The selector is unit tested end to end (vitest plus `scripts/verify-release-selection.mjs` in CI).
- **Windows laptops build normal output (v2.18.0.2 policy)**: standalone output is now Docker/Linux only (`resolveStandaloneOutput` in `src/lib/build-mode.ts`). Windows never builds standalone even if BUILD_STANDALONE=1 is set (it warns instead), the Windows installer/updater dropped the standalone assembly step, and the launcher (`start-server.mjs`) starts the plain build with `next start` when no standalone output exists. This removes the entire Windows trace-copy/EINVAL failure class and the "Build output missing (.next/standalone/server.js)" failure mode. A stale standalone output from an older release is deleted during the rebuild and its presence after a normal build is a hard verification failure.
- **Process-tree stop on Windows**: the updater stops the POS with `taskkill /T /F` so the `next start` child process cannot survive as an orphan holding port 3000, and already-exited processes no longer produce errors.
- **Prisma configuration warning removed**: the deprecated `package.json#prisma` block (removal planned in Prisma 7) is gone; the seed command lives in `prisma.config.ts` (Prisma 6.16+), which loads the repo `.env` with the same ".env wins" precedence as the runtime launchers and defaults DIRECT_URL to DATABASE_URL. `prisma validate`, `prisma generate`, `prisma db push` and `prisma db seed` all verified; the Docker runner image copies `prisma.config.ts` so container seeding keeps working.
- **Prisma version drift guard**: `prisma` and `@prisma/client` are pinned to the current stable line (^6.19.2); the new `verify:prisma-config` check fails CI on any prerelease tag (such as 8.0.0-rc.22) or major drift. Update notices like "Update available 6.19.2 -> 8.0.0-rc.22" are informational only and never trigger upgrades.

### Security
- The updater now fails safe: it verifies the build output (build log scan plus output shape, including the stale-standalone check) BEFORE declaring success, publishes its state, and rolls the code back to the previous version automatically with the calm message "Update could not be completed. The previous version is still available."
- Invalid release tags can no longer be activated through the updater; the manual channel still validates tag format and base existence.
- No authorization, tenancy or data-handling changes; the database is only touched by the existing guarded schema converge, and the field log's in-sync database needed no repair.

## [2.18.0.1] Windows standalone build correction (EINVAL chunks, sharp, updater)

Field-report correction release for Windows laptop installs (ZIP, no git), covering the three defects visible in the v2.17.6/v2.17.7 update logs: "Failed to copy traced files ... EINVAL" build warnings, "Could not load the sharp module using the win32-x64 runtime" image errors, and an "UPDATE COMPLETE" banner followed by a start failure ("Build output missing (.next/standalone/server.js)").

### Added
- **Standalone build verifier (`scripts/verify-standalone.mjs`)**: after every installer/updater build, proves that `.next/standalone/server.js` exists, the client static assets were assembled, and EVERY server chunk referenced by any route or runtime file is actually present in the standalone output. An incomplete build is now a hard failure that triggers the updater's automatic rollback (and stops the installer with a clear message) instead of a restart into a broken server.

### Fixed
- **Windows EINVAL chunk loss (field log: `/api/batch`, `/api/cron/nightly`)**: Turbopack emits asynchronously imported node builtins as chunk files named after the specifier, e.g. `[externals]_node:inspector_7a4283c6._.js`. NTFS forbids colons in file names, so Windows standalone builds dropped those chunks with EINVAL copyfile warnings and the affected routes (batch operations, the nightly maintenance cron and everything sharing their chunks) broke at runtime while Linux and Vercel builds worked. Every `node:*` builtin is now aliased to its identical bare specifier (`turbopack.resolveAlias` in `next.config.ts`), so Turbopack's chunk file names never contain a colon on any platform - the runtime modules are byte-for-byte the same Node builtins.
- **`node:fs/promises` dynamic import in `src/lib/data-retention.ts`** converted to a static import: static built-in imports are inlined by the bundler and produce no chunk file at all (this was the nightly-cron half of the EINVAL pair).
- **sharp win32-x64 missing** (the "Could not load the sharp module" 500s on every optimized image): installers and updaters now install with `npm install --include=optional` so a machine-level npm config can never skip sharp's platform binary, repair a missing win32-x64 binary automatically (`npm install --no-save --os=win32 --cpu=x64 sharp`), and - as the final safety net - `next.config.ts` probes sharp at BUILD time and bakes `images.unoptimized` into standalone laptop builds whose machine has no usable binary, so product photos always serve (without resizing) instead of erroring.
- **Update loop on correction releases**: the updater compared `package.json` "version" (three-part, "2.18.0") against the release tag (four-part, "v2.18.0.0"), which can never match - a machine that installed v2.18.0.0 would download and rebuild it again on EVERY start. The Windows and macOS/Linux updaters now prefer the `mbumah.releaseVersion` metadata when comparing, so correction releases settle to "Already up to date" like every other release; the Start POS "was updated to" message reads the same field.
- **Scary-but-harmless stop error**: `Start POS` no longer prints the red "[ERROR] Cannot find a process with the process identifier ..." line when the server process exited early; it points at the reason printed above it and the two most common fixes instead.

### Security
- No authorization, tenancy or data-handling changes; the verifier only reads build output and the sharp repair only runs npm install scoped to the sharp package.

## [2.18.0.0] Branch workspace path fallback correction

Correction release for the "This branch workspace does not exist or is no longer available" error when opening a branch workspace from the organization console. package.json keeps the valid semver `2.18.0`; the full correction version `2.18.0.0` lives in the `mbumah.releaseVersion` metadata block, a new root `VERSION` file, and every app-reported version surface (footer, login screen, `/api/health`, openapi.json).

### Added
- **Safe branch workspace link builder (`src/lib/branch-workspace.ts`)**: one pure, client-safe and server-safe `getBranchWorkspaceHref` function that turns a store record plus the current origin into the correct new-tab URL: an absolute subdomain URL only when every safety check passes, otherwise `/stores/{slug}/dashboard`; `null` when no safe URL exists (missing slug, inactive store, mode off). It never produces `/stores/undefined`, `/stores/null` or unresolvable `//undefined..` URLs, and it re-uses the reserved-subdomain rules from `src/lib/workspace/config.ts`.
- **Server-side store context resolver reason codes**: `resolveStoreContext` and the `/api/me/store-context` payload now carry a stable, client-safe `reasonCode` alongside the unchanged internal `reason` (store-not-found, store-inactive, user-not-allowed, unauthenticated, missing-slug, schema-drift). The workspace gateway renders one calm message per cause, replacing the single generic "does not exist or is no longer available" copy.
- **New resolver detections**: a present-but-empty slug short-circuits to `missing-slug` without a database call, and a Prisma known request error during the store lookup (for example P2022, a missing column) is answered as `schema-drift` without leaking any error text. Denial audit rows now also carry the request host, pathname and request id for correlation.
- **Workspace environment safe defaults (`.env.example`)**: the branch workspace keys ship with safe local defaults (path mode, no shared cookie domain, minimal host allowlist, forwarded-host trust off) plus a comment block pointing at `.env.local-offline.example`, `.env.lan.example` and `.env.online.example` and the automatic path-fallback rule for localhost, 127.0.0.1 and raw IPs.
- **Hosts helper extension (`scripts/domains/print-hosts.mjs`)**: an optional second block from the `LOCAL_LAN_IP` environment variable and an explicit note that raw localhost needs no hosts entries in path mode; the script still only prints entries and never touches the hosts file.
- **Verification script and tests (`scripts/verify-branch-workspace.mjs`, `bun run verify:branch-workspace`; `src/tests/lib/branch-workspace.test.ts`)**: a read-only environment and hygiene check for branch workspace configuration, and 27 new vitest cases covering the link builder safety matrix (localhost, 127.0.0.1, raw IPv4/IPv6, path mode, reserved subdomains, missing slug, inactive stores, broken slug data) and the resolver reasonCode matrix (path/subdomain resolution, slug fallback, inactive denial, cross-store denial, SUPER_ADMIN/STORE_OWNER/warehouse-manager rules, schema drift, non-Prisma error re-throw).
- **Documentation**: `docs/branch-workspaces.md` (modes, fallback rules, button behavior, local/online setup), `docs/store-context-resolution.md` (resolver modes, reasonCode vocabulary, security properties), a "This branch workspace does not exist" entry in the troubleshooting guide with all six messages and their fixes, and cross-links from the README and the workspace docs.

### Fixed
- No broken `/stores/undefined` or `/stores/null` links: the organization console's "Open branch workspace" button now uses the safe builder and shows a calm inline message ("Branch workspace unavailable. Store slug is not configured.") instead of opening a dead tab when the store slug is missing.
- Localhost, 127.0.0.1, `*.localhost`, ::1 and raw LAN IPs no longer attempt invalid subdomain workspaces: branch links always fall back to `/stores/{slug}/dashboard` on those hosts, even when the environment asks for subdomains.
- A missing or whitespace store slug is handled safely end to end (calm console message, `missing-slug` gateway state, no database call).
- Inactive store access is blocked with a clear message ("This branch is currently inactive. Contact the store owner or system administrator.") at the button and in the gateway.
- Cross-store branch access stays denied server-side; the gateway wording and the audit trail make the cause explicit instead of a generic not-found.
- Schema drift on local databases now shows a calm, actionable "schema update needed" message instead of a misleading branch-not-found error.

### Security
- **Branch workspace resolution is validated on the server**: the store is re-derived from the request host or path slug for every call, never from client input, and authorization (role rules plus ACTIVE memberships) is enforced inside the resolver before any workspace payload is returned.
- **Denied access attempts are logged safely**: `UNAUTHORIZED_ACCESS` SecurityEvent rows for workspace denials now include the request host, pathname and request id, while never exposing error text, stack traces or secrets; audit failures still never change the access decision.

## [2.18.0] Full QA verification release

### Added
- **Full QA report (`docs/v2.18.0-qa-report.md`)**: the complete audit of the v2.17.x feature line - quality gates, hygiene sweeps, security and tenant isolation, workspace resolution, the staged updater contract, hosting modes, data integrity and observability - with per-area pass/fail/blocked results, evidence references, known gaps and the release verdict.
- **QA evidence for the v2.17.x feature line**: static gates re-measured at the 2.17.9 baseline (lint 0 errors and 396 warnings, typecheck 472 advisory, vitest 507/507, prisma validate valid), a 21-check runtime matrix on the seeded SQLite development server (auth, RBAC, cross-store 404-indistinguishable probing, store-context allow/deny, updater 401/400/202/409, subdomain and forwarded-host behavior, gateway page, chat) and a browser pass verifying the organization console login and the five branch workspace links.

### Fixed
- Nothing. This is a verification release: no runtime behavior changes are intended; the changes are the QA report, the version bump and release notes.

## [2.17.9] Staged updates and login progress UI

### Added
- **Staged update orchestrator (`scripts/staged-update.mjs`)**: the self-hosted staged update pipeline as one detached run - download, schema preflight on a throwaway copy of the database, verified database backup, install (install-directory swap when `MBUMAH_INSTALL_DIR` is set), activation and a bounded health smoke test - with automatic rollback of the previous release and database once the backup step has completed. Refuses to run on Vercel serverless (exit code 2); never runs destructive SQL; writes no secrets to the state file.
- **Updater state store (`src/lib/updater/state.ts`)**: the shared server-side state file (`updater/update-state.json`) with phase/percent/message progression, atomic tmp+rename writes, path-sanitized error text, and idle defaults (never a 500) on missing or corrupt files.
- **Update endpoints**: `GET /api/update/status` (public minimal progress; SUPER_ADMIN and STORE_OWNER additionally receive startedAt, sanitized error and pid) and `POST /api/update/prepare` (admin-only; 409 while an update is active, 501 on Vercel).
- **Login page update progress bar (`src/components/updater/update-progress-bar.tsx`)**: an iPhone-style amber progress banner that polls the public status endpoint every 2.5 s during maintenance windows and renders nothing at any other time, so the login form is untouched.
- **Documentation (`docs/staged-updates.md`)**: the phase table, the endpoint contract, orchestrator CLI usage, `UPDATE_ON_START` semantics and rollback behavior.

### Fixed
- `UPDATE_ON_START=0` now disables only the remote version check at startup; the local schema preflight (the start-time schema self-heal) always runs.

### Security
- **Update preparation is restricted to SUPER_ADMIN and STORE_OWNER**: `POST /api/update/prepare` validates the DB-backed session in-file (401 unauthenticated, 403 otherwise) before accepting a run and refuses serverless environments outright.
- **Public status exposes progress only**: `GET /api/update/status` answers phase, percent, message, target version and timestamp to everyone; error detail, process id and start time require an owner/administrator session, and even the stored error text is stripped of filesystem paths before it is written to disk.

## [2.17.8] Security, RBAC and tenant isolation hardening

### Fixed
- **`requireAuth` now enforces store-scope validation**: the wrapper skipped `assertStoreScope`, so (a) a non-admin session WITHOUT a store assignment ran handlers in `runWithoutTenant` (no ORM tenant filtering at all) and (b) cross-store `?storeId=` probes were silently answered instead of rejected. Both paths now return 403 and file the same SecurityEvent as `withSessionAuth` / `requireStoreAccess`. SUPER_ADMIN and validated multi-store members are unaffected.
- **Unauthenticated data routes closed**: `GET /api/suppliers/[id]/performance` (order trends, payment history, balances) and `GET /api/etims/dashboard` were exported with no session validation at all (the edge proxy checks Bearer PRESENCE, never validity); they now run behind `requireStoreAccess`. `POST /api/etims/test-connection` and `POST /api/etims/register-product` (an outbound KRA eTIMS action) require a manager-or-above session.
- **`X-Powered-By` removed from page responses**: the API headers block blanked it on `/api/*` only; `poweredByHeader: false` (next.config.ts) stops advertising the framework on every response.

### Security
- **Body storeId validation (`assertBodyStoreScope`)**: several mutating routes accepted `storeId` in the JSON body, and Prisma `create` is deliberately NOT tenant-intercepted (injectTenant only narrows read/update/delete), so a cross-store body value was a REAL cross-tenant write. The new shared guard applies the query-param policy (SUPER_ADMIN/STORE_OWNER pass, active StoreMembership passes, same store passes; otherwise 403 + SecurityEvent) and is wired into stock-movements POST, M-Pesa STK push, KRA submit, eTIMS invoice cancel, debt reminder process/schedule, and gift-card redemption. `reports/export` and receipt distribution already resolve the store server-side (the session wins) and are covered by the requireAuth fix.
- **[id] 404 policy + denied-attempt audit (`auditRecordMiss`)**: store-scoped `[id]` routes answer 404 for a missing record AND for another store's record (ORM tenancy narrows the unique lookup) - the caller cannot distinguish the two (no enumeration oracle), but a foreign-store id now writes a SecurityEvent (UNAUTHORIZED_ACCESS, blocked) plus a `CROSS_TENANT_RESOURCE_DENIED` ops log so IDOR probing is visible. Wired into `/api/products/[id]` (GET/PUT/DELETE), `/api/customers/[id]` (GET/PUT), `/api/transactions/[id]` (GET) and `/api/suppliers/[id]/performance`. Truly-missing ids stay silent.

### Added
- 12 new security regression tests (src/tests/lib/store-guard.test.ts) covering the body storeId policy matrix (SUPER_ADMIN / STORE_OWNER / active membership / no store assignment / cross-store deny with SecurityEvent) and the 404 classifier (silent for missing and own-store records, SecurityEvent for foreign-store records, probe failures swallowed so auditing never changes the response).

## [2.17.7] Online hosting and public subdomains

### Added
- **Trusted forwarded host support (`TRUST_X_FORWARDED_HOST`)**: the new `resolveRequestHost` helper (src/lib/workspace/config.ts, Edge-safe, no Prisma) resolves the client-visible request host from the first `x-forwarded-host` value when the flag is truthy ('1', 'true', 'yes', 'on', case-insensitive), falling back to the plain `Host` header. Wired into the proxy workspace pipeline (page routing, host allowlist, CORS preflight) and the workspace host readers (`/api/me/store-context`, `/api/stores/[storeSlug]`). Off by default everywhere: with the flag absent, request handling is byte-for-byte the pre-2.17.7 behavior.
- **Online tunnel env template (`.env.online.example`)**: copy to `.env` for a self-hosted public deployment on your own domain (`app.mbumah.co.ke` console plus the branch wildcard) behind Cloudflare Tunnel or Caddy, with secure shared cookies, the host allowlist, the forwarded-host trust flag, and commented production PostgreSQL and M-Pesa callback placeholders. Raw localhost and LAN IPs always fall back to path mode automatically.
- **Online hosting guide (`docs/online-hosting.md`)**: the production counterpart to the dev-focused tunnel guide. Covers the environment, the `x-forwarded-host` trust contract, a named Cloudflare Tunnel setup (ingress rules for the console host and the `*.mbumah.co.ke` wildcard, `cloudflared tunnel route dns`, Host header preservation notes) and a Caddy reverse proxy option (site blocks for the app host and the wildcard, automatic HTTPS via the DNS-01 challenge, admin endpoint off, no debug).

### Fixed
- The ngrok recipe in `docs/tunnel-development.md` is now explicitly marked DEV/TESTING ONLY (free tunnels rotate URLs and cannot serve branch wildcards) and points production readers at the online hosting guide; cross-links to the new guide were added from the self-hosting, subdomain-workspaces, LAN deployment, local offline setup and documentation index pages.

### Security
- `x-forwarded-host` is honored only when `TRUST_X_FORWARDED_HOST` is enabled, and the security contract is documented at the helper and in both hosting guides: enable it only behind a proxy or tunnel that overwrites the header (Cloudflare Tunnel, Caddy), never on a directly exposed server. The resolved host still passes the `ALLOWED_HOSTS` validation, so spoofed or unknown hosts are rejected with 403 regardless.

## [2.17.6] LAN hosting and localhost fallback completion

### Added
- **Protected db-schema health endpoint (`/api/health/schema`)**: an authenticated operator view of the full drift picture that the public `/api/health` only hints at. Probes every known drift-sensitive column (the five nullable `idempotencyKey` columns and `users.isEngraved`), reports per-probe results, the resolved provider, and row counts for the operational tables, and returns the matching remediation ("run the updater" or `npm run db:repair`). The endpoint never throws on a drifted database - reporting is its job.
- **LAN env template (`.env.lan.example`)**: copy to `.env` on the shop server for `mbumah.lan` (or the static LAN IP variant, documented inline) with the one shared SQLite database, plain-HTTP shared cookies and mock M-Pesa. Referenced from the LAN deployment guide.
- **Windows Firewall guidance** in `docs/lan-deployment.md`: the exact `New-NetFirewallRule` invocation for the POS port (private/domain profiles), a cross-device `Test-NetConnection` verification, and the Docker Desktop note.

### Verified (already shipped, unchanged)
- The no-Docker launcher binds `0.0.0.0` (`HOSTNAME` is forced in `deploy/nodocker/start-server.mjs`) and localhost plus raw LAN IPs fall back to path mode automatically (`resolveWorkspaceHostMode` returns `organization` for them); dnsmasq, Pi-hole and router DNS wildcard options are documented in the LAN guide.

## [2.17.5] Branch workspaces and organization console: verification release

### Verified
- The full branch workspaces and organization console matrix shipped in v2.16.0 was re-verified end to end against the current build (browser E2E on the seeded local database): SUPER_ADMIN login lands on `/org/dashboard` (5 branches, KPIs, per-branch revenue table); "Open branch workspace" actions open NEW TABS; `/stores/thika/dashboard` renders the pinned branch shell with its own page title and branch badge; the warehouse manager's branch selector lists exactly the assigned branches (Juja Main, Thika); a Juja cashier opening the Thika workspace receives the calm "You do not have access to this branch" denial; the global chat channel is readable from a branch account (chat visibility stays separate from branch data access). All roles share the one database; every workspace request is re-authorized server-side.

### Changed
- The global chat composer input now declares `type="text"` explicitly (consistency for input styling and accessibility queries; behavior unchanged).

## [2.17.4] Local offline subdomain foundation: env template and hosts writer

### Added
- **Local offline env template (`.env.local-offline.example`)**: copy to `.env` for a single-shop offline install where every branch behaves like its own website. Pre-wires the `mbumah.test` root domain (the default host allowlist then covers the root and every branch subdomain), SQLite paths for the one shared database, plain-HTTP shared-cookie settings (`.mbumah.test`, secure off) and the sandbox M-Pesa callback. Referenced from `docs/local-offline-setup.md`.
- **Hosts file writer (`npm run domains:write-hosts`)**: companion to the print-only helper. Writes an idempotent, clearly marked managed block (root domain plus all five seeded branch subdomains, LAN IP or 127.0.0.1 via `--ip`, custom root via `--domain`), takes a timestamped backup of the hosts file before every write, verifies the result, supports `--remove`, and refuses cleanly with the exact elevated command when not run as root/Administrator. Verified: the write, re-run (single replaced block, foreign entries preserved), remove, and the non-elevated refusal path.

The remaining foundation items of this phase (Store slug and subdomain schema, seeded slugs and subdomains for the five branches, store context resolver, middleware host resolution, allowed-host validation, `/stores/[storeSlug]` path fallback, reserved subdomain blocking) shipped in v2.16.0 and are unchanged here.

## [2.17.3] Database safety tooling and standalone opt-in

### Added
- **Schema preflight (`npm run db:preflight`)**: answers "will this schema apply safely?" BEFORE an install or update touches the live shop database. It copies the SQLite database to a throwaway preflight file, runs the read-only `prisma migrate diff` between the copy and the models, then classifies the convergence on the copy: `in-sync`, `lossless-converge`, `additive-converge` (the known safe case for this project's nullable idempotencyKey / isEngraved columns) or `unsafe` (even `--accept-data-loss` fails; callers must abort). The live database is never written. Server databases are diffed read-only via `PREFLIGHT_DATABASE_URL`. `KEEP_PREFLIGHT_DB=1` keeps the copy for inspection.
- **Safe additive repair (`npm run db:repair`)**: one operator command for the "Schema drift detected" state: verified backup first (`db:backup` semantics), then the ensure-schema converge (plain push, and only on the known additive-drift refusal a pre-converge SQLite backup plus `--accept-data-loss`), then a verification push that must be a clean no-op. Exit 0 means repaired and verified.
- **Windows standalone output is now opt-in** (`BUILD_STANDALONE=1`): the Docker image and both no-Docker installers/updaters set the flag (their launchers run `.next/standalone/server.js`); plain `next build` and Vercel build without it, which also avoids the Windows EINVAL copyfile errors the standalone file walk can trigger. `users.isEngraved` was audited and confirmed deliberate (self-healing bootstrap admin); its schema documentation stands.

### Investigated and blocked
- **`prisma.config.ts` migration (the deprecated `package.json#prisma` seed block stays for now)**: adding a Prisma config file changes Prisma 6.19 CLI behavior - the CLI then resolves the datasource from the .env file and ignores inherited environment variables, and schema management rides `directUrl`, so the entire self-host toolchain (ensure-schema converge, installers, CI database preparation, the new preflight and repair targets) silently loses explicit-target control. Reproduced and documented; reverted. Revisit when adopting Prisma 7, together with a toolchain-wide env strategy.

## [2.17.2] File organization and duplicate file removal

### Removed
- **Retired duplicate brand assets**: `public/logo.png` and `public/logo.svg` (the old flat logo generation) are gone. Every surface now uses the current 3D brand set: the app sidebar, receipts and printed documents, the PDF statement report (which now embeds the 3D gear mark), and the service worker precache (cache version bumped so clients pick up the new asset list).
- **One-shot operational workflow removed**: `.github/workflows/delete-duplicate-vercel-project.yml` served its purpose once the duplicate Vercel project was confirmed deleted; the workflow remains recoverable from git history if ever needed again.

### Changed
- **.gitignore hardened**: SQLite/PostgreSQL local database variants (`*.sqlite`, `*.db.wal`/`*.db.shm`) and OS or editor droppings (`Thumbs.db`, `*.swp`) are now ignored, alongside the existing env, log, and database exclusions. One shared database remains the rule: nothing in the repo creates per-branch databases.
- The Edge proxy matcher explicitly excludes the 3D brand assets from the workspace pipeline so they are always served statically.
- Project structure documentation updated to describe the current brand asset set.

## [2.17.1] Professional repository writing standards

### Changed
- **Decorative emojis removed from the product surface**: seed and tooling console output now uses plain status markers ([ok] / [skip] / Warning: / [FAIL]); the offline page, WhatsApp receipt text, email subjects and headings, staff message templates, PDF statement activity rows, and client error logs read as plain professional text. Typographic status glyphs used by financial tables (check and cross marks) and the Mac Command key notation are preserved.
- **AI-style em and en dashes removed** from prose, comments, documentation (including the archive), console output, and config banners across the repository. Technical hyphens inside identifiers, URLs, CLI flags, package names, and version strings are untouched.
- **Terminology standardized in prose**: M-Pesa, Daraja API, STK Push, TypeScript, Next.js, PostgreSQL. Code identifiers, enum values, and endpoint paths are unchanged.
- **Demo credentials labeled as local-only**: the README, client setup guide, and self-host READMEs now explicitly mark the seeded admin login as a local default that must be changed immediately after first login.

### Fixed
- **Brand consistency**: receipts, printed documents, and the PWA shortcuts now use the current 3D gear brand mark (the same set as the app sidebar and favicon) instead of the retired flat logo; the two PWA shortcut icons point at the standard icon set; staff-facing email placeholders use the mbumahhardware.co.ke domain.
- **Self-host README corrections**: removed a stale version reference and repaired a malformed documentation link.

## [2.17.0] Hosting readiness audit corrections (external spec review)

### Added
- **Hosting readiness audit** (`docs/hosting-readiness-audit.md`): the external "hosting and subdomain phases" specification and the "local and online hosting guide" were reviewed against the repository. The audit maps all seven spec phases to what actually shipped (v2.15.0 through v2.16.0), records where the documents' assumptions no longer match the codebase (custom Bearer auth instead of NextAuth, IndexedDB instead of localStorage, `isEngraved` is a deliberate feature, the v2.15.0 series is already released so remaining work uses 2.17.0+), and keeps a prioritized gap register with dispositions.
- **Deployment posture fields on `/api/health`**: new informational top-level fields `appMode` (APP_MODE vocabulary: local-offline / development / production), `workspaceMode` (auto / subdomain / path / off) and `databaseProvider` (sqlite / postgresql, derived from the DATABASE_URL scheme). Monitors, tunnel checks and the LAN health gates can now tell which deployment posture answered. Additive only; the status computation is unchanged.
- **Database backup tooling** (`scripts/backup-db.mjs`, `npm run db:backup`): timestamped SQLite backup with `-wal`/`-shm` sidecars, file-missing and empty-file refusal, size verification, `BACKUP_DIR` destination and `BACKUP_KEEP`/`--keep` retention (newest 20 by default). PostgreSQL URLs print masked pg_dump / snapshot guidance instead of handling credentials. `npm run db:verify` runs the provider-aware `prisma validate`.

### Fixed
- **STK Push now rides the PAYMENT rate tier** (20/min) in the Edge proxy instead of the generic WRITE tier; initiating a customer-facing M-Pesa payment prompt is money-touching and must not share the 30/min write budget.
- **Docs corrected**: `/api/healthy` never existed as a route - `docs/deployment.md` and `docs/self-hosting.md` now document the real authenticated aggregated status endpoint `/api/health/system-status`, and the `/api/health` field lists include the new posture fields.

## [2.16.0] Feature: subdomain workspaces for offline and localhost modes

### Added
- **Branch subdomain workspaces** - every branch can now be reached as its own website (`juja-main.mbumah.co.ke`) while everything stays on one shared database. The root domain remains the organization console; path mode (`/stores/juja-main/dashboard`) remains the universal fallback for localhost, raw IPs, previews and tunnels without wildcard DNS. Mode selection is automatic (`NEXT_PUBLIC_STORE_WORKSPACE_MODE=auto`) with explicit `subdomain`, `path` and `off` overrides.
- **Host security layer in the Edge proxy** (extends the previous API-only pipeline to pages): Host header allowlist (`ALLOWED_HOSTS`, built-in defaults cover localhost, LAN IPs, `*.vercel.app` and the configured root domain), port stripping, reserved-subdomain protection (www, api, auth, admin, app, ...), branch subdomain rewrites to the internal path workspace, advisory `x-store-subdomain` / `x-store-slug` request headers, and a CORS OPTIONS preflight answer for trusted origins only (never a wildcard with credentials).
- **Store workspace schema**: `Store.slug` + `Store.subdomain` (unique, RFC 1123 labels, reserved-word protected) and `Store.brandingColor` (branch accent). Production-safe idempotent backfill (`scripts/backfill-store-slugs.mjs`, wired into `vercel-build` and `npm run db:backfill-slugs`) stamps legacy rows without touching populated values.
- **Multi-store memberships**: new `StoreMembership` model (unique active row per user+store) grants additional branch access; `assertStoreScope` now honors org-wide roles (SUPER_ADMIN, STORE_OWNER) and active memberships, and the ORM tenant context follows the validated requested store so branch workspaces show the right branch's data. A demo WAREHOUSE_MANAGER (`warehouse@mbumahhardware.co.ke`, password123) is seeded with Juja Main + Thika assignments.
- **Organization console** (`/org/dashboard`): combined metrics (revenue, transactions, low stock, overdue rentals, debt aging, pending M-Pesa), per-branch performance table, recent audit events, and "Open branch workspace" actions that open a new tab (subdomain URL when available, path mode otherwise). SUPER_ADMIN and STORE_OWNER get the full view; ACCOUNTANT a read-only financial view; branch-only roles are denied and the attempt is audit-logged.
- **Branch selector** (`/branches/select`) for multi-store members: shows only assigned active stores, opens workspaces in new tabs, auto-redirects single-store members, calm empty state for unassigned users.
- **Global chat across subdomains** (`/chat` + `/api/chat/*`): a singleton GLOBAL channel readable by every authenticated user of every branch (chat visibility is separate from data access), branch origin badges on messages, store threads unchanged, Zod-validated sends (2000 char cap) on the MESSAGING rate tier, 5s/15s polling fallback - no WebSocket dependency, serverless-friendly.
- **Cross-subdomain session sharing (opt-in)**: when `NEXTAUTH_COOKIE_DOMAIN` is configured, login also sets a shared `mbt_token` cookie; branch subdomain origins adopt it at boot and validate via `/api/auth/me`. Without it, behavior is unchanged (Bearer in localStorage, per-origin login).
- **Workspace routing for the SPA**: `/stores/[slug]/[[...rest]]` renders the exact same shell (extracted to `src/components/app/main-app.tsx`) pinned to the resolved branch, with per-branch page titles (`{Store Name} | Mbumah Hardware POS`), a branch badge in the top bar, and the branch accent color. Single-branch roles no longer see a store switcher in a pinned workspace; org roles keep it (the server still validates every switch).
- **Local setup tooling**: `npm run domains:print` prints copy-pasteable hosts-file entries (macOS/Linux/Windows instructions in the docs), `npm run domains:verify` runs a PASS/FAIL verification matrix against a running server (subdomain resolution, host header attacks, reserved subdomains, port stripping, health through a branch host).

### Tests
- 28 new unit tests: workspace domain helpers (host parsing, allowlist, reserved subdomains, mode resolution, internal rewrites) and workspace store definitions consistency (seed vs client store-info vs domains config). Suite: 19 files / 475 tests green; lint 0 errors; typecheck at baseline.

### Notes
- All branches keep sharing one database; tenant isolation is unchanged and every workspace request is re-authorized server-side (denied attempts are written to the security event feed).
- Docs: `docs/subdomain-workspaces.md` (master reference), `docs/local-offline-setup.md`, `docs/lan-deployment.md`, `docs/tunnel-development.md`, `docs/multi-store-workspaces.md`, `docs/global-chat.md`, `docs/rbac.md`, `docs/architecture.md`, `docs/vercel-deployment.md`, `docs/self-hosting.md`.

## [2.15.2] Hotfix: offline laptops self-heal database schema drift

### Fixed
- **Critical (offline incident): laptops updated to a release whose schema added unique columns kept serving Prisma P2022 errors** - "The column `equipment_rentals.idempotencyKey` does not exist in the current database" on `/api/notifications`, `/api/debt`, `/api/reminders/debt/overdue` and `/api/stock-movements`. Root cause: v2.14.0 added five nullable `idempotencyKey @unique` columns; Prisma classifies adding a unique constraint to a NON-EMPTY existing database as a data-loss warning and REFUSES `prisma db push` in non-interactive mode ("Use the --accept-data-loss flag"). Every self-hosted path (Windows installer, updater, Linux laptop scripts, docker entrypoint) ran the bare push with no fallback, so the database silently stayed behind the code while `/api/health` stayed green (row counts never touch new columns).

### Added
- **`scripts/ensure-schema.mjs` - the self-healing schema converge step** now behind `npm run db:push` everywhere (installer, updater, laptop scripts, CI prepare): plain push first (fast no-op when in sync); when refused, it backs the SQLite file up (`pos.db.pre-heal-<timestamp>.db`, newest 5 kept) and converges with `--accept-data-loss` - safe for this project's recurring additive drift (new nullable unique columns).
- **Startup self-heal**: the standalone server launcher (`deploy/nodocker/start-server.mjs`) converges the schema on EVERY boot before starting the POS (~1s no-op when in sync), so an install whose update schema step was skipped repairs itself the next time the shop opens the till. Disable with `SKIP_SCHEMA_HEAL=1` in `.env`. The docker entrypoint uses the same converge step (replacing the blind push + retry).
- **Schema-drift sentinel in `/api/health`**: when row counts succeed but the schema lags the code, `database_stats` degrades from `ok` to `warning` with a self-service fix hint. The probe uses the generated Prisma client (an ORM `findFirst` on the sentinel column) - a raw `SELECT "idempotencyKey"` probe would be blind on SQLite, which treats a double-quoted unknown identifier as a string literal instead of erroring. The start-pos and update-pos health gates key on exactly this status, so a drifted database can no longer pass the update health gate unnoticed.

### Notes
- Data safety: the converge fallback only ever runs after a plain push is refused, takes a timestamped SQLite file backup first, and the updater still takes its full pre-update backup before the rebuild. No changes to totals, VAT math, payments, debt or discount gates.
- Immediate remedy for affected laptops (works on any version): close the POS, run `npm run db:push` in the app folder, start the POS. Updating to 2.15.2+ does this automatically.

## [2.15.1] Hotfix: offline sales actually queue (mutation networkMode)

### Fixed
- **Critical: the offline sale flow never fired while offline** - TanStack Query pauses mutations when `navigator.onLine` is false under its default `networkMode: 'online'`, so `checkoutMutation.mutationFn` never ran, `saveOfflineTransaction()` was never reached and tapping "Process Payment" offline silently did nothing (queue stayed empty, no synthetic receipt). The app-wide QueryClient now sets `mutations.networkMode: 'always'`; the checkout mutationFn's own `navigator.onLine` check routes offline sales into the IndexedDB queue, and mutations without an offline path surface their network error via their normal `onError` handlers.
- Caught by the post-release browser E2E (release-process step 3): `[HANDLE-CHECKOUT]` logged while the mutation function never did; after the fix the full loop was verified live on the POS - offline sale saved locally with amber queue badge and synthetic receipt, reconnect auto-synced it to the server (real receipt number, Completed), queue drained to the green dot, and exactly one "Offline sales synced" success toast appeared (no duplicates).

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates. The offline queue engine, idempotent replay and indicator were already correct - only the mutation gating blocked them.

## [2.15.0] Release: audit corrections, realtime self-hosting wiring, offline polish

### Fixed
- **Duplicate sync toasts at the till**: an automatic background sync with the POS tab mounted toasted twice for the same event (POS tab's own success toast + the global OfflineIndicator's transition toast). Toast ownership is now explicit - the top-bar indicator owns the single "Offline sales synced" success per queue transition, and the POS tab surfaces only what the indicator cannot see: per-sync failure detail (which sales will retry). Manual "Sync now" and offline/online announcements are unchanged.
- **Latent self-hosted startup bug**: nginx `proxy_pass http://nextjs_app` referenced a hostname the compose file never defined (the app container had been renamed to `mbumah_app`), so `docker-compose.prod.yml` failed at nginx startup with "host not found in upstream". The app service now carries the `nextjs_app` network alias (documented in place).
- **Fresh-clone test suite**: `bun run test` failed 16 DB-dependent tests locally because the hermetic SQLite test database (`prisma/prisma/dev.db`) only existed in CI. A new `pretest` hook (`scripts/prepare-test-db.mjs`) mirrors the CI prepare step (schema push + seed against the forced URL, committed postgresql schema text restored afterwards), making the suite self-sufficient: 17 files / 447 tests green on a fresh clone (was 411/16 failed).

### Added
- **Realtime notifications ship self-hosted**: `mini-services/notification-service` now has a production Dockerfile (bun runtime, frozen lockfile) and runs as an internal-only `notification` service in `docker-compose.prod.yml` (healthcheck on `/health`, nginx `depends_on` healthy). Nginx routes same-origin `/socket.io/` traffic to it with websocket upgrade headers and 24h timeouts. Verified end-to-end: Engine.IO polling handshake 200, websocket connect, `join-store` -> `room-joined`. On Vercel the client degrades gracefully (no realtime push, everything else unchanged).
- **Offline mode documentation** (`docs/offline-mode.md`): queue flow (queue -> replay -> dedupe -> cleanup), cashier-facing surfaces, step-by-step offline testing, developer notes; indexed from `docs/README.md`.
- **Health endpoints guide** (`docs/deployment.md`): documents the `/api/health` (public, automation) vs `/api/healthy` (authenticated, in-app) split and the realtime service wiring.

### Improved
- Repository organization phase 2: client source materials consolidated under `docs/assets/`, ops runbook moved to `docs/runbooks/`, sandbox template artifacts removed, repo-wide markdown hygiene (single H1, no emoji headings, no em dashes), gitignore env-variant coverage.

### Notes
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.
- Version reads from `package.json` everywhere (API, footer badge, OpenAPI) per the release process.

## [2.14.0] Production hardening: self-test, engraved admin, offline queue UX, stock contract

### Added
- **POST self-test + engraved-admin self-heal**: `/api/system/post` runs isolated production checks (PASS/FAIL/DEGRADED); `/api/system/heal` repairs the seeded engraved super admin idempotently; engraved accounts cannot be deleted, deactivated or demoted via the users API (403 `ENGRAVED_ADMIN_PROTECTED`); Admin tab gains a System Health card and shield badge.
- **Offline queue UX**: top-bar `OfflineIndicator` (green/amber dot + Offline Queue dialog listing every queued sale) on every tab, single per-transition reconnect toast, `clearOfflineQueue()` for the confirmed dialog action; canonical import path `@/lib/offline` with the queue contract documented in `src/lib/offline/README.md`.
- **Stock shortage contract**: checkout pre-validates every sellable line and fails with one structured 400 (`INSUFFICIENT_STOCK` + per-product details) before any charge; race losers map to the same contract; the POS clamps lines to available stock and routes zero-stock lines to the existing low-stock popup.
- **Ops**: `scripts/backup.sh` (sqlite3 `.backup` -> gzip with retention), database idempotency keys on `DebtLedger`/`EquipmentRental`/`Expense`/`StockMovement`.

### Improved
- **Fullscreen sidebar autohide**: in browser fullscreen the sidebar collapses to a 64px icon rail, auto-hides after 2s idle, peeks from a left-edge sensor, and restores state on exit; icon tooltips show F2-F5 shortcut hints; user menu gains "Toggle Fullscreen".
- **Inventory reorder prefill**: at/below-reorder products show "Reorder (+N)" (row menu, detail panel and a quick-fill chip in the Adjust Stock dialog) that prefills the suggested quantity to restore the stock level.
- **Typography sweep**: repo-wide string-literal cleanup (em dashes -> hyphens, decorative emojis out of internal UI); customer-facing templates exempt.
- **Repository organization phase 1**: Windows installers under `deploy/windows/`, QA screenshots and sandbox scripts removed, `bun.lock` as the sole lockfile, governance files (CONTRIBUTING/SECURITY/CODE_OF_CONDUCT/CHANGELOG/SUPPORT) and `.github` templates in place.

### Notes
- Receipts gained print/PDF parity (`<receipt-number>.pdf`), amount no-wrap, unit abbreviations and a fixed totals strip.
- No changes to totals, VAT math, payments, debt or discount gates.

## [2.13.3] Feature release: functional POS + new 3D logo + smart recommendations

### Added
- **New 3D brand logo everywhere (spec PART 1)**: the official MBUMAH HARDWARE artwork (navy gear · orange house · silver trowel · "Your Building Partner in Juja") now anchors the sidebar in a white rounded-xl container with drop shadow so it sits cleanly on the dark `#0f172a` rail; the old flat green "MH" initials square is gone. A gear-only crop marks the top bar (visible even when the sidebar is collapsed) and the favicon/PWA icons are regenerated from the same artwork. Light backgrounds use the full-color logo as-is; dark surfaces get the white-container wrapper.
- **Smart Sell More recommendations (spec PART 3)**: a client-side product-affinity engine (`src/lib/product-affinities.ts`) maps what's in the cart to what the same customer very likely still needs (cement → spade + mixer + nails; mabati → timber + nails; rebar → cement + binding wire…), ranks by frequency, drops items already in the cart or out of stock, and shows the top 6 as tappable chips (+ icon, category dot, price). Works from the first cart, with no sales history needed (the server's co-occurrence engine is merged in and takes over as history accumulates). An empty cart shows best-seller chips; a cart with no mapped affinity shows the coach text plus best sellers below. The section is collapsible and the collapse state persists per device.
- **Thika branch catalog aligned to spec (PART 2)**: `scripts/seed-thika-catalog.ts` (idempotent, owner-run, StockMovement-audited) ensures the THI branch carries the 11 spec products at exact prices and stock: 4-inch Nails (Ksh 150/kg · 350), Bamburi Cement 50kg (750 · 180 bags), Dulux Weathershield 20L (8,500 · 20), Mabati 28/30-Gauge 8ft (800/650 · 200/350), Plywood 8x4ft 18mm (2,800 · 45), PVC Pipe 4-inch x 3m (800 · 90), Rebar 12mm x 12m (1,200 · 280), Simba Cement 50kg (720 · 120 bags), Spade Heavy Duty (1,200 · 40), Timber 2x4 x 12ft Cypress (800 · 60), plus the rental Concrete Mixer (Ksh 85,000, RENTAL) and Chain Link 6ft x 50m (4,500) used by the demo cart.

### Improved
- **Instant, honest cart feedback (spec PART 2)**: product tiles now show a blue "1 in cart / 2 in cart" pill the moment a line lands (optimistic, under 100ms, no network involved; pops on every re-add), add-toasts name the product and price ("Added Spade (Heavy Duty) - Ksh 1,200"), and Hold toasts say exactly what was parked ("Cart held - 7 items").
- **Faster search**: the products query debounce drops 200ms → 150ms per the functional-POS spec; the input itself stays instantly responsive and barcode-scan Enter-to-cart behaviour is unchanged.
- **Zero-sales KPI honesty (new branches)**: when a branch has no sales today, the Today's Revenue card shows a gray trend badge (never green or red at zero) with a hover tooltip "No sales yet today - start selling!" and the same coaching line as the card sub-text. Live/updated/auto-refresh-30s behavior from v2.13.0 is untouched.

### Notes
- RBAC, manager-PIN overrides, abuse detection and the audit trail (v2.12.x-v2.13.0) are unchanged and fully enforced.
- No schema changes; no changes to totals, VAT math, payments, debt or discount gates.

## [2.13.2] Hotfix: checkout 500 regression + limited-dashboard money card

### Fixed
- **Critical: checkout 500 on every sale (v2.13.1 regression)**: the new VAT-ledger line chained `.mul()` on the `Money` wrapper (which exposes `multiply()`/`taxComponent()`, not `mul()`), throwing `TypeError: KES(...).mul is not a function` and failing **every** `POST /api/transactions` with a 500. Replaced with the vetted helper `KES(finalTotal).taxComponent(rate).toNumber()`, the exact intended formula (`total × rate/(100+rate)`), Decimal-safe, 2dp HALF_UP. Caught by the post-deploy prod E2E (network log captured the 500 body) within minutes of rollout.
- **Cashier dashboard "Today's Sales" showed a count as money**: the limited payload's `todaySales` carried the transaction COUNT, so one sale rendered as "Ksh 1.00" while the real net revenue only surfaced via Avg Order. Now returns net revenue (same semantic as the full dashboard), keeping "Transactions" as the count card.

## [2.13.1] Fixed: VAT alignment & cashier KPI scoping

Closes the two acceptance nuances documented at the v2.13.0 E2E verification. No schema changes; no changes to totals, payments, debt or discount-gate math.

### Fixed
- **VAT figure is now receipt-true (spec formula)**: the info-only "VAT (x% incl.)" line on the POS cart, checkout summary and printed receipt shows the VAT component **inside the amount the customer actually pays**: `Total × rate / (100 + rate)`. Previously it showed the pre-discount per-line VAT component, so a Ksh 220 cart with a Ksh 50 discount (Total 170) displayed VAT 30.34 instead of 23.45.
- **Server VAT ledger aligned (Kenya VAT Act)**: `SalesTransaction.taxAmount`, the journal `VAT_PAYABLE` credit, the eTIMS payload `vatTotal` and the receipt's taxable-amount derivation now all use the post-discount consideration, since a discount given at the time of supply reduces the taxable value. Net revenue (`totalAmount − taxAmount`) therefore increases by the discount's VAT component on discounted sales, which is correct under IFRS 15 (revenue at transaction price).
- **Journal entry restructure**: the cart-level discount is no longer booked to the `SALES_DISCOUNTS` contra-revenue account (it is already netted inside the transaction-price revenue; booking both would unbalance the entry by exactly the discount). The discount remains recorded on the transaction row (`discountAmount`) for analytics. Entries created before v2.13.1 are untouched and remain balanced.
- **Cashier dashboard KPIs strictly own-scoped**: the limited dashboard's "Today's Sales", "Transactions" and "Avg Order" aggregates now filter on `cashierId = session.userId` and are captioned "your sales", matching the RBAC spec ("My Sales", not the branch total). Low Stock remains a store-level signal (no revenue leakage; previously true by construction).

### Notes
- Historical transactions keep their stored figures (documents are immutable history); only sales created on/after v2.13.1 use the aligned VAT derivation.
- Info-only guarantee still holds: Totals, Subtotals, Discounts, payments, debt, gift-card redemptions and the discount permission gates are byte-identical to v2.13.0 behavior.

## [2.13.0] Feature release: RBAC & Audit

The v2.12.1 → v2.13.0 ladder completes the RBAC roadmap. This release's headline is already live since v2.12.5-v2.12.8; v2.13.0 adds the release polish and ships the full ladder together.

### The ladder (v2.12.1 v2.12.8)
- **v2.12.2-v2.12.5, RBAC core**: 16-key dotted feature-permission matrix (`src/lib/permissions.ts`) with a 5-role system (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, INVENTORY_MANAGER), backend `403 PERMISSION_DENIED` enforcement, role-filtered sidebar with lock affordances, LockedCard + access requests, cashier limited dashboard, manager step-up authorization at the counter (`POST /api/auth/manager-authorize`) for >5% discounts and high-risk debt (KES 150k+).
- **v2.12.6-v2.12.8, Audit & abuse**: consolidated Audit Trail page with CSV export, discount-spam abuse detection (>3 denials/1h → SecurityEvent + manager notifications), privilege-abuse lockout (5 denials/10 min → 15-minute lock + Super Admin alerts), Security tab in the notification center, inventory price guard for INVENTORY_MANAGER.
- **v2.12.1, POS hotfix**: per-unit fallback ("per " bug), product-card badge overlap, FAB overlap on checkout, category scrollbar, VAT "(incl.)" labels, stock counter units, duplicate-image cleanup script.

### Added (v2.13.0)
- **What's New dialog**: on first launch after an update, a "Karibu! What's New in Mbumah POS" modal summarizes the release (latest version highlighted, previous entries below) with a direct link to this changelog on GitHub. Shown once per version via `localStorage.mbt_seen_version`; SSR-safe, and it does not repeat when storage is unavailable.
- **Footer status chip**: the Connected dot is now a live online indicator (mirrors `navigator.onLine` via online/offline events): green pulsing dot when connected, red "Offline" when the connection drops. Hidden on xs screens.
- **Footer Shortcuts button**: opens the existing Keyboard Shortcuts help dialog (previously reachable only via the `?` shortcut).

### Deprecated
- **Versions prior to v2.13.0 are deprecated for support purposes; self-hosted stores should update via the in-app updater (v2.9.0+) or the Remote Access Kit flow.**

## [2.12.8] Audit Trail page

### Added
- **Audit Trail view in the Security tab**: a second view ("Security Dashboard | Audit Trail" toggle, dashboard stays default) rendering a consolidated table of permission denials, manager overrides and manager authorizations: timestamp (with time-ago), user (name + truncated email), role, color-coded action badge (red denial / amber override / green authorized), resource + reason, result (DENIED / SUCCESS), branch, IP address.
- **Filters**: role select, user search (name/email), date range (from/to), "Denied only" switch, free search (permission/resource/reason), Prev/Next pagination with totals, and **Export CSV** (`mbumah-audit-trail-YYYYMMDD.csv`) honoring the active filters.
- Loading skeletons, error state and an explicit empty state ("No audit events match your filters"); long tables scroll inside a `scrollbar-thin` container.

## [2.12.7] Abuse detection & security alerts

### Added
- **Discount-spam pattern alert**: a cashier (or any role) denied `pos.discount.gt5` more than 3 times in 1 hour now writes a `PRIVILEGE_ABUSE_PATTERN` SecurityEvent and notifies every active BRANCH_MANAGER and SUPER_ADMIN of the org (WARNING / SECURITY notification, e.g. "Grace Wanjiku (Cashier) attempted 4x discount >5% in 1h, 14:32"). In-memory sliding window per instance (same best-effort posture as the lockout engine); the SecurityEvent feed is the durable record.
- **Inventory price guard**: an INVENTORY_MANAGER whose product-price update deviates more than ±20% from the cost basis (or from the old price when cost is null) gets `403 MANAGER_APPROVAL_REQUIRED` + a `HIGH_RISK_ATTEMPT` security record. The same `managerOverride` credential object used at checkout lets a Branch Manager+ approve inline (writes a MANAGER_OVERRIDE audit row with `PRODUCT_PRICE_GUARD` context); 3 wrong approvals in 5 minutes trip the existing brute-force window.
- **Security tab in the Alerts panel**: role-gated (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER) red-shield filter tab listing SECURITY-category notifications, with the 10 most recent abuse-set SecurityEvents (permission denials, high-risk attempts, brute force, lockouts, abuse patterns) merged below as read-only, red-tinted entries. The bell badge now reflects security alerts too; `/api/notifications` previously surfaced none of the durable SECURITY notification rows.

### Changed
- `/api/security/events` accepts BRANCH_MANAGER (store-scoped) and supports a comma-separated `eventTypes` filter.

## [2.12.6] Audit logging consolidation

### Added
- **GET /api/admin/audit-trail** (SUPER_ADMIN / STORE_OWNER / BRANCH_MANAGER): one consolidated, paginated feed merging hash-chained AuditLog rows (`PERMISSION_DENIED`, `MANAGER_OVERRIDE`, `MANAGER_AUTHORIZED`) with SecurityEvent denial rows (`PERMISSION_DENIED` / `HIGH_RISK_ATTEMPT`) that have no AuditLog twin, so every denial appears exactly once (nearest-timestamp dedup, HIGH_RISK kind carried from the twin). Branch-scoped for non-super-admin callers; `format=csv` streams the compliance export.

### Deferred
- **`pos.void` endpoint**: still does not exist (verified); nothing was invented for it. The `requireFeaturePermission('pos.void')` gate, manager-override flow and Audit Trail visibility are ready the moment the endpoint lands. Void >2/shift manager approval ships with it.
- **Email digest option** for security notifications (daily/weekly summary), scheduled for a later release.

## [2.12.5] RBAC stable

Umbrella release of the v2.12.2 → v2.12.5 RBAC ladder: the role/permission system is now enforced end-to-end: backend 403s with typed denial payloads, role-filtered navigation with lock affordances, manager approval flows at the counter, and a dedicated limited view for cashiers. See the individual sections below for what shipped in each step.

### Highlights
- One permission model, two layers: the resource→action matrix (`hasPermission`) for CRUD checks plus the dotted feature keys (`hasFeaturePermission`) for business rules like discounts and dashboards.
- Manager approvals are now a first-class counter workflow: the cashier can complete a gated sale by collecting a manager's credentials, and every approval/denial is durably audited.
- Cashiers see an honest, useful workspace instead of broken analytics: own-activity KPIs, their own sales, and a clear "request access" path.

### Notes
- No database migrations required (User.role is a string column; the permission matrix is code-defined in `src/lib/permissions.ts`).

## [2.12.4] Cashier Limited View

### Added
- **Limited dashboard for revenue-denied roles** (CASHIER, INVENTORY_MANAGER): the dashboard API early-returns a minimal payload (`limitedView: true`, today's sales, transaction count, average order value, low-stock counts and the caller's own last 10 sales (`mySales`)) and never computes or ships revenue trends, debt exposure, top products/customers, payment-method amounts or inventory value for these roles (restricted by construction).
- **Cashier dashboard layout**: greeting hero, 4 KPI cards only (Today's Sales, Transactions, Avg Order, Low Stock), a "My Sales" feed (receipt tail, payment-method badge, amount, time-ago), an info banner ("You're viewing a limited dashboard. Revenue, debt and analytics are hidden for your role.") and a 2-column grid of LockedCards for Revenue Trend, Debt Aging, Store Health and Financial Reports, each with a "Request Access" action.
- **High-risk debt warning in POS**: selecting a customer whose outstanding balance exceeds KES 150,000 shows a red inline warning in the customer selector; amounts appear only for roles holding `customers.view.debt`; cashiers see the generic "Credit approval required for this customer".

## [2.12.3] RBAC core: matrix, sidebar filtering, locked cards

### Added
- **INVENTORY_MANAGER role** (frontend surfaces): catalog, inventory, suppliers, purchase orders and transfers now grant the role; role labels and tier order shared app-wide (`ROLE_LABELS`, `requiredRoleLabelFor`).
- **Sidebar lock affordances**: tabs a role cannot open are no longer silently hidden; they render as a grayed row with a 14px Lock icon, a "Requires {role}" tooltip (e.g. "Requires Branch Manager"), `aria-disabled` non-clickable behavior, and just the lock icon when the sidebar is collapsed. Accessible tabs keep the orange active-item style.
- **Cashier navigation narrowed to spec**: exactly Dashboard, POS, Customers, Transactions (Messaging/Chat moved out of the cashier's reach).
- **LockedCard component** (`src/components/rbac/locked-card.tsx`): premium locked-section card matching the dashboard design language: lock glyph in a muted circle, "Requires {role}" title, one-line explanation from the permission copy, and a debounced "Request Access" button.
- **Access-request flow** (`POST /api/access-requests`): records a `SecurityEvent(ACCESS_REQUEST, INFO)` with the permission key, requester email and role, and creates Notification rows for every active SUPER_ADMIN and BRANCH_MANAGER of the organization (requester excluded). Grants remain a Super Admin action.
- **Top-bar role badge**: muted role chip next to the top-bar actions (hidden on very small screens); SUPER_ADMIN renders "SA · System Administrator".
- **Feature-permission hook layer**: `usePermissions()` now exposes the `feature` group (`posSell`, `posDiscountGt5`, `dashboardRevenue`, `inventoryViewCost`, …) built on `hasFeaturePermission`, plus a plain `canFeature(role, key)` helper.

### Fixed
- **Cost hiding**: where the products API strips `costPrice` to null (roles without `inventory.view.cost`), the inventory table, detail dialog, stock-value summary and CSV export now render "•••" ("Cost hidden for your role") instead of 0 / blank / NaN margins.

## [2.12.2] Security: backend permission middleware + 403 handling

### Added
- **Feature permission matrix** (`src/lib/permissions.ts`): 16 dotted keys (`pos.sell`, `pos.void`, `pos.discount.gt5`, `pos.discount.gt10`, `pos.view.all_sales`, `dashboard.view.revenue`, `dashboard.view.profit_margin`, `dashboard.view.debt_aging`, `inventory.edit`, `inventory.view.cost`, `customers.view.debt`, `customers.create`, `debt.approve.high_risk`, `financial.view`, `settings.roles.manage`) with SUPER_ADMIN bypass and fail-closed behavior, plus shop-floor denial copy and per-key required-role labels.
- **Backend enforcement**: `requireFeaturePermission(key)` wrapper returns `403 { code: 'PERMISSION_DENIED', permission, message }`; every denial writes a hash-chained AuditLog row and a SecurityEvent, and feeds the privilege-abuse engine (5 denials / 10 min → 15-minute lockout + SUPER_ADMIN notifications).
- **Manager step-up authorization**: `POST /api/auth/manager-authorize` verifies a manager's email + password (shared bcrypt path with login), gates on manager-tier roles, records `MANAGER_AUTHORIZED` audit rows, and rate-limits to 3 failed attempts / 5 min per email+IP (`429 BRUTE_FORCE_PIN`).
- **Checkout gates**: discounts > 5% require the manager tier or a verified `managerOverride` credential object; discounts > 10% require Store Owner tier (never cashier-overridable); credit sales to customers owing more than KES 150,000 require `debt.approve.high_risk` or a verified override; every override writes a `MANAGER_OVERRIDE` audit row.
- **Products cost stripping**: list/detail/search endpoints return `costPrice: null` for roles without `inventory.view.cost`; product create/update/delete restricted to manager tier + INVENTORY_MANAGER.
- **Role management segregation**: creating users and changing roles are now Super Admin-only (`settings.roles.manage`).
- **Wire format**: `ApiRequestError` now carries the parsed error body so the frontend can branch on `code` / `permission` / `requiresManagerOverride` instead of matching message text.

## [2.12.1] Hotfix

### Fixed
- **POS "per NULL" unit bug**: products saved with a NULL `unitType` (e.g. Bamburi Cement) rendered a dangling "per " on product cards and empty/"null" unit badges in the cart, catalog, inventory and POS views. All unit render sites now share one null-safe `unitLabel()` helper (`src/lib/units.ts`), with a `UNIT` fallback. Ships with an owner-run backfill script, `scripts/fix-null-units.ts` (cement/Bamburi → `BAG`, other NULL units → `PIECE`).
- **Product card badge overlap**: the top-left badge stack (NEW / RENTAL / BUNDLE / BEST SELLER / ON SALE) is capped at 55% width with per-badge truncation, and the top-right LOW STOCK / OUT OF STOCK badge at 42% with truncation, so they can no longer collide on narrow cards (both stay z-20; NEW badge rule unchanged).
- **FAB overlap on POS**: the floating home button is now hidden while the POS tab is active (it covered the checkout area on short viewports) and remains on every other tab.
- **Category chips scrollbar**: removed the `scrollbar-none` override so the existing slim `scrollbar-thin` scrollbar (6px, rounded, muted thumb, transparent track) is always visible; scroll behavior and arrows unchanged.
- **VAT labels marked "(incl.)"**: POS cart totals, last-sale receipt, checkout dialog and the printable receipt now read "VAT (16% incl.)", an info-only clarification that prices are VAT-inclusive (KE default; VAT = Total × 0.16 / 1.16). No tax math was changed.
- **Stock counter unit**: product-card stock labels now carry a short unit suffix ("393 kg left", "12 bags left") via a shared `unitShort()` helper.
- **Duplicate nail images**: owner-run script `scripts/fix-duplicate-images.ts` clears `imageUrl` on duplicate nail product rows (one canonical image kept per size variant) so the grid falls back to category images.

### Notes
- Shift math fix, debt-crisis logic, low-stock counts, system-activity sanitization, alert dedup, and revenue-outlier handling shipped in v2.12.0 (PR #86).
