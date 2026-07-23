# Renderer capability matrix

Status: proposed product support matrix  
Purpose: show which game-text features each presentation technique can support, how it supports them, and where another presentation is required

This matrix treats MSDF and MTSDF as one technique. It describes the intended `pmndrs/text` feature set, not capabilities already implemented.

Legend:

- **Yes**: natural runtime capability of the technique.
- **Limited**: feasible with a stored range, baked variant, extra records, extra draw, or quality/performance constraint.
- **No**: not represented by that technique; use another presentation.

## Styling and effects

| Feature | Generated bitmap | MSDF/MTSDF | Slug | Product stance |
| --- | --- | --- | --- | --- |
| Runtime solid fill/tint | Yes for mask strikes; multiplication only for RGBA art | Yes | Yes | Required. Color is a run/glyph instance attribute, not baked into monochrome geometry. |
| Per-span or per-glyph color | Yes | Yes | Yes | Required without reshaping. |
| Gradient or texture fill | Yes through a monochrome mask | Yes through reconstructed coverage | Yes through analytic coverage | Supported by renderer paint inputs; source-authored paint is covered separately below. |
| Runtime opacity/fade | Yes | Yes | Yes | Required. |
| Adjustable text outline | Limited: dilation or a baked outline strike; quality and scale are bounded | Yes within the encoded distance range | Limited: render baked stroked contours or a second outline payload/pass | Required API feature. MSDF/MTSDF is the preferred dynamic-outline implementation. |
| Multiple outline bands | Limited: pre-baked or repeated dilation | Limited: multiple thresholds within the distance range | Limited: multiple stroked payloads/passes | Optional advanced style. |
| Hard drop shadow | Yes with a displaced draw | Yes with a displaced draw/sample | Yes with a displaced draw | Required. |
| Soft shadow or glow | Limited: extra samples, pre-bake, or blur pass | Yes within the stored distance/padding range | Limited: offscreen blur or a separate effect pass | Supported, but not promised as one identical shader path. |
| Weight/thickness adjustment without reshaping | Limited and visually fragile | Limited within the distance range | No; use a real font instance or baked stroked/offset geometry | Cosmetic effect only; it must not masquerade as correct variable-font weight. |
| 3D extrusion/bevel geometry | No | No | No | Separate mesh-generation feature, outside the 2D presentation contract. |

## Font-authored color and icon content

| Feature | Generated bitmap | MSDF/MTSDF | Slug | Product stance |
| --- | --- | --- | --- | --- |
| Monochrome OpenType outlines | Yes, rasterized per strike | Yes | Yes | Required source path. |
| Standalone SVG icon set with manifest | Limited: rasterize each icon | Limited: convert supported closed paths to fields | Yes: convert the supported vector/paint subset | Required after the first vertical slice. |
| OpenType `SVG ` glyphs | Limited: rasterized output | Limited: path-only subset or raster fallback | Yes for the validated vector/paint subset | Required after the first vertical slice; never execute arbitrary SVG at render time. |
| COLRv0 layered vectors | Limited: flatten to RGBA strikes | Limited: layered distance masks and draws | Yes: Slug glyph layers plus palette records | Required after the first vertical slice. |
| COLRv1 paint graph | Limited: flatten to RGBA strikes | Limited: flatten or layer only the supported subset | Limited: compile the supported paint subset to flat paint/layer records | Required capability with an explicit supported-operation matrix, not a promise of every paint node initially. |
| Palette selection for vector color glyphs | No after flattening unless variants are baked | Limited with retained layers | Yes with retained palette/paint records | Required for retained vector color presentations. |
| CBDT/CBLC or `sbix` color emoji | Yes as RGBA image strikes | No | No | Required through the bitmap/image presentation selected for that glyph. |
| Mixed vector and raster artwork inside an SVG glyph | Yes after flattening | No as a pure distance field | Limited: vector layers plus referenced baked images | Support only through the declared safe SVG subset. |
| SVG scripting, animation, filters, or external resources | No | No | No | Explicitly unsupported for security, determinism, size, and runtime cost. |

## Scale, quality, and workload fit

