---
type: Question Register
title: Open questions
description: Tracks unresolved decisions, blockers, and prototype questions for the contracts and roadmap.
tags: [questions, governance, blockers]
timestamp: 2026-07-24T14:01:29Z
---

# Open questions

Status: unresolved unless marked otherwise.

## Blocking before Phase 1

1. Which exact HarfRust, HarfBuzz, and Unicode versions become the first reference set?
2. Which authorized Poimandres maintainer will submit the prepared [`PMNDRS` prefix request](gltf-extension-registration.md), and should the registry identify the project as `Poimandres` or `pmndrs`?
3. Which source-font licenses permit checked-in fixtures and generated derivatives in CI?
4. Which browsers and GPU APIs define the initial support matrix?

## Baker

1. Should subsetting use Skera/Fontations, HarfBuzz subset in native tooling, or a project-owned closure pass?
2. What deterministic outline representation feeds Slug, MSDF, and bitmap generation?
3. Which MTSDF generator is suitable for the MSDF module's safe Rust/Wasm, deterministic output, size, and licensing requirements?
4. Does V1 bitmap rendering include TrueType hinting, or use deterministic unhinted oversampling?
5. What are default runtime-bake glyph ranges, time limits, memory limits, and atlas limits?
6. Can WOFF2 decoding remain out of the always-loaded shaper module and live only in the baker?
7. Which GLB writer details could prevent full byte identity even when authoritative Node/Worker sections are identical?

## Binary format and GLB

1. Which exact KTX2 encodings and GPU-native compressed variants make the initial WebGL2/WebGPU support matrix?
2. What versioning change requires a new extension name versus a declared format version?
3. Should independently fetched raster artifacts support progressive range requests beyond whole-resource loading?

## Shaper and compiled data

1. What internal HarfRust boundary can accept baked cmap, metrics, classes, and lookup execution without a long-lived fork?
2. Which HarfRust behaviors rely on source table structure rather than lookup semantics?
3. How much of the runtime size is Unicode/script logic versus generic font access?
4. Which operation families dominate actual pmndrs workloads?
5. Does a high-level IR remain smaller after Brotli than subsetted shaping-only OpenType?
6. Is a debug/reference HarfRust path shipped, test-only, or separately imported?
7. How are malformed-but-common fonts handled when HarfRust returns errors where HarfBuzz uses fallbacks?

## Paragraph engine

V1 owns UAX #9 bidi analysis/reordering, UAX #14 break opportunities, UAX #24 script itemization, and UAX #29 grapheme boundaries in the JavaScript paragraph engine.

1. Which UAX #14 implementation and tailoring strategy should be used in JS?
2. How much surrounding context is necessary when reshaping final line slices?
3. Which scripts always trigger boundary reshaping versus relying on unsafe-break flags?
4. Is balanced wrapping a post-V1 strategy behind the same interface?
5. What is the font-fallback unit: code point, grapheme, shaping cluster, or script run?
6. How are selections, carets, and hit testing represented in the first public layout output?
7. What is the emergency-break policy for a single cluster wider than the region?

## Rasters

1. Which pieces of Three Flatland Slug are legally and technically suitable to port?
2. How are missing glyph rasters reported and substituted within the V1 per-font-slot raster assignment?
3. Which safe OpenType-SVG subset and standalone-SVG manifest contract must the large-coverage CJK/icon milestone accept?

## Product and package shape

1. Which bundlers form the initial package-graph test matrix for the required dynamic `runtime-bake` boundary and optional React/raster subpaths?
2. Which APIs are public versus experimental while the binary format changes?

## Required prototypes before decisions

- Compare at least two cmap page-directory designs.
- Measure minimal HarfRust Wasm raw/compressed size.
- Measure one coarse Wasm call versus repeated small calls.
- Produce one tiny golden GLB with two rasters and one glyph-ID space.
- Upload raw and compressed atlas candidates through target WebGL/WebGPU paths.
- Bake one font natively and in a worker, comparing deterministic sections.
- Reflow a Latin and Arabic paragraph while recording Wasm call counts.
- Compare shaping-only OpenType versus one compiled lookup representation for size and speed.
