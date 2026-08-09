---
type: Workspace Package
title: '@pmndrs/text'
description: Implements portable font loading, retained Rust shaping and layout, renderer-directed command planning, and maintained Three.js and React Three Fiber adapters.
resource: ../../packages/text
workspace_package: '@pmndrs/text'
documentation_type: reference
source_digest: 'sha256:656e1d9065bce2408626c0e9fe768706f9ee60a73a46ee2e560311a57264b1d8'
tags: [package, public-api, rust, wasm, threejs, typography]
sources:
  - id: manifest
    resource: ../../packages/text/package.json
    title: Package manifest
  - id: public-api
    resource: ../../packages/text/src/index.ts
    title: Renderer-neutral public exports
  - id: runtime
    resource: ../../packages/text/src/text-runtime.ts
    title: Font and Rust-runtime ownership
  - id: text-properties
    resource: ../../packages/text/src/text-properties.ts
    title: Paragraph input contract
  - id: layout-query
    resource: ../../packages/text/src/layout.ts
    title: Explicit layout-query values
  - id: rust-engine
    resource: ../../packages/text/rust/shaper/src/engine/state.rs
    title: Retained Rust text engine
  - id: frame-host
    resource: ../../packages/text/src/internal/text-engine-host.ts
    title: Single-export Wasm host
  - id: three-api
    resource: ../../packages/text/src/three.ts
    title: Three.js public exports
  - id: three-text
    resource: ../../packages/text/src/three/text.ts
    title: Three.js retained text lifecycle
  - id: three-plan
    resource: ../../packages/text/src/three/engine-plan-target.ts
    title: Three.js render-plan executor
  - id: three-policy
    resource: ../../packages/text/src/three/plan-program-registry.ts
    title: Three.js policy-program registry
  - id: r3f
    resource: ../../packages/text/src/r3f.ts
    title: React Three Fiber adapter
  - id: engine-design
    resource: ../planning/rust-layout-engine.md
    title: Rust text engine and render-plan design
  - id: core-api-reference
    resource: ../planning/core-api.md
    title: Core text API reference
  - id: three-api-reference
    resource: ../planning/three-api.md
    title: Three.js text API reference
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-09T17:49:53Z'
---

# Package reference: `@pmndrs/text`

Status: foundation cutover in progress; publishing-feature stacks follow after merge

## Ownership

The package owns five runtime layers:

| Layer                   | Owner                | Responsibility                                                                                                                         |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Font and raster loading | TypeScript core      | Validate portable GLB assets, register shaping payloads, decode selected raster resources, and retain font identity.                   |
| Shaping and layout      | Rust/Wasm            | Unicode analysis, bidi, font fallback, shaping, line composition, positioning, ellipsis, and semantic query state.                     |
| Policy and render plan  | Rust/Wasm            | Interpret a validated renderer policy, pack canonical technique records, coalesce dirty ranges, and emit a compact command buffer.     |
| Three.js integration    | `@pmndrs/text/three` | Compile policy programs, resolve font/material resources, apply command-buffer deltas, upload dirty ranges, and maintain draw proxies. |
| React integration       | `@pmndrs/text/r3f`   | Reconcile React values into the same imperative `Text` and `TextGroup` objects.                                                        |

Rust remains `no_std + alloc` with the package allocator contract. It uses the existing compile-time direct-memory mapping
for font registrations and the single `text_update(requestOffset, requestLength)` export for retained engine sessions.
TypeScript does not independently shape, lay out, or pack paragraphs.

## Public package surfaces

