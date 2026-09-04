---
type: API Specification
title: Glyph integration API
description: Current root application vocabulary and renderer-neutral GlyphConfig, Codec, command-view, root, and renderer contracts.
documentation_type: reference
tags: [api, fonts, shaping, paragraphs, layout, rendering, ownership]
status: stable
sources:
  - id: decision-register
    resource: decision-register.md
    title: Accepted architectural decisions
  - id: root-entry
    resource: ../../../packages/glyph/src/index.ts
    title: Public root entry point
  - id: glyph-runtime
    resource: ../../../packages/glyph/src/glyph.ts
    title: Root Glyph runtime and handle registry
  - id: glyph-config
    resource: ../../../packages/glyph/src/config/glyph.ts
    title: GlyphConfig and renderer contracts
  - id: configured-handle
    resource: ../../../packages/glyph/src/internal/configured-handle.ts
    title: Internal configured-handle ownership
  - id: example-config
    resource: ../../../packages/glyph-example-renderer/src/config.ts
    title: Public config-leaf example integration
  - id: guide
    resource: ../guides/renderer-integration.md
    title: Renderer integration guide
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-04T00:13:53Z'
---

# Glyph integration API

Applications import the values and types they encounter from `@pmndrs/glyph`. Integration authors import the
renderer-neutral construction helpers from explicit `@pmndrs/glyph/config/*` leaves. The former
public `/core` engine-driving surface was removed by D-308 and commit `1990ebf3d`; its low-level ownership model is now an
implementation detail. This file retains its canonical path for existing documentation links, but specifies only the
current root API.

Three and React are integrations over the same public contract available to third parties. Canvas, scene, GPU device,
material, pipeline, and render pass remain renderer-owned.

## Glyph runtime and handles

```ts
import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';

await glyph.init();
const three = glyph.handle('three:main', ThreeConfig);
const hud = three('hud');
```

Successful `glyph.init()` calls share one settled promise. `glyph.handle(name, config)` requires a unique, nonempty live
name and infers the returned handle from the config. Disposing a handle releases that name.

Every handle owns one anonymous root and fronts its API directly. Calling the handle with a nonempty name returns one
idempotent live sibling root. Named roots are terminal and cannot create deeper roots. Text and TextGroup construction is
therefore always attached to a root.

## GlyphConfig

`defineGlyphConfig()` preserves the relationship among schema bindings, Codec, portable resources, renderer result,
boundary, root extension, and font formats.

| Field      | Required | Contract                                                                                |
| ---------- | -------- | --------------------------------------------------------------------------------------- |
| `schema`   | yes      | Binds trusted meanings to renderer-owned objects within the root boundary.              |
| `fonts`    | no       | Declares handle-relative raster-format keys and the default key.                         |
| `encode`   | yes      | Selects the Codec that defines packed command-buffer data.                              |
| `resolve`  | yes      | Creates or updates leased renderer resources from portable payloads.                    |
| `renderer` | yes      | Creates a root-scoped decoder, transform synchronizer, and disposer.                    |
| `root`     | yes      | Constructs the anonymous or named host root through constrained root services.          |
| `commands` | no       | Overrides measured initial command-buffer and retained-text capacities.                 |

The external example is the canonical minimal configuration:

```ts
import { defineGlyphConfig, resourceLease } from '@pmndrs/glyph/config/glyph';

const config = defineGlyphConfig({
  schema: ExampleSchema,
  encode: ({ ids }) => ({ descriptor: exampleCodecDescriptor(ids) }),
  resolve: ({ format, resourceName, payload }) => {
    if (format !== formatId) throw new TypeError(`unsupported raster format ${format}`);
    return resourceLease(Object.freeze({ name: resourceName, resource: payload }), () => undefined);
  },
  renderer: () => ({
    decode: (view) => device.decode(view),
    syncTransforms: () => undefined,
    dispose: () => device.reset(),
  }),
  root: {
    create(context) {
      const extension = new ExampleRootImplementation(context.services);
      return context.create(extension, { boundary: Object.freeze({ name: context.name }) });
    },
  },
});
```

