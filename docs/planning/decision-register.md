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
  - id: "msdf-paper"
    resource: "https://dcgi.fel.cvut.cz/wp-content/wpallimport-dist/publications/pdf/publications-2018-sloup-cgf-msdf-paper.pdf"
    title: "Improved Corners with Multi-Channel Signed Distance Fields"
  - id: "msdfgen"
    resource: "https://github.com/Chlumsky/msdfgen"
    title: "Official msdfgen implementation and rendering guidance"
  - id: "msdf-atlas-gen"
    resource: "https://github.com/Chlumsky/msdf-atlas-gen"
    title: "Official MSDF atlas generator"
  - id: "slug-outline-research"
    resource: "slug-outline-research.md"
    title: "Slug outline architecture"

generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-29T15:36:00Z"
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
| D-006 | A canonical source-font URL infers its `.font.glb` sibling; `.glb` is baked-only, while `{ source, baked: null }` explicitly suppresses sibling discovery for that request. | Accepted |
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
| D-098 | Post-V1 Milestone 11 adds responsive multi-column flow regions and explicit exclusions over the existing universal shaping result, then proves native-strike bitmap, MTSDF, and Slug in one editorial composition. The first implementation keeps rectangular layout as the common path, uses conservative two-dimensional exclusions, and defers a frozen public API, contour-tight wrapping, arbitrary rendered-pixel occlusion, balanced columns, hyphenation, and vertical flow until evidence exists. | Accepted |
| D-100 | Post-V1 Milestone 18 adds Japanese vertical writing after large-coverage CJK paging. The first slice uses top-to-bottom shaping, right-to-left columns, OpenType vertical metrics/features, Unicode cluster orientation, interaction geometry, and shared Bitmap/MTSDF/Slug output while preserving a zero-overhead horizontal fast path; tate-chū-yoko, ruby, warichū, Mongolian, and vertical exclusion flow remain deferred. | Accepted |

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
| D-100 | Every dynamically loaded first-party raster baker executes behind one package-owned serial ESM module Worker. Source bytes are copied before transfer, result buffers transfer back exactly once, idle Workers terminate, and bundlers resolve the static `new URL(..., import.meta.url)` boundary. | Accepted |
| D-101 | Direct raster-baker ABI V1 returns ordinary artifacts inline when bounded and large artifacts through explicit metadata plus fixed-size borrowed windows. The Worker copies each window, releases Wasm ownership before transfer, and callers never retain a view into Wasm memory. | Settled for V0 |
| D-102 | Core-font provenance carries the selected collection face index and authenticates it against the descriptor hash. Legacy artifacts may omit the field only when their descriptor proves face zero; runtime raster baking must reuse the retained face rather than defaulting silently. | Settled for V0 |

Rasters attach only when shaping hash, glyph count, glyph-ID width, raster key, and extension version match. See the [`PMNDRS_font` extension family](extensions/) and [registration draft](gltf-extension-registration.md).

## Baking and loading

