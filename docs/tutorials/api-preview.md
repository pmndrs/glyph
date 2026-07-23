---
type: API Guide
title: Planned API walkthrough
description: Walk through the proposed V0 loading, baking, paragraph, reflow, and presentation APIs before implementation.
status: design-fixture
tags: [api, loader, baker, paragraph, presentation]
---

# Planned API walkthrough

This page demonstrates the canonical V0 API shape. The package is not implemented yet; the examples are fixtures that implementation tests must eventually compile and run unchanged or revise through an explicit API decision.

## Load a font and one presentation

```ts
import { createFontLoader, createParagraphEngine } from '@pmndrs/text'
import { bitmap } from '@pmndrs/text/presentation/bitmap'

const fonts = createFontLoader()
const paragraphs = createParagraphEngine()

const font = await fonts.load(
  {
    source: new URL('./Inter-Regular.ttf', import.meta.url),
    baked: new URL('./Inter-Regular.font.glb', import.meta.url),
  },
  {
    presentations: [{ id: 'ui-16', kind: 'bitmap', required: true }],
  },
)
```

The loader probes `baked` first. A valid baked hit never imports the runtime baker. A miss dynamically imports the runtime baker library, transfers the source to its Worker, and registers the resulting canonical bytes. The public API does not expose a force-runtime or skip-baked switch.

## Lay out a bounded paragraph

```ts
const paragraph = paragraphs.create({
  text: 'A paragraph can wrap, clip, or end with an ellipsis.',
  font: font.handle,
})

const layout = paragraph.layout({
  width: 420,
  height: 120,
  maxLines: 3,
  wrap: 'word',
  align: 'start',
  overflow: 'ellipsis',
})
```

The JavaScript paragraph engine chooses line breaks in UTF-16 source coordinates using shaped clusters and safety flags. Presentation bounds never participate in text measurement.

## Reflow after a resize

```ts
const resized = paragraph.layout({
  width: 260,
  height: 120,
  maxLines: 3,
  wrap: 'word',
  align: 'start',
  overflow: 'ellipsis',
})
```

A width change always reflows. Ordinary reflow uses cached broad shapes and crosses no Wasm boundary. When new line boundaries can affect shaping, the engine submits every changed range in one `reshapeRanges` batch.

## Build a bitmap draw batch

```ts
const registered = await fonts.loadPresentation(font, { id: 'ui-16' })
const resource = await bitmap.decode(font, registered)
const drawBatch = bitmap.buildBatches(resized, resource)
```

`decode` validates the presentation binding and uploads flat records and texture data. It cannot alter glyph IDs, advances, offsets, line breaks, or paragraph positions.

## Load a split presentation later

The core font GLB may reference a presentation embedded in the same GLB, in a separately fetched presentation GLB, or through an application resolver. The API is identical:

```ts
const mtsdfPresentation = await fonts.loadPresentation(
  font,
  { id: 'ui-mtsdf', kind: 'distance-field', required: true },
  {
    resolve: async ({ reference, signal }) => {
      const response = await fetch(`/font-assets/${reference.id}.glb`, { signal })
      return new Uint8Array(await response.arrayBuffer())
    },
  },
)
```

Attachment succeeds only when the shaping hash, glyph count, glyph-ID width, presentation ID, and extension version match the registered font.

## Switch renderers without reshaping

```ts
import { slug } from '@pmndrs/text/presentation/slug'

const registeredSlug = await fonts.loadPresentation(font, { kind: 'slug' })
const slugResource = await slug.decode(font, registeredSlug)
const slugBatch = slug.buildBatches(layout, slugResource)
```

The shaped and positioned glyph stream is reused. Presentation modules remain independently imported so applications can tree-shake or dynamically load only the engines they use.

## Pre-bake in Node

```ts
import { bakeFont } from '@pmndrs/text/bake'

await bakeFont({
  input: new URL('./Inter-Regular.ttf', import.meta.url),
  output: new URL('./Inter-Regular.font.glb', import.meta.url),
  descriptor: {
    fontFaceIndex: 0,
    presentations: [
      {
        id: 'ui-16',
        kind: 'bitmap',
        ppemX: 16,
        ppemY: 16,
        oversample: 2,
        padding: 1,
        hinting: 'none',
        coverage: 'grayscale',
        packaging: 'embedded',
      },
    ],
  },
})
```

The Node host and Worker host call the same bake core. They must emit byte-identical authoritative sections for the same source, descriptor, and versions.

## Dispose resources

```ts
paragraph.dispose()
bitmap.dispose(resource)
font.dispose()
```

Disposal invalidates stale shape, layout, presentation, and GPU-resource cache entries associated with the font generation.

## Contract references

- The [API reference](/planning/api-shapes.md) defines every V0 interface used above.
- The [architecture](/planning/architecture.md) assigns ownership and import boundaries.
- The [shaping contract](/planning/shaping-data-contract.md) defines the Wasm request/result ABI.
- The [presentation contract](/planning/presentation-data-contract.md) defines binding and GPU records.
