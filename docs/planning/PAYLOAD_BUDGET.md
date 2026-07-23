# Font payload budget

Status: measured baseline plus modeled presentation estimates  
Purpose: keep shaping, serialized presentation data, transport bytes, and GPU memory distinct while the first baker is designed.

## What is being counted

A font package has costs that must not be collapsed into one number:

```text
shared font data
  source/layout tables used by HarfRust
  + flat cmap, metrics, properties, and section indexes

selected presentation data
  bitmap records + pixels
  or MSDF/MTSDF records + distance-field texels
  or Slug records + curve/band data

delivery overhead
  GLB JSON, section alignment, image containers, and compression

runtime memory
  Wasm font/shaper state + decoded or uploaded GPU resources
```

The payloads for bitmap, MSDF/MTSDF, and Slug are alternatives unless an asset deliberately contains more than one presentation. The shaping data is paid once and is shared by every presentation.

“Texture bytes” below means the uncompressed GPU-resident storage implied by dimensions and texel format. It is not a network-size estimate. Network bytes depend on the final PNG/KTX2/container choice and must be measured without applying lossy compression that changes rendering quality.

## Representative fixtures

Measured source revisions:

- Three Flatland `main`: `c596ac2313e33cace825fe197a6d730269019175`;
- Three Flatland `feat/uikit-fork`: `2935a89fcd9999e8a8b3d3b733f7f7302285cd60`.

Measurements read the checked-in TTF/GLB bytes and their accessor ranges directly. Compression figures use gzip and Brotli quality 11 over the complete file. Derived Slug GPU figures apply the texture formats and power-of-two packing rules in the reviewed fork; modeled atlas figures are identified separately.

| Fixture | Kind | Coverage | Why it is useful |
| --- | --- | ---: | --- |
| Inter Regular | common UI font | 907 baked glyphs | Existing Three Flatland font and Slug artifact; representative Latin/Greek/Cyrillic UI coverage. |
| Font Awesome Solid | icon font | 350 baked PUA glyphs | Existing font-icon path with trivial shaping but substantial outline complexity. |
| Lucide | standalone SVG icons | 1,594 baked shapes | Actual `feat/uikit-fork` SVG-to-Slug artifact and a realistic full-library stress case. |

The first shipping fixture remains one pinned Inter file. Font Awesome and Lucide are payload/tooling fixtures; they do not expand the first vertical slice into automatic icon discovery or a second shaping system.

## Shared glyph and shaping data

The current V0 plan retains source OpenType layout bytes for HarfRust and separately exposes flat logical fields needed by the loader/layout/render path. These measurements show both that conservative baseline and the possible later floor from removing outlines and image/color presentation tables.

| Fixture | Full source font | Flat shared glyph records measured in current Slug GLB | Conservative V0 shared total | Experimental shaping-only face | Potential shared total with shaping-only face |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inter, 907 glyphs | 324,820 B | 36,962 B | 361,782 B (353.3 KiB) | 145,664 B | 182,626 B (178.3 KiB) |
| Font Awesome, 350 glyphs | 426,112 B | 12,708 B | 438,820 B (428.5 KiB) | 23,048 B | 35,756 B (34.9 KiB) |

The flat records counted here are glyph ID, bounds, advance, side bearing, outline flag, cmap, and legacy kerning columns. They are evidence from the old format, not the final `PMNDRS_font` schema.

Transport measurements for the source and experimental shaping face:

| Fixture | Full source gzip | Full source Brotli | Shaping-only gzip | Shaping-only Brotli |
| --- | ---: | ---: | ---: | ---: |
| Inter | 153,302 B | 122,540 B | 58,610 B | 44,006 B |
| Font Awesome | 172,729 B | 147,594 B | 11,234 B | 8,017 B |

The shaping-only faces were produced only as a sizing experiment by retaining glyph IDs and dropping `glyf`, `loca`, `CFF/CFF2`, `SVG`, `COLR/CPAL`, `CBDT/CBLC`, and `sbix`. Sample `hb-shape` outputs matched, but this is not a conformance proof or an accepted on-disk design. V0 deliberately keeps the safer source-font path until fixtures prove an alternative.

