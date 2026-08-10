---
type: Workspace Package
title: '@pmndrs/text'
description: Implements portable font loading, retained Rust shaping and layout, renderer-directed command planning, and maintained Three.js and React Three Fiber adapters.
resource: ../../packages/text
workspace_package: '@pmndrs/text'
documentation_type: reference
source_digest: 'sha256:94a04c1dd7cf680fb0e340dd0e664059de5c93d1ff453f5057eb8dd670b4f3fb'
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
  at: '2026-08-10T02:40:43Z'
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
draws by transform for integrations that prefer ordinary object matrices. Policy programs may use ordered-direct or
stable-indirect physical storage. Stable draws carry one reserved u32 order buffer; Three validates its draw/primitive
addressing once, then uses the same logical-to-physical mapping for technique records, transform indices, explicit origin
queries, and third-party program material contexts. `TextGroup.compositing` determines whether Rust must preserve authored
ordering or may reorder independent work. Ordered-direct remains the first-party default until stable planning meets the
same tail-latency target.

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

The renderer-neutral core owns the completed asynchronous Worker transfer contract: it copies opaque frame bytes once
into a bounded worker-owned transferable pool, applies explicit backpressure, and requires root to transfer each retired
buffer back so reuse or final collection occurs in the owning realm. Adopting that mode in the Three host is deferred;
the synchronous Three path does not restore the deleted TypeScript shaping Worker. TypeGPU is likewise a later adapter
slice built directly against the Rust render plan.

## Current correctness evidence

The foundation currently has:

- 154 passing Rust engine tests, including exact retained-cluster, revision-range, immediate line-convergence, and
  later cursor-convergence regressions;
- the package JavaScript/integration gate passing through the single-path public exports;
- exact retained Amiri bidi, policy, ellipsis, clipping, UIKit-layout, and CJK contracts exercised by the browser
  `paragraph-contracts` target through public `FontLoader`, `Text`, `TextGroup`, `measureLayout()`, and `inspectLayout()`;
- 32/32 pixel-exact public Bitmap WebGL2 frames against the independent CPU oracle, including resize and clipping, with
  zero differing channel bytes and pinned SHA-256 `a47930d3…15e893`;
- source-font SHA-256, registered shaping hashes, and HarfRust/HarfBuzz oracle identities authenticated independently of
  the browser behavior check;
- byte-identical Bitmap, MSDF, and Slug packing/consumer gates retained elsewhere in the benchmark suite.

The browser paragraph target is fully green under the explicit f32 frame contract. The former UIKit mismatch came from a
fixture generated by the deleted TypeScript path, where authored JavaScript-double line height survived until final array
publication. The retained engine deliberately receives that style scalar as f32, accumulates line positions in f64, and
narrows published values once. An independent calculation from the f32 line box reproduces the corrected final baseline,
centered glyph row, content height, and complete layout hash exactly; no runtime precision or tolerance changed.

## Legacy-path and duplication audit

The Rust command buffer is the only glyph-packing implementation. The former TypeScript `RasterRuntime`, raster
candidate/commit transaction, `select`, `createStorage`, and `writeStorage` surfaces are deleted from production source
and public exports. Current raster techniques own identity, artifact decoding, retained CPU resource data, and disposal;
Rust policy programs own instance packing and dirty-range publication. The package gate retains production render-plan,
font-binding, Three execution, artifact-validation, and Unicode conformance coverage instead of test-only TypeScript
packers.

A Mori 0.19.1 production-source scan (review profile, same-language threshold 0.85, minimum 40 tokens) corroborated the
deleted parallel path and identified smaller repeated validation helpers. It also highlighted similar draw emission in
`ordered_plan.rs` and `stable_plan.rs`; those modules are not duplicate implementations of one behavior. Ordered-direct
compacts physical records in draw order, while stable-indirect preserves slots, publishes an order buffer, and quarantines
retirements until renderer acknowledgement. A symbol-bearing optimized build attributes 33.3 KiB of function bodies to
ordered planning and 50.1 KiB to stable planning; that is strategy-specific code, not an assertion that all 83.4 KiB are
duplicates. The identical final primitive/draw-record construction is now one deliberately out-of-line non-generic
kernel. Together with a stable dependency-scan correction, the final Wasm is 220 raw / 485 gzip / 423 Brotli bytes smaller
than the pre-extraction artifact. This establishes a real, modest compiled win; it does not infer savings from source-line
count or assume that a generic refactor would avoid monomorphization.

## Current size and performance evidence

The latest checked package-size record after the baker ABI cleanup reports:

| Graph                                   |         Raw |      gzip |    Brotli |
| --------------------------------------- | ----------: | --------: | --------: |
| Core JavaScript plus shaper Wasm        | 1,248,721 B | 460,416 B | 363,830 B |
| Three adapter plus core and shaper Wasm | 1,487,349 B | 498,437 B | 395,363 B |

Three, React, and React Three Fiber are optional peers and excluded from these bundle totals. JavaScript and Wasm are
measured independently and then summed because browsers transfer them as separate assets.