## Codec and encode

The Codec selected by `GlyphConfig.encode()` describes programs, packed buffer lanes, capabilities, ordering, transform
mode, and allocation mode. Glyph installs it once per handle. Applications and ordinary renderer code never author or
consume the engine's numeric IDs.

Changing record layout, batching, or ordering belongs in the Codec. It is not a renderer decoding hook.

## Schema

The direct `defineGlyphSchema(schema)` helper checks and freezes the callback table while preserving its argument types.
The exported package example names its schema boundary explicitly so isolated declaration emit can describe it; an
application's inline config still infers structurally at `glyph.handle(name, config)`:

```ts
const ExampleSchema: GlyphSchema<ExampleBindings, ExampleRootContext> = defineGlyphSchema({
  program: (_root: ExampleRootContext, program) => Object.freeze({ kind: 'example-program', program }),
  buffer: (_root, input) => Object.freeze({ kind: 'example-buffer', input }),
  material: (_root, material) => material,
  transform: (_root, transform) => transform,
  batch: (_root, input) => Object.freeze({ kind: 'example-batch', input }),
  instance: (_root, input) => Object.freeze({ kind: 'example-instance', input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: 'example-instance-span', input }),
});
```

| Callback       | Result                                                       |
| -------------- | ------------------------------------------------------------ |
| `program`      | Renderer program or pipeline selector.                       |
| `buffer`       | Stable renderer buffer binding.                              |
| `material`     | Renderer material or paint binding.                          |
| `transform`    | Renderer transform binding.                                  |
| `batch`        | Ordered batched draw object.                                 |
| `instance`     | Ordered root instance object.                                |
| `instanceSpan` | Bound glyph, decoration, inline-object, clip, or Codec span. |

The root recipe supplies the renderer-owned publication `boundary` once through `context.create(...)`. Three uses an
`Object3D`; a render graph may use a layer or bucket; a renderer without a scene graph may use a small semantic object.
Every schema callback receives that boundary as its first argument.

## Trusted projection and CommandBufferView

Glyph owns the packed internal command buffer and its trusted reader. It synchronously projects that data through
`schema` and `resolve` into `CommandBufferView<Bindings>`.

The view contains:

- resource acquire/update/retain commands;
- buffer ensure commands;
- byte patches;
- resource, buffer, slot-range, and output-byte retirements; and
- a `DisplayList` phase that is either unchanged or a replacement ordered hierarchy.

The nested `DisplayList.children` sequence interleaves batches and root instances in authoritative engine order. Its
references are already renderer binding objects; renderer code does not rebuild a map from numeric IDs.

The view, its borrowed sequences, and patch payloads expire when `GlyphRenderer.decode()` returns. A renderer retains its
own objects and copied scalar state, not the view.

## GlyphRenderer.decode

`renderer(context)` constructs one renderer per root:

```ts
interface GlyphRenderer<Bindings, Result> {
  decode(view: CommandBufferView<Bindings>): {
    readonly result: Result;
    commit(): void;
    discard(): void;
  };
  syncTransforms(updates: readonly TransformUpdate<Bindings['transform']>[]): void;
  dispose(): void;
}
```

`decode(view)` stages retained host objects and returns a transaction. It does not define packed data, reinterpret trusted
Rust tables, or submit a host frame. `commit()` swaps accepted state only after all fallible staging succeeds;
`discard()` releases candidate-only work. A rejected publication keeps the previous accepted display list.

Instrumentation wraps `renderer` or `renderer.decode`. There is no configurable intermediate decoder.

The host renderer later traverses or submits committed objects. Three's renderer discovers the attached Object3D draw
hierarchy normally. A custom WebGPU integration may expose a host draw method that accepts the caller's render pass or
records into its render graph.

## Resolve and resource leases

`resolve(context)` receives the selected raster format, resource name and kind, portable payload, companion resources,
previous accepted resource, and an abort signal. It returns `ResourceLease<Value>`.

