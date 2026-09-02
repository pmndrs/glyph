---
type: Workspace Package
title: '@pmndrs/glyph-examples'
description: Demonstrates matching public imperative Three.js and React Three Fiber Glyph lifecycles over shared assets.
resource: ../../apps/r3f-hello-world
workspace_package: '@pmndrs/glyph-examples'
documentation_type: reference
source_digest: 'sha256:0dd0e8d20b53ce47c29b4b5f9b57d714cabc28491e6ba63390bc75361945a51c'
tags: [package, example, three, react, react-three-fiber, vite]
sources:
  - id: manifest
    resource: ../../apps/r3f-hello-world/package.json
    title: Example application manifest
  - id: selector
    resource: ../../apps/r3f-hello-world/src/main.tsx
    title: URL-selected dynamic entry point
  - id: three
    resource: ../../apps/r3f-hello-world/src/three-example.ts
    title: Public imperative Three.js lifecycle
  - id: r3f
    resource: ../../apps/r3f-hello-world/src/app.tsx
    title: Public R3F technique and nested font-span lifecycle
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-01T00:00:00Z'
---

# Package reference: `@pmndrs/glyph-examples`

This private Vite package proves the public imperative Three.js and React Three Fiber integrations side by side. The root
entry reads `?example=three|r3f` and dynamically imports only that integration. Both routes reuse the same baked Inter and
Font Awesome GLBs rather than maintaining separate fixture or loading paths.

The imperative route uses the complete ordinary contract: `await glyph.init()`, `glyph.handle(name, ThreeConfig)`,
`glyph.fontFace(source)`, `await face.load(handle)`, `handle.createText()`, `scene.add(text)`, `text.shape()`, and finally
`renderer.render(scene, camera)`. `shape()` commits one planned Three `Mesh` below the `Text` before
`WebGPURenderer.init()` is awaited. The renderer, its canvas, and the camera are therefore application-owned host state,
not inputs to Glyph resource resolution.

The R3F route uses the module-owned default Three handle unless a `GlyphProvider` selects another immutable handle.
Typed `useBitmap`, `useMsdf`, and `useSlug` hooks own mounted Font leases and suspend on their shared FontFace loads. Three
React `Activity` branches retain the technique variants; nested `Text` chooses the matching icon font, and a `TextGroup`
batches the control labels.

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
Vitexec browser probes. The R3F probe clicks all three technique controls and inspects their committed draws. The Three
probe verifies that the canvas is connected, the named `Text` belongs to the scene, the `Text` owns its planned mesh, and
the mesh contains ten visible instances for `Hello world`; the space participates in shaping but emits no draw instance.
