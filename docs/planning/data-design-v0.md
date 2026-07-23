---
type: Data Contract
title: Runtime data design V0
description: Summarizes canonical font identity, presentation binding, shaped output, paragraph boundaries, and allocation rules.
status: contract-candidate
tags: [data, glb, shaping, presentation]
---

# Runtime data design V0

Status: contract candidate
Goal: freeze the font, shaping, presentation, and runtime-memory shapes used by the first implementation

The detailed shaping rules and binary ABI are normative within this plan:

- [Shaping data contract V0](shaping-data-contract.md)
- [Presentation data contract V0](presentation-data-contract.md)
- [Runtime and bake API shapes](api-shapes.md)

## Canonical model

One font face owns one font-local glyph-ID space. The core font and every presentation bind to the same identity:

```text
FontIdentityV0 =
  SHA-256(canonical SFNT + extents + referenced contour points)
  + glyphCount
  + glyphIdWidth
```

The loader registers many independent faces under opaque `FontHandle`s. A glyph is identified only by `(FontHandle, LocalGlyphId)`.

## Core `PMNDRS_font` object

```ts
interface FontAssetV0 {
  version: 0
  shaping: {
    format: 'opentype-sfnt-harfrust-v0'
    bufferView: number
    hash: Sha256Hex
    fontFunctions: {
      glyphExtentsBufferView: number
      glyphExtentsStride: 8
      contourPoints?: { bufferView: number; count: number; stride: 8 }
    }
  }
  metrics: {
    glyphCount: number
    glyphIdWidth: 16
    unitsPerEm: number
    ascender: number
    descender: number
    lineGap: number
  }
  provenance: {
    sourceHash: Sha256Hex
    descriptorHash: Sha256Hex
    bakerVersion: string
    harfrustVersion: string
    harfbuzzReferenceVersion: string
    unicodeVersion: string
  }
  presentations: readonly PresentationReferenceV0[]
}
```

`Sha256Hex` is exactly 64 lowercase hexadecimal characters. `sourceHash` covers the original input bytes; `descriptorHash` covers the canonical bake descriptor; `shaping.hash` uses the domain-separated, length-prefixed SFNT/extents/contour-point encoding in the shaping contract.

The V0 shaping profile is a deterministic shaping-only static SFNT plus flat extents and referenced contour points required by HarfRust font functions after outlines are removed. It retains required OpenType layout and metrics tables, excludes outlines/presentations/metadata/hinting, and has a closed table whitelist. The exact table and record policy is defined in [the shaping contract](shaping-data-contract.md).

## Presentation references

```ts
interface PresentationReferenceV0 {
  id: string
  kind: 'bitmap' | 'distance-field' | 'slug'
  extension: ExtensionName
  version: 0
  source:
    | { type: 'embedded' }
    | { type: 'external'; uri?: string; artifactHash?: Sha256Hex }
}
```

The same logical presentation can be embedded in the core GLB, delivered as its own GLB, or supplied by an application resolver. The choice does not change its extension object or binary records. A core GLB may contain any combination of presentation extensions.

Companion roots repeat this binding before any payload fields:

```ts
interface PresentationBindingV0 {
  version: 0
  presentationId: string
  shapingHash: Sha256Hex
  glyphCount: number
  glyphIdWidth: 16
}
```

## Technique records

| Extension | Dense glyph record | Authoritative payload |
| --- | ---: | --- |
| `PMNDRS_font_bitmap` | 20 B/glyph/strike | KTX2 texture pages; lossless R8 baseline for grayscale and RGBA8 for color. |
| `PMNDRS_font_distance_field` | 20 B/glyph | Linear RGBA8 KTX2 pages for MSDF or MTSDF; compression variants are quality-gated. |
| `PMNDRS_font_slug` | 40 B/glyph | RGBA16F curves, exact u32 headers, and exact glyph-local u16 references. |

