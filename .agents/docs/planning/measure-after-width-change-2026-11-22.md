---
type: Log
title: 'measure() right after a width change: main vs 0.2.0, 2026-11-22'
description: 'Stage-by-stage evidence for why a measure() that follows a width change costs about twice main on the 0.2.0 integration branch, the call path into the engine on both, and candidate fixes with expected savings. Evidence for a design discussion; nothing here is built.'
status: draft
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-22T13:30:00Z'
---

# measure() right after a width change: main vs 0.2.0, 2026-11-22 (UTC)

This page gathers evidence for a design discussion. Nothing was built for it.

## The gap

The width-sweep workload in `profile-harnesses/browser/headline.js` sets a new width, then calls `text.measure()`,
then publishes and renders the frame. Arms: `main` 4e25a96a against the integration tip 6f52cf03. Both ran in
the same browser build and alternated load by load, during a busy day on the machine (load average 9 to 33).

| per sweep step, median ms                                   | Latin 15k, main | Latin 15k, branch | stress 22k, main | stress 22k, branch |
| ----------------------------------------------------------- | --------------: | ----------------: | ---------------: | -----------------: |
| `measure()` call (headline, 3 loads each)                   |            0.24 |              0.50 |             0.29 |               0.65 |
| Wasm time inside that call (per-export clock, 2 loads each) |    0.15 to 0.17 |      0.36 to 0.38 |             0.22 |               0.49 |
| Wasm time in the frame's publication                        |            0.73 |              0.50 |             1.05 |               0.69 |
| Wasm time in measure plus publication                       |            0.89 |              0.87 |             1.27 |               1.18 |

The branch does not do more engine work per step. It does the same amount, or less, but **earlier**. On `main` the
read stops after flow layout, and the frame's publication then runs positioning. On the branch the read runs
positioning, and publication reuses it. The whole frame is already faster on the branch: sweep 3.17 against 3.36 ms
(Latin) and 3.63 against 3.85 ms (22k). The `measure()` call on its own costs about twice as much.

## Call path

Both versions share the host path down to the engine export:
`Text.measure()` (`src/three/text.ts`) → root `#measureText` → `ConfiguredHandle.measure()` →
`RetainedText.measure()` → `RenderPlanner._layoutText()` → `#assertTextQueryable()`. A text that a setter left dirty
goes on to `#prepareForRead()` → `#prepareAlone()` → `#prepareTextCandidate()` → `HandleState.prepareParagraph()`.
That calls the Wasm export `pmndrs_glyph_engine_measure_paragraph`, then `acceptPreparedMutation()` adopts the
result (`commit_measure`).

The two engines then diverge:

- **0.2.0 branch:** `wasm::prepare` → `TextEngine::prepare_paragraphs(PreparationTarget::One)`
  (`rust/shaper/src/engine/state/prepare_paragraphs.rs`) → `ParagraphState::prepare`. That function runs every
  staged stage, positioning included. The source comment reads "Preparation is durable independently of the result
  sidecar the host requested, so it always includes positioning". It then calls `append_paragraph_measurement`,
  which builds the summary from the positioned occurrences
  (`layout_query::append_measurement_from_occurrences_source`).
- **main:** `measure_paragraph_inner` checks first whether the request repeats a speculative transaction
  (`speculative_match`). It then calls `prepare_geometry_and_layout(position = false)`, which runs flow layout only:
  "Measurement answers at line level from flow and clusters; only a layout-inspection query needs the per-glyph
  positioning tail". `append_paragraph_measurement` sees that positioning is not prepared
  (`positioned_matches_flow == false`) and builds the summary at line level from the flow. Positioning runs later,
  in the frame's publication.

## Where the branch's read spends its time

Source: a CPU profile of the Latin 15k sweep on the branch, with function names from the shaper profile artifact,
taken inside `pmndrs_glyph_engine_measure_paragraph`. The read costs 0.338 ms of Wasm self time per step:

