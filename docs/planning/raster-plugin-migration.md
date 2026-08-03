---
type: How-to guide
title: Migrate a raster plugin to transactional staging
description: Shows external raster authors how to replace the pre-release build, retained-update, and repaint seams with the required renderer-neutral stageBatch transaction.
tags: [raster, plugins, migration, transactions, threejs]
sources:
  - id: 'public-raster-contract'
    resource: '../../packages/text/src/raster.ts'
    title: 'Public raster contract'
  - id: 'external-raster-proof'
    resource: '../../packages/glyph-debug-raster/src/raster.ts'
    title: 'External glyph-debug raster implementation'
  - id: 'external-raster-tests'
    resource: '../../packages/glyph-debug-raster/tests/glyph-debug.test.ts'
    title: 'External raster lifecycle tests'
  - id: 'raster-lifecycle-decision'
    resource: 'decision-register.md#product-and-public-api'
    title: 'Renderer-neutral raster lifecycle decision'

generated:
  by: 'openai-codex/gpt-5.6'
  at: '2026-08-03T15:29:54Z'
---

# Migrate a raster plugin to transactional staging

Use this guide when a raster plugin implements the earlier pre-release `buildBatches`, optional `stageBatchUpdate`, or
`updatePaint` methods. The current public contract replaces all three with one required `stageBatch` transaction. The
transaction lets `Text` preserve the committed scene when preparation fails, publish complete warm updates during normal
Three.js object traversal, and use the same ownership rules for first-party and external rasters.

The exact signatures remain authoritative in the [public API contract](api-shapes.md#raster-module-boundary).
The private [`@pmndrs/text-glyph-debug-raster`](../../packages/glyph-debug-raster/src/raster.ts) package is a complete
external implementation that imports only published entry points.

## 1. Make the draw batch renderer-neutral

Implement `RasterDrawBatch` with an idempotent `dispose()` method. If the Three.js adapter should attach an object to its
scene, implement `RasterObjectDrawBatch<THREE.Object3D>` instead of adding `object` to the portable base contract.

```ts
import type { RasterObjectDrawBatch } from '@pmndrs/text';
import type { Group } from 'three/webgpu';

interface ExampleBatch extends RasterObjectDrawBatch<Group> {
  readonly capacity: number;
  readonly glyphCount: number;
}
```

Keep renderer-specific geometry, materials, buffers, and dirty-range state inside the package-owned batch or in private
state keyed by that batch. Core does not inspect those details.

## 2. Replace the three mutation methods with `stageBatch`

Remove `buildBatches`, `stageBatchUpdate`, and `updatePaint`. Implement the complete next generation in `stageBatch`,
including layout fields and paint fields:

```ts
import { defineRaster, defineRasterBatchStage } from '@pmndrs/text';

export const exampleRaster = defineRaster({
  // kind, extension, version, descriptor, decode, and prepare are unchanged.
  stageBatch(previous, layout, resource, fontSlot, paint, rasterPixelRatio) {
    validateInputs(layout, resource, fontSlot, paint, rasterPixelRatio);
    const next = prepareInstanceValues(layout, resource, fontSlot, paint, rasterPixelRatio);

    if (previous !== undefined && canRetain(previous, resource, fontSlot, next)) {
      return defineRasterBatchStage(
        previous,
        () => publishRetainedValues(previous, next),
        () => releasePreparedValues(next),
      );
    }

    const replacement = createReplacementBatch(resource, fontSlot, next);
    return defineRasterBatchStage(
      replacement,
      () => undefined,
      () => replacement.dispose(),
    );
  },
});
```

`stageBatch` may return `previous` when the new glyphs fit compatible storage, or a replacement when capacity or resource
topology changes. That choice is private to the raster. Callers do not need a capacity or dirty-range API.

## 3. Keep staging isolated from the live batch

Perform every operation that can throw before publication. In particular:

- validate layout, glyph identity, paint, and resource compatibility before changing live fields;
- allocate replacements and prepare retained CPU values in unpublished storage;
- do not change committed GPU arrays, draw counts, scene children, or ownership during staging;
- make `commit()` synchronous and infallible;
- make `abort()` idempotent and unable to affect the committed batch;
- make batch and resource disposal idempotent.

When retaining a batch, compute changed ranges from the committed values and the prepared values, then apply both the
values and upload ranges inside the publish callback. When replacement is required, the abort callback owns the complete
unpublished replacement. `defineRasterBatchStage` enforces the one-way `staged → committed` or `staged → aborted` state
transition and makes repeated terminal calls no-ops.

## 4. Keep cold preparation in `prepare`

`prepare` may remain asynchronous for missing font data, decoded pages, or other genuinely cold resources. Resident work
should finish synchronously so `Text.setProperties()` can stage it without an `await`. `Text` publishes that prepared
generation from `updateMatrixWorld()` or `updateWorldMatrix()` before raster-child traversal.

Application render loops should therefore update ordinary `Text` properties and let the Three.js lifecycle publish them.
Do not add a per-frame `await text.ready`; reserve `ready` or React Suspense for cold readiness, causal test observation,
and error reporting.

## 5. Prove both retained and replacement paths

Before publishing the migrated plugin, cover:

- initial creation and empty output;
- same-capacity replacement of every per-glyph field;
- shrink and exact-capacity growth with authoritative draw counts;
- capacity overflow and incompatible resource or page topology;
- successful commit, abort, staging failure, and stale-generation recovery;
- repeated commit, abort, batch disposal, and resource disposal;
- absence of private `@pmndrs/text` imports or a first-party raster-kind switch.

The workspace proof exercises these cases with:

```sh
mise exec -- pnpm --filter @pmndrs/text-glyph-debug-raster test
mise exec -- pnpm benchmarks:test:external-raster-proof
```

The first command proves the portable transaction and package ownership. The second renders the external raster through
the benchmark's public consumer path and verifies retained update, overflow, abort, and disposal behavior in the browser.