| Subpath                     | Purpose                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@pmndrs/text`              | Font/raster contracts, loading, fallback stacks, formatting helpers, paragraph inputs, layout-query values, and portable bakers. |
| `@pmndrs/text/three`        | Three `FontLoader`, `Text`, `TextGroup`, material factories, and policy registration.                                            |
| `@pmndrs/text/three/bitmap` | Bitmap technique, policy program, and canonical TSL shader.                                                                      |
| `@pmndrs/text/three/msdf`   | MSDF technique, policy program, and canonical TSL shader.                                                                        |
| `@pmndrs/text/three/slug`   | Slug technique, policy program, and canonical TSL shader.                                                                        |
| `@pmndrs/text/r3f`          | React Three Fiber `<Text>`, `<TextGroup>`, and `useFont`.                                                                        |
| `@pmndrs/text/raster/*`     | Renderer-neutral Bitmap, MSDF, and Slug decoding and raster-technique contracts.                                                 |
| `@pmndrs/text/bakers/*`     | Optional portable raster bakers and validators.                                                                                  |

`@pmndrs/text/typegpu`, the TypeScript paragraph engine, paragraph batches/attachments, direct shaping exports, and the
text-preparation Worker are removed. TypeGPU is a later adapter stack built against the Rust render plan; it is not a
compatibility wrapper over the removed batch model.

## Retained frame transaction

One `TextGroup` owns one Rust engine session. A traversal sends only changed paragraph sections:

- text replacement sends text plus any dependent style/geometry state;
- font, spans, shaping style, paint, raster ratio, or material send style state;
- content-box changes send geometry;
- transform and visibility changes update Three's renderer-local sidecar without calling Wasm;
- an empty or normalized-equal update sends nothing.

Rust publishes one revision containing:

- engine and plan revision headers;
- physical-buffer allocation and retirement commands;
- coalesced per-buffer dirty byte ranges;
- resource bindings;
- ordered draw commands with technique/program, resource, material, transform, and clip identity;
- optional semantic measurement or inspection sections only when explicitly demanded.

The Three executor does not infer paragraph layout from GPU records and does not maintain a parallel candidate/current
target state machine. It applies the Rust command buffer transactionally and retains only renderer resources required by
future deltas.

## Renderer policy

Each Three technique registers a static policy descriptor and a cold font compiler. Rust validates and interprets the
compiled policy; it never invokes a JavaScript callback in shaping, layout, or packing.

The first-party policy can select indexed transform batching, direct per-draw transforms, or a hybrid. Indexed mode adds a
stable transform-table ID to each rendered glyph so compatible paragraphs may collapse into one draw. Direct mode splits
draws by transform for integrations that prefer ordinary object matrices. `TextGroup.compositing` determines whether
Rust must preserve authored ordering or may reorder independent work.

`materialId` is explicit through the frame ABI and render plan. Three maps it to a `defineTextMaterial()` factory. Material
identity may split draws without forcing a second copy of the canonical glyph buffers.

## Font fallback and techniques

`createFontStack()` accepts fonts from one runtime in explicit fallback order. Members may use different techniques. The
font carries both shaping identity and raster binding, so `Text` has no redundant technique property. Rust resolves the
font for each cluster and partitions the render plan according to the active renderer's supported technique programs.

This permits an MSDF or Bitmap prose font to fall back to a Slug emoji font while keeping third-party renderers safe: an
unregistered technique fails at the policy boundary instead of producing an unsupported draw.

## Semantic queries

Ordinary rendering requests no layout readback. `Text.measureLayout()` explicitly requests aggregate measurements and
counts; `Text.inspectLayout()` additionally copies line and glyph arrays. Query results are cached by committed revision.
If a query observes pending changes, it synchronizes the containing Rust session once and the following render traversal
reuses that publication.

The semantic values preserve information useful to callers:

- resolved box dimensions remain distinct from intrinsic content extents;
- clipping does not discard off-viewport semantic layout;
- semantic truncation retains visible positioned lines while reporting intrinsic overflow;
- glyph/font identity, UTF-16 clusters, stable IDs, flags, line membership, and positioned origins remain available on
  explicit inspection;
- presentation origin overrides never mutate authoritative Rust layout.

## Wasm memory and copying

The host pins request/result staging views and re-pins after any `memory.grow()`, because growth detaches existing views.
Growth is permitted only at the `text_update` boundary. Result capacity is negotiated and retried without publishing a
partial revision.

WebGPU may alias compatible Wasm-backed typed arrays. Three's WebGL2 PBO path owns a padded array and therefore requires
one retained copy. The architecture does not add complexity to pretend WebGL2 can preserve a Wasm alias it replaces.

Each raster baker's Rust contract generator emits both published JSON and an exact typed TypeScript constant. Bitmap,
MTSDF, and Slug may own different internal ABI shapes—MTSDF exposes both its glyph generator and artifact baker—but their
TypeScript hosts consume those generated constants directly and validate the declared exports once during construction.
There are no instance-ignoring runtime ABI readers. Package builds isolate the distributable MTSDF and Slug
`artifact-baker` feature sets from kernel-only test targets and reject an optimized module missing any contract-declared
artifact export, preventing Cargo's shared top-level artifact path from silently publishing a smaller test variant.

Asynchronous Worker execution is a follow-on host concern. Transfer buffers must return to the Worker when retired so
their final collection occurs in the owning realm. It does not restore the deleted TypeScript shaping Worker.

## Current correctness evidence

The foundation currently has:

- 139 passing Rust engine tests after the semantic query corrections;
- the package JavaScript/integration gate passing through the single-path public exports;
- exact retained Amiri bidi, policy, ellipsis, clipping, UIKit-layout, and CJK contracts exercised by the browser
  `paragraph-contracts` target through public `FontLoader`, `Text`, `TextGroup`, `measureLayout()`, and `inspectLayout()`;
- source-font SHA-256, registered shaping hashes, and HarfRust/HarfBuzz oracle identities authenticated independently of
  the browser behavior check;
- byte-identical Bitmap, MSDF, and Slug packing/consumer gates retained elsewhere in the benchmark suite.

The browser paragraph target is fully green under the explicit f32 frame contract. The former UIKit mismatch came from a
fixture generated by the deleted TypeScript path, where authored JavaScript-double line height survived until final array
publication. The retained engine deliberately receives that style scalar as f32, accumulates line positions in f64, and
narrows published values once. An independent calculation from the f32 line box reproduces the corrected final baseline,
centered glyph row, content height, and complete layout hash exactly; no runtime precision or tolerance changed.

## Current size and performance evidence

The latest checked package-size record after the baker ABI cleanup reports:

| Graph                                   |         Raw |      gzip |    Brotli |
| --------------------------------------- | ----------: | --------: | --------: |
| Core JavaScript plus shaper Wasm        | 1,224,539 B | 447,121 B | 353,986 B |
| Three adapter plus core and shaper Wasm | 1,466,450 B | 485,864 B | 385,930 B |

Three, React, and React Three Fiber are optional peers and excluded from these bundle totals. JavaScript and Wasm are
measured independently and then summed because browsers transfer them as separate assets.

Relative to the preceding checked record, browser-core JavaScript is effectively flat (+96 raw, +7 gzip, -5 Brotli),
the Three adapter shrinks by 1,381 raw / 238 gzip / 255 Brotli bytes, and the shaper Wasm grows by 13,270 raw / 6,239
gzip / 4,288 Brotli bytes. The corrected complete MTSDF baker is 552,025 raw / 215,030 gzip / 168,758 Brotli bytes;
the earlier 52 KiB observation was a kernel-only test artifact that reused the distributable Cargo target directory.

The public Three benchmark now supports an outside-only mode that leaves the internal phase collector disabled and wraps
one `updateMatrixWorld()` call with a host timer. An eight-warmup/31-sample run over 25,515 positioned glyphs measured
17.68/6.13/5.66/16.37 ms median and 18.11/6.32/6.53/16.57 ms p95 for cold/font-size/width/text updates. Those values cover
frame preparation, the complete Rust transaction and render-plan publication, and Three plan application; they exclude
GPU submission. An adjacent phase-instrumented run was indistinguishable within process noise. Those temporary profiler
exports, calls, branches, and clock reads are now absent from the package source and clean publishing output; benchmark
workload markers and the direct Wasm timer remain outside the shipped library.

The canonical direct benchmark loads the packaged `dist/text_shaper.wasm`: Cargo release optimization, LTO, one codegen
unit, default-on `simd128`, stripping, and `wasm-opt -Oz --enable-simd` have already run. On the identical Rust artifact,
Binaryen `-O3` and `-O4` added 11,976 and 13,661 raw bytes without a demonstrated latency improvement, so `-Oz` remains
the evidence-backed setting. The `<4 ms` warm-path target and stable p95 closure remain open.

## Merge gates still open

Before the foundation stack is publishable:

- finish the stale-code and stale-documentation audit;
- regenerate affected ABI, optimized Wasm, package-size records, and package digests from source;
- run package checks, strict Rust checks, benchmark conformance, packed consumers, WebGPU and forced-WebGL2 live rendering,
  and the full repository gate;
- run the unchanged 25k-glyph comparison with enough samples and report cold, font-size, width, and text-update tables;
- profile and reduce any path that misses the target without weakening correctness;
- run a read-only Claude adversarial review if the CLI is available, then address supported findings;
- commit and push the coherent stack with a clean worktree.

The query/candidate-adoption API and the two publishing-feature stacks remain follow-on work after this foundation merge.
They must reuse retained Rust paragraph state and the same render-plan architecture rather than reintroducing a second
layout path.
