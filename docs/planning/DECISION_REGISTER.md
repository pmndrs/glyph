# Decision register

Status: proposed decisions awaiting maintainer review  
Last updated: 2026-07-22

This is the concise review surface for architectural choices. Source material lives in [`RESEARCH.md`](../../RESEARCH.md), the reasoning history lives in [`DESIGN_SYNTHESIS.md`](DESIGN_SYNTHESIS.md) and [`DISCUSSION_EXTRACTION.md`](DISCUSSION_EXTRACTION.md), and unresolved implementation questions live in [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).

No item in this register is an accepted ADR yet. When a decision is accepted, create an ADR that records the exact choice, alternatives, consequences, and date, then link it here.

## Status vocabulary

- **Proposed**: recommended based on current research.
- **Experiment required**: direction is plausible but a prototype or measurement is required.
- **Blocked**: a prerequisite decision is missing.
- **Deferred**: intentionally outside V1.
- **Accepted**: approved and recorded in an ADR.

## Product and ownership

| ID | Decision | Status | Rationale / evidence | Acceptance consequence |
| --- | --- | --- | --- | --- |
| D-001 | `pmndrs/text` is the shipping product; Three Flatland becomes a downstream consumer. | Proposed | Separates general text infrastructure from one renderer/package. See the [project brief](PROJECT_BRIEF.md). | Public API and format names must not depend on Three Flatland classes. |
| D-002 | Slug is one presentation backend, not the shaping or package identity. | Proposed | The shaped glyph model is equally usable by vector, distance-field, and bitmap renderers. | No Slug fields in shaping or paragraph interfaces. |
| D-003 | V1 supports horizontal LTR/RTL text and static font instances. | Proposed | Constrains the first conformance target while retaining modern script shaping. | Vertical writing and runtime variation axes remain deferred. |

## Shaping

| ID | Decision | Status | Rationale / evidence | Acceptance consequence |
| --- | --- | --- | --- | --- |
| D-010 | HarfRust is the primary behavioral baseline; HarfBuzz is the second oracle. | Proposed | HarfRust ports HarfBuzz shaping/Unicode logic and uses Fontations; known differences are documented upstream. | Versions are pinned and every optimized path is differentially tested. |
| D-011 | One unified shaper serves every presentation and script supported by the baseline. | Proposed | Capabilities vary by font data; public “Latin/complex/HarfBuzz profiles” would fragment behavior. | One request/output model, with optional data sections and capability bits. |
| D-012 | Clusters are UTF-16 source offsets; Unicode lookup operates on scalar values. | Proposed | JavaScript APIs use UTF-16 indices while full Unicode cmap requires scalar decoding. | Every fixture tests surrogate pairs and source mapping. |
| D-013 | Shaping output is structure-of-arrays with font-scoped glyph IDs, clusters, four positions, and flags. | Proposed | Matches the HarfBuzz output model and favors bulk Wasm access. | No object-per-glyph bridge or renderer metadata. |
| D-014 | Compiled lookup data is deferred from V0; runtime HarfRust font access is the complete initial shaping path. | Deferred | The hard script/buffer behavior should remain inherited, and speed/size benefits of replacement are unmeasured. | First establish registration, plan caching, coarse calls, correctness, and performance baselines. |
| D-015 | Browser-time JIT, per-font AOT Wasm, and MLIR are not V1 dependencies. | Deferred | Module-generation cost and benefit are unknown; a high-level interpreter/reference path must exist first. | Reconsider only after profiling identifies lookup dispatch as material. |

## Font identity and container

| ID | Decision | Status | Rationale / evidence | Acceptance consequence |
| --- | --- | --- | --- | --- |
| D-020 | V0 glyph IDs are source-local and scoped by `FontHandle`; a future baker may introduce a dense per-font remap. | Proposed | Runtime HarfRust shaping can ship without a compiler while the `(font, glyph)` identity remains compatible with later packed assets. | No glyph ID is globally meaningful; presentations and caches include font identity. |
| D-021 | GLB carries an extension family separating shared font data from presentation payloads. | Proposed | glTF supplies an extensible binary container and existing Slug work proves the delivery shape. | Stabilize internal schemas before considering Khronos registration. |
| D-022 | `FL_font`, `FL_font_slug`, `FL_font_distance_field`, and `FL_font_bitmap` are provisional names. | Blocked | Prefix/name ownership has not been reviewed by pmndrs or Khronos. | Do not publish a stable extension under these names yet. |
| D-023 | CPU shaping data uses extension-owned flat binary sections; GPU data uses final upload formats. | Proposed | Generic accessors are useful for GPU interop but needlessly constrain compact CPU records. | A small JSON directory points to versioned binary sections. |
| D-024 | V0 shaped buffers declare `u16` or `u32` glyph-ID width per registered font. | Proposed | V0 does not subset fonts, so a hard `u16` assumption would make identity depend on future compiler work. | Buffer headers and presentation validators reject width mismatches explicitly. |

## Baking and loading

