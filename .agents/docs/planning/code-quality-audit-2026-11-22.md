---
type: Log
title: 'Kimun and Fallow audit of the 0.2.0 tree'
description: 'Read-only complexity, duplication, hotspot, and unused-code audit of our own Rust and TypeScript, with each item marked new or pre-existing against 8176a24e0a3f.'
status: draft
generated:
  by: anthropic/claude-sonnet-5-5
  at: '2026-11-22T08:30:00Z'
---

# Kimun and Fallow audit of the 0.2.0 tree

Branch `experiments/segment-indexed-layout` at `cec595c0c`; "base" is `8176a24e0a3f`. Nothing in the repository was
changed except this file. Raw outputs are in `/Volumes/Depot/Developer/glyph-scratch/quality/`.

## Method and scope

- **Kimun 0.46.1 (`km`)** cannot take a path list, so our own source was copied to scratch trees and scored there:
  `rs/` holds every `packages/glyph/rust/*/src` minus `generated/` (174 files, 83,649 LOC; 180 `.rs` files before
  `km` skipped some), and `ts/` holds `packages/glyph/src` minus `generated/` (256 files, 52,812 LOC). The Rust
  crates are `shaper`, `bitmap-baker`, `font-baker`, `font-baker-fuzz`, `mtsdf-*`, `raster-artifact`, and
  `slug-*`; no HarfRust fork or `vendor/` directory exists under `packages/glyph/rust`, and `tests/` directories were
  not copied (so `tests/oracle/reference` is out). `km` excludes tests by default. The same trees were produced from
  `git archive 8176a24e0a3f` so every item could be compared with base. `km hotspots` ran in the repo, where git
  history exists, with `--exclude-dir generated|target|reference|vendor`. No `.kimun.toml` was written.
- **Fallow 3.13.0** ran with the pinned invocation from `test-coverage-duplication-audit.md`
  (`--root . --workspace '@pmndrs/glyph' --no-production --no-cache`) for `dead-code`, `health`, and `dupes`. Fallow
  cannot be narrowed to `src/`, so it analysed the whole workspace (tests, scripts, browser probes); every list below
  is filtered to `packages/glyph/src` excluding `generated/`, and workspace-wide headline numbers are labelled. The
  repo has no fallow config, so entry-point detection is package.json plus plugins only.
- "New" below means the function (by file and name) did not exist at base, or its cognitive score rose from base.
  Complexity at base was measured by running the same `km cogcom` on the base tree, which is stronger than blame.

## 1. Overall scores

| Scope                   | Score now | Score at base | Cognitive | Duplication | Indent | Halstead | File size |
| ----------------------- | --------- | ------------- | --------- | ----------- | ------ | -------- | --------- |
| Rust (`km score`)       | D+ (65.1) | D (60.8)      | 42.0 F-   | 100.0       | 83.7   | 55.3 F   | 56.7 F    |
| TypeScript (`km score`) | C+ (75.6) | C+ (75.2)     | 54.8 F    | 100.0       | 99.7   | 63.5 D+  | 77.7 B-   |

The Rust score rose because the tree grew 60,687 to 83,649 LOC (more small files), not because the worst functions
shrank; see section 2. `km score` rates duplication 100/95.6 because it only counts blocks above its own threshold.
`km dups` at its default minimum reports 4.72% (3,950 lines, 409 groups) for Rust and 3.38% (1,787 lines, 181 groups)
for TypeScript; at 20 or more lines it is 0.69% (575 lines) and 0.50% (264 lines).

Worst files by `km score`: Rust `engine/state.rs` (8,613 LOC outside tests, F--), `positioning.rs`, `ordered_plan.rs`,
`flow_composition.rs`, `cluster_state.rs`; TypeScript `three/text.ts`, `internal/render-planner.ts`,
`config/codec.ts`, `loader.ts`, `internal/handle-state.ts`.

Function counts at cognitive 15 or more (SonarSource "should be refactored"): Rust 160 of 2,968 (76 at 25 or more);
TypeScript 106 of 2,367 (37 at 25 or more).

