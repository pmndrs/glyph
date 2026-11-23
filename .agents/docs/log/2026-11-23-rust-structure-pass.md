---
type: Log Entry
title: 'Rust structure pass: engine module splits and function steps'
generated:
  by: process:docs-new
  at: '2026-11-23T19:05:47Z'
---

Branch `experiments/sil-structure` from `experiments/segment-indexed-layout` (`0c66aeaed`) restructures the shaper engine
with no behaviour change, to raise the Kimun health score of our Rust.

- File splits (pure moves; types stay in the parent, private items become `pub(super)` and `pub(super)` items
  `pub(in crate::engine)`, so every item keeps its reach): `engine::state` (9,361 lines outside tests) into 25 child
  modules by responsibility (registry and roots, update and publication, measurement, gather, planner inputs, order,
  lifecycle and placement, the paragraph stage pipeline and the inline path); `positioning` (5,497, whose `#[path]`
  children `ink` and `segments` move under `positioning/`), `ordered_plan`, `codec_gather`, `cluster_state` and
  `flow_composition`.
- Functions broken into named steps (cognitive complexity before to after): `prepare_update_inner` 118 to 8 (an
  `UpdatePass` carries what the request fixed), `layout_next_line_integer_scalar` 102 to 11 (a `ScalarScan` of the
  running sums; per-cluster steps are `#[inline(always)]`), `rebuild_until_state_converges` 93 to 9 (a `Convergence`
  of the fixed inputs; one `clear()` on divergence), `prepare_placement_slots` 66 to 1, `prepare_shape` 62 to 9,
  `prepare_complete_topology` 56 to 5, `RetainedOccurrenceProof::append_inner` 55 to 6,
  `rebuild_source_run_if_topology_is_stable` 54 to 4, `reflag_breaks` 46 to 2 and `commit_paragraphs` 46 to 5.
- The extracted single-caller steps are `#[inline(always)]`: as separate functions they moved LLVM's inlining and grew
  the core shaper by about 2 kB raw.

Kimun over every `packages/glyph/rust/*/src` minus `generated/`: score 65.4 (D+) to 76.1 (C+); cognitive complexity
42.6 to 55.1, Halstead effort 54.3 to 71.1, file size 55.5 to 81.2, indentation 86.3 to 89.9, duplication 100.

Core shaper (package flags, gzip 9): raw 1,409,531 to 1,410,273 B (+742), gzip 565,121 to 567,113 B (+1,992,
+0.35%). Pure moves alone changed gzip by +360 to +690 B each with raw −20 to −110 B: function order follows module
order, so most of the gzip delta is layout. The full native and Wasm layout oracles found no unlisted divergence without
a re-freeze; `cargo test --features oracle` (UAX #9, #14, #29 conformance included), clippy `-D warnings`, the package
test and the repository check pass; `benchmark:v1-bitmap` and `benchmark:typegpu-parity` pass.

Headline A/B (two runs of five interleaved loads against the same base build): every layout row within 10% and every
frame row within 5% in at least one run; the single-run outliers (stress22k `type-end` frame 1.083 then 0.952, bidi15k
`paste-middle` frame 1.001 then 1.078) did not repeat. The mixed-bidi edit benchmark (six rounds) read 0.84 to 1.06
with overlapping load ranges.