| Capability | Generated bitmap | MSDF/MTSDF | Slug | Product stance |
| --- | --- | --- | --- | --- |
| Tiny pixel-aligned text | Yes; best candidate when a suitable hinted strike exists | Limited: field reconstruction cannot replace real hinting | Limited: accurate outline coverage does not provide hinting and costs more | Prefer bitmap strikes. |
| Ordinary scalable game/UI text | Limited to the useful range around available strikes | Yes; proposed default | Yes, with higher and shape-dependent fragment cost | Prefer MSDF/MTSDF by default. |
| Large text and extreme magnification | No without a larger strike | Limited by atlas resolution and encoded range | Yes | Prefer Slug. |
| Heavy minification | Yes with suitable filtering/mips | Yes with suitable filtering/mips and field range | Limited: remains accurate but fragment work is shape/coverage dependent | Prefer bitmap or MSDF/MTSDF. |
| Perspective and changing projected scale | Limited by source resolution | Yes with derivative-aware reconstruction | Yes, subject to measured analytic-renderer cost | Required benchmark lane for MSDF/MTSDF and Slug. |
| Sharp corners | Yes at the baked strike | Yes; core advantage over monochrome SDF | Yes from source curves | Required visual fixture. |
| Intricate outlines and self-intersections | Yes after rasterization | Limited by field generation, atlas resolution, and error correction | Yes for supported font fill rules; performance remains complexity-dependent | Prefer Slug when fidelity dominates. |
| Runtime font-size changes without rebaking | Limited by available strikes | Yes within the useful field scale range | Yes | Presentation policy remains explicit. |
| Predictable low fragment cost | Yes | Yes | Limited: depends on covered pixels and relevant curve/band work | Record GPU time by font complexity and scale. |
| Smallest texture payload | Limited: every strike consumes pixels | Limited: one atlas spans a useful scale range | Limited: curves/bands are often compact but complexity-dependent | Measure per corpus; no universal size claim. |

## Renderer-independent features

These capabilities belong to shaping or paragraph layout and must work identically regardless of presentation:

| Shared feature | Bitmap | MSDF/MTSDF | Slug |
| --- | --- | --- | --- |
| HarfRust shaping, ligatures, kerning, marks, and contextual substitution | Same shaped result | Same shaped result | Same shaped result |
| UTF-16 clusters, caret/source mapping, and unsafe-break flags | Same layout data | Same layout data | Same layout data |
| LTR/RTL runs, bidi ordering, wrapping, alignment, clipping, and ellipsis | Same paragraph result | Same paragraph result | Same paragraph result |
| Font fallback and mixed-font spans | Same font-scoped glyph identities | Same font-scoped glyph identities | Same font-scoped glyph identities |

Switching presentation must never reshape text or change line breaks.

## Recommended game-facing baseline

The common game-text style contract should expose:

- solid or per-glyph fill color;
- opacity;
- outline color and width;
- hard shadow color and offset;
- optional soft shadow/glow parameters;
- optional gradient or texture paint;
- source palette selection for retained color glyphs.

Backends report capabilities and limits. The API must not silently claim an effect is equivalent across techniques: MSDF/MTSDF outlines are distance thresholds, bitmap outlines are raster operations, and Slug outlines require stroked geometry or another pass.

Recommended defaults:

- **MSDF/MTSDF** for ordinary scalable game text and inexpensive runtime outlines/effects;
- **bitmap strikes** for tiny or deliberately pixel-authored text and embedded color emoji;
- **Slug** for large/high-fidelity text, COLR/SVG vector layers, and SVG icon fonts.

A paragraph may contain glyphs using different presentations while preserving one shaped/layout result—for example Slug text plus an RGBA bitmap emoji.

## Source basis

- [msdfgen](https://github.com/Chlumsky/msdfgen): distance-field representation, linear sampling, encoded range, derivative-aware perspective reconstruction, and SVG/font outline inputs.
- [MSDF author preview shader](https://gist.github.com/Chlumsky/263c960ae0a7df59afc2da4051eb0553): demonstrated thickness, border, gradient, and shadow operations over an MSDF.
- [OpenType color glyph overview](https://learn.microsoft.com/en-us/typography/opentype/spec/overview), [COLR](https://learn.microsoft.com/en-us/typography/opentype/spec/colr), [SVG](https://learn.microsoft.com/en-us/typography/opentype/spec/svg), [CBDT](https://learn.microsoft.com/en-us/typography/opentype/spec/cbdt), and [`sbix`](https://learn.microsoft.com/en-us/typography/opentype/otspec180/sbix): source-authored vector and bitmap color formats.
- [`RESEARCH.md`](../../RESEARCH.md): maintained summaries of Slug, the Alvin renderer comparison, msdfgen, and the source-format research.
- [`SLUG_AUDIT.md`](SLUG_AUDIT.md): current Slug pipeline, quality constraints, and performance findings inherited from Three Flatland.
