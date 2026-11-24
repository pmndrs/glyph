---
type: Research Note
title: Core shaper size audit at sil-green-62
description: Report-only byte attribution of the shipped text-shaper.wasm at sil-green-62, the dependency features and dead paths still linked, and a ranked list of cuts, each measured on a scratch build or marked as an estimate.
status: draft
tags: [wasm, size, harfrust, unicode, audit]
sources:
  - id: wasm-size-reduction
    resource: wasm-size-reduction.md
    title: Shaper and baker Wasm size reduction (method, earlier passes, priced levers)
  - id: decision-register
    resource: decision-register.md
    title: Decision register (D-242, D-244)
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-23T23:30:00Z'
---

# Core shaper size audit at `sil-green-62`

Report only. Nothing here changes the product; every cut below was built in scratch from branch
`experiments/sil-sizeaudit` (= tag `sil-green-62`, `da8e31b5e`) and discarded. The owner decides what is built.

## Bottom line

- The shipped `text-shaper.wasm` is **1,410,403 B raw / 563,059 B gzip -9 / 450,781 B Brotli-11**. Our engine's
  functions are 67% of the code bytes and 72% of the code's gzip contribution; HarfRust (with its trait impls on
  read-fonts types) is 23% / 20%. Data is 15% of the raw bytes but 11% of the gzip, and **a third of the data's gzip is
  one HarfRust table**.
- **The largest clean cut is dead data: HarfRust's Unicode script property.** `_hb_ucd_sc` shares two packtab arrays
  with the live properties, so its 15.2 kB region stays linked although nothing reads it (the only reader,
  `guess_segment_properties`, is never called). Splitting the generated arrays per property is a mechanical,
  lookup-identical fork change: **−13,973 raw / −4,778 gzip / −3,670 Brotli**.
