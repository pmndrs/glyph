---
type: Log Entry
title: 'Moved the PixiJS 3D renderer into the @pmndrs/glyph/pixi3d subpath'
generated:
  by: process:docs-new
  at: '2026-11-22T02:06:35Z'
---

The PixiJS 3D renderer shipped in `sil-green-18` as its own workspace package. It is now the `@pmndrs/glyph/pixi3d`
subpath of [`@pmndrs/glyph`](../packages/glyph.md), laid out like `/three` and `/typegpu`: `src/pixi3d.ts` is the
entry, the modules that define its exports live in `src/pixi3d/`, and implementation lives in `src/pixi3d/internal/`.
The files moved with `git mv`; imports that went through the public root and `/core` specifiers now name the package
modules directly, as the TypeGPU integration does. The separate package, its concept and its workspace links are gone.

`@pixi/3d` (`>=0.1.0 <0.2`) and `pixi.js` (`>=8.23.0 <9`) are optional peers and `pixi3d`-catalog development
dependencies. Nothing else in the package imports them: `esm-only.test.mjs` walks the built root, `/core`, `/three`,
`/three/typegpu`, `/typegpu` and `/shaders/typegpu` graphs, and the packed-package test installs a core-only consumer
without PixiJS and a PixiJS-only consumer without Three or TypeGPU.

The shader generator is `scripts/generate-pixi3d-shaders.mjs`. It reads the package's own built TypeGPU shaders, so the
package test reruns it with `--check` after the build instead of regenerating at build time; regenerating produced
byte-identical shaders apart from the generator path in the header comment. The renderer's node tests are
`tests/package/pixi3d-*.test.mjs`, a type test covers the entry against the built declarations, and the benchmark size
report gains a PixiJS 3D renderer entry with both peers externalized. `benchmark:pixi3d-parity` imports the subpath.

The two codec buffer ids keep the `glyph-<integration>/…` naming that `/three` and `/typegpu` use.