The selected `RasterResourceId` is authoritative: equal IDs mean equal format, schema role, companion set, metadata, and
bytes. A Codec mints a new ID whenever that realization changes. The handle therefore performs keyed retention and
reference counting; it does not deep-compare immutable payload bytes on repeated lookup.

Resolution does not inherently need a canvas, context, scene, or GPU device. A renderer may keep the value portable and
realize it later, or capture a device and create a physical resource when the resource lease is the correct lifetime.
Candidate discard, resource retirement, root disposal, and handle disposal release leases exactly once.

## Root services and Text ownership

`GlyphConfig.root.create(context)` receives only:

- the anonymous or named root label;
- the selected Codec and immutable config;
- optional handle-relative font access;
- constrained services for Text creation, shape, measurement/inspection, transform sync, and detached copies; and
- `context.create(extension, { boundary, defaultRenderer?, dispose? })` to finalize the root.

An adapter Text owns desired state and privately holds a `GlyphTextController`. Complete state snapshots flow through
`controller.update()`. The top-level `glyph.shape()` publishes semantic changes; `services.syncTransforms()` is the
cheap transform-only path. TextGroup remains adapter hierarchy and inheritance inside a root, not a publication boundary.

## Fonts

Immutable `Font<RasterFormat>` values remain the renderer-neutral ownership model. `glyph.fontFace()` is the only
application loading declaration; a configured Text internally acquires an independent immutable Font lease from its
loaded selection. `createFontStack()` creates an ordered immutable fallback selection from loaded Fonts.

When `GlyphConfig.fonts` is present, the handle selects and binds a loaded FontFace raster format for Text. Loading remains
owned by the declaration itself:

```ts
const Inter = glyph.fontFace('/fonts/Inter.font.glb', {
  family: 'Inter',
  format: msdf,
});

await Inter.load();
if (!Inter.isLoaded()) throw new Error('font did not load');
```

Root construction receives synchronous `isLoaded`, promise-returning `load`, independent-lease `acquire`, and borrowed
`peek` access for the exact raster format selected by that handle. Text creation throws for an unloaded selection. React
may suspend on the same stable internal format-load promise.

FontFace data crosses workers or other JavaScript realms only through an explicit snapshot:

```ts
const [serialized, transfer] = await Inter.slug.clone();
worker.postMessage(serialized, { transfer });

// receiving realm
const InterFromWorker = glyph.fontFace(message.data, {
  family: 'Inter',
  format: slug,
});
await InterFromWorker.slug.load();
```

The `SerializedFontFace` contains fresh transferable buffers for the main GLB, the selected external raster sidecars,
and the content-addressed external resources actually resolved by those rasters. Transferring the snapshot does not
detach or invalidate the source FontFace. The receiving declaration claims the supplied buffers and converges them into
its realm-local font graph; it does not transfer live Fonts, renderer resources, handles, or cached Promises.

## Ownership summary

```text
Glyph singleton
└─ configured handle
   ├─ Codec and handle-relative font records
   ├─ anonymous root
   │  ├─ Text / TextGroup desired state
   │  └─ renderer accepted state and resource leases
   └─ named root(s)
      ├─ Text / TextGroup desired state
      └─ renderer accepted state and resource leases
```

Handle disposal cascades roots, controllers, renderer state, Codec state, and handle-relative font records. Renderer
resources may borrow a host GPU device, canvas, context, scene, or render pass, but Glyph never owns those host objects
unless the adapter explicitly makes one part of its root extension and disposes it there.

## Historical note

Earlier revisions of this specification published direct engine construction, binding owners, planning objects, and
synchronous/asynchronous target protocols through `/core`. D-306 and D-308 superseded that design. Those types remain
private implementation machinery where useful, but they are not an integration surface and must not appear in examples,
package exports, or third-party adapters.

For a connected implementation walkthrough, use the [renderer integration guide](../guides/renderer-integration.md).
