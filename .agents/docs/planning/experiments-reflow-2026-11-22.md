---
type: Log
title: 'Reflow and placement experiments, 2026-11-22'
description: 'Spike-by-spike record of the width-change reflow and placement experiments on the layout refactor: hypothesis, measurement, verdict, and what landed.'
status: draft
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-22T11:30:00Z'
---

# Reflow and placement experiments, 2026-11-22

Lane `experiments/sil-exp-reflow`, cut from `experiments/segment-indexed-layout` at `ac4f9e4b9` (`sil-green-27`).
The plan is [segment-indexed-layout.md](segment-indexed-layout.md); the browser evidence this lane answers is
[benchmark-main-vs-0.2.0-2026-11-22.md](benchmark-main-vs-0.2.0-2026-11-22.md). Entries are appended; a discarded
spike keeps its numbers here and leaves no code on the branch.

## How the numbers are taken

`scripts/stage-bench.mjs --suite sweep` (added on this lane) replays the browser headline sweep inside the optimized
wasm32+simd128 oracle probe: the headline corpora, 8 px type, `maxWidth` 600 → 300 → 600 px in 4 px steps (150
steps), each step a publication followed by a measurement. It has no GPU, host JavaScript or upload, so a row is the
engine's share of the browser frame, not the frame. Each step's time is its minimum over the sweeps; a row is the
mean step. Two probes are timed interleaved, round by round, in one process (`--probe base=… --probe exp=…`).

Other lanes were building and benchmarking throughout (load average 8–19), so absolute values moved by several
percent between sessions. Compare the two arms of one row, not rows across tables.

### Where a sweep step goes before any experiment

Baseline `ac4f9e4b9`, wasm, mean step in µs. `kept` is the share of a step's lines whose break the previous width
already had; `prefix` is the share kept before the first changed line.

| sweep (start-aligned)  | lines | kept | prefix |  step | flow | positioning | measurement |
| ---------------------- | ----: | ---: | -----: | ----: | ---: | ----------: | ----------: |
| Latin 15k, Inter       |   224 |  81% |    20% | 1,018 |   66 |         205 |          17 |
| Latin 22k, Inter       |   317 |  81% |    20% | 1,454 |   96 |         294 |          24 |
| bidi 15k, Amiri        |   106 |  10% |     4% | 1,925 |   50 |         550 |           8 |
| CJK 15k, Noto Sans CJK |   280 |  49% |    49% | 1,151 |  184 |         136 |          21 |
| Latin 15k, Fredoka     |   213 |  82% |    20% | 1,400 |   69 |         257 |          16 |

The remainder of each step (about 70% on Latin) is the ordered plan and gather, which another lane owns. The
headline Latin corpus is short paragraphs separated by blank lines, so a 4 px step leaves four lines in five with
the break they had; the bidi corpus is one unbroken paragraph and keeps almost none. In the CJK sweep half the steps
change no break at all and the other half change every one.

A native sample of the Latin sweep (6 s, `sample`) puts positioning at 21.5% of the step: 7.1% copying kept lines
(`append_retained_line_validated`, of which the occurrence proof is 5.7%), 7.1% positioning the changed fifth
(`position_fragment`), 2.1% matching lines to the old flow. Flow is 7.6%, of which the fitter is 3.2%.

## Experiment 1: validity interval for line fits — landed

**Hypothesis.** A fit reads the measure only through width tests. If it records the widest width it admitted and the
narrowest it refused, any measure between them takes the same branches from the same cursor and composes the same
line. A width change then reuses every such line without running the fitter, and resumes reuse wherever the cursor
lands on an old line start again, which a hard break guarantees.

**Why it is exact.** The three places that compared a width to the measure (`fits_seeded`, `fits`, and the
character-wrap test) now go through one method, `LineFit::within`, which is the only read of the measure in the fit.
The recorded range is therefore a proof for the corrected rules (seed, rescue, step-back, whole-line totals) and all
three kernels without modelling any of them. A reused line still advances the cursor through the same code a fit
does, and the build loop around it (slots, bands, extents, block positions) is unchanged, so only the walk is
skipped. Reuse is offered only when the geometry alone changed; text, styles, bidi, shaping and clusters are the
committed ones.

