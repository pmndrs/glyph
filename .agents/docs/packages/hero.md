---
type: Workspace Package
title: '@pmndrs/glyph-hero'
description: 'Two Slug-rendered hero scenes — a mass-spring icon lattice under glass type, and a video-masked word cycling ten scripts.'
resource: ../../../apps/hero
workspace_package: '@pmndrs/glyph-hero'
documentation_type: reference
source_digest: 'sha256:cc2370b558ee918e991e27f46ece24be8180d20ab8ea971abe6a50c37cc4d2ea'
tags: [package, example, react-three-fiber, webgpu, slug, vite]
sources:
  - id: manifest
    resource: ../../../apps/hero/package.json
    title: Application manifest
  - id: hero-scene
    resource: ../../../apps/hero/src/hero.tsx
    title: Default scene composition
  - id: origin-scene
    resource: ../../../apps/hero/src/origin.tsx
    title: Origin scene composition
  - id: screen-material
    resource: ../../../apps/hero/src/materials/screen.ts
    title: Video mask and metal story materials
  - id: word-cycle
    resource: ../../../apps/hero/src/origin/wordCycle.ts
    title: Typing schedule across scripts
  - id: bake
    resource: ../../../apps/hero/scripts/bake.mts
    title: Face baking and staleness check
generated:
  by: anthropic/claude-opus-5
  at: '2026-09-18T09:20:00Z'
---

# Package reference: `@pmndrs/glyph-hero`

This Vite application is a showcase rather than an API demonstration: each scene exists to make one rendering
technique visible. Both run on `WebGPURenderer` through React Three Fiber v10 and drei v11, and both draw their
text with the Slug raster, whose analytic coverage is what the techniques depend on.

The default scene builds two interleaved lattices of occult icons on mass-spring grids at different depths, scaled
so they interleave on screen and stay in phase. A Slug-glass `GLYPH` springs in and sends a shockwave through both
lattices, then a feature line types in, each letter applying its own force so the icons reflow around the
letterforms rather than around a bounding box.

`?scene=origin` sets a word off axis over a black reflector in a dark room. A NASA SDO clip is masked into the
letterforms, and the same clip lights the scene through `Lightformer`s inside an `Environment`, so the word and the
justified origin column beside it are lit by the footage showing through the word. The mask samples the clip in the
word's own space through an inverse model matrix rather than from the material's `position`: Slug dilates each glyph
quad to cover its antialiasing footprint, and that dilation is view dependent, so a coordinate derived from it moves
with the camera. Both text materials set `depthWrite: false`, because glyph quads overlap wherever letters kern
tightly and coplanar quads otherwise fight over depth.

The word cycles ten languages, each the native word for a letter or written form rather than a transliteration.
Typing and deleting advance by grapheme cluster through `Intl.Segmenter`, so Devanagari conjuncts and Arabic joining
forms assemble the way those scripts actually write them. The schedule runs on wall-clock seconds and advances only
once the layout it last asked for has committed, so a cluster's share of time is time it was visible for.

Letter-shaped shadows come from Three's own `maskShadowNode`, fed the format's coverage; `alphaTest` does nothing in
the WebGPU shadow pass.

`pnpm --filter @pmndrs/glyph-hero dev` starts the development server. `bake` and `bake:check` drive the faces through
the Glyph CLI, and `check` runs typecheck, lint, format, unit tests, the bake staleness check, and the build. Faces
are baked per script because no single face covers Latin, CJK, Arabic, Devanagari, and Greek at display weight; the
CJK, Arabic, and Devanagari cuts are vendored under `fonts/word-faces` with their licenses and regeneration commands.