**Fallow, TypeScript** (workspace-wide headline in brackets): health score 48.8 D [workspace; penalties are
maintainability 15.0, dead files 10.1, hotspots 10.0, unit size 10.0]; `src/` only: 217 files scored, mean
maintainability index 87.8, 561 functions over threshold (149 critical, 160 high, 252 moderate; thresholds
cyclomatic 20, cognitive 15, unit size 60). Duplication [workspace] 2.0% (2,857 of 142,825 lines, 100 groups), 60
groups confined to `src/`. Dead code: 14 unused files, 115 unused exports, 14 unused types, 24 unused class members,
7 duplicate export names, 2 import cycles, all in `src/`.

## 2. Top 20 functions by cognitive complexity

Rust, `packages/glyph/rust/`. Column "Base" is the same function's score at `8176a24e0a3f`.

| #   | Cog | Function                                               | Location                                        | Base   | Verdict                     |
| --- | --- | ------------------------------------------------------ | ----------------------------------------------- | ------ | --------------------------- |
| 1   | 257 | `screen_font`                                          | `shaper/src/ascii_anchor_policy.rs:155`         | 257    | pre-existing                |
| 2   | 233 | `compile_draw_spans`                                   | `shaper/src/engine/ordered_plan.rs:2157`        | 233    | pre-existing                |
| 3   | 173 | `decide`                                               | `shaper/src/line_break.rs:143`                  | 173    | pre-existing                |
| 4   | 128 | `position_fragment`                                    | `shaper/src/engine/positioning.rs:3098`         | 78     | **grew +50 on this branch** |
| 5   | 116 | `prepare_update_inner`                                 | `shaper/src/engine/state.rs:1518`               | 116    | pre-existing                |
| 6   | 102 | `layout_next_line_integer_scalar`                      | `shaper/src/engine/line_composition.rs:847`     | 102    | pre-existing                |
| 7   | 95  | `reposition_retained_line`                             | `shaper/src/engine/positioning_segments.rs:128` | absent | **new file**                |
| 8   | 93  | `rebuild_until_state_converges`                        | `shaper/src/engine/flow_composition.rs:910`     | 91     | pre-existing (+2)           |
| 9   | 87  | `write_changed_ranges`                                 | `shaper/src/engine/ordered_plan.rs:1620`        | 80     | pre-existing (+7)           |
| 10  | 79  | `build_lines`                                          | `shaper/src/engine/positioning.rs:1985`         | absent | **new on branch**           |
| 11  | 77  | `build_with_drop_cap_context`                          | `shaper/src/engine/flow_composition.rs:622`     | 68     | pre-existing (+9)           |
| 12  | 74  | `validate_plan`                                        | `shaper/src/engine/render_plan_wire.rs:286`     | 74     | pre-existing                |
| 13  | 66  | `prepare_placement_slots`                              | `shaper/src/engine/state.rs:3743`               | 66     | pre-existing                |
| 14  | 66  | `prepare_structural_scope`                             | `shaper/src/engine/placement_slot_arena.rs:387` | 66     | pre-existing                |
| 15  | 65  | `validate_style_topology_for_inputs`                   | `shaper/src/engine/state.rs:3173`               | 42     | **grew +23 on this branch** |
| 16  | 62  | `prepare_incremental_shape_scope`                      | `shaper/src/engine/state.rs:5931`               | 62     | pre-existing                |
| 17  | 61  | `rebuild_after_exclusion_change_until_state_converges` | `shaper/src/engine/flow_composition.rs:1238`    | 60     | pre-existing (+1)           |
| 18  | 60  | `prepare_shape`                                        | `shaper/src/engine/state.rs:5329`               | 60     | pre-existing                |
| 19  | 58  | `position_segment`                                     | `shaper/src/engine/positioning_segments.rs:532` | absent | **new file**                |
| 20  | 57  | `append_measurement_from_occurrences_source`           | `shaper/src/engine/layout_query.rs:500`         | 55     | pre-existing (+2)           |

Across all Rust functions at 15 or more: 41 are absent at base (new or renamed on this branch), 15 pre-existing ones
rose, and only 3 of those rose by 10 or more (`position_fragment`, `validate_style_topology_for_inputs`,
`prepare_flow_lines` 28 to 38).

TypeScript, `packages/glyph/src/`:

| #   | Cog | Function                    | Location                             | Base   | Verdict                                 |
| --- | --- | --------------------------- | ------------------------------------ | ------ | --------------------------------------- |
| 1   | 101 | `compileCodec`              | `config/codec.ts:228`                | 101    | pre-existing                            |
| 2   | 73  | `prepareDrawReplacement`    | `three/internal/draw-realizer.ts:59` | 68     | pre-existing (+5)                       |
| 3   | 72  | `createText`                | `typegpu/text.ts:158`                | 51     | **grew +21 on this branch**             |
| 4   | 67  | `parseBakeArguments`        | `node/cli.ts:278`                    | 67     | pre-existing                            |
| 5   | 63  | `validateBitmapSemantics`   | `bakers/bitmap-validator.ts:169`     | 63     | pre-existing                            |
| 6   | 61  | `ownTextSpanRecords`        | `config/text-span-owner.ts:33`       | 61     | pre-existing                            |
| 7   | 57  | `sync`                      | `three/transform-synchronizer.ts:22` | 57     | pre-existing                            |
| 8   | 56  | `project`                   | `internal/create-engine.ts:107`      | 54     | pre-existing (+2)                       |
| 9   | 53  | `decode`                    | `pixi3d/internal/renderer.ts:46`     | absent | **new file** (pixi3d)                   |
| 10  | 43  | `defineResourceDeclaration` | `internal/schema.ts:398`             | 43     | pre-existing                            |
| 11  | 39  | `createCodecProgramBuilder` | `internal/codec-program.ts:382`      | 39     | pre-existing                            |
| 12  | 38  | `_stagePreparation`         | `internal/render-planner.ts:1233`    | absent | **new name on branch** (file +934/-312) |
| 13  | 36  | `decode`                    | `typegpu/internal/renderer.ts:143`   | 58     | pre-existing, improved                  |
| 14  | 36  | `preparePlannerFrameUpdate` | `internal/frame-wire.ts:277`         | 36     | pre-existing                            |
| 15  | 35  | `readPlannerLayouts`        | `internal/layout-query-view.ts:337`  | 35     | pre-existing                            |
| 16  | 35  | `dispose`                   | `internal/handle-state.ts:897`       | 35     | pre-existing                            |
| 17  | 35  | `staticJson`                | `discovery.ts:399`                   | 35     | pre-existing                            |
| 18  | 34  | `readSfntTables`            | `font-baker/validator.ts:465`        | 34     | pre-existing                            |
| 19  | 34  | `preflightProgramBody`      | `config/codec.ts:730`                | 34     | pre-existing                            |
| 20  | 34  | `validateMsdfSemantics`     | `bakers/msdf-validator.ts:139`       | 34     | pre-existing                            |

Across all TypeScript functions at 15 or more: 9 absent at base, 8 pre-existing ones rose (2 by 10 or more:
`createText`, `readModule` 4 to 19).

Fallow's cognitive numbers differ from Kimun's (different counting of nested closures); its top three are
`prepareDrawReplacement` 115, `compileCodec` 103, `ownTextSpanRecords` 73. Same files, same conclusions.

"Absent at base" can be a rename or move rather than new logic: `decode` in `pixi3d/internal/renderer.ts` and
`_stagePreparation` were not traced to a donor function.

## 3. Duplication (Kimun, at least 20 lines)

Same-logic means the blocks implement one behaviour that should have one owner; coincidental means shape similarity
(argument lists, struct field lists, match arms) with no shared behaviour.

Rust:

| Lines | Locations                                                                       | Judgement                                                                         | New?                   |
| ----- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------- |
| 109   | `bitmap-baker/src/wasm.rs:204`, `font-baker/src/wasm.rs:270`                    | Same logic: wasm response-header and allocation boilerplate copied per baker      | pre-existing           |
| 69    | `mtsdf-baker/src/wasm.rs:319`, `slug-baker/src/wasm.rs:258`                     | Same logic: artifact-baker ABI entry parameters                                   | pre-existing           |
| 38    | `mtsdf-baker/src/wasm.rs:536`, `slug-baker/src/wasm.rs:475`                     | Same logic: `leak_artifact_response`                                              | pre-existing           |
| 37    | `shaper/src/engine/state.rs:1268`, `:1364`                                      | Same logic: near-identical result-struct construction in two paths                | pre-existing file pair |
| 36    | `mtsdf-baker/src/wasm.rs:26`, `slug-baker/src/wasm.rs:19`                       | Same logic: global allocator setup                                                | pre-existing           |
| 32    | `shaper/src/wasm.rs:966`, `:1017`                                               | Same logic: plan-or-publish-failure prologue                                      | pre-existing           |
| 29    | `engine/flow_composition.rs:747`, `:1430`                                       | Mostly coincidental: repeated constructor argument lists across two rebuild loops | pre-existing           |
| 28    | `mtsdf-core/src/distance.rs:67`, `:130`                                         | Likely same logic: parallel edge-distance setup                                   | pre-existing           |
| 26    | `shaper/src/wasm.rs:759`, `:1115`                                               | Same logic: revision-lookup prologue                                              | pre-existing           |
| 24    | `engine/state/prepare_paragraphs.rs:150`, `engine/state.rs:1562`                | Same logic: paragraph lifecycle prologue extracted but still copied               | **new pair**           |
| 24    | `engine/state.rs:2683`, `:2755`                                                 | Mostly coincidental: matching builder arguments                                   | pre-existing file pair |
| 22    | `bitmap-baker/wasm.rs:230`, `font-baker/wasm.rs:296`, `shaper/src/wasm.rs:1489` | Same logic: `Allocation` struct                                                   | pre-existing           |
| 21    | `engine/codec.rs:818`, `:893`                                                   | Coincidental: parallel `Operation::AddF32` match arms                             | pre-existing           |
| 21    | `engine/semantic_wire.rs:102`, `engine/style_state.rs:47`                       | Coincidental: mirrored field lists of one data shape                              | pre-existing           |
| 20    | `mtsdf-baker/wasm.rs:493`, `slug-baker/wasm.rs:432`                             | Same logic: error response                                                        | pre-existing           |
| 20    | `mtsdf-baker/wasm.rs:673`, `slug-baker/wasm.rs:516`                             | Same logic: `write_u32`                                                           | pre-existing           |
| 20    | `engine/positioning.rs:1934`, `:1986`                                           | Same logic: two `&mut self, previous, flow` build paths                           | **new pair**           |

TypeScript:

| Lines | Locations                                                                      | Judgement                                                                   | New?         |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------ |
| 91    | `shaders/tsl/slug/shader.ts:7`, `three/typegpu/internal/slug-shader.ts:23`     | Same logic: mirrored Slug node interface and helpers across TSL and TypeGPU | pre-existing |
| 39    | `react.ts:435`, `vue.ts:436`                                                   | Same logic: `isProviderFontFaceConfig` per framework                        | pre-existing |
| 38    | `react.ts:363`, `vue.ts:380`                                                   | Same logic: provider font-face cache                                        | pre-existing |
| 28    | `shaders/tsl/bitmap-shader.ts:5`, `three/typegpu/internal/bitmap-shader.ts:14` | Same logic: bitmap instance nodes                                           | pre-existing |
| 27    | `react.ts:545`, `vue.ts:192`                                                   | Same logic: default Three handle lookup                                     | pre-existing |
| 21    | `internal/layout-query-view.ts:289`, `:470`                                    | Same logic: inspection copy                                                 | pre-existing |
| 20    | `react.ts:53`, `vue.ts:48`                                                     | Coincidental: identical import lists                                        | pre-existing |

The seven new-or-old file-set comparison found 2 Rust groups whose file pair is not duplicated at base and 0 in
TypeScript. Fallow's `dupes` (mild mode, 5 lines) adds `react.ts:850`/`vue.ts:681` (115 lines), `bakers/bitmap.ts:106`,
`msdf.ts:139`, `slug.ts:110` (33 lines x3), and `pixi3d/internal/resource.ts:27`/`:90` (29 lines, same logic: the
bitmap and msdf resource classes).

## 4. Hotspots (`km hotspots --complexity cogcom`, commits x cognitive, whole history)

"Since base" is commits touching the file in `8176a24e0a3f..HEAD` over total commits.

Rust (top 15):

