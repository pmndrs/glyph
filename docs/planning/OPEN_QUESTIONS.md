# Open questions

Status: unresolved unless marked otherwise.

## Blocking before Phase 1

1. Which exact HarfRust, HarfBuzz, and Unicode versions become the first reference set?
2. Which authorized Poimandres maintainer will submit the prepared [`PMNDRS` prefix request](GLTF_EXTENSION_REGISTRATION.md), and should the registry identify the project as `Poimandres` or `pmndrs`?
3. Which minimum OpenType tables/bytes must V0 retain for HarfRust without attempting shaping-table compilation?
4. Which source-font licenses permit checked-in fixtures and generated derivatives in CI?
5. Which browsers and GPU APIs define the initial support matrix?
6. Is `u16` glyph identity a V1 hard limit, or must the first format support both `u16` and `u32`?

## Baker

1. Should subsetting use Skera/Fontations, HarfBuzz subset in native tooling, or a project-owned closure pass?
2. What deterministic outline representation feeds Slug, MTSDF, and bitmap generation?
3. Which MTSDF implementation is suitable for safe Rust/Wasm, deterministic output, size, and licensing?
4. Does V1 bitmap rendering include TrueType hinting, or use deterministic unhinted oversampling?
5. What are default runtime-bake glyph ranges, time limits, memory limits, and atlas limits?
6. Can WOFF2 decoding remain out of the always-loaded shaper module and live only in the baker?
7. Which GLB writer details could prevent full byte identity even when authoritative Node/Worker sections are identical?

## Binary format and GLB

1. Should CPU shaping sections use one extension-owned buffer view or several independently fetchable views?
2. What alignment is sufficient across Wasm typed views, WebGPU buffers, raw texture uploads, and compressed textures?
3. Are raw upload-ready textures worth row padding in the asset, or should loading perform a bulk row copy?
4. Which atlas image formats can be considered “no repacking” across WebGL and WebGPU?
5. How are optional sections checksummed or validated?
6. What versioning change requires a new extension name versus a binary section version?
7. Can presentation sections be external or progressively fetched while shared shaping data is already usable?

## Shaper and compiled data

1. What internal HarfRust boundary can accept baked cmap, metrics, classes, and lookup execution without a long-lived fork?
2. Which HarfRust behaviors rely on source table structure rather than lookup semantics?
3. How much of the runtime size is Unicode/script logic versus generic font access?
4. Which operation families dominate actual pmndrs workloads?
5. Does a high-level IR remain smaller after Brotli than subsetted shaping-only OpenType?
6. Is a debug/reference HarfRust path shipped, test-only, or separately imported?
7. How are malformed-but-common fonts handled when HarfRust returns errors where HarfBuzz uses fallbacks?

## Paragraph engine

1. Does V1 own bidi analysis or accept pre-segmented directional runs from a caller?
2. Which UAX #14 implementation and tailoring strategy should be used in JS?
3. How much surrounding context is necessary when reshaping final line slices?
4. Which scripts always trigger boundary reshaping versus relying on unsafe-break flags?
5. Is balanced wrapping a post-V1 strategy behind the same interface?
6. What is the font-fallback unit: code point, grapheme, shaping cluster, or script run?
7. How are selections, carets, and hit testing represented in the first public layout output?
8. What is the emergency-break policy for a single cluster wider than the region?

## Presentations

1. Which pieces of Three Flatland Slug are legally and technically suitable to port?
2. Can Slug, MTSDF, and bitmap use one canonical plane-bounds convention without losing technique-specific padding?
3. Can a renderer switch technique per glyph, or only per run/font in V1?
4. What is the default presentation-selection policy by projected pixel height?
5. How are missing glyph presentations reported and substituted?
6. Which COLR paint operations, OpenType SVG subset, standalone SVG-icon manifest contract, and embedded bitmap formats must the first color/SVG milestone support?

## Product and package shape

1. Is the initial package framework-neutral core only, or does it ship React Three Fiber bindings concurrently?
2. Which bundlers form the initial package-graph test matrix for the required dynamic `runtime-bake` boundary?
3. What final names should be used for the Node bake subpath, Worker chunk, and standalone CLI?
4. Which APIs are public versus experimental while the binary format changes?
5. What compatibility promise does Three Flatland need during migration?

## Required prototypes before decisions

- Compare at least two cmap page-directory designs.
- Measure minimal HarfRust Wasm raw/compressed size.
- Measure one coarse Wasm call versus repeated small calls.
- Produce one tiny golden GLB with two presentations and one glyph-ID space.
- Upload raw and compressed atlas candidates through target WebGL/WebGPU paths.
- Bake one font natively and in a worker, comparing deterministic sections.
- Reflow a Latin and Arabic paragraph while recording Wasm call counts.
- Compare shaping-only OpenType versus one compiled lookup representation for size and speed.
