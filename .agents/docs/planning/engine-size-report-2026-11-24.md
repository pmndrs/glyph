---
type: Research Note
title: Why our engine code is 358 kB gzip, and what a smaller design would be
description: Report-only attribution of the engine's own code in text-shaper.wasm at sil-green-64 by purpose and path, measured prices for incremental paths, the inline fast path, editing and rare features, a comparison with v0.1.0 and main, and ranked structural options.
status: draft
tags: [wasm, size, engine, incremental, audit]
sources:
  - id: core-size-audit
    resource: core-size-audit-2026-11-23.md
    title: Core shaper size audit at sil-green-62 (composition by owner, small measured cuts)
  - id: wasm-size-reduction
    resource: wasm-size-reduction.md
    title: Shaper and baker Wasm size reduction (method, earlier passes)
  - id: handoff
    resource: segment-indexed-layout-handoff.md
    title: Layout refactor handoff
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-24T08:00:00Z'
---

# Why our engine code is 358 kB gzip, and what a smaller design would be

Report only. Branch `experiments/sil-enginesize` = tag `sil-green-64`; every build below was a scratch build under
`glyph-scratch/enginesize` and its source edits were discarded. No speed was measured for any option. The owner decides
what is built.

## Short answer

The engine is not two implementations of layout. It is **one set of stage kernels, wrapped by about fifteen separate
"do less than a full rebuild" paths, plus a second pipeline for short labels, plus the read APIs**. Measured by making
each one unreachable and rebuilding as shipped (whole-wasm gzip, control 566,359):

| What                                                                                                 |        Whole-wasm gzip |
| ---------------------------------------------------------------------------------------------------- | ---------------------: |
| Every incremental path in six stages (shape, clusters, flow, positioning, gather + plan, Unicode)    |            **−78,257** |
| The inline fast path (single-line paragraph of at most 64 glyphs) and everything that reads its leaf |            **−19,129** |
| The eight editing exports (caret, hit test, move, boundary, range rects) and what only they reach    |            **−23,027** |
| `copy_glyphs`, `copy_decorations`, `measure`, the two borrows (reads other than editing)             |                 −7,278 |
| Drop caps / ellipsis / justification arithmetic (lower bounds)                                       | −8,511 / −4,587 / −696 |
| `GatherInput::Flat`, a gather path only tests construct (dead in production)                         |             **−8,212** |

These overlap little (different code), so roughly 140 kB of the 358 kB is retention, the label pipeline, reads and rare
features, and the dead path. The remaining ~215 kB is the cold pipeline itself: boundary decoding and validation
(~24 kB), the stage kernels, the retained rope they store results in (~21 kB), and the render-plan compiler. Three
cross-cutting properties inflate all of it: 48% of the engine's bytes are inlined `core`/`alloc` frames (iterators,
`Vec` growth, `Result` plumbing); the same generic is instantiated more than once for 236 generics (80 kB raw); and 909
functions are inlined into more than one caller (108 kB raw of repeats).

Compared with the same build recipe applied to older sources, our engine code went **224.7 kB (v0.1.0) → 244.8 kB
(main) → 369.0 kB (tip)** gzip, including `core`/`alloc` over our types. The +124 kB over main is close to the sum of
the first three rows above: the refactor added the edit paths, the editing API and the dense stages, and removed
nothing of comparable size from the engine.

A materially smaller engine does not come from merging cold and incremental (cold-only code is ~15 kB). It comes from
**fewer retention tiers per stage**, **one label path instead of two reader sets**, and **moving editing out of the
first download**. The cheapest real cut is deleting the dead Flat gather path.

## Method

- Shipped build: `shaper-build.mjs` as is (immediate-abort, `-Zbuild-std`, `simd128`, wasm-opt `-O3`). Control
  **1,417,876 raw / 566,359 gzip (Node zlib 9; GNU/Python zlib 562,601) / 450,822 Brotli-11**, byte-identical in size to
  the integration tree's artifact.
- Attribution: a names-kept twin (same code section) for out-of-line functions, and a `debug = "limited"` twin whose
  DWARF inline ranges give, per out-of-line function, the bytes of each inlined source function and its declaring
  file. Pre-`wasm-opt` shares are scaled to each function's shipped size. **Gzip per group is allocated**: each
  function's whole-module removal price, scaled so the total equals the price of removing all engine functions
  (369,012). Allocated figures are estimates; they agree with the measured removals below to about ±20%.
