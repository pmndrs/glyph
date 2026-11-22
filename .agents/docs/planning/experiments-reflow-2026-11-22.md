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

## Experiment 4: affine placement — landed as line retention by arena identity

Run after merging the integration tip `4a6dd0caa` (`sil-green-34` candidate: experiment 1 and the scoped-reflow
gather, `61a797408`). Base is that tip; every number below is interleaved base / experiment.

**What already exists.** Placement is affine at segment granularity on both sides of publication. A glyph's
position is its run-local ink origin plus the translation of its placement segment (`PlacementState`,
`SegmentTranslation`); the semantic row carries the segment's placement slot, and gather adds the slot's
translation (`plan_glyph_placement`) or publishes it as a placement-slot row the renderers apply. A line whose
content is unchanged but whose numbers moved is repositioned per pen step (`reposition_retained_line`), not per
glyph, and the scoped-reflow gather already skips regathering rows whose projection did not change. The headline
sweep uploads about 15 kB a frame against 450–1,000 kB for an edit, which is that design working. A per-line origin
would only collapse a line's two or three segment translations into one.

**Where positioning goes.** A native sample of the Latin 15k sweep at the tip: 36% of positioning is admitting
exactly retained lines (`append_retained_line_validated`, of which the occurrence proof is 22%), 35% positions the
lines whose breaks changed, 10% matches lines to the old flow, 7% unions line ink, 4% repositions moved lines. The
proof re-derives each retained span's run, glyph range, outline count and outline bit pattern from the new cluster
arena, which is what an edit needs. A width change prepares no cluster stage, so positioning reads the committed
arena on both sides and every one of those checks compares a value with itself.

**Spike.** When both sides are the same cluster arena (`core::ptr::eq`) and a paragraph span keeps its run index and
canonical revision, the span is appended with its new segment and line and nothing else is re-proved: the line
moves as a unit. Boundary and replacement spans, and any span whose run changed, take the full proof. 40 lines in
`positioning.rs`; the exclusion-band retention test now also asserts that a geometry-only change makes no outline
comparison (it fails, 12 against 0, without the shortcut).

**Measured.** Stage bench, wasm, mean step µs, 3 rounds of 6 sweeps, load 8–22:

| sweep                    | positioning   | step              | step change |
| ------------------------ | ------------- | ----------------- | ----------: |
| Latin 15k start          | 201.5 / 181.5 | 790.8 / 782.1     |       −1.1% |
| Latin 22k start          | 292.9 / 259.5 | 1,154.7 / 1,123.9 |       −2.7% |
| bidi 15k start           | 542.4 / 537.4 | 1,912.0 / 1,910.9 |        0.0% |
| CJK 15k start            | 128.4 / 125.7 | 1,041.0 / 1,044.7 |        0.4% |
| Latin 15k start, Fredoka | 250.0 / 223.4 | 1,373.6 / 1,366.5 |       −0.5% |
| Latin 15k centre         | 214.1 / 211.3 | 1,229.6 / 1,213.6 |       −1.3% |
| Latin 15k justify        | 252.2 / 240.8 | 1,211.1 / 1,194.2 |       −1.4% |
| bidi 15k justify         | 662.1 / 664.9 | 2,241.0 / 2,257.0 |        0.7% |

Positioning is 10–11% cheaper on start-aligned Latin and Fredoka, where most kept lines are exactly retained;
centre and end move every line's inline origin, so their kept lines take the numeric repass instead and gain
little. The browser headline harness (3 loads per arm, load 7–24) sees every row as the same: sweep Latin 15k 2.88
/ 2.96 ms, 22k 3.41 / 3.31, bidi Amiri 4.96 / 4.97, edits 0.98–1.06 with overlapping loads (spreads to 12%).
Stage-bench edit rows repeated twice at 15k and 22k stay within ±3% in both directions; an edit prepares the cluster
stage, so it never takes the shortcut. Wasm: 1,695,610 → 1,696,609 raw (+999), 659,080 → 659,484 `gzip -9` (+404).
No memory change.

**Verdict.** Faster in positioning, equal in the frame, output unchanged: landed.

