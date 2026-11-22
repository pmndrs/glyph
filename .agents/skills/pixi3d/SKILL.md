---
name: pixi3d
description: Implement, debug and verify `@pmndrs/glyph/pixi3d`, Glyph's renderer for the official PixiJS 3D release (`@pixi/3d`): View3D/Container3D/Mesh3D text, shader bits generated from Glyph's TypeGPU shaders, Bitmap/MSDF/Slug realization, native-record instancing, and the `benchmark:pixi3d-parity` proof. Use for @pixi/3d or Pixi3D work in this repository; not for Three.js, the TypeGPU renderer, or ordinary 2D PixiJS.
---

# PixiJS 3D renderer

The installed release is the API authority: read `node_modules/@pixi/3d/dist/**/*.d.ts` and the upstream skill it ships
at `node_modules/@pixi/3d/skills/pixijs-3d/SKILL.md` (with its `references/`) before using an unfamiliar API. Do not
guess from Three.js, from the unrelated `pixi3d` npm package, or from the closed beta this renderer started on.
`@pixi/3d` and `pixi.js` are optional peers of `@pmndrs/glyph`, pinned for development through the `pixi3d` catalog in
`pnpm-workspace.yaml`. The integration is the `@pmndrs/glyph/pixi3d` subpath: `packages/glyph/src/pixi3d.ts` and
`packages/glyph/src/pixi3d/`, structured like `/three` and `/typegpu`. Paths below are relative to `packages/glyph`.

## How the renderer is built

- One `Pixi3DText` is a `Container3D`. A publication decodes the Codec's retained lanes on the CPU (`src/pixi3d/internal/renderer.ts`)
  and realizes each draw span as `Mesh3D` children (`src/pixi3d/internal/mesh.ts`): expanded per-vertex attributes for paragraphs, or
  one native material row on a shared canonical quad for a one-record span (`src/pixi3d/internal/native-record.ts`).
- Shader code is generated, never hand-ported: `scripts/generate-pixi3d-shaders.mjs` resolves Glyph's TypeGPU functions
  from the built `dist/shaders/typegpu` to static WGSL and GLSL in `src/pixi3d/generated/shaders.ts`. Change math in
  `src/shaders/typegpu`, build, rerun the generator, and keep only Pixi plumbing (attributes, varyings, texture reads)
  in the `src/pixi3d/*-bit.ts` files. The package test runs the generator with `--check`. The shipped entry must not
  import TypeGPU; `tests/package/pixi3d-generated-shaders.test.mjs` enforces it, and `tests/package/esm-only.test.mjs`
  proves no other entry imports PixiJS. Use the `typegpu` skill for the shader side.
- Material textures are float-sampled. Integer data (Slug headers, band curves) is uploaded as byte-exact
  nearest-sampled `rgba8unorm` texels and rebuilt into `u32` words by `glyphSlugWord` in the bit.
- MSDF uploads every baked page (`msdfBakedPages`) and resolves each instance's cell from the font's `glyphs` table on
  the CPU. Slug makes band curves resident per glyph through core's `SlugBandResidency` before any table row is read.
- Slug dilation needs the physical viewport, which 0.1.0 exposes only through `camera.uLightTileTransform`
  (`16 / width`, `±9 / height`). Recheck `dist/core/LightTiles.mjs` when the release changes.
- Root hooks: `prepared()` resolves anchors after core prepared every dirty paragraph; `accepted` and `unchanged` both
  accept placement and sync native transforms; `rejected` keeps the last accepted meshes.

## Verify

- Package: `mise exec -- node --test tests/package/pixi3d-*.test.mjs` from `packages/glyph` after a build for the fast
  loop; `mise exec -- pnpm --filter @pmndrs/glyph test` and `check` run them with everything else.
- Pixels: `mise exec -- pnpm scripts run benchmark:pixi3d-parity` renders the same scenes through this renderer
  (WebGPU and WebGL2) and through Three in headless Chrome and compares them. The proof draws with an unlit
  `FlatMaterial` in `'display'` colour space so stored values are the linear blend Three stores; the package default is
  lit PBR, which an unlit reference cannot match.
- Report browser evidence separately from node tests, and state the tolerance with every pixel claim.
