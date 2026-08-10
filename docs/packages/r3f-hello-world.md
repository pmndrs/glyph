---
type: Workspace Package
title: '@pmndrs/text-r3f-hello-world'
description: Demonstrates the public React Three Fiber API with Bitmap, MSDF, Slug, and font-stack fallback.
resource: ../../apps/r3f-hello-world
workspace_package: '@pmndrs/text-r3f-hello-world'
documentation_type: reference
source_digest: 'sha256:97a2edefbff112367f3ac1675fa267a85d3f2438f2048dc4e2ffb72b808f3977'
tags: [package, example, react, react-three-fiber, vite]
sources:
  - id: manifest
    resource: ../../apps/r3f-hello-world/package.json
    title: Example application manifest
  - id: scene
    resource: ../../apps/r3f-hello-world/src/app.tsx
    title: Public R3F technique and fallback example
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-10T16:08:36Z'
---

# Package reference: `@pmndrs/text-r3f-hello-world`

This private Vite application is the minimal product-shaped React Three Fiber example. One full-page canvas renders
`Hello world` through the public `@pmndrs/text/r3f` `Text` component and resolves a Font Awesome globe through an ordered
font stack. One `App` component owns the font loads, technique state, one world `Text`, and its in-canvas MSDF controls.
Changing technique selects the corresponding loaded font stack for that same `Text`; the example does not retain a
second renderer path or manually pack glyph data. Separate world and UI `TextGroup` roots batch their text descendants
explicitly; ordinary nested groups only position individual buttons and their background meshes.

The checked-in assets are deliberately bounded at source before baking:

- Inter contains Basic Latin `U+0020–U+007E`.
- Font Awesome contains six globe and earth PUA scalars, including the displayed `U+F0AC` glyph.

Each GLB embeds Bitmap, MSDF, and Slug raster resources for its subset. The package manifest invokes only the published
CLI through `pnpm exec text bake`: direct input/output arguments select all three rasters, `--unicodes` delegates
shaping-font subsetting to the package-owned baker Wasm, and `--check` rebakes into temporary storage before requiring
byte-identical output.
The example loads each GLB once with one typed raster tuple and receives exact Bitmap, MSDF, and Slug `LoadedFont` values;
it does not repeat the input URL per technique. Vite emits the public shaper Wasm URL and a combined Inter/Font Awesome
notice file. Three, React, and React Three Fiber remain ordinary workspace peers rather than part of the core package-size
graph.

## Commands

```sh
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world dev
mise exec -- pnpm --filter @pmndrs/text-r3f-hello-world check
```

The check runs TypeScript 7 isolated typechecking, React Compiler-aware Oxlint with warnings denied, Oxfmt, deterministic
asset rebaking, a production Vite build, and a GPU Chromium acceptance probe. The probe clicks all three in-canvas
controls through pointer events and requires 13 laid-out glyphs—11 visible records plus two spaces—in two Rust-planned
meshes: one for Latin and one for the icon fallback resource.
