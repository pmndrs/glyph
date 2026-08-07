---
type: Integration Fitness Plan
title: External gpucat integration fitness plan
description: Validates the target v1 public core against gpucat and defines the remaining external-package, lifecycle, ordering, resource, and shader-reuse proof.
documentation_type: explanation
tags: [planning, api, gpucat, webgpu, external-package, shaders, batching]
status: draft
sources:
  - id: gpucat
    resource: https://github.com/isaac-mason/gpucat/tree/11cf91b5172cc5143f68ff6ebf01c5e815de4e94
    title: gpucat at the reviewed revision
  - id: gpucat-object3d
    resource: https://github.com/isaac-mason/gpucat/blob/11cf91b5172cc5143f68ff6ebf01c5e815de4e94/src/core/object3d.ts
    title: gpucat Object3D lifecycle
  - id: gpucat-buffer
    resource: https://github.com/isaac-mason/gpucat/blob/11cf91b5172cc5143f68ff6ebf01c5e815de4e94/src/core/gpu-buffer.ts
    title: gpucat typed GPU buffer and update ranges
  - id: gpucat-mesh
    resource: https://github.com/isaac-mason/gpucat/blob/11cf91b5172cc5143f68ff6ebf01c5e815de4e94/src/objects/mesh.ts
    title: gpucat mesh and multi-draw contract
  - id: gpucat-render-list
    resource: https://github.com/isaac-mason/gpucat/blob/11cf91b5172cc5143f68ff6ebf01c5e815de4e94/src/renderer/core/render-list.ts
    title: gpucat render-list ordering
  - id: core-api
    resource: core-api.md
    title: Target v1 core API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Target v1 engine integration contract
  - id: raster-technique
    resource: raster-technique-api.md
    title: Target v1 raster technique boundary
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-07T03:25:58Z'
---

# External gpucat integration fitness plan

## Verdict

The reviewed gpucat public surface can consume the target v1 core without a core API change. That conclusion is based on
source inspection and a successful gpucat build at commit `11cf91b`; it is not yet a rendered-text proof.[^gpucat]

The remaining uncertainty is narrower: gpucat can author its own Bitmap, MTSDF, and Slug nodes, but the current review does
not prove that the canonical Slug GPU algorithm can be shared with TypeGPU and Three without a gpucat-specific translation.
That belongs to the raster shader package and adapter proof, not core shaping, layout, batching, or variants.

| Boundary                                | Result                   | Evidence or remaining gate                                                                                                                                                                          |
| --------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public core revisions and attachments   | Fits                     | `ParagraphBatchTarget.stage()` receives complete batches, runs, storage, bindings, and dirty ranges.                                                                                                |
| Instance buffers and partial uploads    | Fits                     | `GpuBuffer` owns a typed CPU array and `addUpdateRange(start, count)` queues component ranges for renderer upload.[^gpucat-buffer]                                                                  |
| Bitmap/MTSDF texture realization        | Fits                     | gpucat publicly exports array/data texture resources and partial texture updates.                                                                                                                   |
| Slug curve/header/reference storage     | Fits                     | gpucat storage buffers and typed node access can represent the technique bindings.                                                                                                                  |
| Many physical draws per paragraph batch | Fits                     | A `Mesh` can carry ordered instanced `draws`; incompatible material/pipeline runs can use consecutive meshes.[^gpucat-mesh]                                                                         |
| Paragraph transforms and visibility     | Fits                     | Adapter-owned sidecar buffers can index paragraph transforms without reshaping.                                                                                                                     |
| Scene synchronization                   | Fits with adapter policy | gpucat applications explicitly update world matrices before `render()`; the text group can synchronize before render-list collection.[^gpucat-object3d]                                             |
| Stable cross-mesh ordering              | Conditional              | gpucat currently hard-codes `groupOrder` to zero. Consecutive `Mesh.renderOrder` values preserve internal text order but cannot reserve an interval against unrelated objects.[^gpucat-render-list] |
| Canonical Slug shader reuse             | Not proven               | Prove a shared typed WGSL ABI or generated WGSL artifact through gpucat before accepting the shader-package design; gpucat WebGL also requires a GLSL companion for raw `wgslFn()` code.            |
| Visible Bitmap/MTSDF/Slug parity        | Not proven               | Implement the external proof application and compare output, ordering, updates, and disposal.                                                                                                       |

## Keep the integration outside core

The package boundary is:

