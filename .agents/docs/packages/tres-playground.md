---
type: Workspace Package
title: '@pmndrs/glyph-tres-playground'
description: Demonstrates the public Vue adapter rendering Bitmap, MSDF, and Slug text inside a TresJS canvas.
resource: ../../../apps/tres-playground
workspace_package: '@pmndrs/glyph-tres-playground'
documentation_type: reference
source_digest: 'sha256:3b8bfbf2f42cd458f090ca0678826e3f8a9509e151694e55ef1dfbb5052e64c8'
tags: [package, example, vue, tresjs, vite]
sources:
  - id: manifest
    resource: ../../../apps/tres-playground/package.json
    title: Playground manifest
  - id: app
    resource: ../../../apps/tres-playground/src/App.vue
    title: TresCanvas with a WebGPU renderer and HTML controls
  - id: scene
    resource: ../../../apps/tres-playground/src/Scene.vue
    title: Public Vue Text, nested span, TextGroup, and format composables
  - id: probe
    resource: ../../../apps/tres-playground/scripts/live-check.probe.ts
    title: Browser probe over committed draws
generated:
  by: anthropic/claude-fable-5-1
  at: '2026-09-10T00:00:00Z'
---

# Package reference: `@pmndrs/glyph-tres-playground`

This private Vite application proves the public `@pmndrs/glyph/vue` adapter inside a TresJS `<TresCanvas>`. It reuses
the checked Inter and Font Awesome GLBs owned by `@pmndrs/glyph-examples` rather than baking its own assets.

`App.vue` creates Three's `WebGPURenderer` through the `renderer` prop, keeps TresJS in `on-demand` render mode, and
renders HTML controls for the raster format and the greeting text. `Scene.vue` runs inside the canvas: it places a
perspective camera at the distance where one world unit at z = 0 is one CSS pixel of the Tres `sizes`, loads the Latin and icon fonts through `useBitmap`, `useMsdf`, and
`useSlug`, renders one keyed greeting `<Text>` whose nested `<Text>` binds the globe glyph to the icon font, and batches
three Slug labels in a `<TextGroup>`. The scene publishes its Scene and greeting paragraph to a module the browser probe
reads.

The Vite `source` condition resolves the adapter from `packages/glyph/src`, so adapter edits reload the playground
without a package build.

## Commands

```sh
mise exec -- pnpm --filter @pmndrs/glyph-tres-playground dev
mise exec -- pnpm --filter @pmndrs/glyph-tres-playground check
```

The check runs `vue-tsgo` template type checking against the repository TypeScript 7 compiler, lint, formatting, a
production build, and one Vitexec browser probe. The probe clicks each format button and requires the greeting to
commit with ten Latin glyphs and one icon across two resource-partitioned draws, next to the label group's single
batched draw.
