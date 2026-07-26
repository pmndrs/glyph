---
type: Decision Register
title: Decision register
description: Tracks proposed architectural choices and the decisions required before implementation begins.
tags: [decisions, governance]
sources:
  - id: "citation-1"
    resource: "benchmark-plan.md"
    title: "Benchmark plan"
  - id: "citation-2"
    resource: "../../README.md#benchmark-harness-wireframe"
    title: "Repository benchmark-harness wireframe"

generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-26T20:04:16Z"
---

# Decision register

Status: mixed; accepted choices and remaining proposals are recorded per row

This register records choices, not their full rationale. The linked API, architecture, data contracts, roadmap, and research are authoritative for detail. Accepted choices are grouped into four durable records with the exact decision, alternatives, consequences, and date:

- [package and runtime boundaries](decisions/0001-package-runtime-boundaries.md);
- [universal shaping and font identity](decisions/0002-shaping-and-font-identity.md);
- [raster and container contracts](decisions/0003-raster-and-container-contracts.md);
- [verification and optimization policy](decisions/0004-verification-and-optimization.md).

Status vocabulary: **Proposed**, **Experiment**, **Deferred**, **Settled for V0**, **Accepted**.

Implementation and passing fixtures are evidence, not approval. A proposed row changes to **Accepted** only after explicit maintainer review; the roadmap therefore remains open even where a candidate contract already compiles.

## Product and public API

| ID | Decision | Status |
| --- | --- | :---: |
| D-001 | `pmndrs/text` is the product | Accepted |
| D-002 | Slug is one raster, not the shaping or package identity. | Accepted |
| D-003 | V1 targets horizontal LTR/RTL text and static font instances. | Accepted |
| D-004 | `@pmndrs/text` is Three.js-first; `@pmndrs/text/react` is a thin optional wrapper. | Accepted |
| D-005 | React uses one root `<Text>` with nested `<Text>` inline spans and direct props. | Accepted |
| D-006 | A canonical source-font URL infers its `.font.glb` sibling; `.glb` is baked-only. | Accepted |
| D-007 | Every package entry point is native ESM; no CommonJS build or `require` export ships. | Accepted |
| D-008 | Runtime raster and baker modules are typed capability values; core has no closed raster list or mandatory raster package. | Accepted |
| D-009 | `Text` and paragraph layouts remain non-generic; compile-time precision is concentrated at composition seams. | Accepted |
| D-067 | `defineFont(input, raster)` is the recommended reusable token; equivalent string, URL, and object inputs deduplicate by normalized request and validated shaping identities rather than object identity. | Accepted |
| D-068 | Raster identity is the RFC 8785 canonical package descriptor's SHA-256 `rasterKey`; callers never provide arbitrary raster IDs. | Accepted |
| D-086 | Raster-baker descriptors must satisfy `JsonValue` in the public TypeScript contract and are still validated as untrusted plugin output; each descriptor/key pair is resolved once and reused for ordering, packaging, and baking. | Accepted |
| D-087 | `@pmndrs/text-font-baker` solely owns the optimized font-baker Wasm and its canonical URL; offline and runtime hosts share dependency-light bake policy but retain platform-specific I/O, and runtime size ceilings forbid heavy graph drift. | Accepted |
| D-016 | The root `rust-toolchain.toml` is the sole product Rust authority. The isolated coverage-fuzz workspace has one exact dated nightly authority because libFuzzer needs unstable compiler instrumentation. Root and nested mise configurations consume their contextual idiomatic files instead of duplicating Rust versions; pnpm and Cargo remain the normal command interface. | Settled for V0 |

D-004/005 follow the established uikit split: the core owns every feature and React only reconciles lifecycle and props. Nested text follows React Native's attributed-text model; direct props and Suspense match uikit/Drei conventions. D-006 makes the short string form canonical while preserving explicit source/baked overrides and preload identity. D-007 fixes native ESM, explicit subpath exports, module workers, and `import()`-based lazy boundaries as package invariants. D-008/009 adopt Koota's value-oriented inference at raster/plugin boundaries without applying type-level models to runtime binary data. See the [API contract](api-shapes.md).

## Shaping and paragraphs

