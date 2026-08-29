---
type: Workspace Package
title: '@pmndrs/glyph-examples'
description: Demonstrates matching public imperative Three.js and React Three Fiber Glyph lifecycles over shared assets.
resource: ../../../apps/r3f-hello-world
workspace_package: '@pmndrs/glyph-examples'
documentation_type: reference
source_digest: 'sha256:588d4543af7047b09b835ffa92c9b9bf1f52f898ee312e6577b4412a83ad71b5'
tags: [package, example, three, react, react-three-fiber, vite]
sources:
  - id: manifest
    resource: ../../../apps/r3f-hello-world/package.json
    title: Example application manifest
  - id: selector
    resource: ../../../apps/r3f-hello-world/src/main.tsx
    title: URL-selected dynamic entry point
  - id: three
    resource: ../../../apps/r3f-hello-world/src/three-example.ts
    title: Public imperative Three.js lifecycle
  - id: r3f
    resource: ../../../apps/r3f-hello-world/src/app.tsx
    title: Public R3F raster-format and nested font-span lifecycle
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-04T00:50:50Z'
---

# Package reference: `@pmndrs/glyph-examples`

This private Vite package proves the public imperative Three.js and React Three Fiber integrations side by side. The root
entry reads `?example=three|r3f` and dynamically imports only that integration. Both routes reuse the same baked Inter and
Font Awesome GLBs rather than maintaining separate fixture or loading paths.

The imperative route uses the complete ordinary contract: `await glyph.init()`, `glyph.handle(name, ThreeConfig)`,
`glyph.fontFace(source)`, `await face.load()`, `handle.createText()`, `scene.add(text)`, `glyph.shape()`, and finally
`renderer.render(scene, camera)`. The global `shape()` call commits the dirty roots' planned Three `Mesh` objects before
`WebGPURenderer.init()` is awaited. The renderer, its canvas, and the camera are therefore application-owned host state,
not inputs to Glyph resource resolution.

The R3F route uses the module-owned default Three handle unless a `GlyphProvider` selects another immutable handle.
Module-scoped `useBitmap.preload()`, `useMsdf.preload()`, and `useSlug.preload()` calls start the three format loads;
the matching hooks consume those stable operations, suspend only while unresolved, and own their mounted immutable Font
leases. Each hook declares through `glyph.fontFace()` rather than introducing another loader. Three React `Activity`
branches retain the raster-format variants; nested `Text` chooses the matching icon font, and a `TextGroup` batches the
control labels.

The checked-in Inter asset covers Basic Latin `U+0020–U+007E`; the Font Awesome asset contains only six globe/earth PUA
scalars. Each GLB embeds Bitmap, MSDF, and Slug resources. The manifest invokes the published baker CLI and verifies
byte-identical regeneration in check mode.

## Commands

```sh
mise exec -- pnpm --filter @pmndrs/glyph-examples dev
mise exec -- pnpm --filter @pmndrs/glyph-examples bake
mise exec -- pnpm --filter @pmndrs/glyph-examples bake:check
mise exec -- pnpm --filter @pmndrs/glyph-examples check
```

The complete check runs typechecking, lint, formatting, deterministic asset verification, a production build, and two
Vitexec browser probes. The R3F probe clicks all three raster-format controls and inspects their committed draws. The Three
probe verifies that the canvas is connected, the named `Text` belongs to the scene, the `Text` owns its planned mesh, and
the mesh contains ten visible instances for `Hello world`; the space participates in shaping but emits no draw instance.
