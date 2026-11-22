---
type: Log
title: 'measure() right after a width change: main vs 0.2.0, 2026-11-22'
description: 'Stage-by-stage evidence for why a measure() that follows a width change costs about twice main on the 0.2.0 integration branch, the call path into the engine on both, and candidate fixes with expected savings, why a spike of the first fix stopped, and alternative designs. Evidence for a design discussion; nothing here is landed.'
status: draft
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-22T13:30:00Z'
---

# measure() right after a width change: main vs 0.2.0, 2026-11-22 (UTC)

This page gathers evidence for a design discussion. Nothing was landed for it; a spike of fix 1 and why it stopped
are recorded below.

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

## Why fix 1 does not build as stated (spike, 2026-11-22, not landed)

A spike tried fix 1 on the integration branch after `sil-green-42` (scratch worktree, no commit). It hit two blockers.

### 1. A read commits its stages, and positioning needs the uncommitted pairing

On `main` a summary-only read leaves its flow as a speculative candidate. Publication then positions that
candidate against the committed state the last positioning was built from. On 0.2.0 a read is durable: the Wasm
`prepare` export calls `commit_measure` right after the summary is staged, and `commit_paragraphs` commits every
stage (text, clusters, shaping runs, flow, boundary shapes, geometry). Positioning that ran later would see
committed state that no longer matches the committed positioned arena.

`ParagraphState::prepare_positioned` (`rust/shaper/src/engine/state.rs`) builds the new arena with
`build_with_previous`. That call reads the previous side of every input from committed state:

- the committed positioned arena;
- `retained_flow` (the committed flow, when only geometry changed);
- `self.clusters.committed()` and `self.shaping_runs.committed()`;
- the committed `boundary_shape` beside the pending one;
- the committed geometry's typography;
- `pending_next_run_canonical_revision`.

It uses them for three things:

- **Line retention:** `RetainedOccurrenceProof` and `retain_edge_line`.
- **Canonical revisions:** `rebuild_replacement_runs` mints a revision for each replacement run.
- **Recomposition windows:** these feed gather and upload.

After a read commits, the committed positioned arena is one generation older than every other committed input. A
deferred positioning would therefore compare it against the new clusters, runs and boundary arena:

- retention proofs would compare unrelated rows;
- revisions would be minted against the wrong predecessor.

Running it with no predecessor (a cold rebuild) is correct, but it gives up retention. It also mints fresh
canonical revisions, so identity and wire lanes in the publication would move, not only lanes captured after the
read.

### 2. The summary needs per-line glyph counts, and only positioning knows them

`ParagraphLayoutSummary` exposes `glyphCount` and each line's `glyphStart` and `glyphCount`
(`src/internal/layout-query-view.ts`). On 0.2.0 these come from the positioned arena's
`semantic_line_glyph_spans`. `main` derived totals from the flow (`layout_query::visible_glyph_counts`).

The spike ported that walk per line (`flow_line_glyph_counts`):

- the drop cap, then each fragment;
- the lead island's source glyphs;
- retained clusters, skipping hard breaks;
- the cut island and ellipsis marker.

It also cross-checked every measurement the native oracle builds, `check --tier full`: 596 references plus 928
differential runs.

- **Line advances** from the flow (`line_inline_extent`) equalled positioning's `semantic_line_inline_extents` bit
  for bit, with no mismatch.
- **Glyph counts** disagreed in 2,426 measurements. The 16 reference cases where they disagree:
  - `para-latin-start`;
  - `para-devanagari-{start,center,end,justify}` and `para-bengali-{start,center,end,justify}`;
  - `label-devanagari-80-start`;
  - `label-devanagari-256-{start,center,end}` and `label-bengali-256-{start,center,end}`.

The differences are 1 to 5 glyphs per line, in both directions. Two causes were traced:

- **Corrected-break lead islands.** A line that starts at a corrected break draws its leading island shaped
  alone. Those glyphs come from the replacement run's run-local rows (`rebuild_replacement_run_local`), not from
  the boundary record's `source_glyph_count`, which is 0 for such a lead.
  - `para-latin-start`, line 78: positioning emits 2 island glyphs (1462, 1777) where the flow walk counts none.
  - `label-devanagari-80-start`, line 5: the island is the two glyphs of cluster 132 without its trailing
    space glyph (3).
  - The island can therefore have more or fewer glyphs than the clusters it replaces.
- **Hung trailing spaces.** `hanging_cluster_start` ends the drawn body before spaces hung past the line end. In
  `para-latin-start`, line 78, the hung space cluster 585 is not emitted.

A flow-level count would have to replay island shaping and hanging. That would be a second implementation of the
positioning glyph walk, kept in step by hand.

## Alternative designs for the brainstorm

Savings are estimated from the profile above: 0.19 ms Latin 15k, 0.27 ms stress 22k per read for positioning plus
placement segments. None is built.

| design                                                  | read after a width change          | frame     | references                                            | main risk                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------- | --------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Speculative read (main's model)                      | to main, about 0.24 / 0.29 ms      | unchanged | lanes captured after reads (ink, positioned arena)    | Reverses "preparation is durable". Needs a staged-transaction lifetime across calls, and a counting source for the summary (blocker 2 still applies) |
| B. Keep positioning's predecessor                       | to main                            | unchanged | lanes captured after reads only, if retention matches | Memory and bookkeeping for one more generation. Blocker 2 still applies                                                                              |
| C. Count where lines are composed, defer placement only | 0.45 Latin (−0.05), about 0.58 22k | unchanged | none expected                                         | Smallest win                                                                                                                                         |

- **A. Speculative read, as on `main`.** A summary-only read stages flow and does not commit it. Publication (or
  a later glyph read) adopts the staged candidate and positions it against the committed generation, as it does
  today. It still needs a glyph count for the summary; see C.
- **B. Keep positioning's predecessor across a read.** When a read commits without positioning, the inputs the
  committed positioned arena was built from are kept rather than overwritten: committed clusters, shaping runs,
  boundary arena, flow and typography. The deferred positioning then retains and mints revisions exactly as it
  would have.
  - This costs one extra retained generation of those arenas while a paragraph's positioning is pending; most
    arenas are swap-committed, so it can be a swap rather than a copy.
  - It still needs a glyph-count source for the summary (blocker 2).
- **C. Per-line glyph counts from flow composition, plus fix 2.** The flow composer already decides lead and tail
  islands, cuts and hanging, so it could record each line's semantic glyph count as it composes. That removes
  blocker 2 for A and B, and it matters on its own only with them.
  - The independent part is fix 2: build placement segments in publication instead of on the read. Expected about
    −0.05 ms per Latin read, with no reference change expected, since placement is not captured after a read.
    This needs checking.
  - Fix 3 (cheaper per-line retention proofs and line ink) adds an estimated −0.03 to −0.05 ms on either path.

Summary: only A or B reach `main`'s read time, and either needs C's counting source before the summary can skip
positioning. C with fixes 2 and 3 recovers about half the gap without touching the commit model.

## Sources

- Headline rows: `glyph-scratch/gather/runs/merge` (3 rounds).
- Per-export clocks: `runs/mclock`.
- Profile: `runs/mprof/prof-sweep-latin15k-inter.branch.00.cpuprofile`, named with `named-branch/manifest.json`
  (built from the tip's packed artifact), aggregated with `tools/subtree2.py`.
- Code: `rust/shaper/src/engine/state/prepare_paragraphs.rs` on the branch; `measure_paragraph_inner` and
  `prepare_geometry_and_layout` in `rust/shaper/src/engine/state.rs` on `main` 4e25a96a.