| ID | Decision | Status |
| --- | --- | :---: |
| D-010 | HarfRust is the runtime baseline; HarfBuzz is the second oracle. | Accepted |
| D-011 | One shaper serves every raster and supported script. | Accepted |
| D-012 | Clusters are UTF-16 offsets; Unicode lookup uses scalar values. | Accepted |
| D-013 | Shaped output is structure-of-arrays with font-scoped glyph IDs. | Accepted |
| D-014 | V0 retains a closed shaping-only SFNT; compiled lookup data is later. | Accepted |
| D-015 | Browser JIT, per-font AOT Wasm, and MLIR are outside V1. | Deferred |
| D-040 | Paragraph policy and caches live in JavaScript; shaping lives in Wasm. | Accepted |
| D-041 | Width changes always reflow, but do not reshape the whole paragraph. | Accepted |
| D-042 | Breaks use source coordinates, Unicode opportunities, clusters, and safety flags. | Accepted |
| D-043 | V1 uses greedy word/character wrapping; balanced wrap and hyphenation are later. | Accepted |
| D-044 | Third-party layout systems consume allocation-light synchronous `measure` results and request positioned `layout` output only for a box that needs drawing. | Accepted |
| D-045 | Paragraph axes model unconstrained, at-most, and exact sizing without importing a host layout vocabulary; host adapters own translation, invalidation, padding, transforms, and clipping. | Accepted |
| D-069 | uikit owns an incremental adapter from its current `CustomLayouting` and content-box signals; no uikit, Yoga, or Preact Signal types enter core. | Accepted |
| D-072 | The JavaScript paragraph engine owns UAX #9, #14, #24, and #29 using Unicode data pinned to the core font provenance version. | Accepted |
| D-085 | Roadmap item 5.4 makes horizontal CJK bake, source/reduced HarfRust equivalence, independent HarfBuzz agreement, and paragraph layout a pre-render gate; raster paging, CJK rendering coverage, fallback, and vertical layout remain separate later work. | Accepted |
| D-088 | V0 conditionally retains source `BASE`, `VORG`, `vhea`, and `vmtx` tables without fabrication so baking does not destroy vertical-form data; vertical shaping and paragraph layout remain deferred. | Accepted |

The [shaping contract](shaping-data-contract.md), [API contract](api-shapes.md), [uikit integration](uikit-integration.md), and [conformance plan](conformance-plan.md) define the consequences and fixtures.

## Identity and container

| ID | Decision | Status |
| --- | --- | :---: |
| D-020 | V0 glyph IDs remain source-local and are scoped by `FontHandle`. | Accepted |
| D-021 | GLB separates the core font from technique-specific rasters. | Accepted |
| D-022 | Use the provisional `PMNDRS_font` vendor-extension family. | Accepted |
| D-023 | Core shaping is one SFNT view; rasters use final GPU records/KTX2. | Accepted |
| D-024 | V0 local and shaped glyph IDs are `u16`. | Accepted |
| D-062 | Core and raster schemas are identical whether embedded or split. | Accepted |
| D-089 | Raster artifact filenames bind both the font's shaping hash and the package-owned raster key; bitmap V0 accepts only atlas-representable `1..=1022` ppem strikes. | Accepted |
| D-090 | Runtime font baking defaults to one active FIFO Worker job; queued work shares that instance, active cancellation replaces it, and a parallel Worker pool requires representative multi-font throughput and memory evidence before adoption. | Accepted |

Rasters attach only when shaping hash, glyph count, glyph-ID width, raster key, and extension version match. See the [`PMNDRS_font` extension family](extensions/) and [registration draft](gltf-extension-registration.md).

## Baking and loading

