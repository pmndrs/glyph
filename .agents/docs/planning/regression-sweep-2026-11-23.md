---
type: Log
title: 'Regression sweep: main vs sil-green-27/42/51/52, 2026-11-23'
description: 'Interleaved headline-workload and full Labs timings of main and four integration tags on a loaded machine, with bisects inside 51..52 and below 51; one commit (dfb1b238a) accounts for nearly every regression.'
status: draft
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-23T09:40:58Z'
---

# Regression sweep, main vs `sil-green-27/42/51/52`, 2026-11-23 (UTC)

Scope: every headline workload of the 2026-11-22 harness (width sweep, `measure()` after a width change reading
`glyphCount` and reading only the size, edit rows, ASCII frame, first frame and cold-to-first), the committed
`benchmark:headline-bidi-edit` workflow, and the full Labs suite (all 145 rows of the 2026-11-21 snapshot plus 75
newer rows) for main, g51 and g52, with bisects inside 51→52 and between main and g51 where a row moved.

## Bottom line

- **Almost every speed regression hidden in the last two days is one commit: `dfb1b238a` "feat(glyph): compute a
  summary's glyph facts on first read" (in g51..g52).** It makes any read of a summary's glyph facts after a
  layout change (`measure().glyphCount`, the per-label `[setter + read]` measures, `measure()` then publication)
  10–90% slower than g51. `cd31aae2c` (defer positioning) is neutral on its own; `29d225568` (shared accessors) does
  not recover it.
- The same commit is the win it was meant to be for size-only reads: `measure()` reading only width/height is
  0.30–0.70× g51. Positioning moves into publication (+19–42% publish), so the frame is unchanged.
- Against main, g52 is faster on 164 of 219 Labs rows and on every edit, bidi sweep, ASCII and first-frame headline
  row. It is slower than main on `measure()` after a width change (2.0–5.1×, worst bidi), on the two
  long unsafe-line-break reflows (1.30–1.37×), and on a handful of sub-millisecond setter/prepared rows that were
  already slower at g27.

## Rows where g52 is slower than main

Ratios are g52/main (paired, median over rounds). "First slower at" is the earliest arm already >5% slower than main.

| row                                                                             |                  g52/main | first slower at | size and introducing range                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------: | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| headline: `measure()` after width change, reading `glyphCount`, bidi            |                      5.08 | ≤ g27           | g27 4.5× main, g51 4.3×; +11% at `dfb1b238a`                                                                                      |
| headline: same, 22k                                                             |                      2.85 | ≤ g27           | g27 2.2×, g51 2.1×; +38% at `dfb1b238a`                                                                                           |
| headline: same, Latin                                                           |                      2.54 | ≤ g27           | g27 1.9×, g51 1.9×; +40% at `dfb1b238a`                                                                                           |
| headline: sweep `:layout` (setter + that read), bidi / 22k / Latin              |        3.84 / 2.46 / 2.04 | ≤ g27           | same cause; +11/+32/+34% at `dfb1b238a`                                                                                           |
| headline: `measure()` after width change, reading size only, 22k / Latin / bidi |        1.43 / 1.31 / 1.29 | ≤ g27           | g27 2.0–3.9× main; g52 is 0.30–0.70× g51 (improved at `dfb1b238a`)                                                                |
| Labs layout: measurement after width change                                     |                      2.06 | g51 (1.10×)     | +86% at `dfb1b238a` (0.85→1.81 ms in the bisect)                                                                                  |
| Labs layout: measurement then publication after width change                    |                      1.06 | g52             | g51 was 0.64× main; +65% at `dfb1b238a`                                                                                           |
| Labs unsafe-line-breaks: long reporter workaround paragraph reflow              |                      1.37 | g52             | g51 was 0.84× main; +64% in g51..g52, at `dfb1b238a` (one full-suite run: 1.50–1.62× at that commit, cd31 1.00–1.01)              |
| Labs unsafe-line-breaks: long unsafe-boundary paragraph reflow                  |                      1.30 | g52             | g51 was 0.78× main; +67% in g51..g52, at `dfb1b238a` (one full-suite run: 1.50–1.62× at that commit, cd31 1.00–1.01)              |
| Labs batching: rewrite 64/128/256/512 labels in one group [setter only]         | 1.38 / 1.33 / 1.21 / 1.19 | ≤ g27           | g27 1.3–2.1× main; g42→g51 +9–26% (2 rounds, low confidence); g51→g52 0.93–0.97                                                   |
| Labs stress: publish 1024 retained Text instances [setter only]                 |                      1.22 | ≤ g27           | g27 1.17×; g27→g42 +18% (2 rounds); flat after                                                                                    |
| Labs prepared-operations: 1 / 1000 labels first same-value-set+measure          |               1.46 / 1.68 | ≤ g51           | 7 µs → 12–13 µs; already there at g51 (g52/g51 0.85–0.96); not bisected below g51 (no focused suite covers `prepared-operations`) |
| Labs batching: 10 labels first same-length scene publication                    |                      1.13 | ≤ g51           | 0.34 → 0.38 ms; already there at g51; not bisected below g51                                                                      |

Frame totals are not slower than main anywhere in the headline set: sweep frames are 0.95–0.96× (Latin, 22k),
0.98–1.00× for the size-only sweeps, 0.80–0.83× for bidi.

## Rows where g52 is >5% slower than an earlier tag (all first slower at g52 unless noted)

Headline (15 rounds, g52/g51; bisect ratios c-dfb1/g51 from 3 rounds):

| row                                                                                    |                   g52/g51 | introduced by                                                                | bisect c-cd31 / c-dfb1 (to g51)                                                      |
| -------------------------------------------------------------------------------------- | ------------------------: | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `measure()` call after width change, glyphCount, Latin / 22k / bidi                    |        1.40 / 1.38 / 1.11 | `dfb1b238a`                                                                  | 1.03 / 1.45; 0.97 / 1.49; 1.02 / 1.13                                                |
| sweep `:layout`, Latin / 22k / bidi                                                    |        1.34 / 1.32 / 1.11 | `dfb1b238a`                                                                  | 1.02 / 1.35; 0.96 / 1.47; 1.01 / 1.12                                                |
| edit `:layout` (edit + `measure().glyphCount`), 22k type-end / insert / delete / paste | 1.14 / 1.17 / 1.16 / 1.17 | `dfb1b238a`                                                                  | 0.94–1.01 / 1.04–1.13                                                                |
| edit `:layout`, Latin type-end / insert / delete / paste                               | 1.09 / 1.11 / 1.11 / 1.10 | `dfb1b238a`                                                                  | 0.95–1.01 (insert 1.07) / 1.02–1.18                                                  |
| edit frame, 22k type-end / insert / paste                                              |        1.05 / 1.05 / 1.05 | `dfb1b238a` (same cause, +0.2–0.3 ms)                                        | not separable from noise in the bisect                                               |
| bidi edit `:layout` type-end / delete, bidi type-end frame                             |        1.08 / 1.05 / 1.06 | g51..g52                                                                     | not in bisect; the committed workflow shows g52/g51 0.99 for type-end, so unresolved |
| size-only sweep publish, Latin / 22k / bidi                                            |        1.42 / 1.38 / 1.27 | `dfb1b238a` (positioning moved from `measure()` to publish; frame 0.96–1.02) | 0.92 / 1.26; 1.00 / 1.36; 1.02 / 1.19                                                |
| 22k sweep frame                                                                        |                      1.05 | g51..g52                                                                     | bisect 1.03 — not confirmed                                                          |

Labs (3 rounds, every round agreeing; bisect from focused suites, 2 rounds, plus one full-suite run per bisect arm):

