---
type: How-to guide
title: Build a raster and baker plugin
description: Shows package authors how to add an external raster runtime, baker, artifact, optional runtime fallback, discovery metadata, and lifecycle tests through public pmndrs/text APIs.
tags: [raster, baker, plugins, transactions, threejs]
sources:
  - id: 'public-raster-contract'
    resource: '../../packages/text/src/raster.ts'
    title: 'Public raster runtime contract'
  - id: 'public-baker-contract'
    resource: '../../packages/text/src/bake.ts'
    title: 'Public raster baker contract'
  - id: 'plugin-manifest'
    resource: '../../packages/glyph-example-raster/package.json'
    title: 'External plugin manifest and discovery mapping'
  - id: 'plugin-contract'
    resource: '../../packages/glyph-example-raster/src/contract.ts'
    title: 'External plugin identity and descriptor'
  - id: 'plugin-artifact'
    resource: '../../packages/glyph-example-raster/src/artifact.ts'
    title: 'External plugin artifact generator'
  - id: 'plugin-baker'
    resource: '../../packages/glyph-example-raster/src/baker.ts'
    title: 'External plugin Node baker'
  - id: 'plugin-runtime'
    resource: '../../packages/glyph-example-raster/src/raster.ts'
    title: 'External plugin raster runtime'
  - id: 'plugin-runtime-baker'
    resource: '../../packages/glyph-example-raster/src/runtime-baker.ts'
    title: 'External plugin runtime baker'
  - id: 'plugin-tests'
    resource: '../../packages/glyph-example-raster/tests/glyph-example.test.ts'
    title: 'External plugin lifecycle tests'
  - id: 'plugin-browser-proof'
    resource: '../../apps/benchmarks/src/benchmark/targets/product/external-raster-proof.ts'
    title: 'External plugin browser proof'

generated:
  by: 'openai-codex/gpt-5.6'
  at: '2026-08-04T12:55:07Z'
---

# Build a raster and baker plugin

Use this guide to create an ESM package that adds a raster technique to `pmndrs/text` without changing or importing its
internals. The finished package will own:

- one literal raster kind, extension name, format version, options type, and canonical descriptor;
- a package-owned companion artifact and baker;
- a runtime decoder and renderer adapter;
- an optional runtime-bake entry loaded only when source fallback is required;
- retained-update, abort, overflow, and disposal tests.