| ID | Decision | Status |
| --- | --- | :---: |
| D-030 | Node and Worker hosts share one portable bake core. | Accepted |
| D-031 | The loader is baked-first and dynamically imports Worker fallback. | Accepted |
| D-032 | V0 has no force-runtime or skip-baked switch. | Accepted |
| D-033 | In-memory deduplication is required; persistent bake caching is later. | Deferred |
| D-034 | The integration proof generates one grayscale bitmap strike. | Accepted |
| D-035 | Raster modules and generators are optional imports. | Accepted |
| D-036 | Baked assets are data; baker surfaces are libraries/modules. | Accepted |
| D-066 | The CLI resolves baker modules through an imported or explicitly named package's flat `pmndrs.text` map and public ESM exports; package semver governs compatibility and the CLI never scans dependency directories. | Settled for V0 |
| D-071 | The Node baker statically discovers `defineFont` uses and literal raster descriptors without executing application code; dynamic font origins remain valid when an unambiguous local pathname can be resolved, otherwise runtime fallback remains authoritative. | Accepted |
| D-070 | Bitmap strike tuples are non-empty, duplicate-free static positive integer literals and are part of raster identity; a missing declared strike makes a baked raster incompatible. | Accepted |
| D-077 | The portable bake core ships one `wasm32-unknown-unknown` module behind a versioned JSON-described C ABI and direct linear-memory TypeScript shim; it ships no platform binaries, WASI dependency, Embind, or binding-generator runtime. | Settled for V0 |
| D-078 | The bake Wasm uses `no_std + alloc` and aborting panics; its allocator is ABI-private. `dlmalloc` is the baseline, `rlsf` is the primary challenger, and any replacement requires representative benchmark evidence. Host code owns gzip/Brotli measurement. | Experiment |
| D-084 | Font format parsing and outline/metric interpretation use maintained Fontations `read-fonts` and `skrifa`; project code owns bake policy and artifact contracts, not a parallel OpenType parser or geometry engine. | Settled for V0 |

The [architecture](architecture.md) owns loading behavior and dependency rules. The [API contract](api-shapes.md) owns host and Worker shapes.

## Raster

| ID | Decision | Status |
| --- | --- | :---: |
| D-050 | V1 ships bitmap, MSDF, and Slug; bitmap alone is only the proof. | Accepted |
| D-051 | Rasters never duplicate advances, kerning, or shaping behavior. | Accepted |
| D-052 | Direct-to-GPU means no reconstruction/repacking, not zero upload. | Accepted |
| D-053 | The MSDF raster uses linear MTSDF RGBA8; padding stays in raster bounds. | Accepted |
| D-054 | Deterministic unhinted bitmap oversampling is the baseline candidate. | Experiment |
| D-055 | Recommend MSDF generally, but require an explicit raster module. | Accepted |
| D-056 | Windfoil is research prior art, not a planned text backend. | Accepted |
| D-057 | Post-slice Slug includes color-emoji vector paint; safe OpenType-SVG and standalone-SVG icon baking lands in the large-coverage CJK/icon milestone. | Accepted |
| D-058 | Fill, opacity, outline, and hard shadow are baseline game-text styles. | Accepted |
| D-059 | Payload reports separate shaping, transport, decoded, and GPU bytes. | Accepted |
| D-061 | Slug bands compress exactly; curve compression remains quality-gated. | Accepted |
| D-064 | V1 does not support plain MSDF assets or parallel MSDF/MTSDF batches. | Accepted |
| D-065 | First-party raster packages use TSL internally; the core raster API is shader-system and backend agnostic. | Accepted |
| D-073 | V1 assigns one selected raster per font slot; per-glyph raster mixing is additive color/SVG work after the first release. | Accepted |
| D-075 | Latin remains the V1 rendering and raster-coverage priority. Pre-render CJK shaping/layout conformance may harden universal core assumptions, but CJK raster paging and icon coverage remain a post-V1 milestone and do not expand the Latin-first renderer exit gate. | Accepted |
| D-076 | Raster page indexes are logical IDs; page payloads may be embedded or independently addressed, and raster modules own preparation, residency, eviction, and backend batching. | Accepted |
| D-091 | Bitmap plane bounds preserve the rasterizer's integer pixel placement with `planeUnitsPerEm = strike ppem`; the shared TSL vertex graph snaps projected quad edges to physical framebuffer pixels so native rendering maps one atlas texel to one device pixel. | Accepted |
| D-092 | Hinted grayscale strikes and optional four-phase grayscale packing remain measured research. LCD/ClearType subpixel rendering, panel-order assumptions, runtime hint interpreters, and distance-field reconstruction are out of scope. | Experiment |
| D-093 | Bitmap V0 renders fill and opacity only and rejects outline or shadow through the raster paint-validation seam; MTSDF owns those distance-based effects rather than silently degrading them. | Accepted |

