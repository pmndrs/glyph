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
generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-27T02:26:42Z"
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

| Implementation | License evidence | Useful findings | Production disposition |
| --- | --- | --- | --- |
| Chlumsky `msdfgen` 1.13 | MIT license in the pinned source archive | Canonical C++ core, exact curve-distance selectors, overlap combiners, error correction, MTSDF semantics, and mature fixtures | Test-only native oracle and port reference; never shipped or required by the browser |
| `klyff_msdf` 0.1.3 | Crate metadata declares MIT; the audited crates.io archive omits a standalone license file | Pure-Rust CPU structure, reusable scratch ownership, SoA edge traversal, compact Wasm proof, and a useful adversarial starting corpus | No product dependency or source copy; retain design findings and differential evidence only |
| Rust `msdfgen` 0.2.1 | MIT upstream through `msdfgen-sys` | Safe Rust API over the canonical implementation | Rejected: C++ FFI and native build surface violate the portable Rust/Wasm boundary |
| `oxitext-sdf` 0.2.0 | Apache-2.0 crate metadata | Pure-Rust MTSDF, edge coloring, glyph tiles, and atlas APIs | Research comparison only: duplicates font ownership and brings a broader stack than the core requires |
| pmndrs/uikit runtime loader | UIKit is MIT; its loader imports `@zappar/msdf-generator` | Confirms practical runtime generation, Worker lifetime, progress, overlap repair, and configurable atlas/range controls | Product precedent, not a reusable generator implementation |
| `@zappar/msdf-generator` 1.2.4 | MIT package; notice records MIT msdfgen, BSD-3-Clause Skia PathOps, and MIT/public-domain stb_truetype | Emscripten Worker wrapper around msdfgen with overlap repair; published package contains a 303.1 kB Wasm module and 444.0 kB unpacked surface | Rejected: duplicates font parsing and geometry dependencies and is materially larger than the repository boundary |

All reviewed implementations permit commercial use, modification, and redistribution under permissive licenses. A port or substantial derivation must preserve the applicable copyright and license notice. The package-owned implementation records msdfgen as algorithm and oracle provenance even where the Rust representation and control flow are original.

UIKit does not currently contain its own distance-field kernel. Its `TTFLoader` dynamically imports the Zappar package, initializes one generator, generates one or more atlases, and disposes it.[^uikit-loader] The current Zappar package describes itself as a WebAssembly port of msdfgen and ships third-party notices for msdfgen, Skia PathOps, and stb_truetype.[^zappar-generator]

## Repository-owned core boundary

The production generator is a private Rust core under `packages/text/rust`; public packaging remains owned by the MSDF baker. The core owns only:

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

The scalar kernel is both the correctness oracle and the selected production implementation, not a public mode. Compiler `simd128` auto-vectorization and explicit four-channel quantization preserve exact output and slightly reduce bytes, but regress representative Node and Chromium calls by roughly 5–6%. Their complete-Inter improvement remains below 0.5%. The internal explicit implementation therefore remains test-only so the decision can be reproduced; the opinionated baker exposes no SIMD toggle, alternate artifact, or per-call capability branch.

## Verification and optimization gates

- Unit tests cover geometry, degenerate curves, edge coloring, winding, quantization, typed limits, and allocation reuse.
- Differential integration tests compare reconstructed coverage and channel errors with pinned native `msdfgen`, including acute, overlapping, self-intersecting, counter, quadratic, cubic, and malformed cases.
- Deterministic cargo-fuzz targets exercise outline ingestion, bounded subdivision, distance evaluation, and error correction; minimized failures become stable regressions.
- Full Inter plus representative Arabic, Devanagari, and CJK outlines must generate without panic or missing non-empty glyphs.
- Scalar, auto-vectorized, and explicit-SIMD experiments report native/Wasm time, allocation counts, raw/optimized/gzip/Brotli bytes, and exact or bounded-error equivalence; exactly one winning Wasm kernel ships.
- The final baker uses the repository's generated C ABI/JSON contract and direct Wasm memory access. It adds no WASI, Embind, wasm-bindgen, or per-call marshalling allocations.

The scalar production boundary satisfies that final ABI gate: the package build emits one optimized zero-import Wasm and its Rust-generated contract, while the TypeScript host validates the complete contract and writes fixed command records directly into one owned request allocation. All seven native-oracle hashes survive the host boundary. The completed scalar/auto/explicit comparison includes exact quality, the complete Inter pass, representative Node and Chromium calls, allocation/memory behavior, and compressed size. Scalar remains the sole production implementation because neither SIMD variant wins the complete comparison.

[^valve-sdf]: Green, *Improved Alpha-Tested Magnification for Vector Textures and Special Effects*, 2007.
[^chlumsky-thesis]: Chlumský, *Shape Decomposition for Multi-Channel Distance Fields*, 2015.
[^chlumsky-paper]: Chlumský, Sloup, and Šimeček, *Improved Corners with Multi-Channel Signed Distance Fields*, 2018.
[^msdfgen]: Chlumsky `msdfgen` 1.13 source and documentation.
[^uikit-loader]: Current pmndrs/uikit `TTFLoader` source.
[^zappar-generator]: Published `@zappar/msdf-generator` 1.2.4 metadata, README, archive contents, and license notice.