| row                                                                               | g52/g51 (full, 3 rounds) | c-cd31/g51 | c-dfb1/c-cd31 | g52/c-dfb1 | source                               | introduced by       |
| --------------------------------------------------------------------------------- | -----------------------: | ---------: | ------------: | ---------: | ------------------------------------ | ------------------- |
| batching: rewrite 128 labels in one group [setter + read]                         |                    1.357 |       1.03 |          1.34 |       1.02 | focused, 2 rounds                    | dfb1b238a           |
| batching: rewrite 256 labels in one group [setter + read]                         |                    1.307 |       1.04 |          1.31 |       1.00 | focused, 2 rounds                    | dfb1b238a           |
| batching: rewrite 512 labels in one group [setter + read]                         |                    1.350 |       1.01 |          1.35 |       1.01 | focused, 2 rounds                    | dfb1b238a           |
| batching: rewrite 64 labels in one group [setter + read]                          |                    1.345 |       1.02 |          1.30 |       1.03 | focused, 2 rounds                    | dfb1b238a           |
| batching: 10 labels first color-only [setter + read]                              |                    1.150 |       1.15 |          0.74 |       1.04 | focused, 1 rounds                    | cd31aae2c           |
| batching: 10 labels last color-only [setter + read]                               |                    1.098 |       0.88 |          0.91 |       0.91 | focused, 1 rounds                    | spread / unresolved |
| batching: 100 labels 100 edits immediate measurements without publication         |                    1.425 |       0.98 |          1.47 |       0.98 | focused, 1 rounds                    | dfb1b238a           |
| batching: 100 labels batched edit-read publication                                |                    1.214 |       1.01 |          1.34 |       0.93 | focused, 1 rounds                    | dfb1b238a           |
| batching: 100 labels first same-length engine publication                         |                    1.065 |       1.28 |          0.80 |       0.95 | focused, 1 rounds                    | cd31aae2c           |
| batching: 100 labels interleaved edit-read publication [setter + read]            |                    1.441 |       0.99 |          1.48 |       1.02 | focused, 1 rounds                    | dfb1b238a           |
| batching: 100 labels interleaved edit-read publication                            |                    1.097 |       1.00 |          1.17 |       1.00 | focused, 1 rounds                    | dfb1b238a           |
| batching: 100 labels last color-only scene publication                            |                    1.080 |       0.83 |          0.94 |       0.95 | focused, 1 rounds                    | spread / unresolved |
| batching: 1000 labels 100 edits batched edit-read publication                     |                    1.131 |       1.03 |          1.28 |       0.93 | focused, 1 rounds                    | dfb1b238a           |
| batching: 1000 labels 100 edits immediate measurements with publication           |                    1.185 |       0.98 |          1.26 |       1.01 | focused, 1 rounds                    | dfb1b238a           |
| batching: 1000 labels 100 edits immediate measurements without publication        |                    1.438 |       0.98 |          1.49 |       1.01 | focused, 1 rounds                    | dfb1b238a           |
| batching: 1000 labels 100 edits interleaved edit-read publication [setter + read] |                    1.443 |       0.99 |          1.48 |       0.98 | focused, 1 rounds                    | dfb1b238a           |
| batching: 1000 labels 100 edits interleaved edit-read publication                 |                    1.179 |       1.01 |          1.17 |       0.97 | focused, 1 rounds                    | dfb1b238a           |
| batching: 1000 labels first color-only [setter + read]                            |                    1.063 |       0.92 |          1.13 |       0.97 | focused, 1 rounds                    | dfb1b238a           |
| common: measure after text change                                                 |                    1.123 |       0.97 |          1.25 |       1.07 | focused, 2 rounds                    | dfb1b238a           |
| edit: type one character into a long Fredoka paragraph and measure                |                    1.139 |       0.93 |          1.34 |       0.91 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| edit: type one character into a long paragraph and measure                        |                    1.060 |       0.84 |          1.40 |       0.91 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| layout: measurement after width change                                            |                    1.863 |       1.02 |          2.06 |       1.00 | focused, 4 rounds                    | dfb1b238a           |
| layout: measurement then publication after width change                           |                    1.647 |       1.02 |          1.90 |       0.96 | focused, 4 rounds                    | dfb1b238a           |
| lifecycle: dispose and recreate 100 labels [recreate + read]                      |                    1.190 |       1.02 |          1.23 |       0.95 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| lifecycle: mount 1600 labels [construct + read]                                   |                    1.069 |       1.00 |          1.22 |       0.87 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| prepared-operations: 1 labels first overwrite-before-scene-publication            |                    1.116 |       1.01 |          1.12 |       0.99 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| prepared-operations: 1 labels first same-value-set+scene-publication              |                    1.052 |       0.85 |          1.47 |       0.69 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| prepared-operations: 1 labels first set+measure                                   |                    1.153 |       1.06 |          0.87 |       1.25 | full suite, 1 run vs 3-round medians | 29d225568           |
| prepared-operations: 1 labels first set+measure+scene-publication                 |                    1.086 |       1.00 |          0.99 |       1.07 | full suite, 1 run vs 3-round medians | 29d225568           |
| prepared-operations: 1 labels first set+scene-publication                         |                    1.058 |       1.02 |          0.90 |       1.07 | full suite, 1 run vs 3-round medians | 29d225568           |
| prepared-operations: 100 labels first same-value-set                              |                    1.113 |       1.11 |          0.90 |       1.09 | full suite, 1 run vs 3-round medians | cd31aae2c           |
| prepared-operations: 100 labels first same-value-set+measure                      |                    1.202 |       1.26 |          0.90 |       1.02 | full suite, 1 run vs 3-round medians | cd31aae2c           |
| prepared-operations: 100 labels first set+measure                                 |                    1.252 |       1.15 |          1.22 |       0.89 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| prepared-operations: 100 labels first set+measure+scene-publication               |                    1.059 |       1.18 |          0.89 |       0.98 | full suite, 1 run vs 3-round medians | cd31aae2c           |
| prepared-operations: 1000 labels first set+measure+scene-publication              |                    1.101 |       1.01 |          1.03 |       1.05 | full suite, 1 run vs 3-round medians | spread / unresolved |
| request-arena: write one paragraph and text mutation                              |                    1.079 |       0.88 |          1.04 |       1.26 | full suite, 1 run vs 3-round medians | 29d225568           |
| sparse-assignment: split move and merge paint boundaries preparation only         |                    1.313 |       1.00 |          1.36 |       0.95 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| sparse-assignment: split move and merge paint boundaries publication              |                    1.115 |       0.99 |          1.15 |       0.98 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| stress: edit and measure one of 1000 retained labels                              |                    1.415 |       1.04 |          1.18 |       1.00 | focused, 2 rounds                    | dfb1b238a           |
| stress: measure 1000 unchanged retained labels                                    |                    1.101 |       0.97 |          1.14 |       1.04 | focused, 2 rounds                    | dfb1b238a           |
| stress: publish 1024 retained Text instances [setter + read]                      |                    1.310 |       1.01 |          1.32 |       1.00 | focused, 2 rounds                    | dfb1b238a           |
| stress: toggle one group containing 1000 retained labels                          |                    1.078 |       1.05 |          1.11 |       0.95 | focused, 2 rounds                    | dfb1b238a           |
| unsafe-line-breaks: common-safe word-wrap reflow                                  |                    1.076 |       0.90 |          1.20 |       1.00 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| unsafe-line-breaks: issue 216 reporter workaround                                 |                    1.161 |       0.98 |          1.14 |       1.04 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| unsafe-line-breaks: issue 216 unsafe-boundary word-wrap reflow                    |                    1.191 |       1.06 |          1.40 |       0.85 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| unsafe-line-breaks: long reporter workaround paragraph reflow                     |                    1.636 |       1.01 |          1.50 |       1.07 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| unsafe-line-breaks: long unsafe-boundary paragraph reflow                         |                    1.674 |       1.00 |          1.62 |       1.03 | full suite, 1 run vs 3-round medians | dfb1b238a           |
| unsafe-line-breaks: long unsafe-boundary paragraph text edit                      |                    1.181 |       1.02 |          1.15 |       1.00 | full suite, 1 run vs 3-round medians | dfb1b238a           |

"focused" rows come from the `measure`, `reflow`, `edit-sized` and `batch` suites (2 rounds; 1 round where a
run failed); "full suite" rows from one run of each bisect arm against the 3-round g51/g52 medians. Single-run
attributions of rows under 0.2 ms (`prepared-operations`, `request-arena`) are within run-to-run noise and should be
read as "somewhere in g51..g52". Every row above 1.15× attributes to `dfb1b238a`.

## Rows that beat main

- Headline: every edit row (frames 0.39–0.64×, `:layout` 0.18–0.50×), bidi sweep frame 0.83× and publish 0.58×,
  Latin and 22k sweep publish 0.58–0.60×, ASCII frame 0.89×, first frame Latin 0.66× and 22k 0.75×, cold-to-first
  Latin 0.77× and 22k 0.85×. `benchmark:headline-bidi-edit`: 0.48–0.83× main.
- Labs: 164 of 219 rows faster than main in all three rounds, including the 2026-11-21 headline losers
  "layout: publication after text change" 0.61× (was 1.41× at branch start), "publication after font-size change"
  0.80×, "batching: 1000 labels 100 edits interleaved edit-read publication" 0.14×, "cold: mount and publish a
  22k-glyph paragraph" 0.71×, "edit: type one character into a long paragraph and measure" 0.38×.

## Rows not resolvable

- Cold-to-first and first-frame rows: one sample per browser load, dominated by start-up; the 15-round set and the
  bisect disagree on direction (Latin cold-to-first 1.10× g51 in one, 0.70× in the other). Nothing resolved against
  g51; against main they are faster or same.
- Bidi edit `type-end` frame: 1.06× g51 in the five-arm harness, 0.99× in the committed workflow.
- 22k sweep frame 1.05× g51 (bisect does not reproduce).
- Labs: 30 rows "unresolved" against main and 35 against g51 (beyond ±5% but rounds disagree); listed in the full
  table. Most are sub-0.5 ms `prepared-operations` and `batching` color/same-length rows.
- The g42→g51 rise of the `[setter only]` rewrite rows (2 rounds; g42 also came out faster than g27, which may be
  noise) was not bisected inside the 80-commit range.
