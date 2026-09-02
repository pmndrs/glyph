---
type: Workspace Package
title: '@pmndrs/glyph-example-renderer'
description: Proves the root GlyphConfig integration surface through a real TypeGPU/WebGPU renderer without Three.js.
resource: ../../packages/glyph-example-renderer
workspace_package: '@pmndrs/glyph-example-renderer'
documentation_type: reference
source_digest: 'sha256:21086d0eeb2654b59626072cb7280a41c92f71baccd2db0d7c62631138a1099c'
tags: [package, glyph-config, codec, integration-proof, typegpu]
sources:
  - id: manifest
    resource: ../../packages/glyph-example-renderer/package.json
    title: Package manifest
  - id: engine-driver
    resource: ../../packages/glyph-example-renderer/src/engine.ts
    title: Root-services Text implementation
  - id: glyph-config
    resource: ../../packages/glyph-example-renderer/src/config.ts
    title: Example GlyphConfig and named handle
  - id: configured-plan-target
    resource: ../../packages/glyph/src/internal/glyph-plan-target.ts
    title: Internal configured publication target
  - id: codec
    resource: ../../packages/glyph-example-renderer/src/codec.ts
    title: Renderer-authored system lanes and Codec
  - id: draw-list
    resource: ../../packages/glyph-example-renderer/src/draw-list.ts
    title: Device-neutral draw list owned by the renderer
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
  - id: acceptance-tests
    resource: ../../packages/glyph-example-renderer/tests/example-render.test.ts
    title: Real font, resource, geometry, and non-empty draw acceptance
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-28T20:20:47Z'
---

# Package reference: `@pmndrs/glyph-example-renderer`

Status: Active external-renderer proof. It drives a real immutable font through the public root `GlyphConfig`, Codec,
resource realization, borrowed `CommandBufferView`, and concrete TypeGPU/WebGPU submission without Three.js.

The package is a standing consumer proof. Production source imports only `@pmndrs/glyph`, the example raster package, and
the raster's explicit `/typegpu` shader subpath—never `internal/`, `generated/`, a removed `/core` subpath, `/three`, or
Three itself. Its Codec supplies its own system lane, capability set, allocation mode, transform mode, and program
namespace while reusing the technique's portable Codec body. The package root exposes a custom `source` condition for
opted-in workspace tools; default consumers resolve built ESM and declarations.

The ordinary proof begins with `await glyph.init()` and `glyph.handle(name, defineExampleConfig(device))`. Its seven-field
config uses `schema`, optional `fonts`, `encode`, `resolve`, `renderer`, `root`, and optional `commands`. `encode()` selects
`exampleCodecDescriptor(ids)`. `resolve()` leases portable resources. The internal trusted projector binds schema values
and gives the configured renderer a borrowed `CommandBufferView<ExampleBindings>` whose nested `DisplayList` preserves
Rust-authored order. Numeric IDs and raw plan tables never reach the renderer.

The implementation first infers its complete config from `defineGlyphConfig({...})` and then checks it with
`satisfies ExampleGlyphConfig`. The exported `ExampleGlyphConfig` is
`GlyphConfigFor<typeof ExampleSchema, ExampleRoot, ExampleDrawList>`, so isolated declaration emit has a stable name while
bindings and the root boundary remain derived from the schema instead of being repeated as a corrective generic tuple.

The package's `ExampleRootImplementation` receives only constrained `GlyphRootServices` and uses them to construct adapter
`ExampleText` objects. Semantic mutations invalidate that root; the application publishes all dirty roots through the
single top-level `glyph.shape()` boundary. The integration never constructs or receives a public engine, backend, planner,
or target. The returned handle fronts one anonymous root, and `handle(name)` selects idempotent terminal named siblings.
Applications and benchmarks use that surface exactly as they use the first-party Three handle.

During each synchronous `decode(view)`, the configured device walks already-bound programs, buffers, resources, batches,
root instances, and instance spans. Candidate resources, retained buffers, patches, geometry, and draws are staged in
local maps; `commit()` swaps them atomically, while `discard()` leaves the previous accepted device state untouched. Only
accepted renderer-owned state survives after the borrowed view expires.

`RecordingExampleRendererDevice` is the deterministic CPU oracle. It reads already-bound technique, program, variant,
named buffers, geometry, resources, ordered batches/root instances, and instance spans before one commit changes accepted
state. It validates only renderer and user/config requirements; it does not revalidate trusted Rust hierarchy semantics.
Rejected candidates discard staging and leave accepted state untouched.

`TypeGpuExampleRendererDevice` is the concrete renderer device. It realizes GLB-like position, UV, and index accessors; creates
TypeGPU/WebGPU vertex, index, and instance buffers; builds the selected pipeline; encodes an indexed instanced pass; and
submits to an offscreen `rgba8unorm` target. Empty idle deltas produce no submission, while accepted removal clears the
target. The hardware recovery proof disposes the lost-device handle and creates a new handle with a new configured device,
then reuses the same immutable Font and reconstructs the retained text. Device replacement is therefore not a hidden
mutation on an ordinary handle.

The acceptance fixture bakes Inter, loads an immutable Font through the renderer-neutral root `loadFont()`, creates a
configured Glyph handle, binds the external format, publishes initial and updated retained text through `glyph.shape()`,
and asserts non-empty draws, required named buffers and
geometry, changed visible pixels, idle submission suppression, failure atomicity, exact retirement, and disposal. The
hardware lab additionally proves recovery on a second handle. Glyph's package-private tests retain borrowed expiry,
publication ownership, and worker-transfer coverage without exposing those mechanisms to integrators.

See [Example renderer](../planning/example-renderer.md) for why the package exists and how it divides
work with the technique-owned `/typegpu` shader subpath.