The [raster contract](raster-data-contract.md) owns records. The [capability matrix](renderer-capabilities.md), [payload budget](payload-budget.md), and [compression analysis](gpu-compression.md) own evidence and limitations.

## Verification and optimization

| ID | Decision | Status |
| --- | --- | :---: |
| D-060 | Optimizations require reproducible A/B evidence and no quality loss. | Accepted |
| D-063 | The interactive/headless benchmark harness is the first executable artifact; one shared registry defines every proof and measurement, including the first bitmap frame. | Accepted |
| D-074 | Every rendering scenario uses current browser HTML/CSS output as its visual reference; HarfRust/HarfBuzz remain structured shaping oracles, and legacy Three Flatland Slug is historical comparison data only. | Accepted |
| D-079 | The benchmark app uses Vite, React 19, the React Compiler, modern Suspense/resource/action patterns, project-owned custom shadcn-derived components from the Figma design, Oxlint, Oxfmt, Vitest, and committed Vitexec probes. | Accepted |
| D-080 | Rendering is not a prerequisite for the harness shell: the synthetic target proves runner behavior and the portable baker provides the first real non-rendering target; raster panels remain explicitly unsupported until real adapters land. | Accepted |
| D-081 | Figma semantic values are CSS variables consumed through Tailwind utilities and local shadcn-derived primitives; desktop and mobile frames share those tokens and components rather than duplicating literal styles. | Accepted |
| D-082 | React Compiler runs in the Vite build and Oxlint runs compiler analysis, Hooks, accessibility, and `react-you-might-not-need-an-effect` rules as errors. Effects remain external-system synchronization; effect-only events use `useEffectEvent`, never render-time ref reads. | Accepted |
| D-083 | Maintainer-local product probes use Vitexec for the live Vite/GPU-capable desktop lane and Playwright for explicit mobile viewports; both reject browser-console errors and use causal DOM/application signals without sleeps or retries. | Accepted |
| D-094 | The React subpath targets React 19.2 and the agreed React Three Fiber 10 alpha lane, presently 10.0.0-alpha.2, exclusively through `@react-three/fiber/webgpu`. Its Three peer accepts 0.185.1. A narrow R3F patch removes eager browser-only Inspector registration from the WebGPU module graph, while the 9.1.0 test-renderer patch retargets static imports to `three/webgpu` and the R3F WebGPU entry; upstream should make Inspector registration lazy and publish a v10-aware WebGPU test entry. Resolved R3F reconciliation uses a real root backed by `WebGPURenderer` and a pinned paragraph oracle; pending Suspense is exercised in the live browser. Test-only reconcilers do not enter the benchmark product registry. | Accepted |
| D-095 | The benchmark application has distinct conformance and benchmark modes over shared implementation, workload, fixture, and result contracts. The UI exposes mode, raster technique, WebGPU/WebGL2 backend, and workload as independent shareable axes. Conformance visibly compares reference/candidate/diff and may pay readback/oracle costs; benchmark mode measures consumer-facing cold phases and an oracle-free live render loop with CPU-ms, FPS, and GPU-ms sparklines. Conformance duration is never reported as renderer performance. | Accepted |

The [benchmark plan](benchmark-plan.md), [conformance plan](conformance-plan.md), and [autoresearch protocol](autoresearch.md) define the gates.

## Decisions required before implementation

1. ✅ The maintainer accepted all contract decisions and acceptance criteria through roadmap item 5.4; deferred and experiment rows retain those lifecycle states.
2. ✅ HarfRust, HarfBuzz, Unicode, glTF schema, validator, ABI, format, and initial generator versions are fixed in the [version contract](version-contract.md).
3. ⬜ Assign an authorized maintainer to submit the accepted provisional `PMNDRS` prefix request.
4. ✅ Inter Regular 4.1 and the target Chromium/GPU matrix are pinned; Amiri and Noto CJK add complex-script and universality evidence without changing the first rendering fixture.
