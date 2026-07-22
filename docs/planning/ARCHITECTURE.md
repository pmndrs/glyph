# Proposed architecture

Status: proposed; interfaces are illustrative and not public API commitments.

## System boundaries

```text
                         build time or worker
source font ───────────► portable Rust baker
                              │
                              ▼
                     canonical FL_font GLB
                  ┌───────────┼─────────────┐
                  │           │             │
              shaping       Slug        MTSDF/bitmap
               data       GPU data        GPU data
                  │           │             │
                  ▼           └──────┬──────┘
          HarfRust-based Wasm        │
                  │                  │
                  ▼                  │
          shaped glyph buffers       │
                  │                  │
                  ▼                  │
           JS paragraph engine       │
                  │                  │
                  ▼                  ▼
             positioned glyphs → presentation renderer
```

## Ownership

### Baker owns

- source-font parsing and validation;
- variation instancing;
- subset and shaping closure;
- dense glyph remapping;
- canonical metrics and shaping-section emission;
- Slug conversion;
- MSDF/MTSDF generation and atlas packing;
- bitmap rasterization and atlas packing;
- GLB writing and deterministic diagnostics.

### Wasm shaper owns

- UTF-16 decoding and source clusters;
- HarfRust script behavior;
- shaping plans and font registration;
- GSUB/GPOS application;
- glyph flags and unsafe-break data;
- packed output buffers;
- optimized lookup and SIMD kernels when proven equivalent.

### JS paragraph engine owns

- source text and style spans;
- font fallback policy;
- region constraints;
- break selection and layout strategy;
- alignment, justification, clipping, max lines, and ellipsis;
- shape/reflow caches;
- batching ranges that need boundary reshaping.

### Presentation adapters own

- GPU resource creation;
- presentation selection policy;
- glyph quad/instance generation;
- renderer-specific draw submission.

## Canonical identities and coordinates

- Input text indices and public clusters are UTF-16 offsets.
- Unicode processing uses decoded scalar values.
- Each baked font has one dense packed glyph-ID space.
- Stored shared metrics use font design units.
- Shaping output uses signed 32-bit design-unit positions.
- Presentation plane bounds use a documented design-unit or fixed-point space.
- World/screen scaling occurs after shaping.

## Proposed runtime contracts

### Shaper request

```ts
interface ShapeRequest {
  fontHandle: number
  textStart: number
  textLength: number
  direction: 'ltr' | 'rtl'
  script: number
  language: number
  clusterLevel: number
  features: readonly FontFeature[]
  flags: number
}
```

Requests are encoded into persistent Wasm memory and submitted in batches. Strings and per-glyph objects must not cross the boundary one at a time.

### Shaper output

```ts
interface ShapedBufferViews {
  glyphIds: Uint16Array | Uint32Array
  clusters: Uint32Array
  xAdvances: Int32Array
  yAdvances: Int32Array
  xOffsets: Int32Array
  yOffsets: Int32Array
  flags: Uint16Array
}
```

### Paragraph boundary

```ts
interface Paragraph {
  text: string
  spans: readonly TextSpan[]
  style: ParagraphStyle
}

interface ParagraphConstraints {
  width: number
  height?: number
  maxLines?: number
  wrap: 'none' | 'word' | 'character'
  align: 'start' | 'center' | 'end' | 'justify'
  overflow: 'visible' | 'clip' | 'ellipsis'
}
```

The paragraph engine creates measured clusters from broad-run shapes, chooses line boundaries, then submits all boundary-sensitive final ranges in one reshape batch.

## Font loading states

```text
source bytes
    │
    ├── contains supported FL_font
    │      └── validate sections → register shaper → upload presentations
    │
    └── supported source font
           └── check persistent bake cache
                  ├── hit → normal baked path
                  └── miss → worker baker → cache → normal baked path
```

The application must not retain two font models. Runtime baking terminates at the same canonical format as offline baking.

## `FL_font` extension family

### Shared extension

`FL_font` contains:

- format/version metadata;
- glyph count and ID width;
- units per em and line metrics;
- section directory;
- cmap and variation sequences;
- dense glyph metrics and properties;
- shaping program/reference sections;
- supported scripts, languages, and features;
- presentation directory and per-glyph availability;
- compiler, HarfRust, HarfBuzz-reference, and Unicode versions.

### Presentation extensions

`FL_font_slug` contains flat glyph-to-curve/band ranges and GPU-ready geometry data.

`FL_font_distance_field` contains one or more SDF/MSDF/MTSDF atlases, technique metadata, and dense or sparse packed-glyph records.

`FL_font_bitmap` contains strike directories, atlas payloads, and per-strike glyph records.

Future presentation extensions may add color layers or images without changing shaped output.

## Binary-layout rules

1. The GLB JSON locates top-level extension buffer views; authoritative section records live in binary data.
2. All sections are aligned sufficiently for direct typed-array views; GPU blocks also meet backend upload constraints.
3. Section offsets and lengths are bounds-checked once during registration.
4. Shaping data uses structure-of-arrays where bulk access dominates.
5. GPU presentation data uses final component widths, record strides, texture dimensions, and row layouts.
6. No pointer-sized or platform-dependent values appear on disk.
7. Unknown optional sections are skipped; unknown required capability bits reject the asset.
8. Every serialized structure has golden-byte tests before its version is considered stable.

## Reference and optimized shaping paths

Initial reference path:

```text
baked shaping-only OpenType data → HarfRust → shaped output
```

Progressive optimized path:

```text
HarfRust Unicode/script/buffer state
            +
FL_font direct cmap/metrics/classes/lookups
            ↓
same shaped output
```

Each optimized operation ships only after differential tests pass. The reference path remains available in debug/test builds and as a temporary fallback until the operation family is complete.

## Reflow algorithm boundary

Stable across width changes:

- decoded text and style segmentation;
- paragraph bidi analysis;
- Unicode break opportunities;
- font fallback decisions;
- broad-run shaping and measured clusters;
- shape plans.

Width-dependent:

- selected line breaks;
- boundary reshape ranges;
- visual line ordering;
- justification and alignment;
- ellipsis and vertical placement.

Expected width-change flow:

1. JS fits cached measured clusters to the new width.
2. It intersects legal UAX #14 opportunities with cluster and unsafe-break constraints.
3. It identifies changed line ranges.
4. It batches only ranges needing boundary-sensitive reshaping.
5. It finalizes visual order and placement.

## Caching

### Persistent baked-font cache key

Hash of:

- source bytes;
- compiler and format versions;
- glyph selection;
- variation instance;
- presentation options;
- generator versions affecting deterministic output.

### Runtime caches

- registered font and validated section offsets;
- HarfRust shaper data;
- shape plans keyed by segment properties and feature set;
- broad-run shape cache;
- final line-shape cache;
- paragraph analysis and width-dependent layout cache;
- GPU resources by font/presentation.

## Failure model

- Reject malformed or unsupported source fonts in the baker with structured diagnostics.
- Reject malformed offsets, unsupported versions, and required unknown capability bits during load.
- Permit missing optional presentation records and select an available fallback.
- Never silently fall back from incorrect compiled shaping to approximate shaping.
- Surface runtime-bake cancellation, memory limit, atlas overflow, and unsupported table errors distinctly.

## Dependency direction

```text
binary model
   ↑          ↑
baker      shaper
   ↑          ↑
CLI/worker  JS bridge
       ↑      ↑
        loader
          ↑
 paragraph + presentations
          ↑
 downstream renderers / Three Flatland
```

The paragraph engine depends on shaper contracts, never HarfRust internals. Presentations depend on packed glyph IDs and positioned output, never GSUB/GPOS.
