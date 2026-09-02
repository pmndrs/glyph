---
type: Workspace Package
title: '@pmndrs/glyph-example-renderer'
description: Proves the published core engine surface through a real TypeGPU/WebGPU backend without Three.js.
resource: ../../packages/glyph-example-renderer
workspace_package: '@pmndrs/glyph-example-renderer'
documentation_type: reference
source_digest: 'sha256:02d97556ef9c32a9e8c24d2a4658a60944fc4042cd8d4185ec8f031d8f992dc4'
tags: [package, core, engine, integration-proof, typegpu]
sources:
  - id: manifest
    resource: ../../packages/glyph-example-renderer/package.json
    title: Package manifest
  - id: engine-driver
    resource: ../../packages/glyph-example-renderer/src/engine.ts
    title: Retention-protocol frame driver
  - id: glyph-config
    resource: ../../packages/glyph-example-renderer/src/config.ts
    title: Example GlyphConfig and named handle
  - id: command-binder
    resource: ../../packages/glyph-example-renderer/src/command-buffer.ts
    title: Example bound command-buffer binder
  - id: policy
    resource: ../../packages/glyph-example-renderer/src/policy.ts
    title: Backend-authored system lanes and render policy
  - id: draw-list
    resource: ../../packages/glyph-example-renderer/src/draw-list.ts
    title: Device-neutral draw list owned by the backend
  - id: device
    resource: ../../packages/glyph-example-renderer/src/device.ts
    title: Deterministic renderer validation oracle
  - id: webgpu-device
    resource: ../../packages/glyph-example-renderer/src/webgpu-device.ts
    title: Concrete TypeGPU/WebGPU renderer device
  - id: build-script
    resource: ../../packages/glyph-example-renderer/scripts/build.mjs
    title: TypeGPU metadata build
  - id: boundary-tests
    resource: ../../packages/glyph-example-renderer/tests/package-boundary.test.ts
    title: Published-entry-point boundary proof
  - id: retention-tests
    resource: ../../packages/glyph-example-renderer/tests/example-engine.test.ts
    title: Retention protocol and capacity-growth proof
  - id: acceptance-tests
    resource: ../../packages/glyph-example-renderer/tests/example-render.test.ts
    title: Real font, resource, geometry, and non-empty draw acceptance
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-28T20:20:47Z'
---

# Package reference: `@pmndrs/glyph-example-renderer`

Status: Active external-engine proof. It drives a real immutable font through the public planner and render-plan contract,
portable raster registration, resource realization, and concrete TypeGPU/WebGPU submission without Three.js.

The package is a standing consumer proof. Source imports only published root assets, `/core`, and the example raster's
public main and `/typegpu` subpaths—never `internal/`, `generated/`, `/three`, or Three itself. Its policy supplies its own
system lane, semantic capability set, allocation mode, transform mode, and program namespace while reusing the technique's
portable policy body. Capability wire IDs are automatic; stable author-owned identities are branded numeric hashes.
The package root exposes a custom `source` condition for opted-in workspace tools; default consumers still resolve its
built ESM and declarations.

The ordinary proof begins with `await glyph.init()` and `glyph.handle(name, defineExampleConfig(device))`. Its
`GlyphConfig` uses the shared default decoder, resolves portable resources into counted object bindings, and gives
phase-structured bound frames to a configured renderer. The same config can be spread or wrapped to instrument encode,
decode, resolve, preparation, transform synchronization, and disposal. Two handle publications prove this path without
exposing plan IDs to the config renderer.

`ExampleCommandBufferBinder` is independent from Three and deliberately thin: it delegates to the renderer-neutral core
`createEngine({ config, codec, root })` helper. Core therefore owns admitted-plan projection, stable opaque identity,
resource acquisition/settlement, default decoding, and borrowed-frame expiry once for every integration. The config
schema binds programs, buffers, materials, transforms, batches, root instances, and instance spans to example-owned
object types. Numeric wire IDs and raw plan tables never reach the configured renderer.

The package's internal `ExampleTextEngine` is only the handle implementation behind `defineExampleConfig()`; it is not
exported from the package entry point and is not an alternative application API. It receives the root engine from the
handle factory, creates one backend and synchronous `RenderPlanner`, and exposes binding, retained text, and publication
operations only through `ExampleHandle`. Applications and benchmarks use `glyph.handle(name, config)` just as they do for
Three. The render planner still owns paragraph/style/flow identities and one `PlanTarget`; callers author no raw IDs,
revisions, acknowledgments, request bytes, or ABI numbers.

The plan target consumes the borrowed publication synchronously through `applyGlyphPublication()`. Its configured device
receives `BorrowedBoundCommandBuffer<ExampleBindings>` and walks the Rust-authored ordered group hierarchy during
`prepare()`. Candidate resources, retained buffers, patches, geometry, and draws are staged in local maps; commit swaps
them atomically, while discard leaves the previous accepted device state untouched. Only accepted renderer state is
retained after the borrowed frame expires.

`RecordingExampleRendererDevice` is the deterministic CPU oracle. It reads already-bound technique, program, variant,
named buffers, geometry, resources, ordered batches/root instances, and instance spans before one commit changes accepted
state. It validates only renderer and user/config requirements; it does not revalidate trusted Rust hierarchy semantics.
Rejected candidates discard staging and leave accepted state untouched.

`TypeGpuExampleRendererDevice` is the concrete backend. It realizes GLB-like position, UV, and index accessors; creates
TypeGPU/WebGPU vertex, index, and instance buffers; builds the selected pipeline; encodes an indexed instanced pass; and
submits to an offscreen `rgba8unorm` target. Empty idle deltas produce no submission, while accepted removal clears the
target. The hardware recovery proof disposes the lost-device handle and creates a new handle with a new configured device,
then reuses the same immutable Font and reconstructs the retained text. Device replacement is therefore not a hidden
mutation on an ordinary handle.

The acceptance fixture bakes Inter, loads it through root `loadFont()`, creates a configured root Glyph handle, binds the
external technique, publishes initial and updated retained text, and asserts non-empty draws, required named buffers and
geometry, changed visible pixels, idle submission suppression, failure atomicity, exact retirement, and disposal. The
hardware lab additionally proves recovery on a second handle. Separate low-level `/core` fixtures retain borrowed expiry,
single-target ownership, and async one-copy transport coverage.

See [Example renderer](../planning/example-renderer.md) for why the package exists and how it divides
work with the technique-owned `/typegpu` shader subpath.