- Five more measured cuts are small code-shape changes (fallible `try_reserve` growth out of line, HarfRust plan-builder
  helpers out of line, the ASCII bootstrap's `push_str`, the font-index miss path). With the script split, the six
  measured cuts together give **−33,359 raw / −9,637 gzip (−1.7%) / −6,644 Brotli**.
- Estimated, not built: a `const` template for `ParagraphState::empty` (about −3.3 kB gzip), answering
  `is_alphanumeric` from a trie we own instead of `core`'s tables (about −1.5 kB), and folding the
  `InCB_Extend` range table into the segmentation trie (about −1.2 kB).
- No dependency feature that is on costs bytes without being needed, apart from three variation-delta functions
  (0.7 kB raw / 0.3 kB gzip) that `variations = off` leaves reachable. The rest of the size is hot code: the remaining
  levers are the already-priced complex-shaper interpreter and per-script payloads.

## Method

- Shipped build: `packages/glyph/scripts/support/shaper-build.mjs` exactly (`-Cpanic=immediate-abort`,
  `-Zbuild-std=core,alloc`, `simd128`, D-244 optimizer flags), into an isolated target under
  `glyph-scratch/sizeaudit`, with the repository's pinned Rust 1.97.1 and Binaryen 129. The control is the same size as
  the integration worktree's `dist/text-shaper.wasm` built at `sil-green-62` (1,410,403 B).
- Attribution twin: `CARGO_PROFILE_RELEASE_STRIP=false`, `wasm-opt -g`; its code section is byte-for-byte the shipped
  one (1,199,040 B). A second twin linked with `--no-merge-data-segments` names every data segment. A third at
  `debug = "limited"` gives DWARF inline ranges (pre-`wasm-opt` bytes).
- Owner of a function: the crate of its self type, or of the trait for a foreign trait impl (so
  `<read_fonts::…ChainedSequenceContextFormat2 as harfrust::…::Apply>::apply` is HarfRust). Inlined callees count
  toward the caller.
- **Gzip contribution** of a group is the whole-module gzip -9 delta when that group's function bodies or data segments
  are removed from the shipped module (Python `zlib` level 9, which matches GNU `gzip -9` to within 20 B). It prices
  what the bytes cost inside the compressed stream, not standalone. Contributions are not additive.
- Cut sizes: whole shipped module, GNU `gzip -9`, Node `zlib` level 9 (the tool behind the size tables in
  `wasm-size-reduction.md`; it reads about 4 kB larger on this module, deltas within 10% of GNU), Node Brotli q11.

## Composition

Section split: `code` 1,199,040 raw; `data` 206,973; exports 1,684; everything else 2,706.

### Code by owner

| Owner (out-of-line function)                                                          |           Raw | Gzip contribution |
| ------------------------------------------------------------------------------------- | ------------: | ----------------: |
| our engine (`pmndrs_glyph_shaper`), modules below                                     |       805,653 |           357,528 |
| — `engine::state`                                                                     |       235,555 |           105,760 |
| — `engine::positioning`                                                               |        74,321 |            34,991 |
| — `engine::codec_gather`                                                              |        53,074 |            23,431 |
| — `engine::cluster_state`                                                             |        49,527 |            21,594 |
| — exported entry points + `wasm` module                                               |        48,528 |            19,993 |
| — `engine::ordered_plan`                                                              |        39,840 |            18,347 |
| — `engine::retained_rope`                                                             |        37,466 |            16,241 |
| — `engine::flow_composition`                                                          |        31,912 |            15,450 |
| — `unicode`                                                                           |        27,306 |            11,977 |
| — `engine::editing`                                                                   |        26,617 |            11,198 |
| — `engine::line_composition`                                                          |        20,497 |             8,822 |
| — `engine::inline_leaf`                                                               |        19,094 |             7,448 |
| — `engine::codec`                                                                     |        15,600 |             5,404 |
| — `engine::layout_query`                                                              |        13,865 |             6,066 |
| — `ascii_anchor_policy`                                                               |        12,547 |             4,792 |
| — 25 smaller modules                                                                  |       ~99,900 |                 — |
| `core`/`alloc` instantiated over our types                                            |        31,544 |            11,622 |
| HarfRust, modules below                                                               |       280,157 |            97,747 |
| — `ot_layout_gsubgpos` (incl. `Apply` impls on read-fonts)                            |        69,220 |            24,162 |
| — complex shapers (Indic, USE, Khmer, Myanmar, vowel, Hangul, Thai, Hebrew, syllabic) |        72,899 |            20,820 |
| — `ot_shape`                                                                          |        50,420 |            19,184 |
| — `ot` (contextual, GSUB/GPOS lookups)                                                |        25,155 |             8,727 |
| — `face`                                                                              |        16,403 |             5,809 |
| — `buffer`                                                                            |        14,278 |             5,737 |
| — `ot_shaper_arabic`                                                                  |        11,821 |             3,694 |
| `core`/`alloc` instantiated over HarfRust types                                       |         5,223 |             2,342 |
| read-fonts (own functions)                                                            |        24,663 |             6,845 |
| `core`/`alloc` instantiated over read-fonts types                                     |         1,306 |               558 |
| font-types                                                                            |             0 |                 0 |
| `core`/`alloc`/`compiler_builtins`, not generic over a crate                          |        14,858 |             5,825 |
| unicode-bidi                                                                          |        13,138 |             5,929 |
| `wasm-opt`-synthesized (merged/outlined, unnamed)                                     |        10,003 |             3,896 |
| unicode-segmentation (vendored)                                                       |         7,068 |             2,938 |
| smallvec                                                                              |         2,637 |             1,102 |
| talc                                                                                  |         1,684 |               773 |
| libm                                                                                  |           313 |               176 |
| serde_json, once_cell, bytemuck, core_maths                                           |             0 |                 0 |
| **all code**                                                                          | **1,199,041** |       **499,066** |

font-types has no out-of-line function: DWARF puts 14.5 kB of pre-`wasm-opt` bytes from font-types source inside
HarfRust and read-fonts functions. By innermost source frame, about 180 kB of our 918 kB of pre-`wasm-opt` function
bytes are inlined `core`/`alloc` code (iterators, `Vec` growth, slice indexing), and HarfRust functions carry 16.7 kB of
inlined read-fonts code.

### Data by owner

| Data                                                                 |         Raw | Gzip contribution |
| -------------------------------------------------------------------- | ----------: | ----------------: |
| **HarfRust `ucd_table`** (gc, ccc, mirroring, script, decomposition) |      40,462 |        **21,900** |
| unicode-segmentation category trie                                   |      36,157 |             4,068 |
| our script tables (incl. extensions)                                 |      33,198 |             4,610 |
| our line-break tables                                                |      22,113 |             3,195 |
| our bidi-class tables                                                |      18,362 |             1,780 |
| HarfRust syllable machines                                           |      16,846 |             4,203 |
| our kernel tables                                                    |      13,098 |             4,436 |
| our language-tag tables                                              |       7,449 |             4,498 |
| HarfRust USE/Indic category tables                                   |       5,886 |             3,472 |
| other ours (brackets, switch tables, sRGB 1,029)                     |       4,978 |             3,177 |
| unicode-segmentation `InCB_Extend` range table                       |       3,023 |             1,427 |
| HarfRust other (Arabic joining, emoji, charmap, shaper configs)      |      ~3,300 |            ~2,100 |
| `core` Unicode `alphabetic` and `n` tables                           |       2,219 |             1,765 |
| read-fonts (one error string)                                        |          77 |                71 |
| **all data**                                                         | **207,692** |        **62,808** |

Group rows come from matching each segment of the unsplit twin against the source tables; pieces of a split table can
land in a neighbour's row, so table groups are good to about ±1 kB raw. Our tries cost one gzip byte per three to ten raw
bytes. HarfRust's packtab tables cost one per two, which is why one 40 kB table is a third of all data gzip.

### Top 30 functions

|    Raw | Gzip contribution | Owner        | Function                                                                     |
| -----: | ----------------: | ------------ | ---------------------------------------------------------------------------- |
| 28,716 |            10,368 | HarfRust     | `OtShapeContext::shape_internal`                                             |
| 27,423 |            11,702 | ours         | `ParagraphState::prepare_clusters`                                           |
| 26,968 |            12,766 | ours         | `OrderedPlanCompiler::prepare_internal`                                      |
| 26,241 |            12,553 | ours         | `PositionedGlyphArena::build_lines`                                          |
| 21,548 |             9,611 | ours         | `planner_inputs::stage_planner_inputs`                                       |
| 19,581 |             8,941 | ours         | `TextEngine::prepare_update_inner::{closure#0}`                              |
| 13,403 |             2,223 | HarfRust     | `ot_shaper_use::setup_syllables`                                             |
| 12,890 |             6,351 | ours         | `ParagraphState::prepare_flow_layout`                                        |
| 12,765 |             1,998 | HarfRust     | `ot_shaper_vowel_constraints::preprocess_text_vowel_constraints`             |
| 12,553 |             3,669 | HarfRust     | `ShaperData::new`                                                            |
| 11,788 |             5,297 | ours         | `ParagraphState::prepare_shape`                                              |
| 10,634 |             3,642 | ours         | `ParagraphState::empty`                                                      |
| 10,512 |             4,164 | HarfRust     | `hb_ot_shape_planner_t::compile`                                             |
| 10,462 |             3,647 | ours         | `ValidatedCodec::new`                                                        |
|  9,640 |             4,823 | ours         | `ParagraphState::prepare_intrinsic_flow_layout`                              |
|  9,548 |             4,413 | ours         | `ParagraphState::prepare_styles::<prepare_stages::{closure#0}>`              |
|  9,428 |             4,278 | unicode-bidi | `utf16::BidiInfo::new_with_data_source::<Unicode17BidiData>`                 |
|  8,341 |             3,626 | HarfRust     | `hb_ot_shape_planner_t::new`                                                 |
|  8,128 |             2,910 | ours         | `pmndrs_glyph_engine_copy_glyphs`                                            |
|  6,774 |             2,775 | ours         | `line_composition::layout_next_line_integer_facts::<NoCorrections>`          |
|  6,766 |             2,736 | ours         | `PlacementSlotArena<PlacementLogicalKey>::prepare_structural_scope`          |
|  6,496 |             3,092 | ours         | `UnicodeAnalysis::analyze`                                                   |
|  6,439 |             2,655 | ours         | `state::gather::append_planner_gather`                                       |
|  6,195 |             2,915 | ours         | `Editing<ParagraphSource>::build_box`                                        |
|  6,033 |             2,969 | ours         | `FlowLayoutArena::rebuild_until_state_converges::<…>`                        |
|  6,022 |             2,404 | ours         | `line_composition::layout_next_line_witnessed::<ShapedBreakCorrections>`     |
|  5,766 |             2,628 | ours         | `FlowLayoutArena::rebuild_after_exclusion_change_until_state_converges::<…>` |
|  5,698 |             2,389 | HarfRust     | `ot_shaper_indic::initial_reordering`                                        |
|  5,691 |             2,490 | ours         | `PositionedGlyphArena::position_fragment::<&dyn Fn…>`                        |
|  5,628 |             1,561 | ours         | `InlineLeaf::build_numeric_rows::<try_prepare_inline::{closure#3}>`          |

### Top 15 data tables

Raw is the source table's size; gzip is that table compressed on its own.

|    Raw | Gzip alone | Owner                | Table                                                                                              |
| -----: | ---------: | -------------------- | -------------------------------------------------------------------------------------------------- |
| 33,664 |      3,152 | unicode-segmentation | `category_trie::LEAVES`                                                                            |
| 25,920 |      2,199 | ours                 | `SCRIPT_LEAVES`                                                                                    |
| 21,568 |      8,448 | HarfRust             | `_hb_ucd_u16` (gc 6,592 · **script 8,128, dead** · decomposition 6,848)                            |
| 20,032 |      2,134 | ours                 | `LINE_BREAK_LEAVES`                                                                                |
| 19,845 |      7,070 | HarfRust             | `_hb_ucd_u8` (gc 8,294 · ccc 2,580 · mirroring 580 · **script 7,113, dead** · decomposition 1,278) |
| 16,832 |      1,269 | ours                 | `BIDI_CLASS_LEAVES`                                                                                |
|  7,136 |      1,918 | ours                 | `KERNEL_LEAVES`                                                                                    |
|  6,708 |        827 | HarfRust             | `_use_syllable_machine_indices`                                                                    |
|  4,292 |        899 | HarfRust             | `_indic_syllable_machine_indices`                                                                  |
|  3,840 |        461 | ours                 | `SCRIPT_EXTENSION_LEAVES`                                                                          |
|  3,262 |          — | HarfRust             | `_hb_ucd_dm2_u64_map`                                                                              |
|  3,221 |      2,420 | ours                 | `LANGUAGE_ROWS`                                                                                    |
|  3,023 |          — | unicode-segmentation | `InCB_Extend_table` (`(char, char)` rows, binary-searched)                                         |
|  2,944 |        850 | ours                 | `SCRIPT_MIDDLE`                                                                                    |
|  2,560 |        700 | ours                 | `LINE_BREAK_MIDDLE`                                                                                |

## Dependency features, cfgs and dead paths

`cargo tree -e features` for the shipped build (`--no-default-features --features simd128`, `wasm32`):

| Dependency → feature                                                                                | Pulled in by                         |                      Linked bytes | Needed at runtime                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------: | ------------------------------------------------------------------------------------------------------------------------- |
| `harfrust` → `libm` → `core_maths` → `libm` (`arch`)                                                | shaper                               | 313 (`floorf`, `ceilf`, `roundf`) | yes, `no_std` float math                                                                                                  |
| `harfrust` → `read-fonts/experimental_font_api`                                                     | the fork's manifest, unconditionally |                                 0 | no; nothing in `model` is reachable. Compile time only                                                                    |
| `harfrust` → `bytemuck/extern_crate_alloc` (+ `bytemuck_derive`)                                    | fork manifest                        |                                 0 | no code linked                                                                                                            |
| `read-fonts` → `once_cell` `alloc`, `race`                                                          | read-fonts                           |                                 0 | no code linked                                                                                                            |
| `read-fonts` → `font-types/bytemuck`                                                                | read-fonts                           |                     0 out of line | font-types code is all inlined, and needed                                                                                |
| `harfrust` → `smallvec` (default)                                                                   | fork                                 |                             2,637 | yes (`try_grow` ×4, `resize`, `clone`)                                                                                    |
| shaper → `serde_json` (`alloc`), with `itoa`, `zmij`, `memchr`, `serde_core`                        | shaper `[dependencies]`              |                                 0 | no; used by `abi_contract`, the ABI generator and tests. Compile time only                                                |
| shaper → `unicode-bidi` (no default features)                                                       | shaper                               |  13,138 + 5,166 bracket-pair sort | yes; the UTF-16 path and our `Unicode17BidiData` only, no bundled tables                                                  |
| shaper → `unicode-segmentation` `no_std` (vendored)                                                 | shaper                               |           7,068 code, 39,180 data | yes                                                                                                                       |
| shaper → `talc` (`lock_api`, `allocator-api2`)                                                      | shaper, `wasm32`                     |                             1,684 | yes                                                                                                                       |
| shaper features `kernel-lab`, `debug-validation`, `diagnostic-live-memory`, `oracle`, `stage-bench` | —                                    |                                 0 | off; nothing linked. Test-only tables (`KERNEL_TEST_REPRESENTATIVES`, `SEGMENTATION_TEST_REPRESENTATIVES`) are not linked |

Reachable but dead or unneeded at runtime:

- **HarfRust script property** (`_hb_ucd_sc`): 15,241 B of data inside the shared `_hb_ucd_u8`/`_hb_ucd_u16` arrays.
  `CharExt::script` is called only by `UnicodeBuffer::guess_segment_properties`, which the shaper never calls (runs
  carry their script). The function and `_hb_ucd_sc_map` are already stripped; the array region cannot be.
- **Variation deltas with `variations` off**: `Mvar::metric_delta` and `ItemVariationStore::compute_delta` (through
  `BuiltinFontFuncs::vertical_origin`) and `Gsub::feature_variations` (through `hb_ot_map_builder_t::add_lookups` and
  our `ShaperRegistry::ascii_anchor_screen`): 702 raw / 313 gzip. With no coordinates they return nothing, but the
  calls are not behind the feature.
- **`core::str::count::do_count_chars`** (1,421 raw / 541 gzip): only `hb_buffer_t::push_str` calls it, and only
  `ascii_anchor_policy::bootstrap_nominals` calls `push_str`, to push 95 ASCII characters it has just built into a
  `String`.
- **`core` Unicode `alphabetic` and `n` tables** (2,219 data + 654 code; about 2.0 kB gzip): only
  `Editing::is_word` reaches them, through `char::is_alphanumeric` on the word-movement path (`text_move`).
- **Exports not called by the runtime**: `pmndrs_glyph_engine_update` (`textUpdate`; bound in
  `text-shaper-module.ts`, called only by tests, the runtime uses `update_batch`), and `root_count`, `codec_count`,
  `font_stack_count` (not bound by `src/`, used by tests). Together about 200 raw / 100 gzip. Removing them breaks the
  tests that use them as probes.
- `TextEngine::settle_root_positioning` is dead (compiler warning) and already stripped; 0 bytes.

## Ranked candidates

Measured cuts are against the control unless stacked (marked). Gzip is GNU `gzip -9`; Node zlib-9 is in brackets.

|   # | Cut                                                                                                                                          | Where                                     | Status                                   |                       Δ raw |    Δ gzip -9 [Node] | Δ Brotli | Behaviour risk                                                                                | Speed risk                                                                     | Effort                                                                        |
| --: | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------- | --------------------------: | ------------------: | -------: | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
|   1 | Split HarfRust's packtab arrays per property so the dead script region is stripped                                                           | fork (generated `ucd_table.rs`)           | measured                                 |                     −13,973 | **−4,778** [−5,114] |   −3,670 | none: every property checked equal at all 1,114,112 code points                               | none: same loads, other base addresses                                         | low: post-pass on the generated file, or per-property arrays in the generator |
|   2 | `ParagraphState::empty` as a copy of a `const` template                                                                                      | ours                                      | estimate                                 | ≈ −500 (+10 kB static data) |            ≈ −3,300 |        — | none                                                                                          | none (one `memcpy` for 1,104 stores)                                           | medium-high: `const` constructors for every field type                        |
|   3 | Fallible `try_reserve`/`try_reserve_exact` growth out of line: inline capacity check, `#[cold]` per-type grow                                | ours (166 call sites, 62 files)           | measured                                 |                      −6,140 |     −1,892 [−2,021] |     −427 | none                                                                                          | low: the fast path stays inline; growth gains one call. Needs the headline A/B | medium (mechanical)                                                           |
|   4 | `is_word` from an Alphabetic∪N bit in a trie we own, not `core`'s tables                                                                     | ours + generator                          | estimate                                 |                    ≈ −2,000 |            ≈ −1,500 |        — | none at Unicode 17 (`core` is 17.0.0 today); afterwards pinned to our UCD rather than rustc's | none                                                                           | low-medium                                                                    |
|   5 | `InCB_Extend` from the segmentation category trie instead of a range table                                                                   | vendored unicode-segmentation + generator | estimate                                 |                    ≈ −2,900 |            ≈ −1,200 |        — | none, if checked at every scalar like the existing trie                                       | none (trie read replaces a binary search)                                      | low-medium                                                                    |
|   6 | `hb_ot_map_builder_t::add_feature` `#[inline(never)]` (55 inlined sites)                                                                     | fork                                      | measured, stacked on 3                   |                      −5,817 |     −1,164 [−1,265] |     −776 | none                                                                                          | plan compile only (cached plans)                                               | trivial                                                                       |
|   7 | `bootstrap_nominals` pushes the 95 ASCII code points with `UnicodeBuffer::add` (same clusters) instead of building a `String` for `push_str` | ours                                      | measured                                 |                      −2,299 |         −885 [−909] |     −245 | none: same code points and clusters                                                           | none (font registration)                                                       | trivial                                                                       |
|   8 | `hb_ot_map_builder_t::add_pause` `#[inline(never)]`                                                                                          | fork                                      | measured, stacked on 3+6+9               |                      −3,485 |         −465 [−429] |     −321 | none                                                                                          | plan compile only                                                              | trivial                                                                       |
|   9 | `ShaperRegistry::font_index` binary search out of line (memo hit stays inline)                                                               | ours                                      | measured, stacked on 3+6                 |                      −1,645 |         −405 [−516] |     −496 | none                                                                                          | a call on memo misses                                                          | trivial                                                                       |
|  10 | Short export names in the generated ABI                                                                                                      | ours (ABI generator, TS binding, tests)   | measured by rewriting the export section |                      −1,375 |                −399 |        — | none                                                                                          | none                                                                           | low; costs readable stack traces                                              |
|  11 | Variation-delta calls behind `variations`                                                                                                    | fork                                      | estimate (removal price)                 |                        −702 |              ≈ −300 |        — | none (no coordinates are passed)                                                              | none                                                                           | low                                                                           |
|  12 | Drop the unused exports                                                                                                                      | ours                                      | estimate                                 |                      ≈ −200 |              ≈ −100 |        — | none at runtime; tests use them                                                               | none                                                                           | low                                                                           |
|   — | `TableRange::new` `#[inline(never)]` (19 sites in `TableRanges::new`)                                                                        | fork                                      | measured, **not recommended**            |                      −4,781 |         −579 [−633] | **+265** | none                                                                                          | none                                                                           | trivial                                                                       |

Cuts 1, 3, 6, 7, 8 and 9 built together: **1,377,044 raw / 553,422 gzip -9 (−9,637) / 556,943 Node zlib (−10,164)
/ 444,137 Brotli (−6,644)**. Native `cargo test --release --lib` of the shaper on that combined tree: 592 passed,
0 failed (includes `simple_text_equals_harfrust_on_repository_fonts`).

Checked and not worth doing:

- **Re-encoding the live HarfRust UCD properties** (gc, ccc, mirroring, decomposition) as our 3-stage tries: after
  cut 1 the packtab regions are 26,564 raw / 11,110 gzip; the best 3-stage tries over the same values are
  43,654–72,550 raw / 12,566–13,811 gzip. Packtab is already the better gzip encoding for these.
- **Answering HarfRust's script lookup from our script trie**: unnecessary, nothing reads it (cut 1).
- Our tries, the segmentation trie and the HarfRust machines are gzip-tuned or near it; not re-encoded (owner rule).
- `stage_planner_inputs` (9,611 gzip) and `ValidatedCodec::new` (3,647) are boundary validation; cold code at
  `opt-level = "s"` was priced at 907 gzip for all 57 cold functions (2026-11-23).
- Remaining generic copies (`twiggy monos`: drop glue 8.6 kB duplicate over 27 types; `(u64, u32)`, `u64` and `usize`
  pdqsort 9.5 kB; HarfRust `apply_chain_with_sequences` 5.6 kB; unicode-bidi bracket and HarfRust Indic stable sorts
  5.3 kB) are as described in `wasm-size-reduction.md`, unchanged.
- talc (773 gzip) and smallvec (1,102 gzip): no smaller equivalent identified.
- Hot HarfRust inlining (`next_glyph` 15 kB, `CoverageTable::get` 14 kB, `may_skip` 9 kB pre-`wasm-opt` duplicate
  bytes) is specialisation on the per-glyph path; left alone.

Already priced elsewhere, with this build's numbers for reference only: the complex shapers are now 72,899 raw / 20,820
gzip of code plus 22,732 raw / 7,675 gzip of machines and category tables (an upper bound for the interpreter and
per-script payload estimate); language-tag resolution is 2,734 raw code plus 7,449 raw data, about 5.8 kB gzip
(payload candidate); the vertical gate was about 1.2 kB.

## Evidence gaps

- No cut has been through the layout oracles, the fork parity tests or the headline benchmark; only the shaper's
  native lib tests ran (combined tree, green). Cuts 1, 7, 9 and 12 are behaviour-identical by construction (cut 1
  checked exhaustively); 3, 6 and 8 change only inlining.
- Estimates 2, 4, 5 and 11 price the removed bytes from the shipped module and add a measured or guessed replacement
  cost; they are not builds.
- The integration worktree moved past `sil-green-62` while this ran (`experiments/sil-buildflags`, the shaper
  `-O3` build decision; its `dist/text-shaper.wasm` is 1,417,876 raw). Every delta here is against `sil-green-62` and
  should be re-measured on the next tag.
