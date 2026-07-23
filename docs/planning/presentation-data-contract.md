---
type: Data Contract
title: Presentation data contract V0
description: Defines packaging-neutral bitmap, MSDF/MTSDF, and Slug presentation records and GPU resources.
status: contract-candidate
tags: [data, bitmap, mtsdf, slug, gpu]
---

# Presentation data contract V0

Status: contract candidate
Scope: independently loadable bitmap, MSDF/MTSDF, and Slug presentations sharing one font-local glyph space

## Logical resources, not a mandatory file split

The format defines one core font resource and zero or more presentation resources. Packaging is deliberately orthogonal:

```text
combined
  one GLB
    PMNDRS_font
    PMNDRS_font_bitmap
    PMNDRS_font_distance_field
    PMNDRS_font_slug

split by use
  font.glb                 PMNDRS_font
  font.bitmap.glb          PMNDRS_font_bitmap
  font.mtsdf.glb           PMNDRS_font_distance_field
  font.slug.glb            PMNDRS_font_slug

application-linked
  load font.glb
  load any presentation bytes from an application resolver
  attach only after identity validation
```

Bundling or splitting MUST NOT change the binary records. A presentation is attached to a registered font by the SHA-256 of the canonical shaping payload plus the declared glyph count and ID width. A resource with a mismatched identity is rejected before GPU upload.

The core `PMNDRS_font.presentations` directory describes availability. Each entry contains:

```ts
interface PresentationReferenceV0 {
  id: string
  kind: 'bitmap' | 'distance-field' | 'slug'
  extension: 'PMNDRS_font_bitmap' | 'PMNDRS_font_distance_field' | 'PMNDRS_font_slug'
  version: 0
  source:
    | { type: 'embedded' }
    | { type: 'external'; uri?: string; artifactHash?: string }
}
```

`id` is unique within the font. An external `uri` is a normal glTF URI resolved relative to the core GLB. If `uri` is absent, the application must provide the presentation through its resolver API. `artifactHash`, when present, is lowercase SHA-256 of the complete external artifact. glTF `extensionsRequired`, not a duplicated presentation flag, determines whether unsupported embedded extensions invalidate a combined asset.

Every presentation extension root contains the reciprocal binding:

```ts
interface PresentationBindingV0 {
  version: 0
  presentationId: string
  shapingHash: string
  glyphCount: number
  glyphIdWidth: 16
}
```

## Shared conventions

- Glyph records are dense and indexed by font-local glyph ID.
- `page = 0xffff` means that glyph has no representation in that presentation; all other fields are ignored and SHOULD be zero.
- Plane bounds use baseline-relative em coordinates: X increases right, Y increases up.
- A required `planeUnitsPerEm` integer declares fixed-point precision. Decode with `em = stored_i16 / planeUnitsPerEm`.
- Atlas coordinates are unsigned pixel-edge coordinates with upper-left origin, X right, Y down, and right/bottom exclusive.
- Texture data is linear. No grayscale, distance-field, or Slug data is sampled as sRGB.
- Shared advances, kerning, clusters, and line metrics never occur in a presentation.
- Record buffer views are two-byte aligned, tightly packed, and have exactly `glyphCount × recordStride` bytes.
- Extension-owned record and texture buffer views MUST omit core glTF `byteStride` and `target`; their layout is defined only by the companion extension.
- Texture resources declare dimensions, mip count, exact GPU format, encoding, and KTX2 buffer-view source.

## Texture resource

Bitmap and distance-field pages, and losslessly wrapped Slug textures, use the same descriptor:

```ts
interface TextureResourceV0 {
  width: number
  height: number
  mipLevelCount: number
  colorSpace: 'linear' | 'srgb'
  variants: readonly TextureVariantV0[]
}

interface TextureVariantV0 {
  bufferView: number
  container: 'ktx2'
  gpuFormat:
    | 'r8unorm'
    | 'rgba8unorm'
    | 'rgba16float'
    | 'r16uint'
    | 'r32uint'
    | 'bc4-r-unorm'
    | 'bc7-rgba-unorm'
    | 'eac-r11unorm'
    | 'etc2-rgba8unorm'
    | 'astc-4x4-unorm'
  requiredFeature?: 'texture-compression-bc' | 'texture-compression-etc2' | 'texture-compression-astc'
  quality: 'lossless' | 'quality-gated'
}
```

KTX2 bytes occupy the complete referenced glTF `bufferView`; the presentation GLB is the independently addressable unit. A variant whose KTX2 `vkFormat` names a native GPU format can be uploaded directly only when the device supports it. A Basis payload requires a dynamically imported transcoder and is not described as direct upload. The runtime selects the first supported variant in listed order.