- Labs failures (not timings): "lifecycle: dispose and recreate 1000 labels [recreate + read]" and
  "[recreate + frame]" error on every arm (main: glyph ID collision; g51/g52: "pending paragraph mutations exceed
  limits.maxParagraphs" and the same collision), so those two rows have no values. "typegpu-publication: move 1000
  retained TypeGPU labels" errors on g51 and g52 ("TypeGPU direct draw is missing its Text transform") and has a
  main value only. One focused bisect run (round 2, edit-sized, c-dfb1) failed with a missing `three/webgpu` module
  in its temporary install and is absent.

## Machine load

1-minute load average before each browser load: median 4.6, range 2.2–14.7 (600 loads). Labs ran at 3.8–9.6.
The Rust-cleanup lane compiled through most of the run. Ratios are paired within rounds for that reason; absolute
milliseconds in this report are higher than the 2026-11-22 quiet-machine numbers (for example main's Latin sweep
frame median 4.87 ms here against 2.95 ms then).

## Arms

| arm                  | commit      | what it is                                                                    | packed archive sha256 |
| -------------------- | ----------- | ----------------------------------------------------------------------------- | --------------------- |
| main                 | `4e25a96a5` | main, packed 2026-11-21 (same archive as the 2026-11-22 headline run)         | `95bd8ebd…`           |
| g27 = `sil-green-27` | `ac4f9e4b9` | first headline baseline (contains the 2026-11-22 headline arm `bcc5b8644`)    | `3490e974…`           |
| g42 = `sil-green-42` | `b25059dc4` | after the ASCII shaping merge                                                 | `1f3e5ceb…`           |
| g51 = `sil-green-51` | `676996e37` | all lanes closed, mixed-bidi edit lane merged                                 | `745d2de7…`           |
| g52 = `sil-green-52` | `03b1e4ce4` | current tip, `measure()` lane merged                                          | `88c52dea…`           |
| c-cd31 (bisect)      | `cd31aae2c` | g51 + "defer positioning past a summary-only read against a kept predecessor" | `tarballs/c-cd31`     |
| c-dfb1 (bisect)      | `dfb1b238a` | c-cd31 + "compute a summary's glyph facts on first read"                      | `tarballs/c-dfb1`     |

Commit ranges: g27..g42 is 74 commits (25 first-parent), g42..g51 80 (18), g51..g52 6 (6). The g51..g52 code changes
are `cd31aae2c`, `dfb1b238a` and `29d225568` ("share the accessors of deferred line glyph facts"); the other three are
docs.

Each tag was built once in its own detached worktree under `/Volumes/Depot/Developer/glyph-scratch/regress/` with
`pnpm install --frozen-lockfile`, `pnpm --filter @pmndrs/glyph build`, `pnpm --dir packages/glyph pack`.
`CARGO_TARGET_DIR` was set per arm (`target-<arm>`) for g42 onward and for the bisect arms. `sil-green-27`'s
`build.mjs` predates `scripts/support/rust-target.mjs` and hard-codes per-crate in-tree target paths, so an external
`CARGO_TARGET_DIR` made its `wasm-opt` step fail; g27 was rebuilt with in-tree targets, which are private to its
worktree. Main was not rebuilt: its archive is the 2026-11-21 pack of `glyph-baseline-main`.

## Method

- Machine: Apple M4 (10 cores), macOS 26.7.1, Node 24.18.0 (Labs, via mise), Google Chrome headless with WebGPU
  (browser rows). Another lane (Rust cleanup) compiled during the run; 1-minute load average before each browser load
  ranged 2.6–13.7 (median about 5.5), and 3.8–9.6 during Labs. Every number here was taken on a noisy machine.
- **Browser headline rows** use a copy of the 2026-11-22 harness (`harness/`) with three changes: five arms instead of
  two, a `read=size` variant of the width sweep that reads only `measure().width` and `.height`, and the first frame
  recorded (complete frame time, plus `performance.now()` at its GPU completion as "cold to first frame").
  One fresh browser per load. Within a round, each config runs all arms back to back; the arm order rotates by one
  each round. Value per load = the median step of that load; row value = median over loads.
- **Ratios** are the median over rounds of the within-round ratio (the two arms ran seconds apart), with the round
  range in the full tables. Verdict: "slower"/"faster" when the ratio is beyond ±5% and at least two thirds of rounds
  agree on the direction; "same" inside ±5%; otherwise "unresolved".
- Headline rounds: 15 for every row (sets of 3, 3, 3 and 6; rows looked >5% worse after the first set, so the whole
  sweep was repeated). Bisect: 3 rounds (g51, c-cd31, c-dfb1, g52).
- **`benchmark:headline-bidi-edit`** (the committed workflow) ran as written, 3 rounds each for main vs g52 and
  g51 vs g52.
- **Labs**: `benchmark:labs-package --suite full --sampling single-call --warmup fixed-20 --blocks 4`, candidate-only,
  one invocation per arm, run from `glyph-wt-regress` (= g52 harness) so every arm used the same harness. 3 rounds,
  arm order rotated (main g51 g52 / g51 g52 main / g52 main g51). Per run: pooled per-call p50. All 145 identities of
  the 2026-11-21 snapshot are present; the other 75 rows are newer.
- Labs bisect (51→52): focused suites `measure`, `reflow`, `edit-sized`, `batch` for g51, c-cd31, c-dfb1, g52, 2 rounds;
  then one full-suite run each of c-dfb1 and c-cd31 for rows no focused suite covers (unsafe-line-breaks, edit,
  prepared-operations, sparse-assignment, lifecycle). Pre-51 bisect: `batch` suite for main, g27, g42, g51, 2 rounds.

## Headline workloads (browser, complete GPU-completed frames)

15 interleaved rounds per row, ms per step. Values are medians over all loads, which pool rounds taken at different
load averages; the ratio columns are the paired within-round ratios and are the numbers to read. "g42/g27",
"g51/g42" and "g52/g51" are the step ratios between consecutive tags.

Configs: `latin15k-inter` (Latin, 14,850 glyphs, Inter MTSDF), `stress22k-inter` (21,600 glyphs), `bidi15k-amiri`
(mixed Arabic/Latin, Amiri bitmap 16; sweep only), `bidi15k-amiri-edit` (same text; edits only), `*-size` (width
sweep reading only `measure().width/height`), `ascii-interbitmap` (2,880-glyph animated ASCII frame). In the sweep
rows, "measure() call" is the `measure()` call alone after the width change, ":layout" is the width setter plus that
call, "publish" is `scene.updateMatrixWorld`, "frame" is the whole step to GPU completion. Edit ":layout" is the edit
plus `measure().glyphCount`.

| config             | metric                |    main |     g27 |     g42 |     g51 |     g52 | g52/main | vs main | g52/g51 | g42/g27 | g51/g42 | g52 vs g51 | rounds |
| ------------------ | --------------------- | ------: | ------: | ------: | ------: | ------: | -------: | ------- | ------: | ------: | ------: | ---------- | -----: |
| ascii-interbitmap  | ascii frame           |   5.990 |   5.235 |   5.705 |   5.980 |   5.245 |     0.89 | faster  |    0.99 |    1.00 |    1.01 | same       |     15 |
| ascii-interbitmap  | cold to first frame   | 133.530 | 128.305 | 132.590 | 124.705 | 124.290 |     0.95 | same    |    1.02 |    1.03 |    0.96 | same       |     15 |
| ascii-interbitmap  | first frame           |  44.445 |  40.560 |  44.025 |  42.380 |  42.710 |     0.96 | same    |    0.99 |    1.04 |    1.02 | same       |     15 |
| bidi15k-amiri      | cold to first frame   | 149.770 | 143.245 | 146.460 | 145.805 | 148.510 |     0.99 | same    |    0.99 |    1.03 |    1.01 | same       |     15 |
| bidi15k-amiri      | first frame           |  65.545 |  58.730 |  60.405 |  61.765 |  62.500 |     0.96 | same    |    1.04 |    1.02 |    1.01 | same       |     15 |
| bidi15k-amiri      | sweep :layout         |   0.255 |   0.895 |   0.885 |   0.880 |   0.975 |     3.84 | slower  |    1.11 |    0.99 |    1.00 | slower     |     15 |
| bidi15k-amiri      | sweep frame           |   6.280 |   5.025 |   5.060 |   5.205 |   5.250 |     0.83 | faster  |    0.99 |    1.01 |    1.00 | same       |     15 |
| bidi15k-amiri      | sweep measure() call  |   0.190 |   0.795 |   0.790 |   0.790 |   0.885 |     5.08 | slower  |    1.11 |    0.99 |    0.99 | slower     |     15 |
| bidi15k-amiri      | sweep publish         |   3.965 |   2.205 |   2.180 |   2.270 |   2.240 |     0.58 | faster  |    0.99 |    0.98 |    1.04 | same       |     15 |
| bidi15k-amiri-edit | delete-middle :layout |   3.590 |   8.195 |   8.120 |   1.640 |   1.755 |     0.50 | faster  |    1.05 |    1.00 |    0.21 | slower     |     15 |
| bidi15k-amiri-edit | delete-middle frame   |   8.885 |  11.995 |  12.060 |   5.580 |   5.905 |     0.64 | faster  |    1.02 |    1.01 |    0.45 | same       |     15 |
| bidi15k-amiri-edit | insert-middle :layout |   3.605 |   8.290 |   8.220 |   1.660 |   1.755 |     0.48 | faster  |    1.03 |    1.00 |    0.20 | same       |     15 |
| bidi15k-amiri-edit | insert-middle frame   |   8.910 |  12.120 |  12.140 |   5.710 |   5.665 |     0.63 | faster  |    0.99 |    1.00 |    0.45 | same       |     15 |
| bidi15k-amiri-edit | paste-middle :layout  |   9.560 |   8.250 |   8.250 |   8.115 |   8.340 |     0.88 | faster  |    1.01 |    1.00 |    1.01 | same       |     15 |
| bidi15k-amiri-edit | paste-middle frame    |  14.730 |  12.080 |  12.140 |  11.745 |  12.005 |     0.81 | faster  |    1.00 |    1.01 |    0.99 | same       |     15 |
| bidi15k-amiri-edit | type-end :layout      |   9.495 |   2.155 |   1.710 |   1.670 |   1.845 |     0.20 | faster  |    1.08 |    0.78 |    1.03 | slower     |     15 |
| bidi15k-amiri-edit | type-end frame        |  13.360 |   5.985 |   5.610 |   4.915 |   5.185 |     0.39 | faster  |    1.06 |    0.95 |    0.90 | slower     |     15 |
| bidi15k-amiri-size | sweep :layout         |   0.270 |   0.870 |   0.870 |   0.880 |   0.315 |     1.15 | slower  |    0.35 |    1.00 |    0.99 | faster     |     15 |
| bidi15k-amiri-size | sweep frame           |   6.585 |   4.895 |   4.990 |   5.100 |   5.345 |     0.80 | faster  |    1.02 |    1.03 |    1.01 | same       |     15 |
| bidi15k-amiri-size | sweep measure() call  |   0.200 |   0.785 |   0.785 |   0.795 |   0.260 |     1.29 | slower  |    0.30 |    1.00 |    0.99 | faster     |     15 |
| bidi15k-amiri-size | sweep publish         |   4.160 |   2.165 |   2.150 |   2.275 |   2.910 |     0.70 | faster  |    1.27 |    1.00 |    1.04 | slower     |     15 |
| latin15k-inter     | cold to first frame   | 263.290 | 199.045 | 222.080 | 206.965 | 226.480 |     0.77 | faster  |    1.10 |    1.08 |    0.92 | slower     |     15 |
| latin15k-inter     | delete-middle :layout |   3.205 |   1.530 |   1.020 |   1.030 |   1.210 |     0.38 | faster  |    1.11 |    0.67 |    1.01 | slower     |     15 |
| latin15k-inter     | delete-middle frame   |   8.200 |   5.495 |   5.085 |   4.805 |   4.960 |     0.60 | faster  |    1.02 |    0.94 |    0.93 | same       |     15 |
| latin15k-inter     | first frame           |  93.570 |  59.005 |  64.525 |  63.585 |  66.525 |     0.66 | faster  |    1.04 |    1.08 |    0.98 | same       |     15 |
| latin15k-inter     | insert-middle :layout |   3.230 |   1.660 |   1.120 |   1.140 |   1.300 |     0.41 | faster  |    1.11 |    0.67 |    1.06 | slower     |     15 |
| latin15k-inter     | insert-middle frame   |   8.230 |   5.555 |   5.105 |   5.110 |   5.205 |     0.63 | faster  |    1.01 |    0.94 |    0.95 | same       |     15 |
| latin15k-inter     | paste-middle :layout  |   3.245 |   1.560 |   1.065 |   1.090 |   1.285 |     0.39 | faster  |    1.10 |    0.68 |    1.01 | slower     |     15 |
| latin15k-inter     | paste-middle frame    |   8.380 |   5.530 |   5.180 |   4.955 |   5.210 |     0.62 | faster  |    1.04 |    0.96 |    0.93 | same       |     15 |
| latin15k-inter     | sweep :layout         |   0.575 |   0.840 |   0.895 |   0.875 |   1.245 |     2.04 | slower  |    1.34 |    0.99 |    0.99 | slower     |     15 |
| latin15k-inter     | sweep frame           |   4.870 |   4.630 |   4.470 |   4.520 |   4.785 |     0.95 | same    |    1.04 |    0.88 |    0.97 | same       |     15 |
| latin15k-inter     | sweep measure() call  |   0.450 |   0.740 |   0.775 |   0.790 |   1.155 |     2.54 | slower  |    1.40 |    0.95 |    1.01 | slower     |     15 |
| latin15k-inter     | sweep publish         |   2.215 |   1.805 |   1.130 |   1.225 |   1.200 |     0.60 | faster  |    0.96 |    0.53 |    1.02 | same       |     15 |
| latin15k-inter     | type-end :layout      |   6.135 |   1.630 |   1.150 |   1.205 |   1.330 |     0.22 | faster  |    1.09 |    0.70 |    1.05 | slower     |     15 |
| latin15k-inter     | type-end frame        |   9.590 |   5.555 |   5.035 |   4.475 |   4.650 |     0.49 | faster  |    1.03 |    0.94 |    0.88 | same       |     15 |
| latin15k-size      | sweep :layout         |   0.530 |   0.805 |   1.005 |   0.580 |   0.425 |     1.18 | slower  |    0.74 |    0.97 |    0.93 | faster     |     15 |
| latin15k-size      | sweep frame           |   4.755 |   4.560 |   4.935 |   3.370 |   3.545 |     0.98 | same    |    1.05 |    0.92 |    0.96 | same       |     15 |
| latin15k-size      | sweep measure() call  |   0.420 |   0.675 |   0.905 |   0.505 |   0.350 |     1.31 | slower  |    0.70 |    0.94 |    0.94 | faster     |     15 |
| latin15k-size      | sweep publish         |   1.840 |   1.785 |   1.400 |   0.745 |   1.075 |     0.90 | faster  |    1.42 |    0.56 |    0.95 | slower     |     15 |
| stress22k-inter    | cold to first frame   | 266.130 | 209.130 | 216.045 | 215.920 | 215.685 |     0.85 | faster  |    1.01 |    1.02 |    0.96 | same       |     15 |
| stress22k-inter    | delete-middle :layout |   8.690 |   2.105 |   1.325 |   1.320 |   1.625 |     0.18 | faster  |    1.16 |    0.64 |    1.00 | slower     |     15 |
| stress22k-inter    | delete-middle frame   |  14.605 |   6.865 |   6.305 |   5.690 |   6.185 |     0.42 | faster  |    1.05 |    0.93 |    0.90 | same       |     15 |
| stress22k-inter    | first frame           |  98.765 |  64.300 |  64.605 |  64.625 |  68.160 |     0.75 | faster  |    1.04 |    1.02 |    1.00 | same       |     15 |
| stress22k-inter    | insert-middle :layout |   8.775 |   2.125 |   1.340 |   1.340 |   1.570 |     0.18 | faster  |    1.17 |    0.64 |    1.00 | slower     |     15 |
| stress22k-inter    | insert-middle frame   |  14.865 |   6.785 |   6.175 |   5.685 |   6.055 |     0.41 | faster  |    1.05 |    0.91 |    0.92 | slower     |     15 |
| stress22k-inter    | paste-middle :layout  |   8.725 |   2.165 |   1.420 |   1.395 |   1.655 |     0.19 | faster  |    1.17 |    0.65 |    1.02 | slower     |     15 |
| stress22k-inter    | paste-middle frame    |  14.815 |   7.090 |   6.590 |   6.095 |   6.420 |     0.43 | faster  |    1.05 |    0.93 |    0.96 | slower     |     15 |
| stress22k-inter    | sweep :layout         |   0.415 |   0.795 |   0.700 |   0.965 |   0.950 |     2.46 | slower  |    1.32 |    0.96 |    1.02 | slower     |     15 |
| stress22k-inter    | sweep frame           |   3.830 |   4.540 |   3.520 |   4.670 |   3.870 |     0.96 | same    |    1.05 |    0.81 |    1.03 | slower     |     15 |
| stress22k-inter    | sweep measure() call  |   0.315 |   0.700 |   0.620 |   0.845 |   0.850 |     2.85 | slower  |    1.38 |    0.93 |    1.02 | slower     |     15 |
| stress22k-inter    | sweep publish         |   1.385 |   1.925 |   0.895 |   1.455 |   0.960 |     0.58 | faster  |    0.95 |    0.50 |    1.00 | faster     |     15 |
| stress22k-inter    | type-end :layout      |   8.610 |   2.250 |   1.450 |   1.465 |   1.710 |     0.20 | faster  |    1.14 |    0.66 |    1.01 | slower     |     15 |
| stress22k-inter    | type-end frame        |  12.595 |   6.880 |   6.145 |   5.205 |   5.545 |     0.43 | faster  |    1.05 |    0.92 |    0.84 | slower     |     15 |
| stress22k-size     | sweep :layout         |   0.565 |   0.810 |   0.845 |   1.155 |   0.765 |     1.34 | slower  |    0.72 |    1.01 |    1.02 | faster     |     15 |
| stress22k-size     | sweep frame           |   4.685 |   4.930 |   4.150 |   5.195 |   5.185 |     1.00 | same    |    1.02 |    0.85 |    1.01 | same       |     15 |
| stress22k-size     | sweep measure() call  |   0.470 |   0.730 |   0.745 |   1.095 |   0.695 |     1.43 | slower  |    0.69 |    0.96 |    1.02 | faster     |     15 |
| stress22k-size     | sweep publish         |   2.070 |   2.030 |   1.105 |   1.665 |   2.250 |     0.90 | faster  |    1.38 |    0.53 |    1.03 | slower     |     15 |

### 51→52 bisect (3 rounds; ratios are within-round, to g51)

`c-cd31` = `cd31aae2c` (defer positioning past a summary-only read), `c-dfb1` = `dfb1b238a` (summary glyph facts on
first read), g52 adds `29d225568` (shared accessors of deferred line glyph facts) and docs.

| config             | metric                |     g51 |  c-cd31 |  c-dfb1 |     g52 | c-cd31/g51 | c-dfb1/g51 | g52/g51 | n   |
| ------------------ | --------------------- | ------: | ------: | ------: | ------: | ---------: | ---------: | ------: | --- |
| bidi15k-amiri      | cold to first frame   | 138.215 | 150.885 | 141.395 | 147.865 |       1.12 |       1.02 |    1.07 | 3   |
| bidi15k-amiri      | first frame           |  61.530 |  59.565 |  61.945 |  61.045 |       0.99 |       0.99 |    0.99 | 3   |
| bidi15k-amiri      | sweep :layout         |   1.110 |   1.125 |   1.230 |   1.200 |       1.01 |       1.12 |    1.08 | 3   |
| bidi15k-amiri      | sweep measure()       |   1.065 |   1.080 |   1.185 |   1.150 |       1.02 |       1.13 |    1.08 | 3   |
| bidi15k-amiri      | sweep publish         |   3.230 |   3.235 |   3.060 |   3.015 |       1.00 |       0.95 |    0.93 | 3   |
| bidi15k-amiri      | sweep total           |   6.555 |   6.620 |   6.595 |   6.450 |       1.01 |       1.01 |    0.99 | 3   |
| bidi15k-amiri-size | sweep :layout         |   1.145 |   1.140 |   0.335 |   0.345 |       1.03 |       0.30 |    0.30 | 3   |
| bidi15k-amiri-size | sweep measure()       |   1.095 |   1.095 |   0.280 |   0.285 |       1.03 |       0.26 |    0.26 | 3   |
| bidi15k-amiri-size | sweep publish         |   3.275 |   3.295 |   3.890 |   3.900 |       1.02 |       1.19 |    1.18 | 3   |
| bidi15k-amiri-size | sweep total           |   6.635 |   6.690 |   6.465 |   6.590 |       1.02 |       0.98 |    0.98 | 3   |
| latin15k-inter     | cold to first frame   | 264.185 | 198.665 | 194.735 | 186.540 |       0.75 |       0.74 |    0.70 | 3   |
| latin15k-inter     | delete-middle :layout |   1.465 |   1.440 |   1.580 |   1.510 |       0.98 |       1.10 |    1.11 | 3   |
| latin15k-inter     | delete-middle total   |   6.465 |   6.445 |   6.475 |   6.210 |       0.97 |       1.00 |    1.01 | 3   |
| latin15k-inter     | first frame           |  70.485 |  64.695 |  58.525 |  56.570 |       1.05 |       0.93 |    0.93 | 3   |
| latin15k-inter     | insert-middle :layout |   1.500 |   1.635 |   1.835 |   1.750 |       1.07 |       1.18 |    1.15 | 3   |
| latin15k-inter     | insert-middle total   |   6.230 |   6.415 |   6.510 |   6.560 |       1.01 |       1.04 |    1.05 | 3   |
| latin15k-inter     | paste-middle :layout  |   1.535 |   1.455 |   1.565 |   1.725 |       0.95 |       1.02 |    1.12 | 3   |
| latin15k-inter     | paste-middle total    |   6.650 |   6.420 |   6.365 |   6.745 |       0.95 |       0.96 |    1.01 | 3   |
| latin15k-inter     | sweep :layout         |   0.970 |   1.015 |   1.305 |   1.475 |       1.02 |       1.35 |    1.52 | 3   |
| latin15k-inter     | sweep measure()       |   0.850 |   0.875 |   1.200 |   1.345 |       1.03 |       1.45 |    1.58 | 3   |
| latin15k-inter     | sweep publish         |   1.350 |   1.395 |   1.285 |   1.345 |       1.01 |       0.95 |    1.06 | 3   |
| latin15k-inter     | sweep total           |   4.665 |   4.845 |   5.020 |   5.300 |       1.07 |       1.09 |    1.12 | 3   |
| latin15k-inter     | type-end :layout      |   1.640 |   1.650 |   1.830 |   1.840 |       1.01 |       1.12 |    1.12 | 3   |
| latin15k-inter     | type-end total        |   5.960 |   5.780 |   5.860 |   5.915 |       0.97 |       0.99 |    1.00 | 3   |
| latin15k-size      | sweep :layout         |   1.120 |   1.005 |   0.770 |   0.675 |       0.93 |       0.64 |    0.60 | 3   |
| latin15k-size      | sweep measure()       |   1.005 |   0.865 |   0.645 |   0.610 |       0.96 |       0.64 |    0.61 | 3   |
| latin15k-size      | sweep publish         |   1.585 |   1.400 |   2.000 |   1.915 |       0.92 |       1.26 |    1.21 | 3   |
| latin15k-size      | sweep total           |   5.195 |   4.690 |   4.960 |   4.980 |       0.95 |       0.96 |    0.96 | 3   |
| stress22k-inter    | cold to first frame   | 192.075 | 189.325 | 230.090 | 189.620 |       1.03 |       1.19 |    0.99 | 3   |
| stress22k-inter    | delete-middle :layout |   1.725 |   1.710 |   1.945 |   1.895 |       0.98 |       1.13 |    1.10 | 3   |
| stress22k-inter    | delete-middle total   |   7.185 |   6.960 |   7.185 |   7.090 |       0.97 |       1.01 |    0.99 | 3   |
| stress22k-inter    | first frame           |  62.390 |  62.950 |  81.635 |  63.415 |       1.01 |       1.31 |    1.02 | 3   |
| stress22k-inter    | insert-middle :layout |   1.735 |   1.735 |   1.935 |   1.975 |       1.01 |       1.12 |    1.14 | 3   |
| stress22k-inter    | insert-middle total   |   6.990 |   7.010 |   7.195 |   7.275 |       1.01 |       1.01 |    1.04 | 3   |
| stress22k-inter    | paste-middle :layout  |   1.770 |   1.645 |   1.935 |   1.920 |       0.94 |       1.08 |    1.10 | 3   |
| stress22k-inter    | paste-middle total    |   7.495 |   6.910 |   7.430 |   7.405 |       0.94 |       0.98 |    1.00 | 3   |
| stress22k-inter    | sweep :layout         |   1.150 |   1.195 |   1.770 |   1.550 |       0.96 |       1.47 |    1.29 | 3   |
| stress22k-inter    | sweep measure()       |   1.085 |   1.120 |   1.665 |   1.460 |       0.97 |       1.49 |    1.31 | 3   |
| stress22k-inter    | sweep publish         |   1.720 |   1.675 |   1.580 |   1.535 |       0.97 |       0.98 |    0.89 | 3   |
| stress22k-inter    | sweep total           |   5.175 |   5.335 |   5.420 |   5.310 |       0.99 |       0.99 |    1.03 | 3   |
| stress22k-inter    | type-end :layout      |   2.040 |   2.005 |   2.185 |   2.245 |       0.96 |       1.04 |    1.10 | 3   |
| stress22k-inter    | type-end total        |   6.660 |   6.490 |   6.615 |   6.780 |       0.97 |       0.98 |    1.02 | 3   |
| stress22k-size     | sweep :layout         |   1.200 |   1.220 |   0.755 |   0.805 |       0.99 |       0.69 |    0.74 | 3   |
| stress22k-size     | sweep measure()       |   1.110 |   1.130 |   0.690 |   0.735 |       1.02 |       0.67 |    0.72 | 3   |
| stress22k-size     | sweep publish         |   1.680 |   1.680 |   2.250 |   2.355 |       1.00 |       1.36 |    1.34 | 3   |
| stress22k-size     | sweep total           |   5.145 |   5.375 |   5.290 |   5.535 |       1.04 |       1.02 |    1.03 | 3   |

The first-frame rows in this bisect contradict the 15-round set (Latin cold-to-first 0.70 of g51 here, 1.10 there):
cold rows are single samples per load dominated by browser start-up and are not resolved either way.

### `benchmark:headline-bidi-edit` (committed workflow, 3 rounds each)

Per-step median ms of a complete frame, median of loads.

| operation     |  main |   g52 | g52/main |   g51 |   g52 | g52/g51 |
| ------------- | ----: | ----: | -------: | ----: | ----: | ------: |
| type-end      | 12.69 |  6.11 |     0.48 |  5.22 |  5.15 |    0.99 |
| insert-middle |  8.95 |  6.65 |     0.74 |  6.07 |  5.43 |    0.89 |
| delete-middle |  8.96 |  6.61 |     0.74 |  6.12 |  5.24 |    0.86 |
| paste-middle  | 13.90 | 11.57 |     0.83 | 11.82 | 11.87 |    1.00 |

The two pairs ran as separate invocations a few minutes apart, so compare within a pair only. The workflow shows no
51→52 regression on mixed-bidi edits; the five-arm harness shows bidi `type-end` frame 1.06× g51 (15 rounds) and
`delete-middle :layout` 1.05×. Treat bidi edit frames as unchanged within ±6%.

## Labs (full suite, 3 rounds, p50 ms per call)

Values are medians over rounds of each run's pooled p50; ratios are medians of within-round ratios; verdicts need all
three rounds to agree beyond ±5%, otherwise "unresolved". Rows with an error on an arm are blank for that arm.

### Between main and g51: `batch` suite, 2 rounds (main, g27, g42, g51)

| row                                                        |   main |    g27 |    g42 |    g51 | g27/main | g42/g27 | g51/g42 | rounds |
| ---------------------------------------------------------- | -----: | -----: | -----: | -----: | -------: | ------: | ------: | -----: |
| batching: rewrite 128 labels in one group [setter only]    | 0.2538 | 0.3498 | 0.3128 | 0.3677 |     1.37 |    0.91 |    1.18 |      2 |
| batching: rewrite 256 labels in one group [setter only]    | 0.4551 | 0.6459 | 0.5428 | 0.6720 |     1.41 |    0.86 |    1.24 |      2 |
| batching: rewrite 512 labels in one group [setter only]    | 0.7857 | 1.0512 | 1.0023 | 1.0933 |     1.34 |    0.96 |    1.09 |      2 |
| batching: rewrite 64 labels in one group [setter only]     | 0.1290 | 0.2752 | 0.1614 | 0.2040 |     2.11 |    0.72 |    1.26 |      2 |
| stress: publish 1024 retained Text instances [setter only] | 1.8122 | 2.1135 | 2.4844 | 2.4842 |     1.17 |    1.18 |    1.00 |      2 |

The `[setter only]` rewrite rows were already 1.3–2.1× main at g27; g42 came out faster than g27 and g51 slower
than g42 again (+9–26%). With two rounds and that non-monotone path this is not a resolved 42→51 regression.
"publish 1024 retained Text instances [setter only]" rose at g27→g42 (+18%) and is flat after.

### The 145 rows of the 2026-11-21 snapshot

| row                                                                                                          |     main |     g51 |     g52 | g52/main | g52/g51 | g52 vs main | g52 vs g51 |   n |
| ------------------------------------------------------------------------------------------------------------ | -------: | ------: | ------: | -------: | ------: | ----------- | ---------- | --: |
| adapter-publication: mutate one trailing span across 1000 formatted labels                                   |  42.0656 | 28.1995 | 26.3198 |    0.626 |   0.933 | faster      | faster     |   3 |
| adapter-publication: normalize 1000 equivalent retained label updates                                        |   2.5451 |  2.4693 |  2.3401 |    0.936 |   0.948 | faster      | faster     |   3 |
| batching: edit and measure one of 100 retained labels                                                        |   0.1844 |  0.1636 |  0.1491 |    0.746 |   1.012 | faster      | same       |   3 |
| batching: rewrite 128 labels in one group                                                                    |   1.9925 |  1.9920 |  1.8634 |    0.935 |   0.935 | faster      | faster     |   3 |
| batching: rewrite 256 labels in one group                                                                    |   3.7062 |  3.4427 |  3.1914 |    0.861 |   0.927 | faster      | faster     |   3 |
| batching: rewrite 512 labels in one group                                                                    |   7.3244 |  5.9492 |  6.0166 |    0.846 |   1.016 | faster      | same       |   3 |
| batching: rewrite 64 labels in one group                                                                     |   1.1933 |  1.1129 |  1.1261 |    0.956 |   1.012 | same        | same       |   3 |
| batching: 10 labels first color-only engine publication                                                      |   0.2688 |  0.2993 |  0.2393 |    0.881 |   0.962 | unresolved  | same       |   3 |
| batching: 10 labels first color-only scene publication                                                       |   0.2930 |  0.3420 |  0.2899 |    0.891 |   0.878 | faster      | faster     |   3 |
| batching: 10 labels first length-changing engine publication                                                 |   0.4858 |  0.5175 |  0.5229 |    0.923 |   0.981 | unresolved  | same       |   3 |
| batching: 10 labels first length-changing scene publication                                                  |   0.4737 |  0.5534 |  0.4860 |    1.026 |   0.930 | same        | faster     |   3 |
| batching: 10 labels first same-length engine publication                                                     |   0.3353 |  0.4032 |  0.3616 |    1.019 |   0.869 | same        | faster     |   3 |
| batching: 10 labels first same-length scene publication                                                      |   0.3436 |  0.4070 |  0.3817 |    1.129 |   0.914 | **slower**  | unresolved |   3 |
| batching: 10 labels last color-only engine publication                                                       |   0.3120 |  0.2916 |  0.2938 |    0.926 |   0.867 | unresolved  | unresolved |   3 |
| batching: 10 labels last color-only scene publication                                                        |   0.3201 |  0.3178 |  0.2920 |    0.912 |   0.974 | unresolved  | same       |   3 |
| batching: 10 labels last length-changing engine publication                                                  |   0.4607 |  0.5538 |  0.4647 |    1.009 |   0.839 | same        | faster     |   3 |
| batching: 10 labels last length-changing scene publication                                                   |   0.5381 |  0.4947 |  0.4442 |    0.825 |   0.968 | faster      | same       |   3 |
| batching: 10 labels last same-length engine publication                                                      |   0.3363 |  0.5338 |  0.3792 |    1.201 |   0.669 | unresolved  | unresolved |   3 |
| batching: 10 labels last same-length scene publication                                                       |   0.3685 |  0.3821 |  0.3772 |    0.997 |   0.974 | same        | same       |   3 |
| batching: 10 labels no-op scene traversal                                                                    |   0.0424 |  0.0248 |  0.0248 |    0.616 |   0.927 | faster      | unresolved |   3 |
| batching: 100 labels 100 edits immediate measurements with publication                                       |  11.9205 |  6.0328 |  6.3287 |    0.531 |   1.049 | faster      | same       |   3 |
| batching: 100 labels 100 edits immediate measurements without publication                                    |   2.9510 |  1.7954 |  2.5586 |    0.870 |   1.425 | faster      | **slower** |   3 |
| batching: 100 labels batched edit-read publication                                                           |   5.4983 |  3.0530 |  3.7392 |    0.677 |   1.214 | faster      | **slower** |   3 |
| batching: 100 labels first color-only engine publication                                                     |   0.4378 |  0.3300 |  0.2835 |    0.648 |   0.859 | faster      | unresolved |   3 |
| batching: 100 labels first color-only scene publication                                                      |   0.5104 |  0.3219 |  0.3101 |    0.608 |   0.949 | faster      | unresolved |   3 |
| batching: 100 labels first length-changing engine publication                                                |   0.8824 |  0.6141 |  0.6247 |    0.708 |   1.017 | faster      | same       |   3 |
| batching: 100 labels first length-changing scene publication                                                 |   0.9539 |  0.6270 |  0.6094 |    0.681 |   0.954 | faster      | same       |   3 |
| batching: 100 labels first same-length engine publication                                                    |   0.5601 |  0.4461 |  0.4721 |    0.844 |   1.065 | faster      | unresolved |   3 |
| batching: 100 labels first same-length scene publication                                                     |   0.5972 |  0.5132 |  0.4532 |    0.737 |   0.941 | faster      | faster     |   3 |
| batching: 100 labels interleaved edit-read publication                                                       |  20.5630 |  8.1476 |  8.4922 |    0.413 |   1.097 | faster      | unresolved |   3 |
| batching: 100 labels last color-only engine publication                                                      |   0.4472 |  0.3353 |  0.2620 |    0.626 |   0.835 | faster      | unresolved |   3 |
| batching: 100 labels last color-only scene publication                                                       |   0.4659 |  0.3763 |  0.3065 |    0.665 |   1.080 | faster      | unresolved |   3 |
| batching: 100 labels last length-changing engine publication                                                 |   0.6894 |  0.6293 |  0.5968 |    0.866 |   0.957 | faster      | same       |   3 |
| batching: 100 labels last length-changing scene publication                                                  |   0.7226 |  0.6828 |  0.5604 |    0.799 |   0.995 | faster      | same       |   3 |
| batching: 100 labels last same-length engine publication                                                     |   0.4908 |  0.5731 |  0.4379 |    0.874 |   0.917 | unresolved  | faster     |   3 |
| batching: 100 labels last same-length scene publication                                                      |   0.5613 |  0.5513 |  0.4466 |    0.796 |   0.810 | faster      | faster     |   3 |
| batching: 100 labels no-op scene traversal                                                                   |   0.0760 |  0.0376 |  0.0365 |    0.463 |   1.039 | faster      | same       |   3 |
| batching: 1000 labels 100 edits batched edit-read publication                                                |   9.7432 |  4.9392 |  5.5847 |    0.579 |   1.131 | faster      | **slower** |   3 |
| batching: 1000 labels 100 edits immediate measurements with publication                                      | 110.6806 | 11.6386 | 13.9472 |    0.125 |   1.185 | faster      | **slower** |   3 |
| batching: 1000 labels 100 edits immediate measurements without publication                                   |   4.0939 |  1.8759 |  2.7041 |    0.661 |   1.438 | faster      | **slower** |   3 |
| batching: 1000 labels 100 edits interleaved edit-read publication                                            | 139.2429 | 16.3127 | 19.2112 |    0.138 |   1.179 | faster      | **slower** |   3 |
| batching: 1000 labels first color-only engine publication                                                    |   1.9746 |  0.4864 |  0.4295 |    0.218 |   0.959 | faster      | same       |   3 |
| batching: 1000 labels first color-only scene publication                                                     |   2.4665 |  0.6908 |  0.6211 |    0.255 |   0.899 | faster      | unresolved |   3 |
| batching: 1000 labels first length-changing engine publication                                               |   4.6567 |  2.1516 |  2.1764 |    0.465 |   1.018 | faster      | same       |   3 |
| batching: 1000 labels first length-changing scene publication                                                |   5.0928 |  2.1786 |  2.0541 |    0.405 |   0.951 | faster      | same       |   3 |
| batching: 1000 labels first same-length engine publication                                                   |   2.5352 |  1.4304 |  1.3397 |    0.524 |   0.937 | faster      | faster     |   3 |
| batching: 1000 labels first same-length scene publication                                                    |   3.1104 |  1.3878 |  1.2823 |    0.409 |   0.924 | faster      | faster     |   3 |
| batching: 1000 labels last color-only engine publication                                                     |   2.1677 |  0.5156 |  0.4515 |    0.208 |   0.876 | faster      | faster     |   3 |
| batching: 1000 labels last color-only scene publication                                                      |   2.5391 |  0.6578 |  0.6209 |    0.245 |   0.944 | faster      | unresolved |   3 |
| batching: 1000 labels last length-changing engine publication                                                |   3.1784 |  1.6809 |  1.6763 |    0.508 |   0.960 | faster      | same       |   3 |
| batching: 1000 labels last length-changing scene publication                                                 |   3.4416 |  1.5898 |  1.4989 |    0.432 |   0.948 | faster      | faster     |   3 |
| batching: 1000 labels last same-length engine publication                                                    |   2.7118 |  1.3896 |  1.3749 |    0.507 |   0.989 | faster      | same       |   3 |
| batching: 1000 labels last same-length scene publication                                                     |   2.9963 |  1.3389 |  1.2800 |    0.423 |   0.953 | faster      | same       |   3 |
| batching: 1000 labels no-op scene traversal                                                                  |   0.4316 |  0.1688 |  0.1515 |    0.345 |   0.898 | faster      | faster     |   3 |
| batching: 100 labels separated balanced grow-shrink-space engine publication                                 |   1.0086 |  0.7590 |  0.7619 |    0.755 |   0.997 | faster      | same       |   3 |
| batching: 100 labels separated balanced grow-shrink-space scene publication                                  |   0.9882 |  0.7491 |  0.7477 |    0.782 |   0.956 | faster      | same       |   3 |
| batching: 100 labels separated unbalanced grow-shrink-space engine publication                               |   0.9426 |  0.7887 |  0.7556 |    0.793 |   0.995 | faster      | same       |   3 |
| batching: 100 labels separated unbalanced grow-shrink-space scene publication                                |   0.9582 |  0.7388 |  0.7670 |    0.756 |   1.018 | faster      | same       |   3 |
| batching: 1000 labels separated balanced grow-shrink-space engine publication                                |   4.7265 |  2.9519 |  2.9315 |    0.620 |   0.988 | faster      | same       |   3 |
| batching: 1000 labels separated balanced grow-shrink-space scene publication                                 |   5.4639 |  2.7395 |  2.7787 |    0.510 |   1.012 | faster      | same       |   3 |
| batching: 1000 labels separated unbalanced grow-shrink-space engine publication                              |   5.1801 |  3.0497 |  3.0161 |    0.582 |   0.986 | faster      | same       |   3 |
| batching: 1000 labels separated unbalanced grow-shrink-space scene publication                               |   5.1586 |  2.8657 |  2.8420 |    0.552 |   0.994 | faster      | same       |   3 |
| cold: mount 100 labels and borrow glyphs from each once                                                      |   9.7285 |  9.0151 |  8.4345 |    0.870 |   0.970 | faster      | same       |   3 |
| cold: mount a label and publish its first edit                                                               |   2.1753 |  2.7039 |  2.2979 |    1.056 |   0.850 | unresolved  | faster     |   3 |
| cold: mount and publish a 22k-glyph paragraph                                                                |  17.1420 | 13.0586 | 12.1973 |    0.712 |   0.950 | faster      | faster     |   3 |
| common: measure 100 unchanged labels                                                                         |   0.0291 |  0.0194 |  0.0179 |    0.579 |   0.924 | faster      | faster     |   3 |
| common: measure after text change                                                                            |   1.2496 |  0.9348 |  1.0412 |    0.840 |   1.123 | faster      | unresolved |   3 |
| common: publish after color change                                                                           |   1.6189 |  0.8575 |  0.7924 |    0.491 |   0.927 | faster      | faster     |   3 |
| common: publish after text change                                                                            |   2.0897 |  1.4659 |  1.3445 |    0.646 |   0.917 | faster      | faster     |   3 |
| common: reflow after width change                                                                            |   0.5300 |  0.3790 |  0.3104 |    0.568 |   0.819 | faster      | faster     |   3 |
| common: relayout after font-size change                                                                      |   2.1077 |  1.6187 |  1.5082 |    0.716 |   0.932 | faster      | faster     |   3 |
| edit: type one character into a long Fredoka paragraph and measure                                           |   1.5803 |  0.8187 |  0.9301 |    0.589 |   1.139 | faster      | **slower** |   3 |
| edit: type one character into a long paragraph and measure                                                   |   2.0782 |  0.7325 |  0.7891 |    0.380 |   1.060 | faster      | **slower** |   3 |
| edit: type one character into a long paragraph and publish a frame                                           |   3.2642 |  1.5931 |  1.3564 |    0.416 |   0.868 | faster      | faster     |   3 |
| framework-publication: bind and normalize 1000 framework-shaped formatted flow updates                       |   5.8908 |  5.3754 |  5.1826 |    0.878 |   0.964 | faster      | same       |   3 |
| framework-publication: normalize 1000 equivalent formatted flow updates                                      |   5.3075 |  5.2321 |  5.0297 |    0.951 |   0.969 | same        | same       |   3 |
| framework-publication: reuse 1000 unchanged Vue property snapshots                                           |   0.1882 |  0.1934 |  0.1896 |    1.004 |   0.973 | same        | same       |   3 |
| inspection: borrow per-glyph metrics from 100 promoted labels                                                |   0.2576 |  0.2440 |  0.2254 |    0.881 |   0.936 | faster      | faster     |   3 |
| inspection: copy per-glyph metrics after text change                                                         |   3.6438 |  2.0738 |  2.0297 |    0.560 |   0.987 | faster      | same       |   3 |
| inspection: copy per-glyph metrics from 100 unchanged labels                                                 |   0.1796 |  0.1316 |  0.1255 |    0.698 |   0.975 | faster      | same       |   3 |
| inspection: edit and independently copy one label among 1 labels                                             |   1.2163 |  0.9822 |  0.8399 |    0.733 |   0.881 | faster      | faster     |   3 |
| inspection: edit and independently copy one label among 100 labels                                           |   1.3721 |  0.9900 |  0.9438 |    0.699 |   0.968 | faster      | same       |   3 |
| inspection: edit and independently copy one label among 1000 labels                                          |   3.0504 |  1.8812 |  1.8629 |    0.611 |   0.992 | faster      | same       |   3 |
| layout: cached measurement                                                                                   |   0.0054 |  0.0060 |  0.0044 |    0.798 |   0.726 | unresolved  | faster     |   3 |
| layout: cached per-glyph inspection                                                                          |   0.0693 |  0.0911 |  0.0679 |    0.936 |   0.732 | unresolved  | faster     |   3 |
| layout: inspection then publication after width change                                                       |   8.8122 |  3.9451 |  3.8827 |    0.441 |   0.988 | faster      | same       |   3 |
| layout: measurement after width change                                                                       |   0.8369 |  0.9211 |  1.7737 |    2.059 |   1.863 | **slower**  | **slower** |   3 |
| layout: measurement then publication after width change                                                      |   1.8938 |  1.2099 |  2.0101 |    1.064 |   1.647 | **slower**  | **slower** |   3 |
| layout: per-glyph inspection after width change                                                              |   7.0535 |  5.6354 |  3.7369 |    0.530 |   0.697 | faster      | faster     |   3 |
| layout: publication after font-size change                                                                   |   6.2419 |  5.3775 |  4.9806 |    0.798 |   0.926 | faster      | faster     |   3 |
| layout: publication after text change                                                                        |   6.6398 |  4.4842 |  4.0371 |    0.606 |   0.902 | faster      | faster     |   3 |
| layout: publication after width change                                                                       |   1.0806 |  0.6401 |  0.5424 |    0.513 |   0.845 | faster      | faster     |   3 |
| outlines: copy per-glyph metrics with outlines after text change                                             |   3.6849 |  2.0708 |  2.0878 |    0.567 |   1.017 | faster      | same       |   3 |
| outlines: read every outline from an unchanged copy                                                          |   0.8931 |  0.8838 |  0.8946 |    1.002 |   1.012 | same        | same       |   3 |
| prepared-operations: 1 labels first overwrite-before-scene-publication                                       |   0.2421 |  0.0704 |  0.0786 |    0.281 |   1.116 | faster      | unresolved |   3 |
| prepared-operations: 1 labels first same-value-set                                                           |   0.0039 |  0.0039 |  0.0038 |    0.839 |   0.973 | unresolved  | same       |   3 |
| prepared-operations: 1 labels first set                                                                      |   0.0371 |  0.0325 |  0.0323 |    0.835 |   0.956 | unresolved  | same       |   3 |
| prepared-operations: 1 labels first set+measure                                                              |   0.1610 |  0.1392 |  0.1605 |    0.952 |   1.153 | same        | **slower** |   3 |
| prepared-operations: 1 labels first set+measure+scene-publication                                            |   0.4173 |  0.3912 |  0.4168 |    0.999 |   1.086 | same        | unresolved |   3 |
| prepared-operations: 100 labels first overwrite-before-scene-publication                                     |   0.3282 |  0.0989 |  0.0965 |    0.260 |   0.976 | faster      | same       |   3 |
| prepared-operations: 100 labels first same-value-set                                                         |   0.0039 |  0.0036 |  0.0039 |    0.952 |   1.113 | same        | unresolved |   3 |
| prepared-operations: 100 labels first set                                                                    |   0.0278 |  0.0309 |  0.0315 |    1.133 |   1.002 | unresolved  | same       |   3 |
| prepared-operations: 100 labels first set+measure                                                            |   0.1662 |  0.1283 |  0.1606 |    0.840 |   1.252 | unresolved  | unresolved |   3 |
| prepared-operations: 100 labels first set+measure+scene-publication                                          |   0.5878 |  0.4831 |  0.4970 |    0.841 |   1.059 | faster      | unresolved |   3 |
| prepared-operations: 1000 labels first overwrite-before-scene-publication                                    |   1.7283 |  0.2579 |  0.2681 |    0.155 |   0.992 | faster      | same       |   3 |
| prepared-operations: 1000 labels first same-value-set                                                        |   0.0070 |  0.0056 |  0.0057 |    0.756 |   1.030 | unresolved  | same       |   3 |
| prepared-operations: 1000 labels first set                                                                   |   0.0338 |  0.0442 |  0.0391 |    1.154 |   0.884 | unresolved  | unresolved |   3 |
| prepared-operations: 1000 labels first set+measure                                                           |   0.1764 |  0.1482 |  0.1606 |    0.910 |   1.028 | faster      | same       |   3 |
| prepared-operations: 1000 labels first set+measure+scene-publication                                         |   3.3119 |  1.2450 |  1.3487 |    0.407 |   1.101 | faster      | unresolved |   3 |
| request-arena: write 1000 paragraph and text mutations                                                       |   0.0882 |  0.0849 |  0.0886 |    1.024 |   1.026 | same        | same       |   3 |
| request-arena: write 1000 paragraph-order mutations                                                          |   0.0154 |  0.0119 |  0.0128 |    0.861 |   1.001 | faster      | same       |   3 |
| request-arena: write 22k UTF16 text into Wasm request arena                                                  |   0.0389 |  0.0364 |  0.0384 |    0.962 |   1.042 | same        | same       |   3 |
| request-arena: write 22k UTF16 text into owned array control                                                 |   0.0401 |  0.0363 |  0.0372 |    0.926 |   1.024 | faster      | same       |   3 |
| request-arena: write one paragraph and text mutation                                                         |   0.0105 |  0.0080 |  0.0092 |    0.812 |   1.079 | faster      | unresolved |   3 |
| sparse-assignment: broad end-to-end setter and publication with 8192 paint spans                             |  20.2707 | 13.6030 | 13.6666 |    0.674 |   1.011 | faster      | same       |   3 |
| sparse-assignment: broad setter preparation in one large paragraph with 8192 paint spans                     |  32.4350 | 10.7823 | 11.2045 |    0.342 |   1.030 | faster      | same       |   3 |
| sparse-assignment: scattered end-to-end setter and publication with 8192 paint spans                         |  20.1181 | 13.1105 | 13.2463 |    0.661 |   1.008 | faster      | same       |   3 |
| sparse-assignment: scattered setter preparation in one large paragraph with 8192 paint spans                 |  32.4858 | 10.9091 | 11.2802 |    0.347 |   1.033 | faster      | same       |   3 |
| sparse-assignment: unchanged end-to-end setter and publication with 8192 paint spans                         |   4.4898 |  3.0713 |  3.0883 |    0.696 |   1.009 | faster      | same       |   3 |
| sparse-assignment: unchanged setter preparation in one large paragraph with 8192 paint spans                 |   4.5313 |  3.0421 |  3.0627 |    0.670 |   1.010 | faster      | same       |   3 |
| sparse-assignment: monospaced broad end-to-end setter and publication with 8192 paint spans                  | 137.1513 | 14.2051 | 14.3406 |    0.104 |   1.010 | faster      | same       |   3 |
| sparse-assignment: monospaced broad setter preparation in one large paragraph with 8192 paint spans          |  95.8634 | 11.5244 | 11.9829 |    0.125 |   1.040 | faster      | same       |   3 |
| sparse-assignment: monospaced scattered end-to-end setter and publication with 8192 paint spans              |  17.7144 | 10.3926 | 10.2129 |    0.580 |   0.975 | faster      | same       |   3 |
| sparse-assignment: monospaced scattered setter preparation in one large paragraph with 8192 paint spans      |  31.1169 |  9.4593 |  9.9360 |    0.318 |   1.047 | faster      | same       |   3 |
| sparse-assignment: monospaced unchanged end-to-end setter and publication with 8192 paint spans              |   4.5700 |  3.0580 |  3.0624 |    0.679 |   0.991 | faster      | same       |   3 |
| sparse-assignment: monospaced unchanged setter preparation in one large paragraph with 8192 paint spans      |   4.5909 |  3.0305 |  3.0753 |    0.673 |   1.015 | faster      | same       |   3 |
| sparse-assignment: split move and merge paint boundaries preparation only                                    |   6.4224 |  1.4094 |  1.8335 |    0.288 |   1.313 | faster      | **slower** |   3 |
| sparse-assignment: split move and merge paint boundaries publication                                         |   9.1044 |  2.9220 |  3.2567 |    0.360 |   1.115 | faster      | **slower** |   3 |
| sparse-assignment: shared-material scattered end-to-end setter and publication with 8192 paint spans         |  28.4467 | 14.1517 | 14.2663 |    0.514 |   1.021 | faster      | same       |   3 |
| sparse-assignment: shared-material scattered setter preparation in one large paragraph with 8192 paint spans |  40.6486 | 11.7513 | 12.3719 |    0.302 |   1.050 | faster      | same       |   3 |
| stress: borrow glyphs from 1000 steadily promoted retained labels                                            |   2.1655 |  1.2241 |  1.1781 |    0.613 |   0.982 | unresolved  | same       |   3 |
| stress: edit and measure one of 1000 retained labels                                                         |   0.2290 |  0.1421 |  0.1930 |    0.790 |   1.415 | faster      | **slower** |   3 |
| stress: edit and sparsely borrow one of 1000 retained labels                                                 |   0.2131 |  0.1530 |  0.1605 |    0.753 |   1.048 | faster      | same       |   3 |
| stress: measure 1000 unchanged retained labels                                                               |   0.2821 |  0.2064 |  0.2254 |    0.834 |   1.101 | faster      | **slower** |   3 |
| stress: publish 1024 retained Text instances                                                                 |  15.5321 | 12.4608 | 12.5552 |    0.824 |   1.004 | faster      | same       |   3 |
| stress: reorder 1000 unchanged retained labels                                                               |   2.7210 |  2.3746 |  2.4240 |    0.911 |   1.034 | faster      | same       |   3 |
| stress: reorder then edit one of 1000 retained labels                                                        |   6.4121 |  5.2981 |  5.5518 |    0.882 |   1.048 | faster      | same       |   3 |
| stress: toggle one group containing 1000 retained labels                                                     |   0.4913 |  0.4611 |  0.4767 |    1.055 |   1.078 | unresolved  | unresolved |   3 |
| typegpu-publication: move 1000 retained TypeGPU labels                                                       |   0.2640 |         |         |          |         | n/a         | n/a        |   0 |
| unsafe-line-breaks: common-safe word-wrap reflow                                                             |   0.1995 |  0.1536 |  0.1661 |    0.841 |   1.076 | unresolved  | unresolved |   3 |
| unsafe-line-breaks: issue 216 reporter workaround                                                            |   0.2158 |  0.1591 |  0.1838 |    0.839 |   1.161 | unresolved  | **slower** |   3 |
| unsafe-line-breaks: issue 216 unsafe-boundary word-wrap reflow                                               |   0.2059 |  0.1365 |  0.1720 |    0.835 |   1.191 | unresolved  | **slower** |   3 |
| unsafe-line-breaks: long reporter workaround paragraph reflow                                                |   0.4310 |  0.3606 |  0.5866 |    1.368 |   1.636 | **slower**  | **slower** |   3 |
| unsafe-line-breaks: long unsafe-boundary paragraph reflow                                                    |   0.3833 |  0.2984 |  0.4996 |    1.303 |   1.674 | **slower**  | **slower** |   3 |
| unsafe-line-breaks: long unsafe-boundary paragraph text edit                                                 |   1.6051 |  1.2673 |  1.4995 |    0.934 |   1.181 | faster      | **slower** |   3 |

### The 75 newer rows

| row                                                                                       |     main |      g51 |      g52 | g52/main | g52/g51 | g52 vs main | g52 vs g51 |   n |
| ----------------------------------------------------------------------------------------- | -------: | -------: | -------: | -------: | ------: | ----------- | ---------- | --: |
| batching: rewrite 128 labels in one group [setter + read]                                 |   2.7652 |   1.8520 |   2.3664 |    0.872 |   1.357 | faster      | **slower** |   3 |
| batching: rewrite 128 labels in one group [setter only]                                   |   0.2409 |   0.3171 |   0.3060 |    1.331 |   0.965 | **slower**  | same       |   3 |
| batching: rewrite 256 labels in one group [setter + read]                                 |   5.4035 |   3.4496 |   4.5185 |    0.869 |   1.307 | faster      | **slower** |   3 |
| batching: rewrite 256 labels in one group [setter only]                                   |   0.4453 |   0.6024 |   0.5311 |    1.206 |   0.909 | **slower**  | faster     |   3 |
| batching: rewrite 512 labels in one group [setter + read]                                 |  10.3133 |   6.2538 |   8.7617 |    0.840 |   1.350 | faster      | **slower** |   3 |
| batching: rewrite 512 labels in one group [setter only]                                   |   0.7774 |   1.0171 |   0.9870 |    1.188 |   0.970 | **slower**  | same       |   3 |
| batching: rewrite 64 labels in one group [setter + read]                                  |   1.5104 |   0.9605 |   1.2938 |    0.857 |   1.345 | faster      | **slower** |   3 |
| batching: rewrite 64 labels in one group [setter only]                                    |   0.1184 |   0.1764 |   0.1666 |    1.382 |   0.933 | **slower**  | faster     |   3 |
| batching: 10 labels first color-only [setter + read]                                      |   0.1620 |   0.1499 |   0.1475 |    0.894 |   1.150 | unresolved  | unresolved |   3 |
| batching: 10 labels first color-only [setter only]                                        |   0.0739 |   0.0828 |   0.0609 |    0.840 |   0.888 | unresolved  | unresolved |   3 |
| batching: 10 labels last color-only [setter + read]                                       |   0.1895 |   0.1599 |   0.1726 |    0.911 |   1.098 | unresolved  | **slower** |   3 |
| batching: 10 labels last color-only [setter only]                                         |   0.0750 |   0.0721 |   0.0661 |    0.822 |   0.817 | faster      | faster     |   3 |
| batching: 100 labels first color-only [setter + read]                                     |   0.2025 |   0.2017 |   0.1611 |    0.825 |   0.812 | faster      | unresolved |   3 |
| batching: 100 labels first color-only [setter only]                                       |   0.0869 |   0.1055 |   0.0645 |    0.757 |   0.616 | faster      | unresolved |   3 |
| batching: 100 labels interleaved edit-read publication [setter + read]                    |   3.0365 |   1.7239 |   2.4653 |    0.828 |   1.441 | faster      | **slower** |   3 |
| batching: 100 labels interleaved edit-read publication [setter only]                      |   0.1987 |   0.2097 |   0.1859 |    0.936 |   0.887 | faster      | faster     |   3 |
| batching: 100 labels last color-only [setter + read]                                      |   0.1998 |   0.1902 |   0.1647 |    0.814 |   0.866 | faster      | unresolved |   3 |
| batching: 100 labels last color-only [setter only]                                        |   0.0961 |   0.0664 |   0.0660 |    0.708 |   0.994 | faster      | same       |   3 |
| batching: 1000 labels 100 edits interleaved edit-read publication [setter + read]         |   4.0562 |   1.8917 |   2.6894 |    0.663 |   1.443 | faster      | **slower** |   3 |
| batching: 1000 labels 100 edits interleaved edit-read publication [setter only]           |   0.2975 |   0.2913 |   0.2620 |    0.875 |   0.930 | faster      | faster     |   3 |
| batching: 1000 labels first color-only [setter + read]                                    |   0.2940 |   0.2177 |   0.2276 |    0.755 |   1.063 | faster      | unresolved |   3 |
| batching: 1000 labels first color-only [setter only]                                      |   0.1265 |   0.1405 |   0.1107 |    0.822 |   0.876 | faster      | faster     |   3 |
| batching: 1000 labels last color-only [setter + read]                                     |   0.2603 |   0.2634 |   0.2391 |    0.887 |   1.033 | unresolved  | same       |   3 |
| batching: 1000 labels last color-only [setter only]                                       |   0.1190 |   0.1535 |   0.1349 |    1.136 |   0.922 | unresolved  | faster     |   3 |
| edit: insert one character into a long Fredoka paragraph [setter + frame]                 |   2.5504 |   1.4719 |   1.4887 |    0.584 |   1.006 | faster      | same       |   3 |
| edit: insert one character into a long Fredoka paragraph [setter + read]                  |   1.5428 |   0.6671 |   0.4881 |    0.318 |   0.738 | faster      | faster     |   3 |
| edit: insert one character into a long Fredoka paragraph [setter only]                    |   0.0185 |   0.0119 |   0.0084 |    0.443 |   0.709 | faster      | faster     |   3 |
| edit: insert one character into a long paragraph [setter + frame]                         |   2.9545 |   1.2050 |   1.2633 |    0.428 |   1.048 | faster      | same       |   3 |
| edit: insert one character into a long paragraph [setter + read]                          |   2.1314 |   0.5325 |   0.3919 |    0.183 |   0.747 | faster      | faster     |   3 |
| edit: insert one character into a long paragraph [setter only]                            |   0.0173 |   0.0135 |   0.0087 |    0.505 |   0.647 | faster      | faster     |   3 |
| edit: restore one character in a long Fredoka paragraph [setter + frame]                  |   2.5342 |   1.4186 |   1.4599 |    0.576 |   1.029 | faster      | same       |   3 |
| edit: restore one character in a long Fredoka paragraph [setter + read]                   |   1.5337 |   0.6844 |   0.5019 |    0.327 |   0.733 | faster      | faster     |   3 |
| edit: restore one character in a long Fredoka paragraph [setter only]                     |   0.0181 |   0.0127 |   0.0090 |    0.460 |   0.714 | faster      | faster     |   3 |
| edit: restore one character in a long paragraph [setter + frame]                          |   2.9640 |   1.2761 |   1.2527 |    0.424 |   0.979 | faster      | same       |   3 |
| edit: restore one character in a long paragraph [setter + read]                           |   2.1142 |   0.5245 |   0.3817 |    0.183 |   0.744 | faster      | faster     |   3 |
| edit: restore one character in a long paragraph [setter only]                             |   0.0156 |   0.0122 |   0.0086 |    0.543 |   0.709 | faster      | faster     |   3 |
| lifecycle: dispose and recreate 100 labels [recreate + frame]                             |   7.1915 |   5.4560 |   5.4844 |    0.773 |   1.003 | faster      | same       |   3 |
| lifecycle: dispose and recreate 100 labels [recreate + read]                              |   9.2604 |   4.8444 |   5.7636 |    0.622 |   1.190 | faster      | **slower** |   3 |
| lifecycle: dispose and recreate 100 labels [recreate only]                                |   2.4870 |   2.0493 |   2.0478 |    0.823 |   1.027 | faster      | same       |   3 |
| lifecycle: dispose and recreate 1000 labels [recreate only]                               |  58.8663 |  27.8752 |  26.3568 |    0.445 |   0.941 | faster      | unresolved |   3 |
| lifecycle: mount 100 labels [construct + frame]                                           |   6.3131 |   5.6234 |   5.4840 |    0.882 |   1.000 | faster      | same       |   3 |
| lifecycle: mount 100 labels [construct + read]                                            |   7.5201 |   4.5834 |   4.4982 |    0.603 |   1.017 | faster      | same       |   3 |
| lifecycle: mount 100 labels [construct only]                                              |   2.6967 |   2.2259 |   2.1913 |    0.813 |   0.982 | faster      | same       |   3 |
| lifecycle: mount 1600 labels [construct + frame]                                          | 244.9660 |  89.7662 |  89.2990 |    0.365 |   0.995 | faster      | same       |   3 |
| lifecycle: mount 1600 labels [construct + read]                                           | 656.2896 |  67.4678 |  72.1496 |    0.110 |   1.069 | faster      | **slower** |   3 |
| lifecycle: mount 1600 labels [construct only]                                             | 119.3943 |  37.4765 |  36.6489 |    0.305 |   0.968 | faster      | same       |   3 |
| lifecycle: mount 200 labels [construct + frame]                                           |  12.4125 |   9.8226 |   9.8354 |    0.792 |   1.023 | faster      | same       |   3 |
| lifecycle: mount 200 labels [construct + read]                                            |  17.9710 |   7.9920 |   8.2662 |    0.457 |   1.039 | faster      | same       |   3 |
| lifecycle: mount 200 labels [construct only]                                              |   5.3823 |   3.8487 |   3.7674 |    0.700 |   0.987 | faster      | same       |   3 |
| lifecycle: mount 2000 labels [construct + frame]                                          | 351.9621 | 113.4881 | 111.9961 |    0.318 |   0.986 | faster      | same       |   3 |
| lifecycle: mount 2000 labels [construct + read]                                           | 989.4941 |  89.0510 |  90.4916 |    0.091 |   1.011 | faster      | same       |   3 |
| lifecycle: mount 2000 labels [construct only]                                             | 180.3119 |  52.5738 |  51.7654 |    0.287 |   0.991 | faster      | same       |   3 |
| lifecycle: mount 400 labels [construct + frame]                                           |  27.4557 |  19.1460 |  18.1991 |    0.674 |   0.984 | faster      | same       |   3 |
| lifecycle: mount 400 labels [construct + read]                                            |  52.3332 |  15.5995 |  15.8152 |    0.301 |   1.037 | faster      | same       |   3 |
| lifecycle: mount 400 labels [construct only]                                              |  12.8712 |   7.2942 |   7.0563 |    0.548 |   0.982 | faster      | same       |   3 |
| lifecycle: mount 800 labels [construct + frame]                                           |  72.7228 |  39.3082 |  37.5077 |    0.517 |   0.951 | faster      | same       |   3 |
| lifecycle: mount 800 labels [construct + read]                                            | 171.8869 |  30.8362 |  31.7181 |    0.185 |   1.038 | faster      | same       |   3 |
| lifecycle: mount 800 labels [construct only]                                              |  36.3972 |  15.1046 |  14.7321 |    0.405 |   0.975 | faster      | same       |   3 |
| prepared-operations: 1 labels first overwrite-before-scene-publication [setter + read]    |   0.1206 |   0.0437 |   0.0454 |    0.322 |   1.037 | faster      | same       |   3 |
| prepared-operations: 1 labels first overwrite-before-scene-publication [setter only]      |   0.0304 |   0.0349 |   0.0350 |    1.125 |   1.033 | unresolved  | same       |   3 |
| prepared-operations: 1 labels first same-value-set+measure                                |   0.0072 |   0.0158 |   0.0121 |    1.457 |   0.845 | **slower**  | unresolved |   3 |
| prepared-operations: 1 labels first same-value-set+scene-publication                      |   0.0280 |   0.0303 |   0.0259 |    0.923 |   1.052 | faster      | unresolved |   3 |
| prepared-operations: 1 labels first set+scene-publication                                 |   0.3705 |   0.3993 |   0.3907 |    1.051 |   1.058 | unresolved  | unresolved |   3 |
| prepared-operations: 100 labels first overwrite-before-scene-publication [setter + read]  |   0.1032 |   0.0438 |   0.0402 |    0.374 |   1.001 | faster      | same       |   3 |
| prepared-operations: 100 labels first overwrite-before-scene-publication [setter only]    |   0.0326 |   0.0422 |   0.0386 |    1.098 |   0.977 | unresolved  | same       |   3 |
| prepared-operations: 100 labels first same-value-set+measure                              |   0.0071 |   0.0104 |   0.0120 |    1.443 |   1.202 | unresolved  | unresolved |   3 |
| prepared-operations: 100 labels first same-value-set+scene-publication                    |   0.0654 |   0.0405 |   0.0403 |    0.616 |   0.993 | faster      | same       |   3 |
| prepared-operations: 100 labels first set+scene-publication                               |   0.5909 |   0.4804 |   0.4820 |    0.774 |   1.003 | faster      | same       |   3 |
| prepared-operations: 1000 labels first overwrite-before-scene-publication [setter + read] |   0.1782 |   0.0486 |   0.0463 |    0.260 |   0.918 | faster      | unresolved |   3 |
| prepared-operations: 1000 labels first overwrite-before-scene-publication [setter only]   |   0.0540 |   0.0436 |   0.0460 |    0.929 |   0.971 | unresolved  | same       |   3 |
| prepared-operations: 1000 labels first same-value-set+measure                             |   0.0071 |   0.0139 |   0.0130 |    1.678 |   0.962 | **slower**  | same       |   3 |
| prepared-operations: 1000 labels first same-value-set+scene-publication                   |   0.3844 |   0.1691 |   0.1651 |    0.406 |   0.976 | faster      | same       |   3 |
| prepared-operations: 1000 labels first set+scene-publication                              |   2.8696 |   1.2430 |   1.2578 |    0.430 |   1.012 | faster      | same       |   3 |
| stress: publish 1024 retained Text instances [setter + read]                              |  22.5950 |  12.8802 |  16.8816 |    0.747 |   1.310 | faster      | **slower** |   3 |
| stress: publish 1024 retained Text instances [setter only]                                |   1.8415 |   2.1783 |   2.2194 |    1.218 |   1.032 | **slower**  | same       |   3 |

## Files and commands

Everything is under `/Volumes/Depot/Developer/glyph-baselines-2026-11-23/`:

- `build-arms.sh`, `build-bisect.sh`: worktree builds and packs; logs in `logs/build*.log`; archives in `tarballs/<arm>/`.
- `harness/`: the five-arm copy of the 2026-11-22 browser harness (`run.mts --plan regress --arms … [--configs …]`,
  `setup.mts <arm> <tgz>`, `headline.js` with `read=size` and first-frame capture). Consumers in `harness/consumers/`.
- `run-headline.sh <out> <rounds> [configs] [arms]`; results in `headline/r1`–`r4` (15 rounds) and
  `headline/bisect52`; tables from `scripts/headline_final.py` and `scripts/bisect_table.py`.
- `bidi-edit/{main-vs-g52,g51-vs-g52}/`: `pnpm scripts run benchmark:headline-bidi-edit -- --baseline … --candidate …
--rounds 3 --output …` from `glyph-wt-regress`.
- `run-labs.sh 3 main g51 g52`: Labs rounds in `labs/round{1,2,3}/<arm>/candidate-0.1.0-<sha8>.json`;
  `scripts/labs_final.py` → `labs/final.csv` (all 220 rows, per-arm medians, paired ratios, verdicts).
- `run-labs-bisect.sh`, `run-labs-bisect-pre51.sh`, `run-labs-full-bisect.sh`: focused and full-suite bisect runs in
  `labs-bisect/`, `labs-bisect-pre51/`, `labs-full-bisect/`; `scripts/labs_attrib.py` builds the attribution table.
- `logs/sequence.log`: every step with UTC time and load average.

Worktrees: `/Volumes/Depot/Developer/glyph-scratch/regress/{g27,g42,g51,g52,c-cd31,c-dfb1}` (detached) with
`target-<arm>` Cargo targets beside them.