The exact interfaces remain authoritative in the [API reference](api-shapes.md#raster-module-boundary). The private
[`@pmndrs/text-glyph-example-raster`](../../packages/glyph-example-raster) workspace package is a complete external proof using
only published entry points.

## 1. Create separate runtime and baker entry points

Keep the browser runtime at the package root and the Node baker in its own export. The root must not statically import the
baker or its generation dependencies.

```json
{
  "name": "@example/text-raster",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./baker": {
      "types": "./dist/baker.d.ts",
      "import": "./dist/baker.js"
    }
  },
  "pmndrs": {
    "text": {
      "exampleRaster": "./baker"
    }
  },
  "peerDependencies": {
    "@pmndrs/text": "^1.0.0",
    "three": ">=0.185.1 <0.186"
  }
}
```

The `pmndrs.text` key is the runtime factory export name. Its value is the package export containing the default baker.
Static project discovery can then connect `exampleRaster(...)` in a `defineFont(...)` call to this baker without executing
application modules. Omit the `three` peer when the plugin targets a different adapter and does not publish a Three.js draw
object.

## 2. Define one shared identity and descriptor

Put the values shared by runtime and baker in a dependency-light contract module:

```ts
import type { JsonValue } from '@pmndrs/text';

export const EXAMPLE_KIND = 'exampleRaster' as const;
export const EXAMPLE_EXTENSION = 'VENDOR_text_example_raster' as const;
export const EXAMPLE_FORMAT_VERSION = 0 as const;
export const EXAMPLE_GENERATOR_VERSION = '1.0.0' as const;

export interface ExampleOptions {
  readonly quality?: number;
}

export interface ExampleDescriptor {
  readonly [key: string]: JsonValue;
  readonly generatorVersion: typeof EXAMPLE_GENERATOR_VERSION;
  readonly quality: number;
}

export function exampleDescriptor(options: ExampleOptions = {}): ExampleDescriptor {
  const quality = options.quality ?? 1;
  if (!Number.isSafeInteger(quality) || quality < 1 || quality > 4) {
    throw new RangeError('example raster quality must be an integer in 1..4');
  }
  return { generatorVersion: EXAMPLE_GENERATOR_VERSION, quality };
}
```

Descriptor normalization must be deterministic. The descriptor participates in the raster key, so semantically equal
options must produce the same JSON value and unsupported values must fail before baking or loading.

## 3. Generate a package-owned companion artifact

Implement one artifact function accepting `RasterBakeRequest<Descriptor>` and returning
`RasterBakeArtifact<Kind>`. It owns the extension JSON, binary records, optional page artifacts, hashes, and payload report.

```ts
import type { RasterBakeArtifact, RasterBakeRequest } from '@pmndrs/text';

export async function bakeExampleArtifact(
  request: RasterBakeRequest<ExampleDescriptor>,
): Promise<RasterBakeArtifact<typeof EXAMPLE_KIND>> {
  request.signal?.throwIfAborted();
  const generated = await generateRecords(request.font, request.descriptor, request.signal);
  const companion = await encodeCompanionGlb({
    rasterKey: request.rasterKey,
    shapingHash: request.font.shapingHash,
    glyphCount: request.font.glyphCount,
    descriptor: request.descriptor,
    packaging: request.packaging,
    generated,
  });
  request.signal?.throwIfAborted();
  return companion;
}
```

The returned artifact must satisfy these boundaries:

- `kind`, extension name, format version, raster key, shaping hash, and glyph count agree everywhere;
- the companion uses the `raster` role and independently delivered payloads use `raster-page`;
- every artifact has deterministic bytes, ID, and SHA-256;
- the payload report states exact serialized, metadata, page, and decoded GPU bytes;
- embedded and external packaging preserve the same semantic extension data;
- external resources declare URI, byte length, and hash;
- abort is checked before expensive work, after awaited work, and before publication.

A standalone companion is still an ordinary valid GLB. If the Node composer must embed it into the core font artifact,
integer extension fields referencing glTF buffer views must be named `bufferView` or end in `BufferView` so the generic host
can range-check and rebase them without understanding the plugin schema.

## 4. Export the Node baker

Use `defineRasterBaker` to bind options, descriptor, identity, and generation while preserving their exact types:

```ts
import { defineRasterBaker } from '@pmndrs/text';

const exampleBaker = defineRasterBaker({
  kind: EXAMPLE_KIND,
  extension: EXAMPLE_EXTENSION,
  version: EXAMPLE_FORMAT_VERSION,
  descriptor: exampleDescriptor,
  bake: bakeExampleArtifact,
});

export default exampleBaker;
```

Keep this default export at the `./baker` path declared in the manifest. The literal baker kind must equal the runtime
factory export name used by static discovery.

## 5. Implement the raster runtime

Use `defineRaster` for decoding, cold preparation, transactional batch staging, paint validation, and resource disposal:

```ts
import { defineRaster, defineRasterBatchStage, type RasterObjectDrawBatch } from '@pmndrs/text';
import type { Group } from 'three/webgpu';

interface ExampleBatch extends RasterObjectDrawBatch<Group> {
  readonly capacity: number;
  readonly glyphCount: number;
}

export const exampleRasterModule = defineRaster({
  kind: EXAMPLE_KIND,
  extension: EXAMPLE_EXTENSION,
  version: EXAMPLE_FORMAT_VERSION,
  runtimeBaker: () => import('./runtime-baker.js'),
  descriptor: exampleDescriptor,
  async decode(font, raster, signal) {
    signal?.throwIfAborted();
    return decodeAndValidateResource(font, raster, signal);
  },
  prepare(layout, resource, fontSlot, signal) {
    return prepareRequiredPages(layout, resource, fontSlot, signal);
  },
  stageBatch(previous, layout, resource, fontSlot, paint, rasterPixelRatio) {
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
  validatePaint: validateExamplePaint,
  dispose: disposeExampleResource,
});

export function exampleRaster(options: ExampleOptions = {}) {
  return { module: exampleRasterModule, options } as const;
}
```

`decode` must treat the artifact as untrusted: validate extension identity, descriptor, record sizes, buffer ranges, hashes,
formats, device limits, and GPU budgets before allocation. `prepare` owns genuinely cold page readiness. Once dependencies
are resident, `stageBatch` should complete synchronously.

Staging may retain `previous` or create a replacement, but it must not mutate committed buffers, draw counts, scene
children, or ownership before `commit()`. Perform every fallible operation while staging; make commit synchronous and
infallible; make abort, batch disposal, and resource disposal idempotent. A retained implementation may own capacity slack
and dirty-range coalescing privately. Those policies are not public API.

For Three.js, publish `RasterObjectDrawBatch<Object3D>` so `Text` can attach the object while the portable
`RasterDrawBatch` contract remains renderer-neutral. Implement `setRenderOrderBase(base)` by assigning
`base + rasterLocalOrder` to every drawable, including after retained commits. Use `new Object3D()` as a neutral batch
container, not `new Group()`. `Text` is also a composite `Object3D`, so a caller-owned parent Group remains Three.js's primary
`groupOrder`; `Text.renderOrder` and the raster-local offset form each drawable's secondary order. A nested batch Group would
replace the inherited group order with its own default zero and is rejected by the `Text` adapter. Another renderer adapter
may use a different batch type without adding that renderer to core.

## 6. Add optional runtime baking without growing the normal runtime

The runtime module reaches its generator only through the literal dynamic import in `runtimeBaker`. Export a default
`RuntimeRasterBakerModule` from `runtime-baker.ts` and reuse the same artifact generator:

```ts
import type { RuntimeRasterBakerModule } from '@pmndrs/text';

const runtimeBaker: RuntimeRasterBakerModule<typeof EXAMPLE_KIND, ExampleOptions | undefined> = {
  kind: EXAMPLE_KIND,
  bake(request) {
    return bakeExampleArtifact({
      font: {
        source: request.source,
        fontFaceIndex: request.fontFaceIndex,
        glyphCount: request.font.glyphCount,
        shapingHash: request.font.shapingHash,
      },
      rasterKey: request.rasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor: exampleDescriptor(request.options),
      signal: request.signal,
      onProgress: request.onProgress,
    });
  },
};

export default runtimeBaker;
```

The runtime-bake host loads this module in its selected module Worker. Keep Node-only modules, validators, profiling, and
unselected generators outside the browser runtime graph. If the plugin does not support runtime generation, omit
`runtimeBaker`; a missing compatible artifact will then reject instead of silently choosing another raster.

## 7. Bake and consume the plugin

For an explicit Node bake, pass the typed baker to the public host:

```ts
import { rasterBake } from '@pmndrs/text';
import { bakeFont } from '@pmndrs/text/bake';
import exampleBaker from '@example/text-raster/baker';

await bakeFont({
  input: new URL('./Inter-Regular.ttf', import.meta.url),
  output: new URL('./Inter.font.glb', import.meta.url),
  font: { fontFaceIndex: 0 },
  rasters: [
    rasterBake(exampleBaker, {
      packaging: { artifact: 'embedded', pages: 'embedded' },
      options: { quality: 2 },
    }),
  ],
});
```

At runtime, use the package factory like a first-party raster:

```ts
import { FontRegistry, Text } from '@pmndrs/text';
import { exampleRaster } from '@example/text-raster';

const registry = new FontRegistry();
const font = await registry.load('/fonts/Inter.font.glb');
const text = new Text({
  text: 'External raster',
  font,
  raster: exampleRaster({ quality: 2 }),
  fontSize: 48,
});

await text.ready; // Cold font, shaper, artifact, and resource readiness only.
scene.add(text);
```

Resident text, layout, and paint changes use `text.setProperties(...)` and publish during ordinary Three.js
`updateMatrixWorld()` or `updateWorldMatrix()` traversal. Do not add a per-frame `await text.ready`.

## 8. Prove the extension boundary

Test the plugin at three layers:

1. Artifact tests prove deterministic embedded/external bytes, hashes, identity, report accounting, semantic validation,
   malformed-input rejection, and cancellation.
2. Runtime tests prove initial creation, same-capacity replacement of every glyph field, shrink, exact-capacity growth,
   overflow or topology replacement, commit, abort, staging failure, stale-generation recovery, and repeated disposal.
3. A real browser target proves public loading, shaping, layout, renderer attachment, retained updates, visible pixels, and
   cleanup on every supported backend.

Add a package-boundary test that rejects private core paths and first-party raster/baker imports, plus a core search proving
the new kind and extension name require no registration edit or switch.

The workspace proof runs with:

```sh
mise exec -- pnpm --filter @pmndrs/text-glyph-example-raster test
mise exec -- pnpm scripts run benchmark:external-raster
```

Success means the package bakes, packages, authenticates, loads, renders, updates, overflows, aborts, and disposes through
public entry points while the normal runtime graph remains free of its baker.