Lucide is not a font and has no shaping payload. Its shared records are icon identity, view box, fill/paint, and shape indexes. The existing artifact spends 237,704 B on GLB JSON, largely for named icon metadata; the pmndrs format should measure a compact binary name/index representation rather than inherit that JSON cost by default.

## Measured Slug presentation data

### Existing font artifacts

| Fixture | Slug CPU curve/band/index data | Current GLB GPU textures | Estimated uikit-fork texture layout | Complete current GLB | Brotli q11 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Inter | 368,722 B | 3,145,728 B (3 MiB) | 2,097,152 B (2 MiB) | 3,553,932 B | 268,546 B |
| Font Awesome | 158,130 B | 1,572,864 B (1.5 MiB) | 1,048,576 B (1 MiB) | 1,746,192 B | 167,698 B |

The old font artifacts use an RG32F band texture. The uikit fork changed bands to R32F while retaining RGBA16F curves, halving band-texture storage for the same dimensions. The estimated optimized totals therefore use:

```text
curve texture: width × height × 8 bytes (RGBA16F)
band texture:  width × height × 4 bytes (R32F)
```

The source CPU columns and final GPU textures are shown separately. A direct-GPU `PMNDRS_font_slug` design must decide whether it retains editable/source-like curve and band words, final texture bytes, or both; it must not silently count duplicate representations as unavoidable.

### Existing uikit Lucide SVG bake

The Three Flatland uikit fork already implements:

```text
SVG file or directory
  → @three-flatland/slug SVG parser
  → one shared SlugShapeSet
  → FL_slug_shapes GLB
```

The full checked-in Lucide artifact contains 1,594 named shapes and measures:

| Section | Raw bytes |
| --- | ---: |
| GLB JSON/name/paint/view-box metadata | 237,704 B |
| Binary index/bounds/offset columns | 76,000 B |
| Float32 curve data | 2,780,856 B |
| Uint16 band data | 1,004,324 B |
| Complete GLB | 4,098,912 B (3.91 MiB) |
| Complete GLB, Brotli q11 | 997,999 B |

Using the fork’s actual packing rules—4096-wide, power-of-two height, RGBA16F curves and R32F bands—the same set implies:

| GPU resource | Derived dimensions | GPU bytes |
| --- | --- | ---: |
| Curve texture | 4096 × 32 × RGBA16F | 1,048,576 B |
| Band texture | 4096 × 128 × R32F | 2,097,152 B |
| Total Slug textures | — | 3,145,728 B (3 MiB) |

This proves SVG icon baking, shared shape packing, and realistic library scale already exist as prior art. It also makes subsetting important: shipping a handful of imported icons should not pay the full 1,594-icon library cost.

Relevant prior art:

- [Three Flatland uikit fork at the reviewed revision](https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60)
- [SVG bake pipeline plan](https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/planning/superpowers/plans/svg-bake-pipeline.md)
- [Glyph paging design](https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/planning/perf/glyph-paging-design.md)
- [uikit Lucide package](https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/uikit-lucide)

## Modeled bitmap and MSDF/MTSDF budgets

These are capacity estimates, not measured baker outputs. They make proposed defaults and fixture expectations reviewable before implementation. Exact atlas dimensions, occupancy, edge padding, distance range, and transport compression become benchmark results as soon as the generators exist.

Assumptions:

- one bitmap grayscale strike uses R8;
- color bitmap/emoji pages use RGBA8 and therefore cost four times an equal-sized R8 page;
- MSDF uses RGB8 and MTSDF uses RGBA8;
- distance-field estimates use a representative 32–48 px/em generation range;
- per-glyph plane/atlas/page metadata is budgeted at approximately 20 B per represented glyph;
- atlas dimensions include normal padding but are rounded to plausible power-of-two pages.