```ts
// renderer-neutral API and data contracts
import {
  createTextRuntime,
  type ParagraphBatchTarget,
  type PreparedGlyphBatch,
  type PreparedGlyphRun,
} from '@pmndrs/text';

// gpucat-native retained objects and GPU realization
import { GpucatText, GpucatTextGroup } from '@pmndrs/text-gpucat';
```

`@pmndrs/text-gpucat` may live in another repository. It must compile using only documented package exports and a gpucat
peer dependency. It must not import `@pmndrs/text/src/*`, workspace-relative source, or an engine-specific core subpath.

The same rule applies to the target v1 integrations:

```txt
@pmndrs/text          core, loading, shaping, layout, paragraph batches, target protocol
@pmndrs/text-three    Three.js integration
@pmndrs/text-r3f      React Three Fiber integration over @pmndrs/text-three
@pmndrs/text-typegpu  TypeGPU programs and direct engine
@pmndrs/text-gpucat   gpucat objects, resources, programs, and target
```

These package names make dependency direction mechanically visible. Repository location is an ownership choice; package
independence is the contract. A monorepo workspace integration still needs a packed-package test that installs public
tarballs into an isolated fixture so workspace path aliases cannot hide a private import.

## Map a core batch onto gpucat

One gpucat text group owns one core paragraph batch, one attachment, and one or more hidden meshes:

```ts
class GpucatParagraphBatchTarget implements ParagraphBatchTarget<
  typeof technique,
  GpucatVariant,
  GpucatTargetRevision
> {
  readonly technique = technique;

  stage(previous, next) {
    const buffers = stageBuffers(previous, next.glyphBatches);
    const resources = stageFontResources(next.glyphBatches);
    const draws = program.compileRuns(next.glyphRuns, next.glyphBatches);
    const meshes = stageOrderedMeshes(draws, buffers, resources);

    return readyStage(next.revision, { buffers, resources, meshes });
  }
}
```

The helper names above are adapter implementation work, not proposed core methods. Their inputs already exist on the public
target contract:

```ts
function stageBuffers(previous, nextBatches) {
  for (const batch of nextBatches) {
    const buffer = getOrCreateGpuBuffer(batch.key, batch.storage);
    copyCanonicalRanges(buffer.array, batch.storage, rangesFor(previous, batch));

    for (const range of rangesFor(previous, batch)) {
      buffer.addUpdateRange(toComponentOffset(range), toComponentCount(range));
    }
  }
}
```

The target copies core's canonical CPU storage into gpucat-owned typed arrays during `stage()`. Core remains the batching
authority; gpucat does not re-sort source text, resolve fallback again, or repartition glyphs by font resource. The adapter
may change the physical buffer layout and compile one ordered core run into one or several compatible engine draws.

## Synchronize before render-list collection

Gpucat does not own an application RAF. Its examples update the scene tree and then render:

```ts
score.text = 'Score 2';

scene.updateWorldMatrix();
renderer.render(scene, camera);
```

`GpucatTextGroup.updateWorldMatrix()` can perform the retained coordination before delegating ordinary traversal:

```ts
override updateWorldMatrix(): void {
  this.reconcileMembership();
  this.runtime.update(); // allocation-free no-op when no paragraph is dirty
  this.commitReadyTargetRevision();

  super.updateWorldMatrix();
  this.writeChangedParagraphTransforms();
}
```

This is gpucat adapter behavior, not a new core lifecycle. The first matrix update after adding text creates hidden meshes
before `renderer.render()` collects its render list, so the text does not intentionally lag a frame. Applications that do
not use scene matrix traversal can call an explicit integration-level `textEngine.update()` before rendering; both paths
invoke the same dirty/revision guard.

A node-level `onBeforeRender` callback is too late for membership publication because gpucat has already collected the
render list before it evaluates shader nodes. The integration must not depend on that callback to add first-frame meshes.

## Preserve transforms and draw order

Core glyph origins remain paragraph-local. The integration writes one paragraph transform index into each glyph instance
and keeps matrices in an adapter-owned sidecar buffer:

```ts
paragraph matrixWorld
  -> transform sidecar slot
  -> glyph instance transformIndex
  -> gpucat vertex program
```

A matrix, visibility, or effect-parameter change updates only its sidecar range. It does not call the shaper. A text or
content-box change dirties the core paragraph and is synchronized through `TextRuntime.update*()`.

Gpucat sorts render items by `groupOrder`, `renderOrder`, depth, and stable identity, but its current traversal supplies
`groupOrder = 0` for every mesh. One integration paragraph batch can assign consecutive `renderOrder` values:

```ts
for (const [index, mesh] of orderedMeshes.entries()) {
  mesh.renderOrder = textGroup.renderOrder + index;
}
```

This preserves order among the hidden meshes, but it does not reserve the numeric interval: an unrelated object may choose
the same or an intermediate value and interleave. The integration must document that limitation, expose distinct render
phases, collapse the batch into one aggregate render item that performs its internal ordered draws, or prove an
engine-level ordering allocator before claiming atomic group ordering. The default may not describe consecutive values as
an atomic `TextGroup`. Compatible adjacent runs may
become several entries in one `Mesh.draws`. A different material, pipeline, transparency
class, or pass becomes another hidden `Mesh`. The program must preserve `PreparedGlyphRun` order across both forms. If an
application needs unrelated engine draws between text draws, it creates separate text groups/render phases; core does not
guess that scene-composition boundary.

## Prove shader reuse separately

No user should rewrite Slug to add a gradient. The portable Slug technique must remain independent of every engine, while a
shader package exposes the canonical evaluation algorithm plus a typed resource/input/output ABI.

Gpucat publicly exposes a typed node language and `wgslFn()`, so two implementation candidates are plausible:

1. Publish one technique-owned WGSL kernel and typed ABI that TypeGPU, gpucat, and raw WebGPU programs wrap.
2. Author the kernel in TypeGPU and publish a deterministic generated WGSL artifact plus ABI that gpucat wraps. For
   gpucat's WebGL backend, the wrapper must also supply and verify the required GLSL companion; otherwise the integration is
   explicitly WebGPU-only.

Neither candidate is accepted by source inspection alone. The proof must compile the real Slug loops and bindings, inspect
the emitted WGSL, render the same glyph corpus, compare output against the Three/TSL and TypeGPU paths, and measure added
runtime/build cost. If both candidates fail, a gpucat-native Slug shader is allowed, but that outcome still does not justify
adding gpucat or TypeGPU types to core.

Core `renderVariant` remains sufficient for effects. A gpucat program may encode many variants in one material and draw, or
split runs where its pipeline compatibility requires it. Variant data changes can update adapter sidecars without
reshaping; variant topology changes only rebuild the ordered run plan.

## Acceptance gate

The final external fitness fixture must:

- install packed public `@pmndrs/text` and technique packages, plus gpucat pinned to the reviewed commit or later accepted
  release;
- reject every private/deep `@pmndrs/text` import through a package-boundary test;
- render one multiline paragraph, many labels, and an icon grid through Bitmap, MTSDF, and Slug;
- prove font fallback, span variants, fixed-capacity overflow/recovery, dirty-range updates, transforms, visibility, and
  text-group ordering;
- move retained text between groups without transferring stale paragraph, buffer, texture, or renderer ownership;
- exercise synchronous and asynchronous updates without an intentional one-frame delay;
- dispose text, groups, font resources, and the renderer in every valid order without missing glyphs, use-after-dispose, or
  leaked GPU resources;
- prove the selected canonical shader-sharing path, or explicitly record a gpucat-native shader as the only failed fitness
  dimension;
- require no change to `@pmndrs/text` core APIs while the fixture is implemented.

The core API fitness test passes only when that last condition is true in executable code. This review establishes that the
required public surfaces exist in the design; it does not substitute for the application proof.

[^gpucat]: Reviewed at commit `11cf91b5172cc5143f68ff6ebf01c5e815de4e94`. The repository build passed. A full re-run on 2026-08-06 passed 256 of 260 tests. One failure directly exposed process-global generated-symbol instability (`storage183` versus `storage226`); three golden snapshots expected pre-flip-Y shader output. These are upstream checkout/test-state evidence, not text-integration evidence, and no gpucat integration claim relies on the suite being green.

[^gpucat-buffer]: gpucat update ranges use flat component offsets and counts; the adapter must convert core glyph ranges through the concrete buffer schema instead of assuming byte offsets.

[^gpucat-mesh]: `Mesh.draws` supports several indexed or non-indexed instanced draws over one compatible geometry/material pair.

[^gpucat-object3d]: gpucat's `Object3D.updateWorldMatrix()` is recursive and overridable; reviewed examples call scene matrix update explicitly before render.

[^gpucat-render-list]: The reviewed render-list traversal passes zero as `groupOrder`, then sorts on each mesh's `renderOrder`, depth, and stable object identity.
