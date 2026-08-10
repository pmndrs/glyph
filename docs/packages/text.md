---
type: Workspace Package
title: '@pmndrs/text'
description: Implements portable font loading, retained Rust shaping and layout, renderer-directed command planning, and maintained Three.js and React Three Fiber adapters.
resource: ../../packages/text
workspace_package: '@pmndrs/text'
documentation_type: reference
source_digest: 'sha256:e78a16856ea65f8749d9573503ed17a209291c7c9811f033f8d47c0306e9f05f'
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
  at: '2026-08-10T03:47:15Z'
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
A public compiled-Wasm integration loads Bitmap Inter plus Slug Font Awesome, shapes one paragraph through that ordered
fallback stack, and observes two Rust-planned draws with exact Bitmap `vec2` and Slug `vec4` physical records. The
selected font binding—not a `Text` technique selector—carries the renderer program and resource.

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
deleted parallel path and identified exact shared planner machinery. Ordered and stable planning now use one retained
epoch-cleared identity set, one plan-error and result-capacity classifier, one cold physical-buffer allocator, one inline
draw-span predicate, and one deliberately out-of-line final primitive/draw emitter. The optimized Wasm moved from
1,160,505 raw / 442,612 gzip / 348,594 Brotli bytes to 1,159,317 / 442,284 / 347,850, saving 1,188 / 328 / 744 bytes.

The remaining similar bodies are not two implementations of one behavior. Ordered-direct compacts physical records in
draw order; stable-indirect preserves slots, publishes a separate order buffer, and quarantines retirements until renderer
acknowledgement. A symbol-bearing optimized build attributes 33.3 KiB of function bodies to ordered planning and 50.1 KiB
to stable planning; those complete strategy totals are upper bounds, not deduplicable byte estimates. Their draw compilers
resolve different physical address spaces. Normalizing those addresses into another staging array or dispatching through a
dynamic strategy interface would add hot-path memory traffic or indirect calls, so the audit retains the strategy-local
loops and shares their exact invariants instead. The 22k-glyph complete Rust benchmark remains within adjacent-run noise;
a 20-warmup/51-sample cold check measured 15.452 ms median / 15.670 ms p95 at 1.0% RSD.

## Current size and performance evidence

The latest checked package-size record after the baker ABI cleanup reports:

| Graph                                   |         Raw |      gzip |    Brotli |
| --------------------------------------- | ----------: | --------: | --------: |
| Core JavaScript plus shaper Wasm        | 1,247,715 B | 460,130 B | 363,319 B |
| Three adapter plus core and shaper Wasm | 1,487,318 B | 498,376 B | 395,130 B |

Three, React, and React Three Fiber are optional peers and excluded from these bundle totals. JavaScript and Wasm are
measured independently and then summed because browsers transfer them as separate assets.

The optimized shaper is 1,159,317 raw / 442,284 gzip / 347,850 Brotli bytes. The renderer-neutral JavaScript graph is
88,398 raw / 17,846 gzip / 15,469 Brotli, and the complete Three JavaScript graph is 328,001 raw / 56,092 gzip /
47,280 Brotli. Deleting the legacy TypeScript raster packing/lifecycle path reduced the measured core total from 461,917
to 460,901 gzip bytes and the complete Three total from 501,815 to 498,922 gzip bytes; the later shared-emitter and stable
range-scan work reduces those totals to 460,416 and 498,437 gzip bytes. The homogeneous-policy dispatch and dirty-range
alignment correction moved those totals to 460,458 and 498,479 gzip bytes; the focused planner deduplication and current
Three graph now measure 460,130 and 498,376 gzip bytes.
The corrected complete MTSDF baker remains 552,025 raw / 215,030 gzip / 168,758 Brotli bytes; the earlier 52 KiB
observation was a kernel-only test artifact that reused the distributable Cargo target directory.

The public Three benchmark now supports an outside-only mode that leaves the internal phase collector disabled and wraps
one `updateMatrixWorld()` call with a host timer. An eight-warmup/31-sample run over 25,515 positioned glyphs measured
19.42/6.59/3.10/14.24 ms median and 21.00/6.86/4.75/15.26 ms p95 for cold/font-size/width/text updates. Those values cover
frame preparation, the complete Rust transaction and render-plan publication, and Three plan application; they exclude
GPU submission. An adjacent phase-instrumented run was indistinguishable within process noise. Those temporary profiler
exports, calls, branches, and clock reads are now absent from the package source and clean publishing output; benchmark
workload markers and the direct Wasm timer remain outside the shipped library.

