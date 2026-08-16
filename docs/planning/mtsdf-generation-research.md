---
type: Research
title: MTSDF generation research
description: Records the literature, open implementations, licenses, algorithm boundary, and performance hypotheses for the repository-owned MTSDF generator.
tags: [rust, wasm, msdf, mtsdf, geometry, simd, licensing]
sources:
  - id: valve-sdf
    resource: https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf
    title: Improved Alpha-Tested Magnification for Vector Textures and Special Effects
  - id: chlumsky-thesis
    resource: https://hdl.handle.net/10467/62770
    title: Shape Decomposition for Multi-Channel Distance Fields
  - id: chlumsky-paper
    resource: https://dcgi.fel.cvut.cz/en/publications/2018/sloup-cgf-msdf/
    title: Improved Corners with Multi-Channel Signed Distance Fields
  - id: msdfgen
    resource: https://github.com/Chlumsky/msdfgen/tree/v1.13
    title: msdfgen 1.13 source
  - id: klyff
    resource: https://codeberg.org/SnailBionicLab/klyff
    title: Klyff source repository
  - id: rust-msdfgen
    resource: https://docs.rs/msdfgen/0.2.1/msdfgen/
    title: Rust msdfgen bindings
  - id: oxitext-sdf
    resource: https://docs.rs/oxitext-sdf/0.2.0/oxitext_sdf/
    title: oxitext-sdf 0.2.0 documentation
  - id: uikit-loader
    resource: https://github.com/pmndrs/uikit/blob/main/packages/uikit/src/loaders/ttf.ts
    title: pmndrs/uikit runtime TTF loader
  - id: zappar-generator
    resource: https://www.npmjs.com/package/@zappar/msdf-generator/v/1.2.4
    title: Zappar MSDF generator 1.2.4
  - id: typegpu-pipelines
    resource: https://docs.swmansion.com/TypeGPU/apis/pipelines/
    title: TypeGPU pipelines
  - id: typegpu-interop
    resource: https://docs.swmansion.com/TypeGPU/integration/webgpu-interoperability/
    title: TypeGPU WebGPU interoperability
  - id: typegpu-functions
    resource: https://docs.swmansion.com/TypeGPU/apis/functions/
    title: TypeGPU functions and WGSL integration
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

# MTSDF generation research

Status: 🟢 the repository owns the production Rust generator; external implementations remain literature, design references, and independent test oracles.

## Literature and executable specification

Valve's 2007 paper establishes the single-channel signed-distance baseline: sample at texel centers, encode a bounded signed distance around `0.5`, and reconstruct coverage or effects in the shader. It also identifies the sharp-corner failure and sketches storing distances to different edges in multiple channels.[^valve-sdf]

Chlumský's 2015 thesis develops the complete shape-decomposition and edge-coloring construction for multi-channel fields.[^chlumsky-thesis] The peer-reviewed 2018 paper presents the construction, median reconstruction, and comparative error analysis.[^chlumsky-paper] These are the primary algorithm references for MSDF.

No separate MTSDF paper was located. MTSDF is the combined representation implemented and documented by `msdfgen`: RGB retains the multi-channel pseudo-distance field while alpha stores true signed distance. The pinned `msdfgen` 1.13 core is therefore the canonical executable reference for the added alpha channel, overlap behavior, pseudo-distance selection, and error correction.[^msdfgen]

The repository implementation follows this generation path without adopting the C++ object model:

1. Fontations/Skrifa emits maintained line, quadratic, and cubic glyph outlines.
2. The package validates finite coordinates, closure, contour limits, and deterministic orientation policy.
3. Corner classification and deterministic edge coloring assign each edge at least two of the RGB channels.
4. Exact or bounded-error curve distance evaluation finds channel pseudo-distances and the true signed distance at pixel centers.
5. Contour winding and overlap composition determine the sign without deleting valid geometry.
6. The four distances map through the declared field range and quantize once to linear RGBA8.
7. Error correction detects channel clashes that would create false median edges; every correction policy is independently tested against native `msdfgen`.