- **Measured removals**: a scratch edit makes one path statically unreachable (`if false && …` at the stage's own
  switch, an uninhabited field, or an export dropped from the pre-`wasm-opt` module), then the normal build runs. The
  delta is the code only that path reaches. These builds are not runnable products; they price code, not a design.
- Baselines: v0.1.0 and `origin/main` (`4e25a96a5`) sources built with **today's recipe** so only source differs. As
  shipped they were 501 kB and 541 kB; with today's recipe they are 458.9 kB and 497.7 kB.
- Path classes are assigned by declaring file with name-pattern overrides (`…/enginesize/py/classify.py`). It is a
  judgment per file, not a proof; `S` in particular contains functions with incremental branches inside.

## Composition by purpose

Allocated gzip, kB. S shared kernel, C cold-only, I incremental (edit, reflow, retention), R rare feature, Q reads,
V boundary decode and validation, L registration and lifecycle, K constant initialisation, clears and drop glue,
G out-of-line `core` generics over our types.

| Stage                                    |     S |    C |    I |    R |    Q |    V |    L |    K |    G | Total |
| ---------------------------------------- | ----: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ----: |
| Clusters                                 |   7.5 |  7.4 | 19.2 |      |      |      |      |  0.2 |      |  34.2 |
| Gather + codec                           |  17.4 |  2.6 |  9.7 |  0.6 |      |  1.6 |  1.7 |  0.3 |      |  33.9 |
| Positioning (incl. placement)            |  20.5 |      |  8.8 |  1.1 |      |  0.3 |      |  0.3 |      |  31.0 |
| Render plan (ordered plan, slots)        |  19.0 |  0.3 |  9.8 |      |      |  0.1 |      |  0.8 |      |  30.0 |
| Infrastructure (sort, staging, generics) |   9.6 |      |  0.2 |      |      |      |      |  2.4 | 15.9 |  28.1 |
| Shaping orchestration, ASCII anchor      |   9.9 |  0.5 |  9.6 |      |      |  0.7 |  5.7 |  0.5 |      |  26.9 |
| Flow (bands, drop caps, exclusions)      |  10.9 |      |  3.6 |  7.9 |      |      |      |  0.1 |      |  22.4 |
| Retained rope                            |       |      | 20.4 |      |      |      |      |  0.4 |      |  20.8 |
| Boundary (exports, wire, staging)        |   1.7 |      |  0.1 |      |      | 16.6 |      |      |      |  18.3 |
| Unicode, bidi, line break                |  10.4 |  4.1 |  2.2 |      |      |      |      |  0.3 |      |  17.0 |
| Update orchestration, `ParagraphState`   |   9.6 |      |  0.9 |  0.1 |      |  0.1 |  0.1 |  4.1 |      |  14.9 |
| Editing                                  |       |      |      | 14.8 |      |      |      |      |      |  14.8 |
| Run-local geometry                       |  11.4 |  0.2 |  2.8 |      |      |      |      |  0.2 |      |  14.5 |
| Measure, inspection, glyph copy          |       |      |      |      | 12.2 |      |      |      |      |  12.2 |
| Lifecycle and registries                 |   2.5 |      |      |      |      |      |  7.2 |  0.6 |      |  10.4 |
| Break correction (boundary shaping)      |   6.5 |      |  2.8 |      |      |      |      |      |      |   9.3 |
| Styles                                   |   4.2 |      |  1.1 |      |      |  2.2 |  0.2 |  0.2 |      |   7.9 |
| Inline fast path (producers only)        |       |  7.9 |      |      |      |      |      |      |      |   7.9 |
| Line fit                                 |   7.8 |      |      |      |      |      |      |      |      |   7.8 |
| Text stage                               |   1.5 |      |  2.8 |      |      |  2.2 |      |      |      |   6.5 |
| **Total**                                | 150.3 | 22.8 | 94.0 | 24.4 | 12.2 | 23.7 | 15.0 | 10.7 | 15.9 | 369.0 |

The rope is listed as incremental because it exists for edits (v0.1.0 had none), but the cold path stores into it and
reads through it too.

### The eight questions

- **(a) Cold-only: ~15 kB** (cluster build 7.4, `UnicodeAnalysis::analyze` 4.1, fresh gather rows 2.6), plus the inline
  path's producers (7.9). Small, because the incremental paths call the cold kernels on a window: `splice_source_run`
  calls `build_headers` and `aggregate_shape`, `analyze_edited` falls back to `analyze`, convergence calls
  `compose_band`.
