---
type: Reference
title: Renderer capability matrix
description: Compares evidence-backed merged v0 raster roles and explicitly planned target v1 or later capabilities across bitmap, MSDF, and Slug.
tags: [rendering, bitmap, msdf, mtsdf, slug, games]
sources:
  - id: 'citation-1-1'
    resource: 'https://github.com/Chlumsky/msdfgen'
    title: 'msdfgen'
  - id: 'citation-1-2'
    resource: 'https://gist.github.com/Chlumsky/263c960ae0a7df59afc2da4051eb0553'
    title: "author's preview shader"
  - id: 'citation-2-1'
    resource: 'https://learn.microsoft.com/en-us/typography/opentype/spec/colr'
    title: 'COLR'
  - id: 'citation-2-2'
    resource: 'https://learn.microsoft.com/en-us/typography/opentype/spec/svg'
    title: 'SVG'
  - id: 'citation-2-3'
    resource: 'https://learn.microsoft.com/en-us/typography/opentype/spec/cbdt'
    title: 'CBDT'
  - id: 'citation-2-4'
    resource: 'https://learn.microsoft.com/en-us/typography/opentype/otspec180/sbix'
    title: '`sbix`'
  - id: 'citation-3'
    resource: '../../../RESEARCH.md'
    title: 'Research bibliography'
  - id: 'citation-4'
    resource: 'slug-audit.md'
    title: 'Three Flatland Slug audit'
  - id: 'slug-outline-research'
    resource: 'slug-outline-research.md'
    title: 'Slug outline architecture'
  - id: 'benchmark-evidence'
    resource: '../packages/benchmarks.md'
    title: 'Benchmark and presentation evidence'
  - id: 'text-package-evidence'
    resource: '../packages/glyph.md'
    title: 'Text and raster package evidence'

generated:
  by: 'openai-codex/gpt-5.6'
  at: '2026-08-15T15:53:27Z'
---

# Renderer capability matrix

This matrix separates the evidence-backed merged v0 raster roles from explicitly planned target v1 or later capabilities. The public MSDF
raster uses one MTSDF RGBA atlas; MTSDF is its encoding, not another selectable engine. The recommendation and current
scale/effect boundaries below are implementation evidence, not release claims. Rows describing later color, paging, mixed-raster, or expanded-effect
work remain intended capabilities rather than claims about the merged v0 implementation.

| Symbol | Meaning                                                                   |
| :----: | ------------------------------------------------------------------------- |
|   ✅   | Natural, fully intended capability                                        |
|   ⚠️   | Supported with a bounded range, extra pass/data, or documented constraint |
|   🟡   | Planned additive capability; not implemented in merged v0                 |
|   ❌   | Not represented by this technique; choose another raster                  |

## Styling and effects

| Feature                     | Bitmap | MSDF | Slug |
| --------------------------- | :----: | :--: | :--: |
| Runtime solid fill/tint     |   ✅   |  ✅  |  ✅  |
| Per-span or per-glyph color |   ✅   |  ✅  |  ✅  |
| Gradient or texture fill    |   🟡   |  🟡  |  🟡  |
| Runtime opacity/fade        |   ✅   |  ✅  |  ✅  |
| Adjustable outline          |   🟡   |  ✅  |  🟡  |
| Multiple outline bands      |   🟡   |  🟡  |  🟡  |
| Hard drop shadow            |   🟡   |  ✅  |  🟡  |
| Soft shadow or glow         |   🟡   |  🟡  |  🟡  |
| Cosmetic weight adjustment  |   🟡   |  🟡  |  🟡  |
| 3D extrusion/bevel          |   ❌   |  ❌  |  ❌  |

Notes:

1. Bitmap and Slug V0 accept fill and opacity and reject outline or shadow instead of degrading silently. A future Bitmap
   outline requires a separate dilated strike; the bounded Slug shared-traversal approximation remains research.[^slug-outline-research]
   MSDF outlines use the MTSDF alpha channel and are bounded by the encoded distance range.
2. Planned soft effects require extra samples, padding, or an offscreen blur. Any admitted API must report limits rather
   than imply identical output.
3. Cosmetic thickness is not a substitute for shaping a real font weight.
4. Extruded geometry is a separate mesh-generation feature, outside this 2D raster contract.

## Font-authored color and icons