| ID | Decision | Status |
| --- | --- | :---: |
| D-030 | Node and Worker hosts share one portable bake core. | Accepted |
| D-031 | The loader is baked-first and dynamically imports Worker fallback. | Accepted |
| D-032 | Omitted `baked` keeps the baked-first probe; explicit `baked: null` skips discovery and enters the source/runtime path without adding a second boolean policy. | Accepted |
| D-033 | In-memory deduplication is required; persistent bake caching is later. | Deferred |
| D-034 | The integration proof generates one grayscale bitmap strike. | Accepted |
| D-035 | Raster modules and generators are optional imports. | Accepted |
| D-036 | Baked assets are data; baker surfaces are libraries/modules. | Accepted |
| D-066 | The CLI resolves baker modules through an imported or explicitly named package's flat `pmndrs.text` map and public ESM exports; package semver governs compatibility and the CLI never scans dependency directories. | Settled for V0 |
| D-071 | The Node baker statically discovers `defineFont` uses and literal raster descriptors without executing application code; dynamic font origins remain valid when an unambiguous local pathname can be resolved, otherwise runtime fallback remains authoritative. | Accepted |
| D-070 | Bitmap strike tuples are non-empty, duplicate-free static positive integer literals and are part of raster identity; a missing declared strike makes a baked raster incompatible. | Accepted |
| D-077 | The portable bake core ships one `wasm32-unknown-unknown` module behind a versioned JSON-described C ABI and direct linear-memory TypeScript shim; it ships no platform binaries, WASI dependency, Embind, or binding-generator runtime. | Settled for V0 |
| D-078 | The bake and shaping Wasm modules use `no_std + alloc`, aborting panics, and pinned ABI-private dynamic Talc 5.0.4. Across the optimized four-module corpus it saves 46,610 raw, 15,121 gzip, and 12,121 Brotli bytes relative to `dlmalloc` without changing initial-memory class or artifacts. A 128 MiB global arena is rejected because it saves no meaningful transfer bytes while raising initial memory to about 129 MiB and imposing a fixed ceiling. A request-local scratch arena remains eligible only with proven lifetime ownership outside persistent Worker state. Host code owns gzip/Brotli measurement. | Accepted |
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
| D-096 | Bitmap presentation transitions are optional `@pmndrs/text/raster/bitmap` helpers over copied glyph identities and instance origins. Shaping and layout commit discretely; only identity-matched glyph positions interpolate before the existing physical-pixel snap, and unused consumers pay no target-origin allocation. | Settled for V0 |
| D-097 | Milestone 8 owns a purpose-built `no_std + alloc` Rust MTSDF core under `packages/text/rust`, with repository-defined types, limits, reusable scratch storage, data-oriented scalar/SIMD experiments, typed errors, and the generated direct-memory C ABI/JSON boundary. The scalar path is a correctness oracle; if `simd128` wins the complete quality, full-font-time, and size comparison, it is the single default shipped Wasm kernel rather than a baker option. The core may retain proven design ideas from reviewed implementations but is not a copied Klyff fork. Pinned native Chlumsky `msdfgen` remains the canonical test-only oracle and port reference; Klyff, OxiText, Rust bindings, and UIKit/Zappar remain research evidence rather than product dependencies. | Accepted |
| D-099 | MTSDF V0 originally fixed one opinionated bake: 64 plane units per em, a full eight-pixel encoded distance range, four field-padding texels, one atlas-gap texel, 1024-pixel pages, dense 20-byte records, and lossless linear RGBA8 KTX2. The published baker composes the admitted scalar kernel with the shared Fontations provider and lossless artifact primitives; standalone generator evidence remains separately measurable but is not a second published Wasm. | Superseded by D-110 |
| D-100 | Text size is logical CSS geometry. A rendering integration supplies an explicit raster pixel ratio; bitmap targets `CSS size × ratio`, deterministically selects the nearest declared physical strike, and never changes paragraph geometry to compensate for DPR. The core installs no DOM or gesture listeners. | Accepted |
| D-101 | Bitmap density strikes remain independent grayscale record/texture sets rather than RGB(A)-channel packing. A combined artifact may carry several strikes, while Milestone 13 adds independently fetched and evictable strike pages. | Accepted |
| D-102 | Language delivery is exact-coverage-first and locale-aware. A family directory may route grapheme-safe runs to font-local units, but language labels alone never prove coverage and units never split contextual shaping runs. Compiler-produced shaping closure/remapping remains Milestone 17. | Accepted |
| D-103 | Explicit and fallback runtime raster baking accept normalized bounded coverage and raster options through the same Worker-only path. Coverage may be seeded by Unicode ranges, authored text, or exact font-local glyph IDs, but it reduces atlas generation only: it does not subset the shaping font, remap glyph IDs, or claim transitive shaping closure. | Accepted |
| D-104 | Every direct-memory Wasm ABI layout is represented by fixed-width `#[repr(C)]` Rust types. Build-only Rust generators derive published JSON and exact `as const` TypeScript contracts from `size_of`, `align_of`, and `offset_of!`; production hosts import those generated facts, and production Wasm embeds no duplicate contract or ABI-pointer bootstrap. WebAssembly direct memory uses its guaranteed little-endian order; portable GLB, KTX2, SFNT, and extension encodings retain their format-defined byte order. | Accepted |
| D-105 | V1 retains the current Three.js/TSL integration through Slug so its real shader, resource, batching, and lifetime requirements define the abstraction. After Slug lands, Milestone 10 extracts one renderer-neutral direct integration beneath Bitmap, MSDF, and Slug; Three.js becomes a supported adapter over it, while raw WebGPU and a possible TypeGPU adapter remain independently selectable integrations. Optional TypeGPU compute-baker research may proceed earlier but cannot force the renderer refactor or enter unrelated runtime graphs. | Accepted |
| D-106 | Slug V0 artifacts retain exact R16UI reference grids. The Three.js 0.185.1 adapter may pair-pack those values into R32UI texels at decode time because its WebGL TSL backend does not declare an unsigned sampler for `UnsignedShortType`; this preserves reference identity and two-byte density plus at most one terminal padding value. Other adapters remain free to upload R16UI directly, and the exception does not redefine the portable artifact. | Accepted |
| D-107 | Repository TypeScript commands execute the installed native compiler through one bounded runner that first proves its kill/reap path with a synthetic allocator, supervises the native PID rather than a shell or Node shim, caps aggregate tracked RSS, enforces a wall-time limit, and reports no success while a compiler survives. TSL changes compile reduced operation fixtures and a narrow graph before package or application projects; free functions remain the first mitigation but exact-version pathological overloads use one proven concrete compatibility boundary. | Accepted |
| D-108 | MTSDF V0 uploads only the authenticated base level and uses bilinear field sampling plus screen derivatives for reconstruction. Conventional GPU mip generation and trilinear cross-level sampling are rejected: averaging encoded MSDF channels is not a distance-field-preserving operation, and the primary MSDF paper plus official generators provide no affirmative mipmap guidance. Runtime, standalone validation, fixtures, and the inspector report the exact padded base texture-array allocation. Any future size-specific representation is an independently authored atlas layer or strike, not a conventional mip chain. | Accepted |
| D-109 | Slug V0 implemented a centered exact-distance outline in one specialized fill-plus-outline draw. Retained measurements later showed `2.44×–4.33×` fill-only GPU time, and generated-shader inspection found duplicated traversal, curve loads, closest-point refinement, and a derivative inside divergent control flow. | Superseded by D-111 |
| D-110 | MTSDF V0 exposes `emSize` and full `pixelRange` as authenticated integer bake options. `emSize` is limited to `1..=1022`, `pixelRange` to `1..=1020`, `planeUnitsPerEm` equals `emSize`, and field padding is `ceil(pixelRange / 2)`. Omitted or partial options resolve against the 64/8 compatibility defaults; explicit effective 64/8 canonicalizes to the legacy fieldless descriptor and raster key, while every non-default descriptor contains both effective values. The low-level Wasm ABI is unchanged. Passing 32/4 and 32/6 155-glyph subset bakes proves the control path, not a new recommended default; quality and payload benchmarking owns that decision. | Accepted |
| D-111 | Remove the dynamic exact-distance Slug outline rather than ship an expensive fallback. Slug V0 supports fill and opacity and rejects every runtime outline or shadow property. The generic text outline API remains because MTSDF owns it. | Accepted |
| D-112 | Research one bounded Slug outline approximation that reuses ordinary fill traversal and screen derivatives without closest-point solving or independent halo traversal. It ships only if its quality is no worse than the MTSDF outline corpus and its median GPU time is at most `1.15×` a same-expanded-quad fill control on both WebGPU and forced WebGL2; otherwise Slug remains fill-only. | Experiment |

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
| D-113 | Filtered analytic GPU rasters such as MTSDF and Slug require deterministic pixels within one renderer run plus an independent CPU error envelope; they do not use one hardware or driver framebuffer hash as a portable CI golden. Exact cross-backend hashes remain valid only where an independent byte-level oracle proves the operation itself is exact, as with bitmap texel composition. | Accepted |

The [benchmark plan](benchmark-plan.md), [conformance plan](conformance-plan.md), and [autoresearch protocol](autoresearch.md) define the gates.

## Decisions required before implementation

1. ✅ The maintainer accepted all contract decisions and acceptance criteria through roadmap item 5.4; deferred and experiment rows retain those lifecycle states.
2. ✅ HarfRust, HarfBuzz, Unicode, glTF schema, validator, ABI, format, and initial generator versions are fixed in the [version contract](version-contract.md).
3. ⬜ Assign an authorized maintainer to submit the accepted provisional `PMNDRS` prefix request.
4. ✅ Inter Regular 4.1 and the target Chromium/GPU matrix are pinned; Amiri and Noto CJK add complex-script and universality evidence without changing the first rendering fixture.
