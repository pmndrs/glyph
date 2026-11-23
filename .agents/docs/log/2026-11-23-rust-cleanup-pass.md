---
type: Log Entry
title: 'Rust cleanup pass on the 2026-11-22 audit'
generated:
  by: process:docs-new
  at: '2026-11-23T03:54:10Z'
---

Acted on the Rust findings of the [code-quality audit](../planning/code-quality-audit-2026-11-22.md) with no behaviour
change: each function the audit named as new, grown or worst was split into named steps, and the duplicated Wasm
host-ownership glue of the four bakers moved to one owner.

- Shaper: `screen_font` (257 to 4 cognitive), `compile_draw_spans` (233 to 21, `DrawSpanWalk`), line-break `decide`
  (173 to 1, one step per UAX #14 rule group), `position_fragment` (128 to 23), `reposition_retained_line` (95 to 14),
  `build_lines` (79 to 25, `PositioningSource` replaces the repeated input list), `position_segment` (58 to 1),
  `validate_style_topology_for_inputs` (65 to 9), `write_changed_ranges` (96 to 3, `BatchWrite`),
  `append_measurement_from_occurrences_source` (68 to 38), `splice_plan` (53 to 10) and `try_prepare_multi_run_shape`
  (40 to 12). The planner-input staging prologue copied into `prepare_paragraphs` is now `stage_planner_inputs`, and
  one-font whole-run reshaping is shared by the multi-run and realigned incremental shapes.
- Bakers: `rust/wasm-abi` (`pmndrs-glyph-wasm-abi`, `no_std`) owns the exact-pair allocation table, the published
  result, the once-initialized module state, header writes, the response-length bound and the allocation-evidence
  counter. Each baker keeps its exports, limits and response encoding; the bitmap and font bakers still accept
  `(0, 0)` as the empty input and MTSDF and Slug still refuse it. The crate is linted by the package check and tested
  by the package test.

Kimun over every `packages/glyph/rust/*/src` minus `generated/`: score 64.7 to 65.3 (D+), functions at 25 or more
80 to 71, duplication 4.72% to 4.11% (3,950 to 3,562 lines). The full native and Wasm layout oracles found no unlisted
divergence without a re-freeze, the UAX #14, #29 and #9 conformance suites pass, and the headline and mixed-bidi edit
A/B against `sil-green-52` stayed within noise.