| ID | Decision | Status | Rationale / evidence | Acceptance consequence |
| --- | --- | --- | --- | --- |
| D-030 | A shared portable compiler core remains a future option, not a V0 dependency. | Deferred | The one-font runtime slice can validate shaping, layout, identity, and rendering without compiler architecture. | No compiler API, subsetting, remapping, or native/Wasm parity work enters the current roadmap. |
| D-031 | V0 registers original OpenType bytes in HarfRust and pairs them with pre-generated presentation fixtures. | Proposed | Provides correct runtime shaping and a complete renderer path with minimal machinery. | Font registration caches parsed state/plans; fixture assembly does not interpret GSUB/GPOS. |
| D-032 | Runtime worker baking is deferred until the measured runtime path establishes a need. | Deferred | Worker protocol and canonical output would expand the first slice without improving its central proof. | No worker, cancellation, or bake progress API in V0. |
| D-033 | Persistent baked-result caching is deferred with runtime baking. | Deferred | There is no generated runtime artifact to cache in V0. | Only normal runtime font/shape/layout/GPU caches are designed now. |
| D-034 | Product bitmap generation is deferred; V0 consumes a pinned pre-generated bitmap fixture. | Deferred | This proves presentation contracts without introducing a generalized font generator. | Fixture provenance/generator version is recorded; runtime layout still uses OpenType metrics. |

## Paragraph layout

| ID | Decision | Status | Rationale / evidence | Acceptance consequence |
| --- | --- | --- | --- | --- |
| D-040 | Paragraph policy and caches live in TypeScript/JavaScript; shaping remains in Wasm. | Proposed | Constraints and framework lifecycle are application-facing, while shaping is correctness-sensitive. | The boundary is coarse and data-oriented. |
| D-041 | A width change always reflows but does not automatically reshape the entire paragraph. | Proposed | Broad shaped clusters are reusable; only boundary-sensitive final ranges require reshaping. | Width-only calls make zero or one batched Wasm call. |
| D-042 | Line breaks are selected in source-text coordinates using Unicode opportunities plus cluster/unsafe flags. | Proposed | Glyph-level breaking is invalid for ligatures, marks, reordering, and ZWJ sequences. | UAX #14, UAX #29, bidi, and shaper flags have explicit fixtures. |
| D-043 | Greedy word/character wrapping is V1; balanced wrapping and full hyphenation are later strategies. | Proposed | Establishes a correct baseline without coupling shaping to one line optimizer. | Strategy interface must permit later algorithms. |

## Presentation

| ID | Decision | Status | Rationale / evidence | Acceptance consequence |
| --- | --- | --- | --- | --- |
| D-050 | V1 presentation targets are Slug, MTSDF, and generated grayscale bitmap strikes. | Proposed | Covers resolution-independent vector, scalable atlas, and pixel-size-specific rendering. | One fixture must switch techniques without reshaping. |
| D-051 | Shared advances and kerning never appear in presentation payloads. | Proposed | Plane/atlas bounds control drawing, not logical text flow. | Generator metrics are validation inputs only. |
| D-052 | “Direct to GPU” means no per-glyph reconstruction or numeric repacking, not zero upload/decode work. | Proposed | Browsers still create resources and may decode compressed images. | Documentation and benchmarks name unavoidable bulk operations honestly. |
| D-053 | MTSDF channels are linear data and technique-specific padding stays in presentation plane bounds. | Proposed | Required by msdfgen's rendering model. | Do not infer logical bounds or advances from atlas rectangles. |
| D-054 | Bitmap hinting policy is unresolved; deterministic unhinted oversampling is the baseline candidate. | Experiment required | Hinting may improve tiny text but adds complexity and parity risk. | Compare visual quality, size, native/Wasm determinism, and bake cost. |
| D-055 | MTSDF is the proposed general-purpose recommendation; callers retain explicit presentation choice. | Proposed | Current research places bitmap at fixed tiny sizes, MTSDF across ordinary scalable use, and Slug at high-fidelity large/dynamic scale. | Convenience policy may recommend but must not silently switch techniques or force unused engines into the bundle. |
| D-056 | Windfoil remains future optional presentation research rather than a V1 dependency. | Proposed | Available comparisons show advantages in specialized high-magnification/vector-art cases, not ordinary UI text. | Its preprocessing, shader, and payload do not block or enter V1 core contracts. |

## Optimization governance

| ID | Decision | Status | Rationale / evidence | Acceptance consequence |
| --- | --- | --- | --- | --- |
| D-060 | Agent-discovered optimizations require reproducible end-to-end A/B evidence and zero quality/conformance loss. | Proposed | Prior Slug work found both meaningful wins and attractive changes that were neutral or visually approximate. | The autoresearch agent may make local evidence commits but never push, merge, publish, weaken fixtures, or accept a quality tradeoff. |

## Decisions needed to start Phase 1

Maintainer review should address these first:

1. Accept or revise D-001, D-002, D-010, D-011, D-020, D-024, D-031, D-040, and D-050.
2. Resolve version pins under D-010.
3. Decide the experiment name/prefix policy under D-022.
4. Choose the pinned one-font fixture and target browser matrix.
5. Review the [runtime API](API_SHAPES.md), [V0 data design](DATA_DESIGN_V0.md), and [vertical-slice roadmap](VERTICAL_SLICE_ROADMAP.md).