## Open implementation survey

| Implementation                 | License evidence                                                                                       | Useful findings                                                                                                                               | Production disposition                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Chlumsky `msdfgen` 1.13        | MIT license in the pinned source archive                                                               | Canonical C++ core, exact curve-distance selectors, overlap combiners, error correction, MTSDF semantics, and mature fixtures                 | Test-only native oracle and port reference; never shipped or required by the browser                              |
| `klyff_msdf` 0.1.3             | Crate metadata declares MIT; the audited crates.io archive omits a standalone license file             | Pure-Rust CPU structure, reusable scratch ownership, SoA edge traversal, compact Wasm proof, and a useful adversarial starting corpus         | No product dependency or source copy; retain design findings and differential evidence only                       |
| Rust `msdfgen` 0.2.1           | MIT upstream through `msdfgen-sys`                                                                     | Safe Rust API over the canonical implementation                                                                                               | Rejected: C++ FFI and native build surface violate the portable Rust/Wasm boundary                                |
| `oxitext-sdf` 0.2.0            | Apache-2.0 crate metadata                                                                              | Pure-Rust MTSDF, edge coloring, glyph tiles, and atlas APIs                                                                                   | Research comparison only: duplicates font ownership and brings a broader stack than the core requires             |
| pmndrs/uikit runtime loader    | UIKit is MIT; its loader imports `@zappar/msdf-generator`                                              | Confirms practical runtime generation, Worker lifetime, progress, overlap repair, and configurable atlas/range controls                       | Product precedent, not a reusable generator implementation                                                        |
| `@zappar/msdf-generator` 1.2.4 | MIT package; notice records MIT msdfgen, BSD-3-Clause Skia PathOps, and MIT/public-domain stb_truetype | Emscripten Worker wrapper around msdfgen with overlap repair; published package contains a 303.1 kB Wasm module and 444.0 kB unpacked surface | Rejected: duplicates font parsing and geometry dependencies and is materially larger than the repository boundary |

All reviewed implementations permit commercial use, modification, and redistribution under permissive licenses. A port or substantial derivation must preserve the applicable copyright and license notice. The package-owned implementation records msdfgen as algorithm and oracle provenance even where the Rust representation and control flow are original.

UIKit does not currently contain its own distance-field kernel. Its `TTFLoader` dynamically imports the Zappar package, initializes one generator, generates one or more atlases, and disposes it.[^uikit-loader] The current Zappar package describes itself as a WebAssembly port of msdfgen and ships third-party notices for msdfgen, Skia PathOps, and stb_truetype.[^zappar-generator]

## Repository-owned core boundary

The production generator is a private Rust core under `packages/glyph/rust`; public packaging remains owned by the MSDF baker. The core owns only:

- validated contours and typed line/quadratic/cubic edges;
- deterministic edge coloring and overlap/winding policy;
- signed, pseudo-, and true-distance evaluation;
- MTSDF error correction and linear RGBA8 quantization;
- bounded reusable scratch storage and generation diagnostics.

It does not own SFNT parsing, shaping, atlas packing, KTX2, GLB, Worker scheduling, or JavaScript policy. Fontations remains the sole font parser. The baker composes the core with the existing artifact pipeline and generated direct-memory ABI.

The portable core is `no_std + alloc`, uses typed errors, performs checked size arithmetic, has no panic path for caller-controlled data, and supports an allocator chosen by the final Wasm package. One reusable workspace owns all variable storage; successful generation after warm-up must not allocate unless declared output capacity grows.

## Data-oriented and SIMD design

Data layout follows measured access rather than a universal SoA rule:

- hot edge traversal separates line, quadratic, and cubic spans and stores repeatedly scanned coordinates/colors in aligned SoA buffers;
- contour ranges and stable edge identities remain compact AoS records where they are consumed together;
- the nearest RGB pseudo-distances plus alpha true distance form one fixed four-lane register value;
- output is linear row-major RGBA8 and writes without an intermediate float image;
- scan direction, edge ordering, and tie-breaking are deterministic across native scalar and Wasm kernels.

The scalar kernel is both the correctness oracle and the selected production implementation, not a public mode. Compiler `simd128` auto-vectorization and explicit four-channel quantization preserve the corrected output and slightly reduce bytes. Scalar remains fastest for the bounded seven-case corpus in Node and Chromium; explicit SIMD is about 1.3% and 1.1% slower there. Explicit SIMD now improves the complete Inter warm stress pass by 5.7%, from 48.13 to 45.38 seconds. That experiment vectorizes the final four-channel quantization for one texel; it does not evaluate several texels through the expensive curve-distance traversal. The internal explicit implementation therefore remains test-only evidence for item 8.6 rather than becoming a second published artifact, but the complete-font result means SIMD is not rejected as a category.

Item 8.6 now measures the complete artifact pipeline rather than extrapolating from the generator microcorpus. The native phase observer uses the same optimized Rust pipeline; direct and Worker columns use the shipped optimized Wasm. Times are Apple arm64 observations, not portable thresholds. `Wasm copy` is the exact owned response copy from linear memory, `Worker transfer` is delivery after the Worker's complete marker, linear memory is the retained Wasm high-water mark, and RSS is the isolated Node process lifetime peak.

| Coverage            | Selected/generated glyphs |    Texels | Edge visits | Native texel/total ms | Wasm bake/copy ms | Worker total/transfer ms |     Linear/RSS peak bytes | Output bytes |
| ------------------- | ------------------------: | --------: | ----------: | --------------------: | ----------------: | -----------------------: | ------------------------: | -----------: |
| Small authored text |                   39 / 38 |    71,341 |   1,694,576 |       245.40 / 248.32 |     511.96 / 0.69 |            520.88 / 0.46 |   6,488,064 / 109,002,752 |      595,752 |
| U+0020–U+024F       |                 524 / 522 | 1,289,496 |  36,939,819 |   4,429.17 / 4,445.46 |   9,075.97 / 0.74 |          9,109.36 / 0.61 |  36,634,624 / 147,177,472 |    7,074,796 |
| Complete Inter      |             2,937 / 2,915 | 7,233,197 | 227,327,416 | 25,871.57 / 25,957.06 |  52,420.37 / 4.51 |         52,860.21 / 0.47 | 227,737,600 / 343,343,104 |   39,175,608 |

Texel generation accounts for 98.8%, 99.6%, and 99.7% of measured native pipeline time. Packing, texture encoding, serialization, Wasm response copying, and Worker delivery are not plausible dominant-phase optimizations. Direct Wasm and Worker artifacts are byte-identical in every case. Small and medium native artifacts also match; complete native arm64 and Wasm artifact hashes are retained separately because target floating-point output diverges at full-face scale. The shipped Wasm identity remains authoritative. This evidence admits the adjacent-texel experiment described below and rejects packaging or transfer tuning as the next optimization.

Item 8.6 admitted one second SIMD experiment after phase instrumentation identified texel generation as dominant. The challenger evaluates a fixed adjacent-texel tile through one shared edge traversal, keeps per-lane contour and winding state, reuses precomputed curve coefficients, and writes the same row-major RGBA8 bytes. It compares against an equivalent scalar tile kernel rather than the older scalar loop so tiling and SIMD are measured separately. Exact quality holds, but no candidate produces a universal product win: adjacent SIMD improves bounded Node/Chromium by 2.4%/0.9%, remains flat on complete Inter warm, and adds 20.7% optimized plus 11.4% Brotli bytes; scalar tile improves bounded Node by 10.1% but regresses Chromium/complete Inter by 1.5%/1.4% and adds 20.0%/10.9% bytes. The production baker therefore exposes no SIMD toggle and retains scalar as its sole kernel. Conservative edge bins or bounds remain a separate measured optimization because avoiding distance evaluations may matter more than vectorizing them.

