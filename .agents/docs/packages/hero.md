---
type: Workspace Package
title: '@pmndrs/glyph-hero'
description: 'Two Slug-rendered hero scenes — a mass-spring icon lattice under glass type, and a video-masked word cycling ten scripts.'
resource: ../../../apps/hero
workspace_package: '@pmndrs/glyph-hero'
documentation_type: reference
source_digest: 'sha256:67b8ed939693a5514acc1ded338e27c40c5f5562c94194cfb3ce819a7456700e'
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
  - id: glass-material
    resource: ../../../apps/hero/src/materials/ink.ts
    title: Glass title materials and smooth lens normals
  - id: refraction-check
    resource: ../../../apps/hero/scripts/refraction.probe.ts
    title: WebGPU stained-glass verification
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
so they interleave on screen and stay in phase. The Slug-glass `GLYPH` and feature line start at rest. Press Space
to lift the title towards the camera and slam it back into place. Each pane follows the original eased approach,
35 ms after its neighbour, with a separate impact through both lattices on landing. A slight tilt (at most 1.5°)
and drift make the approach less rigid; a gentle settle returns it home within 380 ms of contact. The feature line retypes after
the final landing. Holding Space does not restart the animation, and focused form controls retain their normal
keyboard behavior.

The development inspector starts hidden in both scenes; D toggles it.

The title uses five inline glass materials in one shaped word: rose G, amber L, jade Y, blue P, and violet H.
Each has its own attenuation tint, thickness, roughness, and refractive index, with smooth lens normals and modest
physical dispersion. The paper and icon background stay unchanged; there are no added crystal lights, internal
rainbow beams, or hidden studio images.

Each pane casts a colored contact shadow from the MSDF companion's `trueDistance` and `pixelRange`. A smooth
falloff replaces the former hard offset shadow. The shadows remain on the surface as the letters rise: height
increases their offset and softness while reducing opacity, then restores a tight contact on landing. The falloff
stays within the baked distance range to avoid rectangular atlas-cell edges.

`mise exec -- pnpm scripts run hero:refraction-check` verifies the real scene on WebGPU through Vitexec. It requires
five stained-glass materials, compares them with an untinted control, checks that changes stay inside the title,
drives the real Space handler in fixed simulation steps to check five staggered impacts and ignored key repeats,
compares against a shadow-free control, checks repeatable captures and resizing, and saves `apps/hero/.cache/refraction.png`. Browser errors fail the workflow.

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