Every V0 presentation MUST provide a lossless baseline variant. GPU-native block-compressed variants are additive. They cannot be the sole variant until the supported platform matrix guarantees them.

For a combined GLB, `extensionsUsed` lists the core and every embedded companion; `extensionsRequired` lists only those whose absence makes that GLB unusable. For a split presentation GLB, that document lists its companion extension in both arrays. Merely naming an external companion in the core directory does not mean the companion extension object is used by the core GLB.

## `PMNDRS_font_bitmap` V0

V0 bitmap presentation contains one or more generated strikes. Each strike owns dense glyph records and one or more atlas pages.

```ts
interface BitmapStrikeV0 {
  ppemX: number
  ppemY: number
  planeUnitsPerEm: number
  recordBufferView: number
  recordStride: 20
  pages: readonly TextureResourceV0[]
}
```

### Bitmap glyph record — 20 bytes

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `i16` | plane left |
| 2 | `i16` | plane bottom |
| 4 | `i16` | plane right |
| 6 | `i16` | plane top |
| 8 | `u16` | atlas left |
| 10 | `u16` | atlas top |
| 12 | `u16` | atlas right |
| 14 | `u16` | atlas bottom |
| 16 | `u16` | page index or `0xffff` |
| 18 | `u16` | flags; zero in V0 |

Grayscale strikes use a lossless `r8unorm` KTX2 variant. Optional BC4/EAC/native ASTC variants may reduce GPU residency; the lossless R8 variant remains the correctness baseline. Embedded color emoji uses a separate bitmap presentation or strike with `rgba8unorm`, `colorSpace: 'srgb'`, and its own dense records; it is not mixed into a grayscale page.

Exact costs:

```text
records = 20 × glyphCount
R8 base level = Σ(width × height)
RGBA8 base level = Σ(width × height × 4)
full mip chain ≈ base × 4/3
```

For the non-subsetted V0 fixtures, records are 57,420 bytes for 2,871-glyph Inter and 28,060 bytes for 1,403-glyph Font Awesome. A 1024² R8 page is 1,048,576 GPU bytes before mips; actual full-face page counts remain generator outputs.

## `PMNDRS_font_distance_field` V0

MSDF and MTSDF share one extension and record layout. Both use RGBA8 pages so WebGPU never needs an unavailable RGB8 texture format. MSDF stores RGB median-distance channels and writes alpha `255`; MTSDF stores RGB multi-channel distance plus true signed distance in alpha.

```ts
interface DistanceFieldPresentationV0 {
  technique: 'msdf' | 'mtsdf'
  emSize: number
  pixelRange: number
  planeUnitsPerEm: number
  recordBufferView: number
  recordStride: 20
  pages: readonly TextureResourceV0[]
}
```

Distance-field glyph records are the same 20-byte plane/atlas/page/flags layout as bitmap records. V0 flags are zero. `pixelRange` is the full encoded signed-distance range in atlas pixels and is authoritative for shader reconstruction and effect limits.

The required baseline is lossless linear `rgba8unorm` KTX2. UASTC/native BC7, ETC2 RGBA, and ASTC variants are allowed only as `quality-gated` variants because channel error moves reconstructed edges. Their post-GPU-decode images must pass the visual/error corpus; they do not replace the lossless baseline by declaration alone.

Exact costs:

```text
records = 20 × glyphCount
RGBA8 base level = Σ(width × height × 4)
full mip chain ≈ base × 4/3
```

The older 4–8 MiB capacity estimates covered the 907/350-glyph presentation subsets, not the non-subsetted V0 faces. V0 records are exactly 57,420 B for Inter and 28,060 B for Font Awesome; full-face texture bytes are intentionally reported by the generator rather than extrapolated from an invalid coverage count.

## `PMNDRS_font_slug` V0

Slug is a separate presentation GLB when loaded independently. It stores final GPU data only; source-like float32 curves, nested bands, and duplicate CPU/GPU representations are forbidden.

The quality-preserving V0 layout incorporates the existing uikit fork improvements and the exact structural packing already identified in the compression research:

- normalized quadratic curves in RGBA16F;
- endpoint sharing within each contour;
- no curve's first/control texel may be the final texel of a row;
- 16 horizontal and 16 vertical bands by default, declared per glyph;
- identical curve-reference lists deduplicated across all bands of a glyph;
- exact `u32` band headers;
- exact glyph-local `u16` curve-texel offsets;
- paging that never splits a glyph.

### Slug glyph record — 40 bytes