## Verification and optimization gates

- Unit tests cover geometry, degenerate curves, edge coloring, winding, quantization, typed limits, and allocation reuse.
- Differential integration tests compare reconstructed coverage and channel errors with pinned native `msdfgen`, including acute, overlapping, self-intersecting, counter, quadratic, cubic, and malformed cases.
- Deterministic cargo-fuzz targets exercise outline ingestion, bounded subdivision, distance evaluation, and error correction; minimized failures become stable regressions.
- Full Inter plus representative Arabic, Devanagari, and CJK outlines must generate without panic or missing non-empty glyphs.
- Scalar, auto-vectorized, and explicit-SIMD experiments report native/Wasm time, allocation counts, raw/optimized/gzip/Brotli bytes, and exact or bounded-error equivalence; exactly one winning Wasm kernel ships.
- The final baker uses the repository's generated C ABI/JSON contract and direct Wasm memory access. It adds no WASI, Embind, wasm-bindgen, or per-call marshalling allocations.

The scalar production boundary satisfies that final ABI gate: the package build emits one optimized Wasm and its Rust-generated contract, while the TypeScript host validates the complete contract and writes fixed command records directly into one owned request allocation. The full artifact baker declares one generated progress callback import so long-running Worker bakes are observable; the smaller admission kernel remains zero-import. All seven native-oracle hashes survive the host boundary. The original production policy expands outline bounds onto one global 64-unit-per-em plane grid, encodes one full eight-pixel distance range, and surrounds each glyph with four padding texels. That policy remains the compatibility default and preserves its established fieldless descriptor and raster key.

Item 8.6 makes the checked transform configurable without changing the low-level Wasm ABI. `emSize` is an integer in `1..=1022`, full `pixelRange` is an integer in `1..=1020`, `planeUnitsPerEm` equals `emSize`, and each quantized glyph rectangle receives `ceil(pixelRange / 2)` field-padding texels. Partial options fill the other 64/8 default before hashing; every non-default descriptor carries both effective fields, while explicit effective 64/8 canonicalizes to the legacy descriptor. Real 155-glyph subset bakes at 32/4 and 32/6 pass generation and artifact validation. Those results prove configurability and deterministic authentication, not comparative quality or a new default. The completed scalar/auto/explicit comparison includes exact quality, the complete Inter pass, representative Node and Chromium calls, allocation/memory behavior, and compressed size. Scalar remains the sole production implementation because it wins the bounded runtime corpus and avoids a required target feature plus alternate artifact; the explicit variant's complete-font win remains item 8.6 evidence.

The published baker integrates the selected kernel without publishing a duplicate standalone generator Wasm. The isolated production-kernel graph is 52,633 optimized bytes, while the zero-import admission export and its harness are 60,563 optimized bytes. The phase-instrumented source still publishes one observer-free production path; its coverage-capable package resource is a 555,792-byte full baker containing the same scalar core plus Fontations, bounded face-resolved selection, dense records, atlas packing, hashing, KTX2, GLB, and its second generated ABI surface. Canonical 64/8 complete Inter retains its legacy artifact and page hashes and occupies ten near-full 1024-pixel RGBA8 pages: 39,111,736 GPU bytes and 39,177,416 externally serialized bytes. Uncompressed KTX2 contributes only 196 bytes per page, so container removal would not materially change this result. Reversible KTX2 supercompression, lossy GPU block formats, a lower authored generation resolution, and paging address different costs and require separate measurements; configurability alone does not select a lower default, and no lossy format replaces the exact baseline by declaration.

## WebGPU compute generation

