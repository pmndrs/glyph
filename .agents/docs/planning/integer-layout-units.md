---
type: Research Concept
title: Integer layout units (historical migration and current seam)
description: Records the completed F26.6 decision-lane migration, its later 16-fraction-bit i64 refinement, and the deliberately retained f64 positioning pen.
documentation_type: explanation
status: stable
tags: [planning, engine, performance, simd, layout]
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-09T02:02:17Z'
sources:
  - id: line-kernels
    resource: ../../../packages/glyph/rust/shaper/src/engine/line_kernels.rs
    title: Production SIMD lanes (D-245)
  - id: line-composition
    resource: ../../../packages/glyph/rust/shaper/src/engine/line_composition.rs
    title: Line fitting
  - id: positioning
    resource: ../../../packages/glyph/rust/shaper/src/engine/positioning.rs
    title: Glyph positioning
  - id: cluster-state
    resource: ../../../packages/glyph/rust/shaper/src/engine/cluster_state.rs
    title: Cluster arena
  - id: fragment-relative-reflow
    resource: fragment-relative-reflow.md
    title: Fragment-relative reflow and LayoutRun placement
---

# Integer layout units (historical migration and current seam)

This document records the completed D-254 migration and one deliberately open numeric seam; it is not an active
implementation plan. The migration introduced F26.6 per-cluster decision values, exact integer line fitting, and integer
justification while retaining the `f64` advance and positioning pen. PR #134 subsequently raised the decision lane to
16 fractional bits stored in `i64` so tiny renderer-local font sizes retain useful precision without giving up the prior
large-coordinate range.

The current contract is three-domain: line-break and justification decisions use the 16-fraction-bit `i64` lane;
positioning accumulates and resynchronizes against `ClusterArena.advances: Vec<f64>`; semantic, query, Codec, and renderer
geometry narrows to `f32`. The [fragment-relative reflow plan](fragment-relative-reflow.md) must preserve that behavior.
Moving the pen into fixed point remains a separate, output-changing migration with its own acceptance and re-pin cost.

## Audit evidence this answers

- The measure/resize path spends ~84 ns per glyph (1.83 ms / 21,805 glyphs) on a handful of multiply-adds:
  indirection- and branch-bound, not compute-bound.
- An interleaved scalar-vs-simd128 A/B shows 8–14% gains on shaping-heavy lanes and 0% on the measure and
  column-resize lanes: nothing south of shaping vectorizes today.
- The chunk-64 advance-summary kernel exists and is lab-proven, parked by its own admission condition
  (`line_kernels.rs`): "until cluster advances gain a fixed-point representation (see D-245)".
- The innermost positioning loop resolves fonts through `BTreeMap` walks per cluster (metrics) and per glyph
  (extents), and gathers shaped glyphs through `glyph_indices` in shaping order.

## Current unit system

One decision unit is 1/65,536 of a caller-space unit. `layout_units_from_scaled(f64) -> i64` applies the single
round-half-up contract `floor(value * 65,536 + 1/2)` and bounds caller-derived magnitudes to ±2^53 integer units so their
conversion back to `f64` is exact. Per-cluster values, chunk summaries, line fitting, and justification totals all use
`i64`. The compact word-break sidecar alone stores a segment in `i32` and falls back to the exact chunk/scalar path when
that range is exceeded.

This is not an integer-position contract. Shaped advances and the intra-line cursor remain `f64`; glyph and cluster
positions narrow once to the public `f32` output. Repository prose calls the decision lane F16.16 to emphasize its 16
fractional bits, although the retained `i64` storage is wider than conventional 32-bit F16.16.

Integer addition is associative, so lane-reordered sums equal scalar sums exactly: the chunk-64 kernels meet
the cross-build exactness bar by construction, on the same terms as the shipped mask kernels.

## Historical slices and actual disposition

1. **Registry flattening** — dense sorted font arrays with a last-hit memo replacing per-glyph `BTreeMap`
   walks; behavior-identical, no layout change. Floors the indirection cost before any unit changes.
2. **Integer cluster advances + line fit + kernel admission** — the historical F26.6 decision lane, the
   line-fit loop to integer accumulation, and the chunk-64 advance/break summaries into the production scan
   (fit skips whole chunks; the scalar tail preserves exact selection).
