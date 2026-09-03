---
type: Explanation
title: Example renderer
description: Explains how the root-only example integration proves GlyphConfig, Codec, CommandBufferView, DisplayList, renderer decoding, and TypeGPU realization without privileged package access.
tags: [glyph-config, codec, integration, typegpu, renderer, proof]
sources:
  - id: integration-api
    resource: core-api.md
    title: Glyph integration API
  - id: renderer-guide
    resource: ../guides/renderer-integration.md
    title: Renderer integration guide
  - id: example-config
    resource: ../../../packages/glyph-example-renderer/src/config.ts
    title: Example GlyphConfig
  - id: example-text
    resource: ../../../packages/glyph-example-renderer/src/engine.ts
    title: Example retained Text
  - id: example-device
    resource: ../../../packages/glyph-example-renderer/src/device.ts
    title: Recording renderer decoder
  - id: example-webgpu
    resource: ../../../packages/glyph-example-renderer/src/webgpu-device.ts
    title: TypeGPU and WebGPU realization
  - id: boundary-test
    resource: ../../../packages/glyph-example-renderer/tests/package-boundary.test.ts
    title: Public package-boundary test
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-02T00:00:00Z'
---

# Example renderer

`packages/glyph-example-renderer` is the standing proof that a non-Three integration can be implemented through the same
root `@pmndrs/glyph` API every integrator receives. Its production code may import the root package, its portable raster
package, and the raster's explicit `/typegpu` shader subpath. It may not import package internals, generated readers, or
Three.

This is stronger evidence than a design claim: the boundary test fails if an implementation reaches around the public
contract, and package type-checking proves its inferred config, handle, schema bindings, Text controller, and renderer
view agree.

## What the package proves

The package supplies a complete `GlyphConfig`:

- `schema` turns trusted meanings into stable renderer-owned objects and selects `drawRoot`;
- `encode` creates the Codec descriptor that defines packed buffers, capabilities, batching, transforms, and order;
- `resolve` returns exactly-once leases over portable raster resources;
- `renderer` creates one root-scoped `GlyphRenderer` whose `decode(view)` stages accepted host state;
- `root` creates the adapter's anonymous and named roots through constrained root services; and
- required custom-format `fonts` and optional `commands` remain config data rather than extra runtime owners.

`glyph.handle(name, config)` owns the internal engine wiring. The example never constructs or receives those internals.
The returned handle fronts one anonymous root, while `handle(name)` selects an idempotent terminal sibling root.

## Codec to renderer flow

One semantic publication follows this path:

```text
ExampleText desired state
  → top-level glyph.shape()
  → Rust emits Codec-defined packed command data
  → Glyph internally projects trusted data and resolves resources
  → CommandBufferView<ExampleBindings>
      updates: resources · buffers · patches · retirements
      displayList: unchanged | ordered replacement DisplayList
  → RecordingExampleRendererDevice.decode(view)
  → result + commit/discard
  → retained ExampleDrawList
  → host renderer submission
```

The borrowed `CommandBufferView`, its sequences, and patch payloads are valid only during synchronous `decode()`. The
recording device copies the scalar draw contract and retains schema-produced binding objects. It does not retain the view
or reconstruct numeric ID maps.

The ordered `DisplayList.children` sequence already interleaves batches and root instances. Each instance span identifies
one glyph, decoration, inline object, clip, or Codec-defined record range. Ordering and batching remain Codec concerns;
the renderer consumes the hierarchy it receives.

## Transaction evidence

The recording device applies update phases to candidate maps, realizes candidate draws, and returns a pending result.
Only `commit()` replaces accepted resources, buffers, and draws. `discard()` makes the candidate inert. Tests inject a
decode failure and prove the prior accepted state remains live, candidate resources are released, and a later publication
can succeed.

An idle publication returns `changed: false` and retains existing draws. Semantic Text updates produce a replacement or
patches. The example's transform synchronization is intentionally a no-op; Three remains the live proof that matrix-only
changes use `syncTransforms()` without shaping.

## TypeGPU and WebGPU evidence

`TypeGpuExampleRendererDevice` wraps a caller-owned `GPUDevice` with TypeGPU 0.12. It creates:

- typed vertex layouts for supplied geometry and instance lanes;
- GPU vertex and index buffers;
- a viewport uniform and bind group;
- an RGBA offscreen texture and render view; and
- a render pipeline using shaders from `@pmndrs/glyph-example-raster/typegpu`.

For each accepted draw it binds position, UV, origin, size, and color inputs, then records an indexed instanced draw. Pixel
readback proves nonempty output and semantic updates prove changing output.

The concrete device currently submits its offscreen pass during transactional commit. That is an acceptance proof, not
the final general host boundary. A reusable integration should retain committed host objects and let the caller's host
renderer later traverse or submit them into its canvas, `GPUCanvasContext`, render pass, shadows, targets, and
post-processing graph. No such caller-pass method is implemented in the example yet.

## Font ownership

The acceptance path declares and loads a typed `glyph.fontFace()` selection and passes that selection to
`handle.createText()`. The config declares its exact `fonts` map and default. Root construction receives `context.fonts` for
synchronous readiness, stable loading promises, independent Font acquisition, and borrowed lookup. Text owns its acquired
Font lease and releases it with its controller.

## Rules

- Import integration contracts from `@pmndrs/glyph`, never a removed `/core` entry or private file.
- Import shader implementations only from an explicit technique shader subpath.
- Keep the package independent of Three and R3F.
- Let `glyph.handle()` own internal engine installation and root publication plumbing.
- Treat `CommandBufferView` as borrowed synchronous data.
- Decode transactionally and preserve the previous accepted state on failure.
- Keep physical device, canvas, context, render-pass, and submission ownership in the host integration.
- Make a missing public capability fail visibly rather than adding a private import or corrective cast.

## Superseded history

Earlier revisions used this package to justify a public `/core` surface exposing engine construction, binding owners,
planning objects, target callbacks, raw borrowed plan views, and an asynchronous-copy branch. D-306 and D-308 superseded
that architecture. The proof's purpose remains the same—keep third-party integration honest—but the enforced boundary is
now smaller: root `GlyphConfig`, Codec/encode, internal trusted projection, borrowed `CommandBufferView`/`DisplayList`,
`GlyphRenderer.decode`, handles, and roots.