| #   | File                                    | Commits | Cog  | Score   | Since base |
| --- | --------------------------------------- | ------- | ---- | ------- | ---------- |
| 1   | `shaper/src/engine/state.rs`            | 109     | 1494 | 162,846 | 44/126     |
| 2   | `shaper/src/engine/positioning.rs`      | 73      | 767  | 55,991  | 16/75      |
| 3   | `shaper/src/engine/ordered_plan.rs`     | 32      | 703  | 22,496  | 5/33       |
| 4   | `shaper/src/engine/cluster_state.rs`    | 57      | 332  | 18,924  | 12/59      |
| 5   | `shaper/src/engine/flow_composition.rs` | 42      | 433  | 18,186  | 8/43       |
| 6   | `shaper/src/engine/codec_gather.rs`     | 37      | 441  | 16,317  | 4/37       |
| 7   | `shaper/src/engine/line_composition.rs` | 25      | 186  | 4,650   | 2/25       |
| 8   | `shaper/src/engine/codec.rs`            | 13      | 237  | 3,081   | 1/13       |
| 9   | `shaper/src/engine/style_state.rs`      | 13      | 208  | 2,704   | 4/12       |
| 10  | `shaper/src/engine/layout_query.rs`     | 26      | 101  | 2,626   | 4/26       |
| 11  | `shaper/src/wasm.rs`                    | 17      | 153  | 2,601   | 5/17       |
| 12  | `shaper/src/unicode.rs`                 | 15      | 150  | 2,250   | 10/15      |
| 13  | `shaper/src/lib.rs`                     | 21      | 102  | 2,142   | 7/22       |
| 14  | `shaper/src/engine/semantic_wire.rs`    | 13      | 162  | 2,106   | 0/13       |
| 15  | `shaper/src/engine/placement_state.rs`  | 23      | 84   | 1,932   | 2/23       |

The Rust list also contains `engine/state/oracle/*` test-support files lower down (not in the top 15).

TypeScript (top 15):

| #   | File                               | Commits | Cog | Score  | Since base |
| --- | ---------------------------------- | ------- | --- | ------ | ---------- |
| 1   | `three/text.ts`                    | 73      | 418 | 30,514 | 14/76      |
| 2   | `internal/render-planner.ts`       | 48      | 365 | 17,520 | 12/50      |
| 3   | `loader.ts`                        | 11      | 402 | 4,422  | 1/11       |
| 4   | `internal/handle-state.ts`         | 23      | 173 | 3,979  | 8/23       |
| 5   | `react.ts`                         | 17      | 186 | 3,162  | 1/17       |
| 6   | `node/cli.ts`                      | 14      | 204 | 2,856  | 0/14       |
| 7   | `text-properties.ts`               | 17      | 168 | 2,856  | 1/17       |
| 8   | `config/codec.ts`                  | 8       | 297 | 2,376  | 0/8        |
| 9   | `internal/configured-handle.ts`    | 19      | 106 | 2,014  | 6/19       |
| 10  | `internal/frame-wire.ts`           | 14      | 127 | 1,778  | 1/14       |
| 11  | `three/internal/draw-realizer.ts`  | 19      | 88  | 1,672  | 9/19       |
| 12  | `config/raster.ts`                 | 17      | 88  | 1,496  | 1/17       |
| 13  | `three/command-buffer-renderer.ts` | 27      | 55  | 1,485  | 10/28      |
| 14  | `vue.ts`                           | 11      | 114 | 1,254  | 1/11       |
| 15  | `internal/layout-query-view.ts`    | 12      | 98  | 1,176  | 2/12       |

All 30 files exist at base; none is a new file. The hotspot status is pre-existing, but this branch added churn to
`state.rs` (44 commits), `positioning.rs`, `cluster_state.rs`, `three/text.ts`, `render-planner.ts`,
`draw-realizer.ts`, and `command-buffer-renderer.ts`. Fallow's 6-month hotspot ranking agrees on `three/text.ts` first.

## 5. Unused code reported by Fallow (TypeScript `src/`)

Caveat: Fallow has no config here, so anything reachable only from tests, scripts, browser probes, or runtime string
imports is flagged. Treat as candidates, not deletions. The workspace-wide totals were 276 unused files and 215
unused exports, mostly in `tests/` and `scripts/`.