3. **Retained positioning stream** — the adjacency-order glyph stream and topology-aware metric refresh landed, but the
   planned integer pen did not; positioning retained the `f64` cursor described below.
4. **Integer justification** — word-space elasticity and letter expansion resolve to integer per-gap adjustments. Review
   replaced the proposed fixed-point ratio multiply/shift with one exactly applied `f64` ratio followed by the shared
   round-half-up conversion.
5. **Contract re-derivation + evidence** — one deliberate re-pin of the paragraph conformance contracts under
   the rounding contract, verified against the independent oracles; lane A/Bs for every slice; decision row.

## Fixture discipline

The contract changes were executed once and reviewed: fixtures were re-derived because the layout-unit definition
changed, with independent shaping and paragraph oracles run against the new contract rather than regenerated to absorb an
unexplained diff. The later 16-fraction-bit migration followed the same discipline and retains exact native/Wasm decision
parity.

## Historical proof obligations

- Every slice: lane A/B (cold, font-size, column-resize, measure-query, suffix, splice) interleaved on one
  machine, plus native-vs-wasm exactness tests for the migrated stage.
- Slice 2: chunk-64 fit selects byte-identical break points to the scalar integer loop across the
  conformance corpus; line-fit lane time drops measurably on long paragraphs.
- Slice 3: resize repositioning streams without `glyph_indices` gathers (assert via the retained stream's
  reuse counter in tests); measure-query and column-resize lane medians drop; the 4 ms p95 width objective
  is re-evaluated for the committing frame, not just the query.
- Targets to verify, not promises: measure-query from ~1.8 ms toward 0.6–0.9 ms at 22k glyphs after slices
  1+3; committing resize frame p95 under 4 ms after slices 1–3.

## Separate deferred migration: the integer pen

The remaining number-system seam was deferred deliberately at D-254 closure: layout decisions resolve in the
16-fraction-bit `i64` lane, but the intra-line pen still accumulates per-glyph scaled `f64` advances and resynchronizes at
each cluster boundary against the authoritative `f64` advance lane. Justification adjustments remain exact dyadic
multiples of 1/65,536 when converted to `f64`. This is a conceptual and memory seam, not a correctness defect.

Scope if separately accepted: cursor in the 16-fraction-bit `i64` domain; per-glyph advances quantized at the adjacency stream; origins
emitted as units; the f64 `advances` lane DELETED outright (8 bytes per cluster and the dual-lane resync
with it); alignment centering (`available * 0.5`) gains its own quantization site under the same
round-half-up contract. Costs: per-glyph quantization moves origins sub-unit, so the full conformance,
contract, and composed-hash re-pin cascade applies — schedule it as its own re-pin slice with the corpus
re-derivation statement discipline slices 2b and 4 established. Gains: one lane, one domain, positions
bit-derivable from integers end to end.

A sibling follow-up recorded here so neither is lost: the engine state machine's prepared/pending boolean
lattice (ten stages plus speculative and intrinsic pairings) is implicit state that produced one live
regression and one review finding during slices 3–5; the maintainability pass should model it as an
explicit enum making invalid flow/positioning pairings unrepresentable, per the engineering standard's
explicit-state rule. Run it through the repository maintainability-review skill as the first post-merge
cleanup slice, together with a direct dual-derivation assertion that positioned-lane and flow-derived
glyph counts agree (today proven only transitively through the commit-parity test).

**Status: the state-machine half is DONE (D-258).** Every stage is a `Staged<T>` — committed value,
pending replacement, and prepared flag behind one field — and `ParagraphState` carries no `*_prepared`
field at all. The invalid pairing is encoded rather than guarded: staging a flow drops the positioning
that described the previous one, so stale positioning over a re-run flow is unrepresentable and the guard
that repaired it is deleted. Lanes are unchanged (interleaved three-round A/B at 22,000 glyphs, every lane
inside noise). The dual-derivation glyph-count assertion is now covered directly by the sequence property
gate, which asserts per step that the per-glyph inspection lane and the line-level measurement lane agree.

The integer pen remains open and is unaffected by that work. It is not part of the fragment-relative run cutover unless
a later decision explicitly accepts the position changes and full corpus re-derivation.