After the final plan-application lifecycle audit, Three sizes indexed transforms from live paragraph IDs instead of
scanning every glyph record in JavaScript. A renderer failure retains an unconsumed owned plan for zero-crossing retry;
dirty upload ranges accumulate across presentation restoration and Rust patches; buffer/resource generations dispose
only their exact dependent materials; direct materials survive indexed transform-table growth; and loaded-font disposal
removes its decoded renderer resources. The unchanged eight-warmup/31-sample public 25,515-glyph lane measures
17.84/6.32/3.04/13.84 ms medians and 18.99/6.64/4.60/14.01 ms p95 for cold/font-size/width/text. The adjacent recorded
run was 19.42/6.59/3.10/14.24 ms median; process-separated samples support no regression and a plausible cold-path
reduction, not causal attribution.

The canonical direct benchmark loads the packaged `dist/text_shaper.wasm`: Cargo release optimization, LTO, one codegen
unit, default-on `simd128`, stripping, and `wasm-opt -Oz --enable-simd` have already run. On the identical Rust artifact,
Binaryen `-O3` and `-O4` added 11,976 and 13,661 raw bytes without a demonstrated latency improvement, so `-Oz` remains
the evidence-backed setting. The `<4 ms` warm-path target and stable p95 closure remain open.

The final sequential eight-warmup/31-sample checkpoint uses the unchanged 22,000-target corpus, which resolves to 25,515
positioned and 21,805 renderable glyphs. Values below are medians in milliseconds for the complete packaged Rust
transaction and technique-specific render plan; GPU submission is outside this direct benchmark.

| Technique |  Cold | Font size | Column width | Suffix edit | Local edit | Middle splice |
| --------- | ----: | --------: | -----------: | ----------: | ---------: | ------------: |
| Bitmap    | 16.02 |      6.01 |         2.77 |       13.73 |       1.19 |          8.35 |
| MTSDF     | 16.60 |      6.42 |         2.77 |       13.75 |       1.20 |          8.75 |
| Slug      | 16.83 |      6.67 |         2.87 |       13.59 |       1.19 |          8.84 |

The comparable retained TypeScript checkpoint measured 55.25/11.90/8.36/38.55 ms for cold/font-size/width/suffix edit,
so every comparable median is faster through Rust. This proves the migration comparison on this machine; it does not
close the stricter p95-under-4-ms objective. Local-edit p95 remains about 6 ms and high-variance, while width p95 ranges
from 4.29 to 4.94 ms across techniques.

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

The first-party policy declares one allocation strategy for every registered technique. Rust now resolves that uniform
strategy once per update instead of looking up a program for every glyph before the selected planner performs its own
validated compilation. Mixed-strategy policies retain the per-glyph discovery path and stop once both strategies are
observed. A five-warmup/11-sample ordered run measures 6.005 ms font-size, 2.813 ms column-resize, 1.212 ms localized-edit,
and 8.281 ms middle-splice medians. The adjacent prior medians were 6.178, 2.817, 1.353, and 8.452 ms; these short runs
show no regression and suggest a small scan reduction, but do not establish a latency win. The same change preserves
whole-buffer update alignment after dirty-range promotion and costs 182 raw / 42 gzip / 233 Brotli bytes.

Three retains pending attribute upload ranges until its renderer consumes them. Consecutive Rust publications,
presentation-origin restoration, and a retry before rendering coalesce overlapping or adjacent ranges instead of
clearing earlier writes. Paragraph transform identities return to a binding-local free list only after the Rust removal
transaction commits, bounding the indexed transform table under create/dispose churn. A disposed `Text` may remain in
the Three scene graph until its host detaches it without poisoning the surviving batch, and batch-wide runtime validation
runs inside the group error boundary before reconciliation mutates ownership. An internal semantic-query contract failure
advances the observed engine revision and retains unexpected render work for the ordinary zero-crossing retry path rather
than leaving the Wasm session permanently revision-conflicted. The focused public integration exercises all four
lifecycles, and the complete package gate passes 158 Rust and 165 Node tests. The canonical direct benchmark now defaults
to eight warmups and 31 measured samples so its reported p95 is not the maximum of an 11-sample run.

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
