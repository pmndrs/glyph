---
type: Research Concept
title: Integer layout units end to end (scale-late)
description: Migration plan moving cluster advances, line fitting, justification, and positioning from scale-early f64 onto F26.6 integer layout units with one final scaling output, admitting the D-245 chunk kernels to production and making the per-glyph loops vectorizable.
documentation_type: explanation
status: draft
tags: [planning, engine, performance, simd, layout]
generated:
  by: 'anthropic/claude-fable-5'
  at: '2026-08-13T00:00:00Z'
sources:
  - id: line-kernels
    resource: ../../packages/glyph/rust/shaper/src/engine/line_kernels.rs
    title: Production SIMD lanes (D-245)
  - id: line-composition
    resource: ../../packages/glyph/rust/shaper/src/engine/line_composition.rs
    title: Line fitting
  - id: positioning
    resource: ../../packages/glyph/rust/shaper/src/engine/positioning.rs
    title: Glyph positioning
  - id: cluster-state
    resource: ../../packages/glyph/rust/shaper/src/engine/cluster_state.rs
    title: Cluster arena
---

# Integer layout units end to end (scale-late)

The pipeline is already integer where it is fast: HarfRust yields `i32` font-unit advances, the D-245 mask
kernels are production-admitted precisely because integer lanes reproduce the scalar result bit-for-bit, and
plan packing quantizes at the output edge. The float boundary is drawn one stage too early — cluster build
pre-scales advances into `f64` (`ClusterArena.advances: Vec<f64>`), so line fitting, justification, positioning,
and measurement all inherited serial f64 arithmetic. This plan moves the scaling to the output edge instead.

## Audit evidence this answers

- The measure/resize path spends ~84 ns per glyph (1.83 ms / 21,805 glyphs) on a handful of multiply-adds:
  indirection- and branch-bound, not compute-bound.
- An interleaved scalar-vs-simd128 A/B shows 8–14% gains on shaping-heavy lanes and 0% on the measure and
  column-resize lanes: nothing south of shaping vectorizes today.
- The chunk-64 advance-summary kernel exists and is lab-proven, parked by its own admission condition
  (`line_kernels.rs`): "until cluster advances gain a fixed-point representation (see D-245)".
- The innermost positioning loop resolves fonts through `BTreeMap` walks per cluster (metrics) and per glyph
  (extents), and gathers shaped glyphs through `glyph_indices` in shaping order.

## The unit system

**F26.6 layout units** (`i32`, 1/64 of a layout unit — the FreeType convention): every inline and block
advance, cursor, slot boundary, and extent inside flow fitting, justification, and positioning. One scale per
`(font_size, units_per_em)` pair converts font units to layout units at cluster build under a single documented
rounding contract — round-half-up, computed as `floor(value * 64 + 1/2)` — and that contract *is* the layout
definition. Tolerance statement: any value derived from a quantized quantity may differ from its pre-contract f64
equivalent by strictly less than one layout unit (1/64 px) per quantization; sums remain exact in f64 while total
magnitude stays below 2^53 layout units, a bound the engine's paragraph limits must keep enforced. `f32` appears exactly once,
at the semantic/measurement/plan emission boundary ("final scaling output"). Ranges: ±2^25 layout units
(±33.5 million px) bounds any paragraph; per-chunk sums fit `i32`, whole-thread sums accumulate in `i64`.

Integer addition is associative, so lane-reordered sums equal scalar sums exactly: the chunk-64 kernels meet
the cross-build exactness bar by construction, on the same terms as the shipped mask kernels.

## Slices (one stacked branch each)

1. **Registry flattening** — dense sorted font arrays with a last-hit memo replacing per-glyph `BTreeMap`
   walks; behavior-identical, no layout change. Floors the indirection cost before any unit changes.
2. **Integer cluster advances + line fit + kernel admission** — `ClusterArena.advances` to F26.6, the
   line-fit loop to integer accumulation, and the chunk-64 advance/break summaries into the production scan
   (fit skips whole chunks; the scalar tail preserves exact selection).
3. **Integer positioning + retained visual order** — integer pen cursors; visual order produced as a sort
   (packed bidi-level/index keys through the existing `sort` module) instead of per-glyph reorder gathers,
   retained across geometry changes and re-sorted only when re-shaping changes levels or cluster identity —
   after cold start a resize walks the retained order sequentially. The sorted permutation materializes a
   visual-order SoA stream (glyph id, advance, offsets, scale slot) so repositioning is a sequential
   transform; origins emit to dedicated columns and scale to f32 at the boundary.
4. **Integer justification** — word-space elasticity and letter expansion as integer per-gap adjustments
   (ratios applied by mul/shift), replacing per-gap f64.
5. **Contract re-derivation + evidence** — one deliberate re-pin of the paragraph conformance contracts under
   the rounding contract, verified against the independent oracles; lane A/Bs for every slice; decision row.

## Fixture discipline

Slice 5 is a contract change, executed once and reviewed: fixtures are re-derived because the layout unit
definition changed, with the independent shaping and paragraph oracles re-run against the new contract —
not regenerated to absorb an unexplained diff. Until slice 5 lands, slices 2–4 must hold results within the
documented rounding tolerance against the f64 path in dual-run tests, and bit-exact native-vs-wasm.

## Proof obligations

- Every slice: lane A/B (cold, font-size, column-resize, measure-query, suffix, splice) interleaved on one
  machine, plus native-vs-wasm exactness tests for the migrated stage.
- Slice 2: chunk-64 fit selects byte-identical break points to the scalar integer loop across the
  conformance corpus; line-fit lane time drops measurably on long paragraphs.
- Slice 3: resize repositioning streams without `glyph_indices` gathers (assert via the retained stream's
  reuse counter in tests); measure-query and column-resize lane medians drop; the 4 ms p95 width objective
  is re-evaluated for the committing frame, not just the query.
- Targets to verify, not promises: measure-query from ~1.8 ms toward 0.6–0.9 ms at 22k glyphs after slices
  1+3; committing resize frame p95 under 4 ms after slices 1–3.