- **Unused files (14):** `bakers/bitmap-validator.ts`, `bakers/msdf-validator.ts`, `bakers/slug-validator.ts`,
  `bitmap-baker-abi.ts`, `font-baker-abi.ts`, `mtsdf-baker-abi.ts`, `slug-baker-abi.ts`, `text-shaper-abi.ts`,
  `internal/raster-artifact-validation.ts`, `internal/raster-baker-profile.ts`, `paint.ts`,
  `shaders/tsl/slug/internal/reference.ts`, `shaders/typegpu/bitmap-reference.ts`, `shaders/typegpu/slug/index.ts`.
  The validator and ABI files are most likely entry points loaded by name by the bakers and tests.
- **Unused exports (115 in `src/`).** Concentrated in `internal/raster-artifact-validation.ts` (18, a whole file
  nobody imports), `bakers/*-validator.ts` (6), `internal/text-queries.ts` (6: `queryCaret`, `queryHitTest`,
  `queryMove`, `queryBoundary`, `queryRangeRects`, `checkReplaceRange`), `engine-encoding.ts` (4),
  `font-face.ts` (3: `disposeFontFace`, `fontFaceSelectionState`, `acquireLoadedFontFaceSelection`),
  `raster-coverage.ts` (4 limit constants), `shaders/tsl/slug/index.ts` (`calcCoverage`, `calcRootCode`,
  `MAX_SAFE_SLUG_BAND_CURVES`), and `runtime-bakers/{bitmap,msdf,slug}.ts` default exports.
- **Unused types (14 in `src/`):** for example `FontBakerAbi`, `ResolvedFontFeature`, `FontSlotRecord`,
  `SlugShaderGlyph`/`SlugShaderPage` (declared in both `index.ts` and `primitives.ts`), `MsdfEffectVariants`.
- **Unused class members (24):** `FontFaceHandleStore` (7 methods), `FontRegistry._onFontDispose`, `FontLoader._peek`,
  `FontLoader.attachRaster`, `Pixi3DMeshPool.release`, `Pixi3D{Bitmap,Msdf,Slug}Resource.dispose`,
  `ThreeCommandBufferRenderer.draws`, `GlyphDraw.boundingSphere`/`copy`, `ThreeRendererResources.dispose` and
  `sharedRenderResourceCount`, `ThreeRootHost.members`/`renderObject`/`scene`, `ResidentMsdfAtlas.byteLength`,
  `ResidentSlugBands.byteLength`. The Pixi3D `dispose` and `ThreeRootHost` members may be framework callbacks.
- **Duplicate export names (7):** `BatchBinding` (typegpu `bindings.ts`/`pipeline.ts`), `Text` and `TextGroup`
  (`react.ts`/`three/text.ts`), `decorationShader`, `slugDilate`, `slugDilateMatrix` (shaders/typegpu vs
  three/typegpu internal copies), `span` (`formatted-text.ts`/`three/span.ts`).
- **Import cycles (2):** `config/raster.ts` <-> `internal/font-binding.ts`; `internal/font-face-transfer-runtime.ts`
  <-> `loader.ts`.
- Workspace-only findings outside scope: one unresolved import and one unlisted dependency
  (`@glyph-test/fiber`) in `tests/browser/r3f-compatibility.mjs`.

Newness: the pixi3d `dispose` members, `ThreeRootHost` members, and `typegpu/internal/*` duplicates belong to code
added or reshaped this branch; the baker validators, `raster-artifact-validation.ts`, `font-face.ts`, and
`text-queries.ts` items were not individually checked against base.

## 6. Newness summary

- Top-20 Rust complexity: 3 new (`reposition_retained_line`, `build_lines`, `position_segment`), 2 grew by 23 or more
  (`position_fragment`, `validate_style_topology_for_inputs`), 15 pre-existing (several by a few points).
- Top-20 TypeScript complexity: 2 new names (`decode` in pixi3d, `_stagePreparation`), 1 grew (`createText` +21),
  17 pre-existing (one improved).
- Duplication at 20 or more lines: 2 of 17 Rust file-sets new (`state.rs`/`prepare_paragraphs.rs`,
  `positioning.rs` self-pair), 0 of 7 TypeScript.
- Hotspots: 0 of 30 files new, but 7 are heavily churned on this branch.
- Rust score improved (D to D+) by growth in file count; the four worst function scores are unchanged from base
  except `position_fragment`.