**Spike size.** 200 lines of engine code in `line_composition.rs`, `flow_composition.rs` and `state.rs`, and two
tests: every fit of the corrected corpus is re-run at the edges of its range, just outside them and at nearby
measures (word and character wrap, shrink, three kernels), and a flow built from the previous width's fits is
compared with a whole build across eleven width changes.

**Measured** (wasm, mean step µs, base / experiment, interleaved, 3 rounds of 6 sweeps, load 8–14):

| sweep                    | flow          | step              | step change |
| ------------------------ | ------------- | ----------------- | ----------: |
| Latin 22k start          | 102.9 / 74.9  | 1,547.5 / 1,507.5 |       −2.6% |
| bidi 15k start           | 55.6 / 54.1   | 1,965.7 / 1,967.0 |        0.1% |
| CJK 15k start            | 182.2 / 119.6 | 1,145.9 / 1,077.3 |       −6.0% |
| Latin 15k start, Fredoka | 70.2 / 49.5   | 1,404.3 / 1,396.5 |       −0.6% |
| Latin 15k centre         | 68.3 / 48.7   | 1,451.1 / 1,430.8 |       −1.4% |
| Latin 15k end            | 67.1 / 47.8   | 1,437.3 / 1,411.8 |       −1.8% |
| Latin 15k justify        | 67.9 / 46.0   | 1,440.4 / 1,424.6 |       −1.1% |
| bidi 15k justify         | 51.3 / 50.2   | 2,181.0 / 2,191.5 |        0.5% |

Flow is 27–32% cheaper wherever lines are kept (Latin, all alignments) and 34% cheaper on CJK; it is unchanged on
the bidi corpus, which keeps no lines. The step moves by what flow saves: 14–40 µs on Latin, 69 µs on CJK. In the
browser frame (3.25 ms on Latin 15k) that is under 1%, so this alone does not close the gap to main.

Edit and other rows (`--suite layout`, 15k, start, minimum µs, base / experiment, load 17–19):

| fixture   | edit                | width, same breaks | width, moved breaks | alignment change  |
| --------- | ------------------- | ------------------ | ------------------- | ----------------- |
| Inter     | 2,978.8 / 2,847.0   | 172.3 / 134.2      | 1,773.4 / 1,749.4   | 1,389.7 / 1,367.7 |
| Fredoka   | 3,171.3 / 3,205.0   | 1,010.3 / 971.3    | 2,014.5 / 2,010.2   | 1,582.4 / 1,517.8 |
| Amiri     | 15,914.6 / 16,043.9 | 1,541.8 / 1,474.1  | 2,388.5 / 2,374.4   | 1,769.7 / 1,649.4 |
| bidi      | 22,547.2 / 21,828.5 | 1,919.0 / 1,807.3  | 3,398.5 / 3,332.9   | 1,952.8 / 1,902.0 |
| CJK       | 3,857.0 / 3,886.5   | 1,190.8 / 1,019.1  | 2,082.9 / 2,050.5   | 1,772.2 / 1,585.0 |
| drop cap  | 2,928.5 / 2,882.5   | 955.1 / 901.6      | 1,844.1 / 1,805.7   | 1,530.5 / 1,471.7 |
| exclusion | 2,915.4 / 3,011.0   | 224.8 / 174.3      | 1,887.6 / 1,905.6   | 1,468.2 / 1,418.3 |

Edits are within the session's noise in both directions (−4% to +3%); the only work an edit gains is one 104-byte
record per composed line. A width change that moves no break is 4–22% cheaper.

**Re-measured after merging `experiments/segment-indexed-layout` at `75c03af21`** (culling and bidi class lanes),
base `75c03af21` against the experiment, both with the sweep bench. Stage bench, wasm, mean step µs, interleaved,
3 rounds of 6 sweeps, load 16–44:

| sweep                    | flow          | step              | step change |
| ------------------------ | ------------- | ----------------- | ----------: |
| Latin 15k start          | 66.2 / 46.1   | 1,010.2 / 1,003.1 |       −0.7% |
| Latin 22k start          | 98.7 / 70.6   | 1,490.5 / 1,468.5 |       −1.5% |
| bidi 15k start           | 56.5 / 56.2   | 2,036.9 / 2,006.2 |       −1.5% |
| CJK 15k start            | 189.3 / 119.0 | 1,198.5 / 1,075.9 |      −10.2% |
| Latin 15k start, Fredoka | 70.2 / 47.1   | 1,476.6 / 1,403.0 |       −5.0% |
| Latin 15k justify        | 66.7 / 45.9   | 1,463.6 / 1,450.9 |       −0.9% |
| bidi 15k justify         | 52.5 / 51.6   | 2,311.2 / 2,312.7 |        0.1% |

The browser headline harness (`glyph-baselines-2026-11-22/profile-harnesses/browser`, plan `headline`, 3 loads per
arm, strict A/B rounds, load 18–49) sees no difference on any row: complete frame, per-step median ms, base /
experiment, sweep Latin 15k 3.60 / 3.66, 22k 4.28 / 4.35, bidi Amiri 5.06 / 4.93; edits (type-end, insert,
delete, paste at 15k and 22k) and ASCII all within 0.96–1.03 with overlapping loads. The engine saves 20–30 µs of
a 3.6 ms Latin frame, below this session's spread (up to 9%). Stage-bench `--suite layout` edit and cold rows
repeated three times stay within noise in both directions; width changes that move breaks may cost about 1%
(recording plus a failed match per line), not separable from noise at this load.

**Cost.** Memory: 104 bytes per line fragment in each of the two staged flows, about 47 kB for the 224-line Latin
15k paragraph against roughly 3.9 MB of cluster lanes. Shipped wasm (simd, after Binaryen): 1,668,110 → 1,671,652
bytes raw (+3,542), 654,092 → 655,260 gzip (+1,168). After the merge, the packed `dist/text-shaper.wasm` is
1,669,487 → 1,673,029 raw (+3,542), 648,156 → 649,750 `gzip -9` (+1,594).

**Verdict.** Faster where lines are kept, equal elsewhere, output unchanged: landed. The plan's objection to this
idea ("the chance a 1 px step stays inside it is about 2 in a million at 518 lines") is about reusing the whole
paragraph; reuse per line, resumed at hard breaks, is what pays. It does not move the browser frame, so the headline
sweep gap to main (Latin 15k 3.25 against 2.95 ms) lies elsewhere: positioning and the ordered plan and gather.

## Not yet run

Sizes of prize below are read off the tables above, so they are ceilings, not results.

| experiment                                     | ceiling and constraint                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2. Advance pyramid, fit by search              | The fitter is 3.2% of a Latin sweep step before experiment 1 and runs for one line in five after it; cold, it is about 25 µs of a 6.6 ms mount. A search must still consult corrections (the predicate is not monotone), so the spike is a prefix-sum lane over word records with the exact loop resumed at the first overflow. |
| 3. Integer pen                                 | The plan's model measured it no faster cold and changing f64 outputs, which would move oracle references. To be run as: does any reference lane move; if so it is reported, not landed.                                                                                                                                         |
| 4. Affine placement                            | Kept lines cost 9% of a Latin sweep step in positioning (copy and proof) and the changed fifth another 9%. The prize is the copy; it needs retained lines shared between the staged arenas, not rewritten, and an origin column in what gather reads.                                                                           |
| 5. Content-anchored blocks                     | Targets edits; the plan records that it changes golden bytes.                                                                                                                                                                                                                                                                   |
| 6. Resize shortcut for lines with edge records | A width change that moves no break costs 0.13 ms on Inter and 1.0–1.8 ms on Fredoka, CJK and drop caps, because the equivalence proof rejects any line with an edge record or a drop cap and positioning, gather and publication then run in full. Half the steps of the CJK sweep are such steps.                              |