Bounds, sentinel values, fixed-point coordinates, texture variants, Slug address resolution, and cost formulas are fixed in the [presentation contract](presentation-data-contract.md).

## Runtime font record

```ts
interface FontRecordV0 {
  handle: FontHandle
  key: FontKey
  shapingBytes: WasmRange
  shapingHash: Sha256Hex
  glyphCount: number
  glyphIdWidth: 16
  unitsPerEm: number
  ascender: number
  descender: number
  lineGap: number
  presentations: ReadonlyMap<string, PresentationHandle>
  generation: number
}
```

Registration validates once, transfers or copies the shaping buffer into Wasm once, and keeps flat views over presentation records. It creates no glyph map or object per glyph.

## Bake descriptor

```ts
interface BakeDescriptorV0 {
  formatVersion: 0
  fontFaceIndex: number
  presentations: readonly PresentationBakeDescriptorV0[]
}

type PresentationBakeDescriptorV0 =
  | BitmapBakeDescriptorV0
  | DistanceFieldBakeDescriptorV0
  | SlugBakeDescriptorV0

interface BitmapBakeDescriptorV0 {
  id: string
  kind: 'bitmap'
  ppemX: number
  ppemY: number
  oversample: number
  padding: number
  hinting: 'none'
  coverage: 'grayscale'
}
```

The exact distance-field and Slug descriptor fields are defined in the [API fixture](api-shapes.md). The first executable baker completes bitmap first; unsupported requested generators fail explicitly rather than ignoring fields. Node and Worker hosts invoke the same descriptor and MUST produce byte-identical authoritative sections.

## Shaped output

The Wasm result is structure-of-arrays:

```text
run font slots      u16[runCount]
run glyph starts    u32[runCount]
run glyph counts    u32[runCount]
glyph IDs           u16[glyphCount]
clusters            u32[glyphCount]
x/y advances        i32[glyphCount]
x/y offsets         i32[glyphCount]
flags               u16[glyphCount]
```

Clusters are UTF-16 offsets and positions are signed design units. V0 costs exactly 24 bytes per shaped glyph plus 10 bytes per run before arena headers and alignment. The exact request records, flags, and validation are in the [shaping contract](shaping-data-contract.md).

## Paragraph boundary

Stable across width changes:

- source text and UTF-16 coordinates;
- font/style runs;
- broad shaped output and measured clusters;
- legal break opportunities and shaper safety flags.

Width-dependent:

- chosen line breaks;
- boundary-sensitive reshape ranges;
- visual run order, alignment, ellipsis, and positioned glyphs.

The JavaScript paragraph engine performs reflow. It makes zero Wasm calls for a reusable simple reflow or one batched `reshapeRanges` call for all affected boundaries.

## Copy and allocation rules

Allowed:

- source transfer to the Worker and baked-result transfer back;
- one final compacting write in the baker;
- one shaping-payload copy into Wasm when shared ownership is unavailable;
- KTX2 decode/transcode required by the selected texture variant;
- bulk GPU uploads.

Forbidden:

- source-font parsing or rasterization on the main thread;
- per-glyph JavaScript output objects;
- reconstruction of glyph or kerning maps;
- numeric repacking of presentation records;
- duplicate logical advances or kerning inside presentations;
- attachment of a presentation whose shaping identity does not match.

## Deterministic byte report

Every bake emits:

```ts
interface FontPayloadReportV0 {
  sourceBytes: number
  shaping: ShapingPayloadReportV0
  presentations: readonly {
    id: string
    kind: 'bitmap' | 'distance-field' | 'slug'
    recordBytes: number
    serializedTextureBytes: number
    decodedTextureBytes: number
    gpuBytes: number
    pages: readonly PagePayloadReportV0[]
  }[]
  glb: {
    jsonBytes: number
    binaryBytes: number
    paddingBytes: number
    totalBytes: number
  }
}
```

Reports are produced per logical resource and for a combined GLB so packaging overhead is visible without conflating shaping, transport, decoding, and GPU residency.