**What publication would need for line-level affine placement** (not built; gather is another lane's):

1. From positioning, per committed line: whether it was retained as a unit, and the old→new segment remap
   (`RetainedSegmentRemap`: previous start, next start, count). The remap already exists inside
   `append_retained_line_validated`; it would be kept per line instead of dropped.
2. With that, gather could rewrite a retained line's rows by outlined range, changing only the placement slot,
   instead of pairing rows by identity. The outlined intervals that were positioned afresh are already exported as
   `unpublished_source_intervals()`; the retained ones are their complement.
3. A per-line origin column (one translation per line, segments carrying in-line offsets) is not needed for
   start, centre or end: segment translations already move as a group, and a line has two or three. It would help
   only if placement slots were made per line, which changes the wire's slot count and every renderer's slot table.

## Experiment 6: resize shortcut for lines with edge records and drop caps — landed after a re-freeze

Run after merging the integration tip `c9ce9ec4b` (`sil-green-36`). Base is that tip.

**Hypothesis.** The geometry-only resize shortcut (`flow_positioning_equivalent`) proves that a new flow
positions bit-identically to the committed one and then skips positioning, gather and publication. It refused any
flow with an edge record or a drop cap, so on fonts with corrected breaks (Fredoka, Noto Sans CJK) and on drop-cap
paragraphs a width change that moves no break ran the whole tail. Positioning reads an edge record by its index
into the boundary arena, and a drop cap from its own line and fragment. If the new flow names the same record
indexes and its boundary arena equals the committed one (records, glyph lanes and stable ids), committing either
arena leaves the committed positioning true; a drop cap equal field for field, with its line numbers and slot
compared bit for bit, is positioned identically.

**Spike.** About 70 lines of engine code: `BoundaryShapeArena::same_as`, edge and drop-cap admission in the proof (the arena comparison
runs at most once, and only when a fragment has an edge), and the state caller passing both arenas. A unit test
admits an edge flow over equal arenas and refuses a reshaped island, a line that gained an edge, and an island
whose glyphs took other stable ids. The first build cost a plain Inter `width.same` 3–5 µs (2–4%, repeated three
times); inlining the shared line comparison brought it back to equal.

**Measured** (stage bench, wasm, interleaved, load 6–8). Layout suite at 15k, minimum µs, base / experiment:

| fixture   | width, same breaks | edit                | width, moved breaks | cold                |
| --------- | ------------------ | ------------------- | ------------------- | ------------------- |
| Fredoka   | 927.7 / 151.5      | 2,900.1 / 2,961.9   | 1,965.2 / 1,953.0   | 4,957.1 / 5,145.8   |
| CJK       | 994.3 / 261.7      | 3,444.8 / 3,418.3   | 2,045.3 / 2,021.4   | 6,062.8 / 6,028.9   |
| drop cap  | 600.2 / 136.1      | 2,591.6 / 2,635.5   | 1,555.7 / 1,562.9   | 6,626.5 / 6,417.4   |
| Inter     | 132.2 / 133.2      | 2,556.8 / 2,551.0   | 1,537.5 / 1,535.1   | 6,352.5 / 6,296.7   |
| exclusion | 180.2 / 175.0      | 2,704.1 / 2,738.4   | 1,633.8 / 1,634.8   | 6,551.7 / 6,526.7   |
| Amiri     | 1,228.8 / 1,231.4  | 14,277.8 / 14,211.5 | 2,303.4 / 2,293.3   | 14,679.1 / 14,474.2 |

A width change that keeps every break is 74–84% cheaper on Fredoka, CJK and drop caps. Edits, moved breaks and
cold rows never reach the shortcut (the cluster stage is prepared) and stay within ±4% in both directions. Amiri
and the bidi fixture gain nothing: a right-to-left paragraph's start edge is the slot end, so every line's pen moves
with the width; that is the numeric repass's job, not this proof's.

Sweep suite, mean step µs: CJK 1,004.3 / 870.0 (−13%), Fredoka 1,299.1 / 1,155.9 (−11%); Latin, bidi and the
other alignments are equal (within 1%), since their kept breaks rarely leave a whole step unchanged.

**Gate.** Incremental equals cold everywhere (differential: 912 runs, no unlisted divergence) and the glyph
values are unchanged, but three frozen references move: `font-fredoka-start`, `font-source-serif-start` and
`label-fredoka-80-start`. `layout-oracle diff` against the base locates every difference in two places, both of
which exist because the tail no longer runs on a step whose breaks did not move:

- `positioned.replacement_run.canonical_revision` and, from the next edit on, `cluster.layout_run.canonical_revision`
  (identity class): the skipped positioning no longer mints new revisions for the edge-record replacement runs, so
  every later revision is lower by the count it skipped (29 against 14 at step 02, 76 against 61 at step 05).
- `wire.publication` (wire class) at the unchanged step: row 12 is 0 instead of 2, the frame publishing nothing
  where it republished.

Matching the references would mean minting those revisions and republishing without positioning, which undoes the
shortcut. The rule for this lane is that an experiment that needs a reference to move is reported, not landed, so
the code was removed; the patch is kept outside the repository (`glyph-scratch/exp-reflow/exp6-edge-shortcut.patch`,
about 220 lines with its unit test).

**Verdict.** Faster on corrected-break fonts and drop caps (74–84% on an unchanged-break width change, 11–13% of a
CJK or Fredoka sweep), equal elsewhere, typographic output unchanged; not landed because it moves three references'
identity and wire classes. Landing it is an owner decision: re-freeze those three references, accepting that a
no-op resize keeps run revisions and publishes nothing for edge-record paragraphs as it already does for plain ones.

**Landed (2026-11-22, branch `experiments/sil-refreeze`).** The owner approved the re-freeze. The patch applied
unchanged on top of `sil-green-42` and the grapheme-run and empty-ink fixes. `layout-oracle diff` against the tree
before it moved exactly the three references named above, and only in the two places above: 14 identity digests
(`positioned.replacement_run.canonical_revision` in 12 step captures, `cluster.layout_run.canonical_revision` in 7,
every changed row lower than before) and 3 wire digests (`wire.publication` row 12, 2 to 0, once per case on the
width step that kept every break). No value or representation lane moved. Native and wasm oracles equal after the
re-freeze, with no unlisted divergence.

## Not yet run

Sizes of prize below are read off the tables above, so they are ceilings, not results.

| experiment                        | ceiling and constraint                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2. Advance pyramid, fit by search | Skipped after experiment 4: flow is about 46 µs of a 782 µs Latin step (6%), so a search could save at most that. The fitter is 3.2% of a Latin sweep step before experiment 1 and runs for one line in five after it; cold, it is about 25 µs of a 6.6 ms mount. A search must still consult corrections (the predicate is not monotone), so the spike is a prefix-sum lane over word records with the exact loop resumed at the first overflow. |
| 3. Integer pen                    | The plan's model measured it no faster cold and changing f64 outputs, which would move oracle references. To be run as: does any reference lane move; if so it is reported, not landed.                                                                                                                                                                                                                                                           |
| 5. Content-anchored blocks        | Targets edits; the plan records that it changes golden bytes.                                                                                                                                                                                                                                                                                                                                                                                     |