| Fixture | Presentation metadata | Bitmap R8, one representative strike | MSDF RGB8 | MTSDF RGBA8 |
| --- | ---: | ---: | ---: | ---: |
| Inter, 907 glyphs | ~18 KiB | ~1 MiB (modeled 1024²) | ~3–6 MiB | ~4–8 MiB |
| Font Awesome, 350 glyphs | ~7 KiB | ~1 MiB (modeled 1024²) | ~3–6 MiB | ~4–8 MiB |
| Lucide, 1,594 SVG icons | ~31 KiB | ~4 MiB (modeled 2048²) | ~12 MiB (modeled 2048²) | ~16 MiB (modeled 2048²) |

The distance-field ranges span a 1024² to 2048×1024 page for the font fixtures. Icon shapes are often near-square and consume more atlas area per entry than proportional text glyphs, so glyph count alone is not a reliable predictor.

Bitmap strikes scale independently. A `[16, 24, 32]` R8 set is not “one 32 px atlas times three”: smaller strikes pack into smaller pages. The baker must report every strike and page separately. RGBA color emoji must likewise be reported separately from grayscale glyph strikes.

Useful exact formulas:

```text
bitmap GPU bytes = Σ(pageWidth × pageHeight × bytesPerPixel)
MSDF GPU bytes   = Σ(pageWidth × pageHeight × 3)
MTSDF GPU bytes  = Σ(pageWidth × pageHeight × 4)
metadata bytes   = glyphRecordStride × representedGlyphCount + page directory
```

Mipmaps add approximately one third to the base texture size when a full chain is resident. Report them explicitly rather than hiding them in an atlas total.

## Planning totals

For an Inter-like common UI font, the current planning envelope is:

| Selected representation | Shared raw baseline | Presentation GPU storage | Notes |
| --- | ---: | ---: | --- |
| Generated bitmap, one strike | ~353 KiB | ~1 MiB R8 | First vertical slice; add each strike independently. |
| MTSDF | ~353 KiB | ~4–8 MiB RGBA8 | Proposed general-purpose default; exact range depends on generation scale. |
| Slug | ~353 KiB | 2 MiB measured-derived | Current source-like Slug columns add ~360 KiB unless final format stores GPU form only. |

For the measured 350-glyph Font Awesome icon font:

| Selected representation | Shared raw baseline | Presentation GPU storage | Notes |
| --- | ---: | ---: | --- |
| Generated bitmap, one strike | ~429 KiB | ~1 MiB R8 | Full source font dominates shared V0; shaping-only experiment falls to ~35 KiB. |
| MTSDF | ~429 KiB | ~4–8 MiB RGBA8 | Strong normal-size icon option, modeled only. |
| Slug | ~429 KiB | 1 MiB measured-derived | Preserves outline fidelity and supports shared vector/icon machinery. |

These columns are intentionally not added into a fake single “download size.” Shared raw bytes, compressed transport, and GPU allocations have different lifetimes and compression behavior.

## Required measurement artifact

The first baker and every later presentation generator must emit a machine-readable section report:

```ts
interface FontPayloadReport {
  source: { bytes: number }
  shared: Record<string, { rawBytes: number }>
  presentations: Array<{
    kind: 'bitmap' | 'msdf' | 'mtsdf' | 'slug'
    metadataBytes: number
    serializedBytes: number
    gpuBytes: number
    pages: Array<{
      width: number
      height: number
      format: string
      mipBytes: number
    }>
  }>
  container: { jsonBytes: number; paddingBytes: number; totalBytes: number }
  transport: { format: string; bytes: number }[]
}
```

The benchmark corpus must eventually produce this report for:

1. the pinned Inter source and agreed subset;
2. Font Awesome as an icon-font fixture;
3. a selected subset and the full 1,594-shape Lucide SVG library;
4. each presentation independently and an intentionally combined asset;
5. Node and Worker bakes, which must agree on canonical section sizes and pixels.

No modeled number becomes a product claim until a checked-in generator, descriptor, source hash, visual reference, and raw report reproduce it.
