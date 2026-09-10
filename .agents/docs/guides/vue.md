---
type: Guide
title: Vue and TresJS font loading
description: Shows the three supported Vue font paths and their loading, reactivity, ownership, and cleanup rules inside a TresJS canvas.
documentation_type: how-to
tags: [vue, tresjs, font-face, reactivity, lifecycle]
sources:
  - id: vue-adapter
    resource: ../../../packages/glyph/src/vue.ts
    title: TresJS adapter and font-loading composables
  - id: vue-format-composables
    resource: ../../../packages/glyph/src/vue
    title: Typed Bitmap, MSDF, and Slug composable leaves and the slot flattener
  - id: font-face
    resource: ../../../packages/glyph/src/font-face.ts
    title: Canonical FontFace declaration and loading graph
  - id: vue-contract
    resource: ../../../packages/glyph/tests/types/vue-api.test.ts
    title: Public Vue API type contract
  - id: vue-lifecycle
    resource: ../../../packages/glyph/tests/integration/vue-lease-lifecycle.test.mjs
    title: Vue font lease lifecycle proof under TresCanvas
generated:
  by: anthropic/claude-fable-5-1
  at: '2026-09-10T00:00:00Z'
---

# Vue and TresJS font loading

`@pmndrs/glyph/vue` renders Glyph text inside a TresJS `<TresCanvas>`. It supports the same three font paths as the
React adapter and reconciles them into the same retained Three `Text` and `TextGroup` objects. None of the paths
creates another byte, decoded-font, shaping, or renderer-resource cache.[^font-face][^vue-adapter]

| Path                      | Use it when                                                                   | Declaration owner                                             | Mounted Font lease |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------ |
| Direct `FontFace`         | Application code already owns a reusable declaration or exact format.         | Caller                                                        | `<Text>`           |
| `useFont` or a format leaf | A component wants Vue to own declaration and mounted lifetime.               | Composable cache                                              | Composable         |
| `GlyphProvider.fontFaces` | A subtree should resolve short family aliases such as `"Inter"`.              | Provider for shorthand entries; caller for passed FontFaces   | `<Text>`           |

Vue has no render-phase suspension, so the adapter is reactive instead of suspending. A `<Text>` whose selection is
still loading mounts nothing, starts every missing load at once, and constructs its Three object when the last one
settles. A later change to an unloaded selection keeps the current paragraph on screen until the new font loads.
Callers who want `<Suspense>` await the `ready` promise a composable returns.

## Pass a caller-owned FontFace directly

```vue
<script setup lang="ts">
import { glyph } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/vue';
import { msdf } from '@pmndrs/glyph/raster/msdf';

const inter = glyph.fontFace('/fonts/Inter.font.glb', { format: msdf });
</script>

<template>
  <Text :font="inter.msdf">Hello <Text :font="inter.msdf">Glyph</Text></Text>
</template>
```

The caller that created `inter` eventually calls `inter.dispose()`. Mounted `<Text>` objects hold independent
immutable Font leases and release them when their component scope ends.[^vue-lifecycle]

## Let a composable own the declaration

`useFont(source, config?)` returns `{ font, error, ready }`: a read-only shallow ref that holds the mounted lease once
loaded, a ref that holds a failure, and a promise for async setup. The format leaves preserve exact return types
without an explicit generic:[^vue-format-composables]

```vue
<script setup lang="ts">
import { Text, useFont } from '@pmndrs/glyph/vue';
import { useBitmap } from '@pmndrs/glyph/vue/bitmap';
import { useMsdf } from '@pmndrs/glyph/vue/msdf';
import { msdf } from '@pmndrs/glyph/raster/msdf';

const custom = useFont('/fonts/Custom.font.glb', { format: msdf });
const label = useBitmap('/fonts/Inter.font.glb', { strikes: [16] });
const body = useMsdf('/fonts/Inter.font.glb');
</script>

<template>
  <Text v-if="body.font.value" :font="body.font.value">Body copy</Text>
  <Text v-if="label.font.value" :font="label.font.value" :style="{ fontSize: 16 }">Label</Text>
</template>
```

`preloadFont(source, config?)` starts the same default-handle load before a component asks for it, and
`clearFont(source, config?)` drops a cached resource without touching mounted leases. Each format leaf exports the
same pair (`preloadBitmap`/`clearBitmap`, `preloadMsdf`/`clearMsdf`, `preloadSlug`/`clearSlug`) as plain functions
rather than static members of the composable, which matches how Vue and TresJS composables are shaped. The
composables read the Glyph context of the nearest `GlyphProvider`, otherwise the canvas-local default root, so they
must run inside a `<TresCanvas>` subtree; `preloadFont` and `clearFont` do not read a context and may run at module
scope.

## Define subtree-local string aliases

```vue
<template>
  <GlyphProvider :font-faces="{ Inter: '/fonts/Inter.font.glb', Title: { src: '/fonts/Title.font.glb', format: 'slug' } }">
    <Text font="Inter">Named <Text font="Title">provider fonts</Text></Text>
  </GlyphProvider>
</template>
```

`handle` and `font-faces` are immutable for the life of a provider; changing either throws, so remount the provider
instead. Shorthand entries are provider-owned and disposed with it; a passed FontFace stays caller-owned. A string
`handle` selects a named root on the built-in default handle; a `ThreeHandle` or `ThreeRoot` selects an application
handle.

## Cache and ownership rules

- The Glyph FontFace graph is the sole semantic cache for source bytes, decoded formats, dependencies, and renderer
  resources.
- One default Glyph root exists per `<TresCanvas>`, because a root may not span two Scenes. Unmounting one canvas
  leaves another canvas's paragraphs and root intact.
- TresJS disposes the retained Three object when a `<Text>` or `<TextGroup>` unmounts; the adapter releases its
  Font leases and default-root reference with the component scope.
- The Three classes are registered in the Tres catalogue under private names only so the custom renderer can
  construct and dispose them. Applications use the wrapper components; the tags are not public.
- Frame errors and font load failures reach the component's `error` emit.

[^vue-adapter]: The adapter defines reactive font readiness, per-canvas default roots, provider aliases, and scope-bound cleanup.
[^vue-format-composables]: The three format leaves delegate to `useFont` while preserving each RasterFormat's option and return types; the flattener turns nested `<Text>` slots into inline spans.
[^font-face]: FontFace loading owns canonical source, decoded-format, dependency, retry, and declaration lifetimes.
[^vue-contract]: The compile-only contract proves accepted provider entries, composable return inference, and exposed instance types.
[^vue-lifecycle]: Integration coverage under a happy-dom TresCanvas proves leases balance across Tres disposal, default roots isolate per canvas, and one canvas survives another's unmount.