| Feature                                             | Bitmap | MSDF | Slug |
| --------------------------------------------------- | :----: | :--: | :--: |
| Monochrome OpenType outlines                        |   ✅   |  ✅  |  ✅  |
| Standalone SVG icon manifest                        |   🟡   |  🟡  |  🟡  |
| OpenType `SVG ` glyphs                              |   🟡   |  🟡  |  🟡  |
| COLRv0 layered vectors                              |   🟡   |  🟡  |  🟡  |
| COLRv1 paint graph                                  |   🟡   |  🟡  |  🟡  |
| Runtime palette selection                           |   🟡   |  🟡  |  🟡  |
| CBDT/CBLC or `sbix` emoji                           |   🟡   |  ❌  |  ❌  |
| Mixed vector/raster SVG artwork                     |   🟡   |  ❌  |  🟡  |
| SVG scripts, animation, filters, external resources |   ❌   |  ❌  |  ❌  |

Notes:

1. Merged v0 bakes monochrome OpenType outlines only. The color and standalone-SVG rows are additive plans, not accepted input
   paths in the current baker or renderer.
2. A future Bitmap color path can flatten supported source artwork to RGBA strikes, but loses vector palette behavior.
3. Arbitrary SVG paint and embedded images are not distance fields. Any future MSDF admission must define a supported
   closed-path or layered-mask subset.
4. A future Slug color path may compile a safe vector/paint subset into package-owned records; it will never execute source
   SVG scripts or external resources at runtime.

## Scale and workload fit

| Capability                           | Bitmap | MSDF | Slug |
| ------------------------------------ | :----: | :--: | :--: |
| Tiny pixel-aligned text              |   ✅   |  ⚠️  |  ⚠️  |
| Ordinary scalable UI/game text       |   ⚠️   |  ✅  |  ✅  |
| Large text and extreme zoom          |   ❌   |  ⚠️  |  ✅  |
| Heavy minification                   |   ✅   |  ✅  |  ⚠️  |
| Perspective/changing projected scale |   ⚠️   |  ✅  |  ✅  |
| Sharp corners                        |   ✅   |  ✅  |  ✅  |
| Intricate/self-intersecting outlines |   ✅   |  ⚠️  |  ✅  |
| Size changes without rebaking        |   ⚠️   |  ✅  |  ✅  |
| Predictable low fragment cost        |   ✅   |  ✅  |  ⚠️  |
| Universally smallest payload         |   ❌   |  ❌  |  ❌  |

Notes:

1. Bitmap quality is tied to available strikes; it is preferred for tiny hinted or deliberately pixel-authored text.
2. MSDF with MTSDF encoding is the general-purpose default established by the accepted scale, transform, atlas, and effects benchmarks.
3. Slug is preferred when large-size or zoomed fill fidelity dominates. Its cost remains shape- and coverage-dependent.
4. Payload size depends on glyph coverage, strikes, atlas resolution, layer padding, outline complexity, and compression. It must be measured per corpus.

## Raster-independent behavior

All rasters consume the same result for:

- HarfRust shaping, ligatures, kerning, marks, and contextual substitution;
- UTF-16 clusters, caret/source mapping, and unsafe-break flags;
- bidi ordering, wrapping, alignment, clipping, and ellipsis;
- font-scoped glyph identity and, after its roadmap milestone, mixed-font fallback.

Switching raster must never reshape text or change line breaks. Merged v0 selects one raster per font slot. The additive color-emoji/SVG lane may later assign a raster per glyph by combining each artifact's `page = 0xffff` availability sentinel with an explicit raster-priority policy and passing the resulting glyph mask through the required `stageBatch` transaction; that mechanism is not part of the merged v0 contract.

## Recommendation

- Use **MSDF** for ordinary scalable game and UI text and inexpensive runtime outlines/effects. Its merged v0 MTSDF encoding
  passed the shared workload, DPR, transform, effects, source-outline error, atlas, and dual-backend gates recorded in the
  [benchmark evidence](../packages/benchmarks.md).
- Use **bitmap strikes** for tiny, known-density, or intentionally pixel-authored text. The exact DPR-1/DPR-2 strike and
  CPU/GPU frame oracles establish this role; bitmap does not silently approximate unsupported outline or shadow effects.
- Use **Slug** for large or deeply zoomed fill text and intricate monochrome outlines. The 36-cell dual-backend/DPR
  raster-role matrix covers large size, 1,024-ppem magnification, complex scripts, clipping, affine transforms, and
  projection zoom against source outlines. Slug V0 deliberately rejects outline, shadow, and color-layer paint.
- Keep the choice explicit. `pmndrs/glyph` may expose recommendations and capabilities, but it does not silently switch engines.

[^slug-outline-research]: The rejected exact-distance design, retained measurements, and replacement gate are recorded separately from the capability table.
