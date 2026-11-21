---
type: Log Entry
title: 'Port the PixiJS 3D renderer to the official release and the current core'
generated:
  by: process:docs-new
  at: '2026-11-21T19:28:16Z'
---

The PixiJS 3D renderer that lived on `feature/pixi3d` as the private `@pmndrs/glyph-pixi3d-beta` is now
[`@pmndrs/glyph-pixi3d`](../packages/glyph-pixi3d.md), a public package on the official `@pixi/3d` 0.1.0 (npm, MIT,
peer `pixi.js` ^8.23.0). It needs neither the private beta tarball nor the beta's `pixi.js` and `@pixi/3d` patches,
which served the demo app's post-processing and KTX2 paths, not the renderer.

**Release changes that touched the renderer.** `ShaderBit` keeps its `gpu`/`gl` stages; `BindingSpec` may now be
`{ type, visibility }`, so material field checks read `type`. Material rows are sized to their fields, so the beta's
256-byte row fallback is dead and was removed. GLSL ES 3.0 rejects derivatives anywhere in a vertex shader and
`gl.header` reaches both stages, so derivative-taking helpers moved to `gl.fragment.header`. The 16×9 light-tile
transform still encodes the physical viewport Slug dilation needs. Other beta-to-release renames (`toneMapped` to
`colorSpace`, `renderPassBits` to `enablePass`/`disablePass`, `_extraBits` to `extraBits`) are not used by the package.

**Core.** MSDF reads the `effect` lane and each font's `glyphs` table over `msdfBakedPages`; Slug keeps band curves
resident through `SlugBandResidency`, now exported from `@pmndrs/glyph/core`; decorations use
`createDecorationCodecProgram`, moved from the Three codec into `config/decoration.ts` and exported from core with
`decorationSchema`. Anchors resolve in `prepared()`, and `unchanged()` accepts like `accepted()`.

**Proof.** `benchmark:pixi3d-parity` renders 27 scenes through PixiJS 3D (WebGPU, then WebGL2) and through Three on
WebGPU at the same camera, channel tolerance 8/255. On WebGPU every Bitmap, Slug and MSDF scene is within tolerance
except `msdf-effects` (13 of 74,484 lit pixels: Three trims MSDF quads where an outline is wider than the baked
padding). On WebGL2, MSDF matches the same way; Slug differs on at most 13 pixels and Bitmap on at most 1.63% of lit
pixels, all on quad edges that fall exactly on pixel centres, which PixiJS 3D's y-flipped WebGL path assigns to the
other row (a quarter-pixel shift of the same Bitmap scene cut 542 such pixels to 198). Overlapping translucent texts
are kept apart in the scenes: PixiJS 3D sorts transparent draws by camera distance, Three by creation order.