The per-texel distance search is the part of MTSDF generation that plausibly benefits from GPU parallelism. A future hybrid path would keep outline validation, contour topology, edge coloring, atlas placement, and checked size arithmetic on the CPU, upload the compact colored-edge representation once, and dispatch one WebGPU invocation per atlas texel into an RGBA8 storage texture. Workgroups should evaluate adjacent texel tiles and stage bounded chunks of one glyph's colored edges in workgroup memory. Runtime-generated atlases could remain GPU-resident only when generation shares the renderer's `GPUDevice`; a Worker-owned device requires texture readback and transferable bytes unless the renderer also lives in that Worker. A downloadable GLB always requires texture-to-buffer copy, asynchronous readback, canonical byte ordering, KTX2 framing, hashing, and transfer to the caller.

TypeGPU is the preferred research host for this optional compute baker rather than Three.js or TSL. It supplies typed buffer schemas, storage resources, compute pipelines, timestamp support, and granular raw-WebGPU interoperability, including initialization from an integration-owned `GPUDevice`.[^typegpu-pipelines][^typegpu-interop] The distance kernel may remain explicit auditable WGSL inside typed shells, avoiding the TypeGPU source transform while still sharing typed bindings.[^typegpu-functions] This creates useful crossover with a future direct WebGPU raster integration without putting TypeGPU, Three.js, or a compute implementation in shaping, layout, baked-hit, scalar-Wasm, or unselected-raster graphs.

The accepted baker must still run offline and without WebGPU, the present serial Worker keeps portable generation off the main thread, and no repository measurement yet proves that pipeline compilation, edge upload, dispatch, synchronization, readback, packaging, and additional bundle bytes beat the scalar Wasm host end to end. A same-device resident-atlas path is an integration capability, not a reason for core to acquire a device, install browser listeners, or own renderer lifecycle.

Admission requires byte-identical or independently bounded output against the same native `msdfgen` corpus plus full-font measurements of every phase above, peak CPU/GPU memory, device-loss cleanup, and Worker availability. If that evidence shows a material end-to-end win, ordinary JavaScript must select the WebGPU compute graph before compilation and retain scalar Wasm as the non-WebGPU/offline path. The WGSL build then contains only the compute implementation; the fallback build does not carry a runtime shader branch. Until that threshold is met, adding compute would create a second generation implementation without evidence and is rejected by D-060.

The runtime text renderer has a different boundary. Its hot work is already one instanced draw sampling a resident atlas; a pre-render compute pass would add dispatch and synchronization without removing the fragment samples. No compute branch is proposed for Bitmap or MTSDF rendering.

The merged v0 sequence deliberately retained Three.js/TSL through Slug so its real curve-resource, shader-composition, batching, and lifetime requirements were executable rather than guessed. Target v1 Milestone 11 now extracts the common integration contract beneath all three rasters: core shaping and layout remain renderer-neutral, portable techniques expose prepared batches and resources, and Three.js, TypeGPU, Wayfare, and gpucat remain independently selectable integrations. The compute-baker experiment can proceed independently and must not enter unrelated runtime graphs.

[^valve-sdf]: Green, _Improved Alpha-Tested Magnification for Vector Textures and Special Effects_, 2007.

[^chlumsky-thesis]: Chlumský, _Shape Decomposition for Multi-Channel Distance Fields_, 2015.

[^chlumsky-paper]: Chlumský, Sloup, and Šimeček, _Improved Corners with Multi-Channel Signed Distance Fields_, 2018.

[^msdfgen]: Chlumsky `msdfgen` 1.13 source and documentation.

[^uikit-loader]: Current pmndrs/uikit `TTFLoader` source.

[^zappar-generator]: Published `@zappar/msdf-generator` 1.2.4 metadata, README, archive contents, and license notice.

[^typegpu-pipelines]: TypeGPU pipeline documentation for compute dispatch, bindings, and timestamp measurement.

[^typegpu-interop]: TypeGPU interoperability documentation for raw resource access and `initFromDevice`.

[^typegpu-functions]: TypeGPU function documentation for explicit WGSL shells without the source transformation plugin.
