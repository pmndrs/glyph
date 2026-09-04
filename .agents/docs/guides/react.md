---
type: Guide
title: React font loading
description: Shows the three supported React font paths and their loading, suspension, ownership, retry, and cleanup rules.
documentation_type: how-to
tags: [react, react-three-fiber, font-face, suspense, lifecycle]
sources:
  - id: react-adapter
    resource: ../../../packages/glyph/src/react.ts
    title: React Three Fiber adapter and font-loading hooks
  - id: react-format-hooks
    resource: ../../../packages/glyph/src/react
    title: Typed Bitmap, MSDF, and Slug hook leaves
  - id: font-face
    resource: ../../../packages/glyph/src/font-face.ts
    title: Canonical FontFace declaration and loading graph
  - id: react-contract
    resource: ../../../packages/glyph/tests/types/r3f-v1-api.test.ts
    title: Public React API type contract
  - id: react-lifecycle
    resource: ../../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs
    title: React font lease lifecycle proof
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-04T00:50:50Z'
---

# React font loading

React supports three coexisting ways to select a font. They all declare or consume the same root `FontFace` graph;
none creates another byte, decoded-font, shaping, or renderer-resource cache. Choose the form by ownership and naming
needs, not by renderer capability.[^font-face][^react-adapter]

| Path | Use it when | Declaration owner | Mounted Font lease |
| --- | --- | --- | --- |
| Direct `FontFace` | Application code already owns a reusable declaration or exact format selection. | Caller | `<Text>` |
| `useFont` or a format hook | A component wants React to own declaration and mounted lifetime. | Hook cache | Hook |
| `GlyphProvider.fontFaces` | A subtree should resolve short family aliases such as `"Inter"`. | Provider for shorthand entries; caller for passed FontFaces | `<Text>` |

## Pass a caller-owned FontFace directly

Declare a face once and pass the declaration or one of its inferred format selections to outer or nested `<Text>`:

```tsx
import { glyph } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { msdf } from '@pmndrs/glyph/raster/msdf';

const Inter = glyph.fontFace('/fonts/Inter.font.glb', { format: msdf });

export function Label() {
  return (
    <Text font={Inter.msdf}>
      Hello <Text font={Inter.msdf}>Glyph</Text>
    </Text>
  );
}
```

React checks loaded state synchronously. A loaded selection continues without a Promise or microtask; an unloaded
selection suspends on that exact load. The nearest ordinary Suspense boundary may handle it, so `GlyphProvider` is not
required. For a rich-text tree with several unresolved direct selections, the adapter starts every missing load before
suspending on the first unresolved cached operation; nested fonts therefore load concurrently instead of forming a
Suspense waterfall. The caller that created `Inter` eventually calls `Inter.dispose()`; mounted Text objects own
independent immutable Font leases and release those leases on unmount.[^react-lifecycle]

## Let a hook own the declaration

`useFont(source, config?)` is the generic hook. The format-specific leaves preserve exact return types and format
options without requiring an explicit generic:[^react-format-hooks]

```tsx
import { Text, useFont } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { msdf } from '@pmndrs/glyph/raster/msdf';

export function Labels() {
  const custom = useFont('/fonts/Custom.font.glb', { format: msdf });
  const body = useMsdf('/fonts/Inter.font.glb');
  const pixels = useBitmap('/fonts/Inter.font.glb', { strikes: [8, 16] });
  const title = useSlug('/fonts/Inter.font.glb');

  return (
    <>
      <Text font={custom}>Custom</Text>
      <Text font={body}>Body</Text>
      <Text font={pixels}>Pixel label</Text>
      <Text font={title}>Title</Text>
    </>
  );
}
```

Each hook declares through `glyph.fontFace()`. It owns the declaration it creates, acquires one immutable Font lease for
the mounted consumer, and releases that lease on unmount. Every hook exposes the same eager and cleanup operations:

```ts
await useMsdf.preload('/fonts/Inter.font.glb');
useMsdf.clear('/fonts/Inter.font.glb');
```

`preload()` returns the real loading Promise; awaiting it is preferable when a route loader or event owns readiness.
While present, each hook cache entry preserves Promise identity. A rejected FontFace operation is evicted so a later explicit preload
can start a fresh operation. The React suspension entry separately preserves one Promise/error identity across render
retries; `clear()` removes that hook declaration and suspension entry without invalidating independently mounted Font
leases.[^react-adapter][^react-contract]

## Define subtree-local string aliases

`GlyphProvider.fontFaces` maps names used by `<Text font="…">` to a source, an existing FontFace, or an object carrying
`src` and an optional format:

```tsx
import { glyph } from '@pmndrs/glyph';
import { GlyphProvider, Text } from '@pmndrs/glyph/react';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';

const ExistingTitle = glyph.fontFace('/fonts/Title.font.glb', { format: slug });

export function App() {
  return (
    <GlyphProvider
      fontFaces={{
        Inter: '/fonts/Inter.font.glb',
        Body: { src: '/fonts/Body.font.glb', format: msdf },
        Title: ExistingTitle,
      }}
      fallback={null}
    >
      <Text font="Inter">
        Hello <Text font="Title">Glyph</Text>
      </Text>
    </GlyphProvider>
  );
}
```

Aliases are lazy: the selected Text loads only the format it resolves. The provider disposes declarations it created
from source or `{ src, format? }` entries when its retained subtree lifetime ends. It never disposes `ExistingTitle`,
because that declaration remains caller-owned. Supplying `fontFaces` creates the provider's local Suspense boundary;
`fallback` customizes its pending UI. `errorFallback` catches `FontLoadError` only and rethrows unrelated application
errors.[^react-adapter]

The provider may also select an immutable Three handle or named root, but it is optional for both direct FontFaces and
hooks. `Text` and `TextGroup` never accept handle or root props. The adapter obtains both from one immutable React
context: a provider-selected value when present, otherwise the Canvas-local default root on the module-owned default
Three handle. That context is dependency injection; it does not create or own a second Glyph runtime, font registry,
renderer, scene, or canvas.

## Cache and ownership rules

- The Glyph FontFace graph is the sole semantic cache for source bytes, decoded formats, dependencies, and renderer
  resources.
- `suspend-react` retains stable Promise and error identity only so React retries the same operation safely.
- A direct FontFace remains caller-owned even when passed through a provider alias.
- Hook-created and provider-created FontFaces are released by the layer that created them.
- Mounted hooks and Text objects hold independent immutable Font leases, so clearing or disposing a declaration cannot
  invalidate a live consumer.
- `loadFont`, `createFontLibrary`, `FontLibrary`, and a public font-library subpath are not part of the React or root API.

[^react-adapter]: The adapter defines direct selection suspension, hook caches, provider aliases, selective error handling, and mounted cleanup.
[^react-format-hooks]: The three format leaves delegate to `useFont` while preserving each RasterFormat's option and return types.
[^font-face]: FontFace loading owns canonical source, decoded-format, dependency, retry, and declaration lifetimes.
[^react-contract]: The compile-only contract proves accepted provider entries, hook return inference, and rejected handle props.
[^react-lifecycle]: Integration coverage proves mounted leases survive declaration cleanup and are released at unmount.
