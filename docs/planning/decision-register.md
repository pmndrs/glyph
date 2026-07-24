---
type: Decision Register
title: Decision register
description: Tracks proposed architectural choices and the decisions required before implementation begins.
tags: [decisions, governance]
timestamp: 2026-07-24T14:01:29Z
---

# Decision register

Status: proposed decisions awaiting maintainer review  

This register records choices, not their full rationale. The linked API, architecture, data contracts, roadmap, and research are authoritative for detail. Accepted choices receive an ADR with the exact decision, alternatives, consequences, and date.

Status vocabulary: **Proposed**, **Experiment**, **Deferred**, **Settled for V0**, **Accepted**.

## Product and public API

| ID | Decision | Status |
| --- | --- | :---: |
| D-001 | `pmndrs/text` is the product | Proposed |
| D-002 | Slug is one raster, not the shaping or package identity. | Proposed |
| D-003 | V1 targets horizontal LTR/RTL text and static font instances. | Proposed |
| D-004 | `@pmndrs/text` is Three.js-first; `@pmndrs/text/react` is a thin optional wrapper. | Proposed |
| D-005 | React uses one root `<Text>` with nested `<Text>` inline spans and direct props. | Proposed |
| D-006 | A canonical source-font URL infers its `.font.glb` sibling; `.glb` is baked-only. | Proposed |
| D-007 | Every package entry point is native ESM; no CommonJS build or `require` export ships. | Proposed |
| D-008 | Runtime raster and baker modules are typed capability values; core has no closed raster list or mandatory raster package. | Proposed |
| D-009 | `Text` and paragraph layouts remain non-generic; compile-time precision is concentrated at composition seams. | Proposed |
| D-067 | `defineFont(input, raster)` is the recommended reusable token; equivalent string, URL, and object inputs deduplicate by normalized request and validated shaping identities rather than object identity. | Proposed |
| D-068 | Raster identity is the RFC 8785 canonical package descriptor's SHA-256 `rasterKey`; callers never provide arbitrary raster IDs. | Proposed |
| D-016 | `rust-toolchain.toml` is the sole Rust toolchain authority. `mise.toml` consumes that idiomatic file instead of duplicating Rust configuration; pnpm and Cargo remain the normal command interface. | Settled for V0 |

D-004/005 follow the established uikit split: the core owns every feature and React only reconciles lifecycle and props. Nested text follows React Native's attributed-text model; direct props and Suspense match uikit/Drei conventions. D-006 makes the short string form canonical while preserving explicit source/baked overrides and preload identity. D-007 fixes native ESM, explicit subpath exports, module workers, and `import()`-based lazy boundaries as package invariants. D-008/009 adopt Koota's value-oriented inference at raster/plugin boundaries without applying type-level models to runtime binary data. See the [API contract](api-shapes.md).

## Shaping and paragraphs

| ID | Decision | Status |
| --- | --- | :---: |
| D-010 | HarfRust is the runtime baseline; HarfBuzz is the second oracle. | Proposed |
| D-011 | One shaper serves every raster and supported script. | Proposed |
| D-012 | Clusters are UTF-16 offsets; Unicode lookup uses scalar values. | Proposed |
| D-013 | Shaped output is structure-of-arrays with font-scoped glyph IDs. | Proposed |
| D-014 | V0 retains a closed shaping-only SFNT; compiled lookup data is later. | Proposed |
| D-015 | Browser JIT, per-font AOT Wasm, and MLIR are outside V1. | Deferred |
| D-040 | Paragraph policy and caches live in JavaScript; shaping lives in Wasm. | Proposed |
| D-041 | Width changes always reflow, but do not reshape the whole paragraph. | Proposed |
| D-042 | Breaks use source coordinates, Unicode opportunities, clusters, and safety flags. | Proposed |
| D-043 | V1 uses greedy word/character wrapping; balanced wrap and hyphenation are later. | Proposed |
| D-044 | Third-party layout systems consume allocation-light synchronous `measure` results and request positioned `layout` output only for a box that needs drawing. | Proposed |
| D-045 | Paragraph axes model unconstrained, at-most, and exact sizing without importing a host layout vocabulary; host adapters own translation, invalidation, padding, transforms, and clipping. | Proposed |
| D-069 | uikit owns an incremental adapter from its current `CustomLayouting` and content-box signals; no uikit, Yoga, or Preact Signal types enter core. | Proposed |
| D-072 | The JavaScript paragraph engine owns UAX #9, #14, #24, and #29 using Unicode data pinned to the core font provenance version. | Proposed |

The [shaping contract](shaping-data-contract.md), [API contract](api-shapes.md), [uikit integration](uikit-integration.md), and [conformance plan](conformance-plan.md) define the consequences and fixtures.

## Identity and container

| ID | Decision | Status |
| --- | --- | :---: |
| D-020 | V0 glyph IDs remain source-local and are scoped by `FontHandle`. | Proposed |
| D-021 | GLB separates the core font from technique-specific rasters. | Proposed |
| D-022 | Use the provisional `PMNDRS_font` vendor-extension family. | Proposed |
| D-023 | Core shaping is one SFNT view; rasters use final GPU records/KTX2. | Proposed |
| D-024 | V0 local and shaped glyph IDs are `u16`. | Proposed |
| D-062 | Core and raster schemas are identical whether embedded or split. | Proposed |