- **(b) Incremental: 94 kB allocated; 78.3 kB measured** for the six stage switches together (table below; the rope's
  tree code and identity diffing stay reachable in that build).
- **(c) Duplicated between cold and incremental**: almost none as hand-written twins. The duplication is of other
  kinds: the inline path's own readers (measured 19.1 kB total against 7.9 kB of producers, so about 11 kB is a second
  copy of gather, measurement, glyph copy, stable ids and editing source over the leaf); stage functions generic over
  closures and instantiated twice (visible flow and intrinsic inspection: `build_with_drop_cap_context`,
  `compose_band`, `prepare_drop_cap`, about 2.7 kB of second copies; cluster build and splice:
  `aggregate_shape_with`, `finish_owned_spans`, about 1.9 kB, with closures that are textually identical; line fit over
  `NoCorrections` and `ShapedBreakCorrections`, about 1.3 kB).
- **(d) Validation and error paths: ~24 kB** in boundary decode and validation (`stage_planner_inputs` 10.2 kB,
  `ValidatedCodec::new` 3.8 kB, wire readers). Separately, inlined `Result` combinators (`?`, `map_err`) are 44 kB raw
  across the engine and fallible `Vec` growth 43 kB raw; the audit's out-of-line growth cut recovers 1.9 kB gzip of that.
- **(e) Rare features**, measured unless marked: editing 23.0 kB; drop caps 8.5 kB; ellipsis 4.6 kB; exclusion-change
  rebuild 4.1 kB (exclusion geometry itself ~3.8 kB allocated, not measured); intrinsic inspection ~4.4 kB allocated;
  decorations ~1.9 kB allocated plus 1.5 kB for `copy_decorations`; justification 0.7 kB (lower bound).
- **(f) Generic instantiation: 80.4 kB raw / ~32 kB gzip allocated of non-largest copies** over 236 generics, an upper
  bound on erasure. Largest: drop glue over 25 types (8.2 kB raw), `apply_pair_order` ×11 (3.8), per-module
  `reserve` helpers ×67 across seven modules (8.9), `Staged::commit` ×12 (2.9), `update_leaf_records` ×6 (2.7),
  `with_shaped_range` ×8 (2.3), and the closure twins in (c).