| Offset | Type | Field |
| ---: | --- | --- |
| 0 | `i16` | plane left |
| 2 | `i16` | plane bottom |
| 4 | `i16` | plane right |
| 6 | `i16` | plane top |
| 8 | `u16` | page index or `0xffff` |
| 10 | `u16` | horizontal band count |
| 12 | `u16` | vertical band count |
| 14 | `u16` | flags; zero in V0 |
| 16 | `u32` | glyph curve-base texel |
| 20 | `u32` | glyph curve-span texels, including contour endpoints and row padding |
| 24 | `u32` | horizontal header base |
| 28 | `u32` | vertical header base |
| 32 | `u32` | curve-reference base |
| 36 | `u32` | curve-reference count |

### Curve texture

Each page has one RGBA16F curve texture. For a quadratic `(p0, p1, p2)`, the curve's texel contains `[p0.x, p0.y, p1.x, p1.y]`; the immediately following texel begins `[p2.x, p2.y, ...]`. Adjacent curves in a contour share the endpoint texel. The final endpoint texel stores zero in unused channels. Coordinates are em-space half floats.

The required curve variant is lossless `rgba16float`. KTX2 Zstandard supercompression is allowed because it reconstructs identical half-float bits before upload. Lossy UASTC/BC7/ASTC curve variants remain outside V0 until visual and geometric gates accept them.

### Band headers and references

Each header is one `u32`:

```text
header = (curveCount << 16) | glyphRelativeReferenceOffset
```

Both fields are `u16`. Header arrays contain all horizontal headers followed by all vertical headers for each glyph. A header's reference offset is relative to that glyph's `curveReferenceBase`.

Each reference is a `u16` texel offset relative to the glyph's `curveBaseTexel`:

```text
absoluteCurveTexel = glyph.curveBaseTexel + localCurveTexelOffset
```

The offset addresses the first/control texel for the referenced quadratic. This remains correct across endpoint sharing, contour endpoints, and row padding. A glyph whose curve span, band count, per-band curve count, reference offset, or local curve offset exceeds `u16` is rejected; values are never truncated.

Pages expose the curve payload as RGBA16F, headers as R32UI, and references as R16UI. A renderer may materialize the latter two as integer textures or storage buffers, but their serialized bytes and indexing remain identical.

### Slug page descriptor

```ts
interface SlugPageV0 {
  curveWidth: number
  curveHeight: number
  curve: TextureResourceV0
  headerCount: number
  headerBufferView: number
  referenceCount: number
  referenceBufferView: number
}
```

Header buffer length is exactly `headerCount × 4`; reference buffer length is exactly `referenceCount × 2`. Both are four-byte aligned in the GLB. Curve texture sampling is nearest and has one mip level.

Exact costs:

```text
glyph records = 40 × glyphCount
curves = Σ(curveWidth × curveHeight × 8)
headers = headerCount × 4
references = referenceCount × 2
```

Measured/modelled evidence:

| Fixture | Current optimized-fork GPU layout | Exact header/reference layout | V0 quality-preserving target |
| --- | ---: | ---: | ---: |
| Lucide, 1,594 shapes | 1,048,576 B curves + 2,097,152 B R32F bands | 204,032 B headers + 883,992 B refs | 2,200,360 B including 63,760 B records |
| Inter legacy subset, 907 glyphs | 2,097,152 B combined derived textures | generator report required | exact formula above |
| Font Awesome legacy subset, 350 glyphs | 1,048,576 B combined derived textures | generator report required | exact formula above |

The Lucide V0 target is about 2.04 MiB and is quality-preserving. It does not count the speculative lossy curve-compression experiment.

## Loader and API behavior

The caller explicitly selects a presentation ID or kind. The loader:

1. loads and registers the core font GLB;
2. locates an embedded presentation or resolves/fetches an external artifact;
3. dynamically imports only that presentation's decoder/renderer module;
4. verifies `shapingHash`, glyph count, ID width, extension version, ranges, and texture capabilities;
5. selects a supported texture variant;
6. creates GPU resources in bulk without per-glyph object reconstruction;
7. attaches the resource to `(FontHandle, presentationId)`.

Switching or attaching a presentation does not reshape text and cannot change paragraph measurement. Multiple presentation artifacts may be attached concurrently.

## Validation fixtures

Every presentation format requires golden-byte, range, and GPU-readback fixtures covering:

- bundled and external packaging producing identical records;
- application-resolved external bytes with no URI;
- wrong shaping hash, glyph count, ID width, and presentation ID;
- missing pages and the `0xffff` sentinel;
- out-of-range atlas rectangles and page indexes;
- unsupported compressed variants with successful lossless fallback;
- Slug header/reference overflow, page-boundary, row-padding, and exact address reconstruction;
- Node/Worker bake parity for records and decoded texture pixels.