The optimized shaper is 1,160,323 raw / 442,570 gzip / 348,361 Brotli bytes. The renderer-neutral JavaScript graph is
88,398 raw / 17,846 gzip / 15,469 Brotli, and the complete Three JavaScript graph is 327,026 raw / 55,867 gzip /
47,002 Brotli. Deleting the legacy TypeScript raster packing/lifecycle path reduced the measured core total from 461,917
to 460,901 gzip bytes and the complete Three total from 501,815 to 498,922 gzip bytes; the later shared-emitter and stable
range-scan work reduces those final totals to 460,416 and 498,437 gzip bytes.
The corrected complete MTSDF baker remains 552,025 raw / 215,030 gzip / 168,758 Brotli bytes; the earlier 52 KiB
observation was a kernel-only test artifact that reused the distributable Cargo target directory.

The public Three benchmark now supports an outside-only mode that leaves the internal phase collector disabled and wraps
one `updateMatrixWorld()` call with a host timer. An eight-warmup/31-sample run over 25,515 positioned glyphs measured
19.42/6.59/3.10/14.24 ms median and 21.00/6.86/4.75/15.26 ms p95 for cold/font-size/width/text updates. Those values cover
frame preparation, the complete Rust transaction and render-plan publication, and Three plan application; they exclude
GPU submission. An adjacent phase-instrumented run was indistinguishable within process noise. Those temporary profiler
exports, calls, branches, and clock reads are now absent from the package source and clean publishing output; benchmark
workload markers and the direct Wasm timer remain outside the shipped library.

The canonical direct benchmark loads the packaged `dist/text_shaper.wasm`: Cargo release optimization, LTO, one codegen
unit, default-on `simd128`, stripping, and `wasm-opt -Oz --enable-simd` have already run. On the identical Rust artifact,
Binaryen `-O3` and `-O4` added 11,976 and 13,661 raw bytes without a demonstrated latency improvement, so `-Oz` remains
the evidence-backed setting. The `<4 ms` warm-path target and stable p95 closure remain open.

The preceding unchanged 22,000-glyph localized-edit lane measured the complete production `text_update` plus Bitmap render
plan at 2.607 ms median / 6.184 ms p95 after 40 warmups over 101 updates. The fast ASCII-letter path reuses Unicode and
bidi state and recomposes until the line cursor converges; punctuation and spacing edits deliberately retain the full
break-sensitive path, so the 42.4% RSD describes remaining workload classes rather than a completed latency result. The
optimized SIMD shaper is 1,147,266 raw bytes. Five patches write roughly 1.2 KiB per update, and the retained high-water
mark remains 80.38 MiB. Median is now below 4 ms, but p95 and memory-growth gates remain open.

Policy gather now retains complete prior input lanes by committed session/policy/capability revision. Zero-change glyphs
reuse them without binding or policy work; changed glyphs update only reachable lanes. A resource or draw-storage key
change retains the verified prefix and fully rebuilds the suffix, preserving correct replacement-buffer inputs without
double-scanning the prefix. The same production lane now measures 1.314 ms median / 5.863 ms p95 with 76.2% RSD, five
patches, and roughly 1.2 KiB written. The 1,153,122-byte optimized shaper is 5,856 bytes larger than the prior checkpoint,
and retained high-water memory is 80.19 MiB. The fast class approaches 1 ms; the break-sensitive p95 remains open.

The ordered-direct compiler additionally retains committed glyph-to-batch and glyph-to-slot topology while policy,
capability, glyph count, and every physical storage key remain compatible. It still validates every glyph and stable
identity; the first storage mismatch falls back to complete batch discovery. Three consecutive optimized runs measured
1.164/5.761, 1.153/5.740, and 1.155/5.738 ms median/p95, versus the preceding 1.314/5.863 ms checkpoint. The optimized
shaper is 1,157,311 raw bytes, a 4,189-byte increase, and retained high-water memory is 79.81 MiB. The repeated median gain
is established; the roughly 5.74 ms p95 and 81.4–81.6% RSD still fail the tail-latency gate.

The direct benchmark also keeps an independent middle-splice lane. On the current optimized artifact, a sequential
eight-warmup/31-sample run measures ordered-direct insertion/deletion at 8.452/9.033 ms median/p95 and 511.3 KiB written
because following physical records move. Stable-indirect reduces that publication to 452 B and measures 9.372/9.583 ms.
The earlier 51.067 ms figure was the maximum selected as p95 from only 11 samples and did not reproduce. This establishes
the storage-policy tradeoff without changing the default: stable planning remains optimization/correctness work, and
chunk-local text storage cannot be claimed as the dominant splice fix while the physical plan has this cost.

Three now consumes stable-indirect plans through one shared record-addressing abstraction rather than technique-specific
branches. A Rust/Three integration regression proves lifecycle reorder mutates only the order table and preserves physical
glyph bytes and draw objects. A two-record GPU oracle makes slot zero green and slot one red, then renders logical slot zero
through `order[0] = 1`: forced WebGL2 and hardware WebGPU both return 16/16 exact red pixels and the same readback hash.
The complete ordered Bitmap/MSDF/Slug/custom-material matrix remains green on both backends. A strict 31-sample stable
run exposed a quadratic dependency scan: each changed physical range rescanned every slot write. Binary-partitioning the
sorted writes to the requested range reduces stable font-size from 350.136 to 7.982 ms median and column resize from
49.636 to 3.767 ms; localized edit is 2.172/6.628 ms and splice is 9.372/9.583 ms median/p95. Stable no-op remains
1.083 ms versus ordered-direct's 0.001 ms, so stable remains an explicit policy rather than the first-party default. The
sequential benchmark high-water marks are 107.56 MiB ordered and 114.25 MiB stable; retained-memory right-sizing remains
open and neither figure is presented as ordinary application demand.

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