- **(g) Inlining into more than one caller: 107.9 kB raw / ~46 kB gzip allocated of repeats** over 909 functions, also
  an upper bound; most are small accessors that should stay inline. Largest: `retained_rope::Node::summary` at 88
  sites (3.4 kB raw of repeats), `ShaperRegistry::font_index` ×20 (2.9, the audit's cut 9), `leaf_at` ×20 (2.0),
  `wire::read_u32` ×29 (1.8), `sort_keys` ×5 (1.5), `saturating_floor_units` ×13 (1.5).
- **(h) Constant initialisation, clears and drop glue: ~10.7 kB.** `ParagraphState::default` is still one 10.4 kB raw /
  3.9 kB gzip run of stores; `RenderPlanCompiler::default` is inlined twice (2.1 kB raw); drop glue for
  `ParagraphState`, `PlannerState` and `RenderPlanCompiler` is 3.8 kB raw.

## What each incremental path costs (measured)

Each row is one scratch build with only that switch forced off.

| Stage         | Path                                                                                   |           Δ raw |          Δ gzip | Δ Brotli |
| ------------- | -------------------------------------------------------------------------------------- | --------------: | --------------: | -------: |
| **All six**   | every row below at once, with windowed Unicode re-analysis                             |        −178,004 |     **−78,257** |  −61,122 |
| Shape         | all three (`incremental`, `multi_run`, `realigned`), their scopes and font screens     |         −47,599 |         −19,359 |  −15,147 |
|               | — ASCII-anchor splice alone (`ascii_anchor_policy`, font screening, nominal bootstrap) |         −27,916 |         −10,852 |   −8,313 |
|               | — multi-run alone / realigned alone                                                    | −4,433 / −4,181 | −2,160 / −2,080 |          |
| Clusters      | all three, with run-local geometry adoption                                            |         −40,581 |         −17,004 |  −13,576 |
|               | — splice between previous rows (the general tier)                                      |         −23,369 |         −10,469 |   −8,085 |
|               | — in-place rebuild of one run when topology is stable                                  |          −7,223 |          −3,255 |   −2,702 |
|               | — style refresh from the stream                                                        |          −3,107 |          −1,124 |     −894 |
| Flow          | all three                                                                              |         −24,655 |         −11,748 |   −9,432 |
|               | — convergent rebuild after a text edit                                                 |         −10,079 |          −4,663 |   −3,740 |
|               | — rebuild after an exclusion change                                                    |          −8,652 |          −4,107 |   −3,203 |
|               | — fit reuse on a width-only change                                                     |            −242 |            −135 |     −252 |
| Positioning   | line retention (clean, matched, repositioned, edge) and the resize equivalence         |          −9,824 |          −4,728 |   −3,684 |
|               | — resize equivalence proof alone (`flow_positioning_equivalent`)                       |          −4,499 |          −1,963 |   −1,452 |
| Gather + plan | retained gather (sparse, replacement), patch scope, reorder-only                       |         −49,273 |         −22,394 |  −17,791 |
|               | — reorder-only fast path alone                                                         |          −8,232 |          −3,567 |   −2,851 |
| Unicode       | windowed re-analysis (`analyze_edited`, resync)                                        |          −5,313 |          −2,187 |   −1,822 |

The shape of the cost: each stage keeps a general tier and one or two special cases that are cheaper to run when they
apply, and every tier carries its own admission proof and its own fallback. The speed these tiers buy is the refactor's
headline (edits at 0.42–0.62 of main), so none is free to remove; the table says what each costs so that a tier whose
win is inside noise can be found by A/B.

## Answers

**2. Could cold be incremental over an empty predecessor?** The kernels are already shared, so this would delete only
the cold-only ~15 kB, and not all of it: the windowed paths need the same builders. A realistic saving is 4–6 kB
(estimate), and the first frame would then run diff, proof and rope-update code against an empty predecessor on its
hottest path. Not worth it under "speed beats size". The reverse (one retention tier per stage instead of two or
three) is where the bytes are: option 3.

**3. What could load lazily?** Only code behind its own exports separates cleanly. Editing is 23.0 kB behind eight
exports and is already written against a narrow trait (`LayoutSource`: text, unit ids, grapheme and boundary lanes,
lines, fragments, drop caps, line glyphs, ligature carets), so a second module can implement that trait over lanes the
core lends it. Drop caps, ellipsis, exclusions, justification and decorations are branches inside the pipeline: they
can only be "lazy" as a second, full build of the core that replaces the lean one, which means re-registering fonts
and laying everything out again when a feature is first used. See options 2 and 6.

**4. Codec and export surface.** Export bodies and the `wasm` module are 48.9 kB raw / ~19 kB gzip, most of it inlined
engine entry code rather than glue. The gather is already column-driven: a codec program names an `InputSource` per
column and one kernel per source kind fills a 64-glyph chunk; the per-type twins (`table_lane`, `copy_lane`,
`binding_lane`, `store_changes` for `f32` and `u32`) are 3.0 kB raw of second copies and compress to under 0.6 kB.
There is no per-lane code left worth a table. What the gather carries instead is **three row sources** (projected
general rows, inline leaf rows, caller-authored Flat rows) and three retention modes; Flat is dead in production
(option 1) and the inline source belongs to option 4. Codec validation, fingerprinting and program compilation are
~5.4 kB at registration; a table-driven validator is option 8.

**5. Against v0.1.0 and main** (today's recipe, out-of-line owner, raw / allocated gzip, kB):

| Module                           |        v0.1.0 |          main |           tip | Δ gzip vs main | Why                                                                        |
| -------------------------------- | ------------: | ------------: | ------------: | -------------: | -------------------------------------------------------------------------- |
| `engine::state`                  |  180.1 / 80.2 |  198.8 / 89.2 | 232.4 / 107.1 |          +17.9 | edit scopes for shape, flow tiers, deferred positioning, prepare-on-demand |
| `engine::codec_gather`           |    14.4 / 5.7 |    14.4 / 5.9 |   52.7 / 23.0 |          +17.1 | column gather, retained sparse/replacement updates, three row sources      |
| `engine::cluster_state`          |    14.7 / 6.1 |    15.5 / 6.2 |   48.8 / 21.3 |          +15.2 | dense build, splice, diff with change ranges, stable-id carry              |
| `engine::retained_rope`          |             0 |             0 |   34.8 / 14.7 |          +14.7 | new persistent storage for lines, fragments, gather sources, instances     |
| `engine::positioning`            |   44.0 / 20.5 |   45.3 / 21.5 |   74.1 / 35.6 |          +14.0 | per-segment spans, line retention and proofs, boundary runs, ink           |
| `engine::editing`                |             0 |             0 |   26.6 / 11.0 |          +11.0 | new editing API                                                            |
| `engine::ordered_plan`           |   23.1 / 10.4 |   25.5 / 12.4 |   40.1 / 19.3 |           +6.9 | retained topology, patches, reorder path                                   |
| `unicode`                        |     8.7 / 3.5 |     8.7 / 3.7 |   26.5 / 11.5 |           +7.8 | dense kernel, windowed re-analysis, word and sentence lanes                |
| `engine::inline_leaf`            |             0 |             0 |    18.7 / 7.3 |           +7.3 | inline leaf split out and extended                                         |
| `ascii_anchor_policy`            |             0 |             0 |    13.3 / 5.0 |           +5.0 | new (measured 10.9 with its callers)                                       |
| `engine::layout_query`           |     3.3 / 1.3 |     4.7 / 1.6 |    14.0 / 6.2 |           +4.6 | `measure()` lane, line records                                             |
| `engine::flow_composition`       |    19.2 / 9.5 |   21.8 / 11.1 |   32.1 / 15.0 |           +3.9 | convergence, exclusion rebuild                                             |
| run-local kernel + paragraph     |             0 |             0 |    16.4 / 7.6 |           +7.6 | one geometry kernel with prefix adoption                                   |
| `engine::line_composition`       |     5.0 / 2.5 |    10.1 / 4.6 |    19.9 / 7.7 |           +3.2 | integer facts, witnessed and indexed fits                                  |
| `engine::placement_slot_arena`   |     1.9 / 0.8 |     1.9 / 0.8 |    10.1 / 4.1 |           +3.3 | structural scopes, retained subsets                                        |
| `core`/`alloc` over our types    |   68.5 / 23.1 |   66.2 / 23.0 |   30.9 / 10.7 |          −12.3 | `IdMap`, shared sorts, erased rope                                         |
| `bidi`, `semantic_wire`, outline |    26.5 / 9.8 |   34.1 / 13.0 |    10.2 / 4.2 |           −8.7 | bidi class lanes, wire cuts, outline decoding moved to the baker           |
| **All engine code**              | 539.2 / 224.7 | 583.8 / 244.8 | 842.3 / 369.0 |     **+124.2** |                                                                            |
| **Whole wasm (gzip, Node)**      |         458.9 |         497.7 |         566.4 |          +68.7 | HarfRust fork cuts and table work paid back 55 kB                          |

## Ranked options

Savings are whole-wasm gzip. "Measured" means the removal build above, which is the ceiling for that option; a real
design keeps some replacement code.

|   # | Option                                                                                                                                                                                                                                                               | Saving                                                                     | Basis                                                        | Speed risk                                                                                               | First-frame risk                                                                                              | Effort                                                                                                            |
| --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
|   1 | Delete or `cfg(test)` the Flat gather path (`LayoutPlanInput`, `append_flat_rows`, `retain_flat_owners`)                                                                                                                                                             | **−8.2 kB**                                                                | measured, exact                                              | none: no production caller constructs it                                                                 | none                                                                                                          | low; ~30 gather tests build Flat input                                                                            |
|   2 | Editing as a second wasm fetched on first use, implementing `LayoutSource` over lanes the core lends                                                                                                                                                                 | **−23.0 kB** from the first download; the module itself ~25–30 kB          | measured removal; module size estimated                      | none on layout                                                                                           | none for drawing; first caret or hit test waits for a fetch unless preloaded when an editable text is created | high: new lending exports, a second artifact, sync methods need a ready state, word and sentence lane cache moves |
|   3 | One retention tier per stage where a special case duplicates the general one: cluster in-place rebuild (3.3), reorder-only (3.6), resize equivalence proof (2.0), exclusion-change rebuild (4.1), and the ASCII-anchor splice (10.9) if `realigned` covers its cases | **up to −23.9 kB**, each tier separately                                   | measured per tier                                            | the point of each tier; needs the headline A/B per tier (typing at end, 22k edits, width sweep, reorder) | none (first frame takes no retention tier)                                                                    | low per tier once the A/B says it is noise                                                                        |
|   4 | Inline path keeps its producers but emits the general lanes at small scale, so gather, measure, copy, editing source and stable ids have one reader each                                                                                                             | **about −11 kB** (19.1 measured for the whole path less ~7.9 of producers) | estimate from two measurements                               | medium: the leaf is compact on purpose; many-label frames and per-label memory need A/B                  | medium: short labels are most first frames                                                                    | high                                                                                                              |
|  4b | Remove the inline path outright                                                                                                                                                                                                                                      | −19.1 kB                                                                   | measured                                                     | high: "small ASCII frame 0.83 of main" rests on it                                                       | high                                                                                                          | medium                                                                                                            |
|   5 | Stage functions take `&dyn` (or one shared closure type) where they are instantiated twice: cluster build/splice, visible/intrinsic flow, style topology, stable ids, `retain_owners`                                                                                | **−4 to −6 kB**; (f) upper bound 32 kB                                     | estimate from instantiation sizes                            | low for cluster and style pairs (per run); flow closures are called per line and per break, A/B          | low                                                                                                           | low–medium                                                                                                        |
|   6 | Lean core without drop caps, ellipsis, exclusions, justification, decorations; full core swapped in on first use                                                                                                                                                     | −8.5 / −4.6 / ~−8 / −0.7 / ~−3.4, about −25 kB                             | measured for the first two and justification, rest allocated | none while lean                                                                                          | none while lean; first use reloads fonts and lays out every text again in the full module                     | high; two artifacts through every oracle. Not recommended                                                         |
|   7 | `ParagraphState::empty` from a `const` template; `RenderPlanCompiler::default` out of line; `Node::summary` and `leaf_at` out of line                                                                                                                                | −3.3 (audit estimate), −0.3, −1 to −2                                      | estimate                                                     | rope accessors are on edit paths: A/B                                                                    | none                                                                                                          | medium / trivial / trivial                                                                                        |
|   8 | Arenas as lane tables: one descriptor-driven `reserve`/`clear`/`copy`/`splice with shift`/`equal` instead of per-field code (`copy_clusters`, `ClusterArena::{reserve,clear,copy_from}`, `lanes_equal`, 67 `reserve` copies, `Staged::commit` ×12)                   | −10 to −20 kB                                                              | estimate, low confidence                                     | low if kept off per-glyph loops (these run per stage, not per glyph)                                     | low                                                                                                           | very high; touches every arena                                                                                    |
|   9 | Table-driven boundary validation and wire decode                                                                                                                                                                                                                     | −5 to −8 kB                                                                | estimate                                                     | validation runs on every update record; an interpreter is slower                                         | slower first update                                                                                           | high. Cold code at size was already priced at 0.9 kB                                                              |
|   — | Cold as incremental over an empty predecessor                                                                                                                                                                                                                        | −4 to −6 kB                                                                | estimate                                                     | first frame runs diff and proof code                                                                     | high                                                                                                          | high. Not recommended                                                                                             |

Options 1, 3 (taken tier by tier), 5 and the small items in 7 are behaviour-identical by construction and fit the
existing oracle. Option 2 changes when editing answers are available and needs an engine-call-contract decision.
Options 1 + 2 + the two cheapest tiers of 3 would bring the first download to about 530 kB gzip.

For the small-cuts lane, three items here are in its range and are not in the audit: the dead Flat path (option 1),
the identical-closure twins in the cluster build (~1.9 kB), and `Node::summary` inlined at 88 sites.

## Evidence gaps

- **No speed measurement.** Every speed and first-frame entry is a judgment from where the code runs, not a benchmark.
- Removal builds were not run through the oracle or tests; they exist only to price code. Option 1 is the exception in
  kind: the production build compiled with the type made uninhabited, which proves no production caller constructs it.
- Drop-cap, ellipsis and justification removals force the producer off and make one type uninhabited where that was
  cheap; readers that the compiler cannot prove dead remain, so those three are lower bounds. Decorations, exclusion
  geometry and intrinsic inspection are allocated estimates only.
- Allocated gzip distributes a non-additive quantity; rows of the purpose table are good to roughly ±20%, and the
  S/I split inside mixed functions (for example `build_lines`, `prepare_flow_lines`) follows the function's file.
- The (f) and (g) totals are upper bounds on duplication, not savings: erasing a small generic can add gzip bytes
  (`apply_pair_order`, 2026-11-23 pass).
- The module sizes for a split-out editing wasm and for a lean core are not built.
- Measured on `sil-green-64`; the small-cuts lane is changing the shaper in parallel, so re-measure on the next tag.
