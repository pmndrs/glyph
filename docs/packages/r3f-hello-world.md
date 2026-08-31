---
type: Workspace Package
title: '@pmndrs/glyph-r3f-hello-world'
description: Demonstrates the public React Three Fiber API with Bitmap, MSDF, Slug, and nested font spans.
resource: ../../apps/r3f-hello-world
workspace_package: '@pmndrs/glyph-r3f-hello-world'
documentation_type: reference
source_digest: 'sha256:bacbc32a9904a2efe181f26a5348a4527a598d5e0cde21d4a88f2549fb9f89ba'
tags: [package, example, react, react-three-fiber, vite]
sources:
  - id: manifest
    resource: ../../apps/r3f-hello-world/package.json
    title: Example application manifest
  - id: scene
    resource: ../../apps/r3f-hello-world/src/app.tsx
    title: Public R3F technique and nested font-span example
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

# Package reference: `@pmndrs/glyph-r3f-hello-world`

This private Vite application is the minimal product-shaped React Three Fiber example. One full-page canvas renders
`Hello world` through the public `@pmndrs/glyph/react` `Text` component. The globe is a nested inline `Text` bound directly
to the matching subsetted Font Awesome raster rather than an automatically resolved font-stack fallback. Public
The three typed convenience hooks preload both assets before the scene suspends on those same per-technique cache entries.
One `App` component owns the loaded fonts, technique state, three React `Activity` branches, and its in-canvas Slug
controls. Each hidden branch pre-renders a standalone world `Text`; changing technique reveals the already committed
Bitmap, MSDF, or Slug branch rather than initializing one after the click. The selected technique color appears on both
the globe and its control label. The example does not retain a second renderer path or manually pack glyph data. The UI
`TextGroup` batches its labels explicitly. The controls sit in one centered row at the top of the viewport, while the
world copy remains centered in the available canvas. One local `Button` component owns each transform group, plane mesh,
hover state, and text label. Its `pillNode()` graph rounds the plane without tessellated shape geometry. Labels use a
44-unit shaped line box, centered font metrics, and tracked uppercase text. Neither text layer opts into independent
compositing because authored order is the honest default for this small scene.

The checked-in assets are deliberately bounded at source before baking:

- Inter contains Basic Latin `U+0020–U+007E`.
- Font Awesome contains six globe and earth PUA scalars, including the displayed `U+F0AC` glyph.

Each GLB embeds Bitmap, MSDF, and Slug raster resources for its subset. The package manifest invokes only the published
CLI through `pnpm exec glyph bake`: direct input/output arguments select all three rasters, `--unicodes` delegates
shaping-font subsetting to the package-owned baker Wasm, and `--check` rebakes into temporary storage before requiring
byte-identical output.
The example requests exact Bitmap, MSDF, and Slug `Font` values through their typed wrappers. Its Vite and TypeScript
configurations opt into workspace `source` exports, so edits to Glyph TypeScript modules hot reload without rebuilding the
packages. Vite emits the public shaper Wasm URL and a combined Inter/Font Awesome notice file. Three, React, and React
Three Fiber remain ordinary workspace peers rather than part of the core package-size graph.

## Commands

```sh
mise exec -- pnpm --filter @pmndrs/glyph-r3f-hello-world dev
mise exec -- pnpm --filter @pmndrs/glyph-r3f-hello-world bake
mise exec -- pnpm --filter @pmndrs/glyph-r3f-hello-world bake:check
mise exec -- pnpm --filter @pmndrs/glyph-r3f-hello-world check
```

`bake:inter` and `bake:icons` own the two output GLBs, and the root `bake` command composes them. The corresponding
`bake:check:inter`, `bake:check:icons`, and root `bake:check` commands preserve the same per-asset boundary in byte-exact
check mode. The complete check runs TypeScript 7 isolated typechecking, React Compiler-aware Oxlint with warnings denied,
Oxfmt, deterministic asset rebaking, a production Vite build, and a GPU Chromium acceptance probe. The probe clicks all three in-canvas
controls through pointer events, reads the named R3F world layer directly through Vitexec, and first requires all three
hidden `Activity` branches to own their two Rust-planned meshes. Every revealed branch contains 13 laid-out glyphs—11
visible records plus two spaces—with one mesh for Latin and one for the explicitly bound icon-span resource. The teaching component
carries no probe-only effect, ref, frame callback, or canvas data attributes.