| part                              | ms per step | functions with the most self time                                                                                                                                       |
| --------------------------------- | ----------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| positioning                       |       0.142 | `RetainedOccurrenceProof::append` 0.033, segment positioning 0.023, `push_line_ink` 0.019, `build_lines` 0.011, `position_layout` 0.009, `append_occurrence_span` 0.008 |
| placement segments                |       0.050 | `ClusterArena::placement_segment_*` 0.012, `PlacementState::append_retained_*` 0.012, `RunLocalArena::source_range_counts` 0.013, `push_segment` 0.006                  |
| flow layout (lines, bands, rope)  |       0.082 | `layout_next_word_line_indexed` 0.019, `LineFit` 0.015, `compose_band` 0.010, rope append 0.013                                                                         |
| building the summary              |       0.020 | `append_measurement_from_occurrences_source` 0.007, `line_inline_extent` 0.004                                                                                          |
| other, shared helpers, allocation |       0.044 |                                                                                                                                                                         |

Host JavaScript adds about 0.06 ms per read on the branch (`prepareParagraph` and the summary decode). On `main`
the gap between the call and its Wasm time puts that figure at about 0.07 ms.

`main` was not profiled by function name. Its shipped shaper could not be rebuilt byte-identically with today's
toolchain, so `glyph:shaper-profile-artifact` refused it. Its per-export clock (0.15 to 0.17 ms) agrees with the
branch's flow-plus-summary share above (0.10 ms) plus the helpers both share, which fits a read that does not
position.

## What each read does that the other does not

| work on a read after a width change            | main                    | branch                                   |
| ---------------------------------------------- | ----------------------- | ---------------------------------------- |
| flow layout of the new width                   | yes                     | yes                                      |
| repeat-transaction check (`speculative_match`) | yes                     | no                                       |
| per-glyph positioning and placement segments   | no, runs in publication | yes, about 0.19 ms                       |
| summary built from                             | flow lines              | positioned occurrences                   |
| publication after the read                     | positions, then gathers | gathers from the positions the read made |

## Candidate fixes

1. **Stop a summary-only read after flow layout, as `main` does.** Run positioning and placement segments in the
   next publication, or in a later read that asks for glyphs or ink.
   - _Expected saving:_ about 0.19 ms per read on Latin 15k and about 0.27 ms on 22k (the same share of 0.49), which
     brings the read to roughly `main`'s 0.24 and 0.29 ms. Frame time stays about the same, because the work moves
     back into publication.
   - _Cost:_ a flow-level summary path, the equivalent of `main`'s `positioned_matches_flow` fallback. The oracle
     captures the positioned arena after measure-only steps, and those captures would no longer hold positions. An
     earlier attempt on this lane concluded this "would move published lanes of measure-only steps", so the change
     needs either a capture adapter or a re-freeze decision.
2. **Defer only the placement-segment build.** Placement segments are publication input and the summary does not
   read them.
   - _Expected saving:_ about 0.05 ms per read (Latin), with no change to the summary path. Lanes move only if the
     oracle captures placement after a measure-only step, which needs checking.
3. **Make width-change positioning cheaper where it stays on the read.** The two largest items are
   `RetainedOccurrenceProof::append` and `push_line_ink`, both per line. Proving retained occurrences per line
   instead of per glyph, and deriving line ink from the line's retained ink plus a translation, could save roughly
   0.03 to 0.05 ms per read.
   - _Caveat:_ this is an estimate, not a measurement. In a sweep almost every line after the first changed break
     rewraps, which limits what retention can reuse.

Fix 1 is the only one that reaches `main` on its own. Fixes 2 and 3 together recover about half the gap.

## Sources

- Headline rows: `glyph-scratch/gather/runs/merge` (3 rounds).
- Per-export clocks: `runs/mclock`.
- Profile: `runs/mprof/prof-sweep-latin15k-inter.branch.00.cpuprofile`, named with `named-branch/manifest.json`
  (built from the tip's packed artifact), aggregated with `tools/subtree2.py`.
- Code: `rust/shaper/src/engine/state/prepare_paragraphs.rs` on the branch; `measure_paragraph_inner` and
  `prepare_geometry_and_layout` in `rust/shaper/src/engine/state.rs` on `main` 4e25a96a.
