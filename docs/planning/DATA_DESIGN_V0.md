# Runtime data design V0

Status: current hardening target; experimental  
Goal: carry one font through runtime shaping, paragraph layout, and one renderer while keeping every identity multi-font-safe

## Scope decision

V0 does not compile OpenType layout data. HarfRust reads the registered OpenType font at runtime and caches its parsed/shaper state. V0 does not subset or remap glyph IDs.

The source OpenType glyph ID is therefore the local glyph ID used by shaping and presentation lookup. That decision is intentionally contained inside a font record so a future compiled format can introduce dense IDs without changing paragraph or renderer APIs.

## Runtime ownership graph

```text
FontRegistry
  FontRecord[FontHandle]
    OpenType bytes owned by Wasm shaper
    Font metrics/capabilities
    PresentationSource[]
    GPU resources, created lazily per selected presentation

Paragraph
  original UTF-16 text
  spans referencing FontHandle
  shaped runs referencing font slots
  width-independent measured clusters
  width-dependent line/layout cache

ParagraphLayout
  fontTable: FontHandle[]
  line/run/glyph typed views
  positioned glyph identity = (fontSlot, localGlyphId)
```

## Font record

```ts
interface FontRecordV0 {
  handle: FontHandle
  key: FontKey

  opentypeBytes: WasmRange
  unitsPerEm: number
  glyphCount: number
  glyphIdWidth: 16 | 32

  ascender: number
  descender: number
  lineGap: number

  capabilities: FontCapabilityBits
  presentations: readonly PresentationRecordV0[]
}
```

`opentypeBytes` is a Wasm-owned range or an equivalent immutable registration owned by the shaper. JavaScript should not retain duplicate parsed font objects.

## Asset envelope

The first fixture may be delivered as an experimental GLB or as equivalent test ranges. The logical envelope is:

```ts
interface FontAssetV0 {
  version: 0
  font: {
    key?: string
    opentypeBufferView: number
  }
  presentations: readonly PresentationDescriptorV0[]
}
```

This is a packaging description, not a compiler output contract. Fixture tooling may assemble already-generated font and presentation bytes without understanding GSUB/GPOS.

The asset contains one font face. Applications support multiple fonts by registering multiple assets. We do not need a multi-face GLB to make the runtime multi-font-safe.

## Presentation directory

```ts
interface PresentationDescriptorV0 {
  kind: 'bitmap' | 'mtsdf' | 'slug'
  version: number
  metadataBufferView: number
  payloadBufferViews: readonly number[]
  required: boolean
}
```

Rules:

- presentation records are keyed by the font's local glyph ID;
- presentation metadata never duplicates shaping advances or kerning;
- a missing presentation record is explicit;
- the loader rejects unknown required presentation kinds and skips unknown optional ones;
- each plugin owns validation of its metadata and payload;
- GPU payloads declare final component format, stride, dimensions, and alignment.

## First bitmap presentation record

Bitmap is the proposed first end-to-end fixture because it proves the shared architecture with the smallest shader and generator surface.

```ts
interface BitmapPresentationV0 {
  ppemX: number
  ppemY: number
  textureFormat: 'r8unorm'
  atlasWidth: number
  atlasHeight: number
  pageCount: number

  glyphCount: number
  records: BufferRange
  pages: readonly ImageRange[]
}
```

Dense record indexed by local glyph ID:

```text
plane bounds   4 × i16
atlas bounds   4 × u16
page           u16
flags          u16
-------------------
20 bytes per glyph
```

`page = 0xffff` marks a glyph without visible bitmap data, such as a space. Plane bounds use a declared fixed-point em convention. Shared OpenType advances remain authoritative for layout.

MTSDF and Slug receive separate versioned record formats later. Their presence does not change font registration, shaping, paragraph data, or glyph identity.

## Shaped data

Shaped output is structure-of-arrays:

```text
run font slots      u16[runCount]
run glyph starts    u32[runCount]
run glyph counts    u32[runCount]

glyph IDs           u16|u32[glyphCount]
clusters            u32[glyphCount]
x/y advances        i32[glyphCount]
x/y offsets         i32[glyphCount]
flags               u16[glyphCount]
```

V0 uses `u16` glyph IDs when the registered font fits. The API and buffer header carry the width so a larger font can use `u32` without redefining every field.

## Paragraph data

The JS paragraph engine keeps stable and width-dependent data separate.

Stable for the text/style revision:

- original text and UTF-16 boundaries;
- style/font runs;
- shaped run views;
- clusters and measured advances;
- break opportunities and unsafe-boundary flags;
- font-slot table.

Recomputed for a constraint revision:

- selected line breaks;
- boundary reshape batch, if required;
- visual run order;
- x/y placement, alignment, ellipsis, and clipping;
- presentation batches.

## Multiple-font invariants

Even though the first pipeline uses one font:

1. every span refers to a `FontHandle`;
2. every shaped run carries a font slot;
3. glyph IDs are never used as global keys;
4. layout exposes its font-slot table;
5. GPU resource lookup uses `(FontHandle, PresentationKind)`;
6. caches include font handle and font generation/version;
7. disposal detects stale font references;
8. presentation batching may split by font without reshaping.

An early contract test should register the same fixture twice under different handles and prove that cache/resource identity does not collide. A real second-font fallback corpus is later work.

## Copy and allocation budget

V0 allows one bulk copy of OpenType bytes into Wasm memory during registration. It does not allow:

- per-shape font copies;
- per-run string transcoding through JS objects;
- per-glyph object output;
- reconstruction of presentation maps;
- numeric repacking before GPU upload.

Typed views are refreshed after Wasm memory growth. Their lifetime and invalidation rules must be explicit in the bridge.

## Validation

At registration:

- bound-check every buffer view/range;
- validate glyph count and ID width;
- validate presentation record count/stride/page indices;
- reject overlapping mutable output/input ranges;
- reject unsupported required capabilities;
- cap source byte length, glyph count, atlas dimensions, and retained memory;
- surface a structured diagnostic rather than silently falling back.

## Future-compatible seams, not current work

- a future compiler can replace `opentypeBufferView` with shaping-only or compiled sections;
- a future `glyphIdMap` can translate compiled dense IDs inside font registration;
- a worker baker can eventually produce the same presentation directory;
- additional font assets can be registered without changing layout records;
- automatic fallback can choose font handles before shaping;
- Slug, MTSDF, color, or image presentations can add independent descriptors.

None of those seams requires implementing the corresponding subsystem in V0.
