---
type: Reference
title: Renderer capability matrix
description: Compares planned game-text features and limitations across bitmap, MSDF, and Slug rasters.
status: proposed-product-matrix
tags: [rendering, bitmap, msdf, mtsdf, slug, games]
---

# Renderer capability matrix

This is the intended `pmndrs/text` feature set, not a claim about implemented behavior. The public MSDF raster uses one MTSDF RGBA atlas; MTSDF is its encoding, not another selectable engine.

| Symbol | Meaning |
| :---: | --- |
| ✅ | Natural, fully intended capability |
| ⚠️ | Supported with a bounded range, extra pass/data, or documented constraint |
| ❌ | Not represented by this technique; choose another raster |

## Styling and effects

| Feature | Bitmap | MSDF | Slug |
| --- | :---: | :---: | :---: |
| Runtime solid fill/tint | ✅ | ✅ | ✅ |
| Per-span or per-glyph color | ✅ | ✅ | ✅ |
| Gradient or texture fill | ✅ | ✅ | ✅ |
| Runtime opacity/fade | ✅ | ✅ | ✅ |
| Adjustable outline | ⚠️ | ✅ | ⚠️ |
| Multiple outline bands | ⚠️ | ⚠️ | ⚠️ |
| Hard drop shadow | ✅ | ✅ | ✅ |
| Soft shadow or glow | ⚠️ | ✅ | ⚠️ |
| Cosmetic weight adjustment | ⚠️ | ⚠️ | ❌ |
| 3D extrusion/bevel | ❌ | ❌ | ❌ |

Notes:

1. Bitmap outlines require dilation or another strike; Slug requires stroked contours or another payload/pass. MSDF outlines use the MTSDF alpha channel and are bounded by the encoded distance range.
2. Soft effects may require extra samples, padding, or an offscreen blur. The API must report limits rather than imply identical output.
3. Cosmetic thickness is not a substitute for shaping a real font weight.
4. Extruded geometry is a separate mesh-generation feature, outside this 2D raster contract.

## Font-authored color and icons

| Feature | Bitmap | MSDF | Slug |
| --- | :---: | :---: | :---: |
| Monochrome OpenType outlines | ✅ | ✅ | ✅ |
| Standalone SVG icon manifest | ✅ | ⚠️ | ✅ |
| OpenType `SVG ` glyphs | ✅ | ⚠️ | ⚠️ |
| COLRv0 layered vectors | ✅ | ⚠️ | ✅ |
| COLRv1 paint graph | ✅ | ⚠️ | ⚠️ |
| Runtime palette selection | ❌ | ⚠️ | ✅ |
| CBDT/CBLC or `sbix` emoji | ✅ | ❌ | ❌ |
| Mixed vector/raster SVG artwork | ✅ | ❌ | ⚠️ |
| SVG scripts, animation, filters, external resources | ❌ | ❌ | ❌ |

Notes:

1. Bitmap can flatten supported source artwork to RGBA strikes, but loses vector palette behavior.
2. The MSDF raster accepts supported closed paths or layered masks; arbitrary SVG paint and embedded images are not distance fields.
3. Slug compiles a safe vector/paint subset into flat geometry, layer, palette, and image-reference records. It never executes source SVG at runtime.
4. Color bitmap emoji uses the bitmap/image raster for that glyph while preserving the paragraph's shaped glyph identity.

## Scale and workload fit

| Capability | Bitmap | MSDF | Slug |
| --- | :---: | :---: | :---: |
| Tiny pixel-aligned text | ✅ | ⚠️ | ⚠️ |
| Ordinary scalable UI/game text | ⚠️ | ✅ | ✅ |
| Large text and extreme zoom | ❌ | ⚠️ | ✅ |
| Heavy minification | ✅ | ✅ | ⚠️ |
| Perspective/changing projected scale | ⚠️ | ✅ | ✅ |
| Sharp corners | ✅ | ✅ | ✅ |
| Intricate/self-intersecting outlines | ✅ | ⚠️ | ✅ |
| Size changes without rebaking | ⚠️ | ✅ | ✅ |
| Predictable low fragment cost | ✅ | ✅ | ⚠️ |
| Universally smallest payload | ❌ | ❌ | ❌ |

Notes:

1. Bitmap quality is tied to available strikes; it is preferred for tiny hinted or deliberately pixel-authored text.
2. MSDF with MTSDF encoding is the proposed general-purpose default, subject to accepted scale, transform, atlas, and effects benchmarks.
3. Slug is preferred when large-size or zoomed outline fidelity dominates. Its cost remains shape- and coverage-dependent.
4. Payload size depends on glyph coverage, strikes, atlas resolution, outline complexity, mipmaps, and compression. It must be measured per corpus.

## Raster-independent behavior

All rasters consume the same result for:

- HarfRust shaping, ligatures, kerning, marks, and contextual substitution;
- UTF-16 clusters, caret/source mapping, and unsafe-break flags;
- bidi ordering, wrapping, alignment, clipping, and ellipsis;
- font-scoped glyph identity and, after its roadmap milestone, mixed-font fallback.

Switching raster must never reshape text or change line breaks. One paragraph may use different rasters per glyph—for example Slug text with RGBA bitmap emoji—without changing shaping or paragraph layout.

## Recommendation

- Use **MSDF** for ordinary scalable game and UI text and inexpensive runtime outlines/effects. Its V1 atlas encoding is MTSDF.
- Use **bitmap strikes** for tiny or intentionally pixel-authored text and embedded color emoji.
- Use **Slug** for large or deeply zoomed text, high-fidelity vector layers, and SVG icon fonts.
- Keep the choice explicit. `pmndrs/text` may expose recommendations and capabilities, but it does not silently switch engines.

## Sources

- [msdfgen](https://github.com/Chlumsky/msdfgen) and the [author's preview shader](https://gist.github.com/Chlumsky/263c960ae0a7df59afc2da4051eb0553)
- OpenType [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr), [SVG](https://learn.microsoft.com/en-us/typography/opentype/spec/svg), [CBDT](https://learn.microsoft.com/en-us/typography/opentype/spec/cbdt), and [`sbix`](https://learn.microsoft.com/en-us/typography/opentype/otspec180/sbix)
- [Research bibliography](../../RESEARCH.md)
- [Three Flatland Slug audit](slug-audit.md)
