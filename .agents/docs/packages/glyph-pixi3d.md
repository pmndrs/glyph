---
type: Workspace Package
title: '@pmndrs/glyph-pixi3d'
description: Glyph's renderer for the official PixiJS 3D release, drawing Bitmap, MSDF and Slug text on WebGPU and WebGL2.
resource: ../../../packages/glyph-pixi3d
workspace_package: '@pmndrs/glyph-pixi3d'
documentation_type: reference
tags: [package, renderer, pixi3d, typegpu, webgpu, webgl]
sources:
  - id: manifest
    resource: ../../../packages/glyph-pixi3d/package.json
    title: Package manifest
  - id: config
    resource: ../../../packages/glyph-pixi3d/src/config.ts
    title: GlyphConfig integration and root shape hooks
  - id: renderer
    resource: ../../../packages/glyph-pixi3d/src/renderer.ts
    title: Retained command-buffer renderer
  - id: mesh
    resource: ../../../packages/glyph-pixi3d/src/mesh.ts
    title: Per-technique mesh realization
  - id: resource
    resource: ../../../packages/glyph-pixi3d/src/resource.ts
    title: Bitmap pages, MSDF baked pages and Slug band residency
  - id: generation
    resource: ../../../packages/glyph-pixi3d/scripts/generate-shaders.mjs
    title: Build-time TypeGPU shader generation
  - id: parity
    resource: ../../../benches/scripts/verify-pixi3d-parity.mts
    title: Real-device pixel parity with Three
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-21T22:00:00Z'
---

# Package reference: `@pmndrs/glyph-pixi3d`

This package adapts Glyph's public `GlyphConfig` and portable raster contracts to the official `@pixi/3d` release
(0.1.0 on npm, MIT, peer `pixi.js` ^8.23.0). It started as `@pmndrs/glyph-pixi3d-beta` against a private beta tarball;
it now depends on the public release and needs no patch to either PixiJS package. `@pixi/3d` and `pixi.js` are peer
dependencies, pinned for development through the `pixi3d` catalog.

## Realization

Each text is a `Container3D`. The Codec uses ordered direct draws. A publication decodes the retained lanes on the CPU
and realizes each draw span as `Mesh3D` children: multi-record spans get expanded per-vertex attributes; a one-record
span stores its lanes in PixiJS 3D's native material row on one canonical quad, so independent characters share a
native instanced draw. The release sizes material rows to their fields, so the beta's full-row fallback is gone.
Native transforms, visibility and sorting stay authoritative; positions are not baked into vertices per frame.

- **Bitmap** uploads each `r8unorm` page widened to RGBA (a mixed-format WebGL batch otherwise drops the red channel).
- **MSDF** exchanges the atlas `pages` token for the baked pages with `msdfBakedPages` and uploads every page; each
  instance's cell, UV bounds and layer come from the font's `glyphs` table on the CPU, and the `effect` lane supplies
  shadow offset and outline width. Fill, outline and shadow are composed by Glyph's `msdfRender`.
- **Slug** uploads the band headers whole and keeps band curves resident per glyph through core's
  `SlugBandResidency`, admitted before any row is read. Its texture is allocated once at the page's largest grid,
  so growth never rebinds a material. Integer words ride in nearest-sampled `rgba8unorm` texels because material
  textures are float-sampled.
- **Decorations** use core's `createDecorationCodecProgram` and a shared unlit material in linear colour space, so
  their paint is encoded for display like the default text material's.

Shader math is Glyph's TypeGPU library resolved at build time to WGSL and GLSL (`src/generated/shaders.ts`); the
runtime imports no TypeGPU. GLSL ES 3.0 rejects derivatives anywhere in a vertex shader and PixiJS 3D's `gl.header`
reaches both stages, so MSDF and Slug put their derivative-taking helpers in `gl.fragment.header`. Slug dilation recovers the physical viewport from `camera.uLightTileTransform`, which
0.1.0 still derives from a fixed 16×9 light grid.

Root hooks follow the integration branch: `prepared()` resolves anchors after core prepared every dirty paragraph;
`accepted` and `unchanged` accept placement and sync transforms; a rejected publication keeps the accepted meshes,
reports once through `text.error`/`onError`, and is not retried until an edit.

## Queries, copies and materials

Text provides desired measurements, ink, glyph columns, carets, selections and native bounds; `split()` returns
independently disposable glyph and decoration snapshots. `Pixi3DTextMaterial` appends bits, updates material data
without reshaping, and may supply a factory for another `BaseMaterial3D`.

## Known differences from the Three renderer

MSDF keeps the whole baked atlas resident and draws untrimmed cells; Bitmap quads are not snapped to the pixel grid;
draw order between overlapping texts is PixiJS 3D's sort, so there is no ordered `TextGroup` and CSS under/over
decoration order is not enforced where a decoration crosses ink.

## Evidence

`mise exec -- pnpm --filter @pmndrs/glyph-pixi3d check` runs the node suite (realization, native records, materials,
anchors, split, rejection, generated shaders). `benchmark:pixi3d-parity` renders 27 scenes (sizes 6–64 px, MSDF
effects, paragraphs, 200 labels, Devanagari, glyphs arriving over six frames, growth from 40 to 400 labels, an edit,
a width change, a perspective page) through this renderer on WebGPU and WebGL2 and through Three on WebGPU, and
compares pixels at 8/255. It draws text with an unlit `FlatMaterial` in display space so stored values are the
linear blend Three stores. Budgets name the intended differences: Three's MSDF quad trimming, and pixel-centre quad
edges that the y-flipped WebGL path assigns to the other row (Bitmap up to 2% of lit pixels, Slug 0.05%). The
[log entry](../log/2026-11-21-pixi3d-official-release.md) records the measured numbers.