Rasters attach only when shaping hash, glyph count, glyph-ID width, raster key, and extension version match. See the [`PMNDRS_font` extension family](extensions/) and [registration draft](gltf-extension-registration.md).

## Baking and loading

| ID | Decision | Status |
| --- | --- | :---: |
| D-030 | Node and Worker hosts share one portable bake core. | Proposed |
| D-031 | The loader is baked-first and dynamically imports Worker fallback. | Proposed |
| D-032 | V0 has no force-runtime or skip-baked switch. | Proposed |
| D-033 | In-memory deduplication is required; persistent bake caching is later. | Deferred |
| D-034 | The integration proof generates one grayscale bitmap strike. | Proposed |
| D-035 | Raster modules and generators are optional imports. | Proposed |
| D-036 | Baked assets are data; baker surfaces are libraries/modules. | Proposed |
| D-066 | The CLI resolves baker modules through an imported or explicitly named package's flat `pmndrs.text` map and public ESM exports; package semver governs compatibility and the CLI never scans dependency directories. | Settled for V0 |
| D-071 | The Node baker statically discovers `defineFont` uses and literal raster descriptors without executing application code; dynamic font origins remain valid when an unambiguous local pathname can be resolved, otherwise runtime fallback remains authoritative. | Proposed |
| D-070 | Bitmap strike tuples are non-empty, duplicate-free static positive integer literals and are part of raster identity; a missing declared strike makes a baked raster incompatible. | Proposed |

The [architecture](architecture.md) owns loading behavior and dependency rules. The [API contract](api-shapes.md) owns host and Worker shapes.

## Raster

| ID | Decision | Status |
| --- | --- | :---: |
| D-050 | V1 ships bitmap, MSDF, and Slug; bitmap alone is only the proof. | Proposed |
| D-051 | Rasters never duplicate advances, kerning, or shaping behavior. | Proposed |
| D-052 | Direct-to-GPU means no reconstruction/repacking, not zero upload. | Proposed |
| D-053 | The MSDF raster uses linear MTSDF RGBA8; padding stays in raster bounds. | Proposed |
| D-054 | Deterministic unhinted bitmap oversampling is the baseline candidate. | Experiment |
| D-055 | Recommend MSDF generally, but require an explicit raster module. | Proposed |
| D-056 | Windfoil is research prior art, not a planned text backend. | Proposed |
| D-057 | Post-slice Slug includes color-emoji vector paint; safe OpenType-SVG and standalone-SVG icon baking lands in the large-coverage CJK/icon milestone. | Proposed |
| D-058 | Fill, opacity, outline, and hard shadow are baseline game-text styles. | Proposed |
| D-059 | Payload reports separate shaping, transport, decoded, and GPU bytes. | Proposed |
| D-061 | Slug bands compress exactly; curve compression remains quality-gated. | Proposed |
| D-064 | V1 does not support plain MSDF assets or parallel MSDF/MTSDF batches. | Proposed |
| D-065 | First-party raster packages use TSL internally; the core raster API is shader-system and backend agnostic. | Proposed |
| D-073 | V1 assigns one selected raster per font slot; per-glyph raster mixing is additive color/SVG work after the first release. | Proposed |
| D-075 | Latin remains the V1 release priority; CJK and icon support share the next large-coverage paging milestone and cannot expand the Latin-first exit gate. | Proposed |
| D-076 | Raster page indexes are logical IDs; page payloads may be embedded or independently addressed, and raster modules own preparation, residency, eviction, and backend batching. | Proposed |

The [raster contract](raster-data-contract.md) owns records. The [capability matrix](renderer-capabilities.md), [payload budget](payload-budget.md), and [compression analysis](gpu-compression.md) own evidence and limitations.

## Verification and optimization

| ID | Decision | Status |
| --- | --- | :---: |
| D-060 | Optimizations require reproducible A/B evidence and no quality loss. | Proposed |
| D-063 | The interactive/headless benchmark harness is the first executable artifact; one shared registry defines every proof and measurement, including the first bitmap frame. | Proposed |
| D-074 | Every rendering scenario uses current browser HTML/CSS output as its visual reference; HarfRust/HarfBuzz remain structured shaping oracles, and legacy Three Flatland Slug is historical comparison data only. | Proposed |

The [benchmark plan](benchmark-plan.md), [conformance plan](conformance-plan.md), and [autoresearch protocol](autoresearch.md) define the gates.

## Decisions required before implementation

1. Accept or revise all proposed decisions, including D-067–076; D-016 and D-066 are already settled for V0.
2. Pin HarfRust, HarfBuzz, Unicode, glTF schema, and generator versions.
3. Confirm the provisional `PMNDRS` prefix and assign its Khronos request.
4. Choose the first font fixture and target browser/GPU matrix.
5. Review the [API](api-shapes.md), [architecture](architecture.md), [shaping contract](shaping-data-contract.md), [raster contract](raster-data-contract.md), and [roadmap](../roadmap/roadmap.md).
