---
type: Workspace Package
title: '@pmndrs/glyph-example-raster'
description: Proves the portable raster boundary and ships matching TypeGPU and TSL shader realizations.
resource: ../../../packages/glyph-example-raster
workspace_package: '@pmndrs/glyph-example-raster'
documentation_type: reference
source_digest: 'sha256:9fc9ec2b25b806029bea130919c9085e0b4f45dc79b22602319e15382166d9d1'
tags: [package, raster, extension-proof, typegpu, tsl]
sources:
  - id: manifest
    resource: ../../../packages/glyph-example-raster/package.json
    title: Package manifest and static discovery mapping
  - id: runtime
    resource: ../../../packages/glyph-example-raster/src/raster.ts
    title: Public-contract decoder and retained portable data
  - id: shader-contract
    resource: ../../../packages/glyph-example-raster/src/shader-contract.ts
    title: Shared shader input contract
  - id: portable-plan
    resource: ../../../packages/glyph-example-raster/src/portable.ts
    title: Portable raster-format schema and Codec-body definition
  - id: registration
    resource: ../../../packages/glyph-example-raster/src/register.ts
    title: Root-imported renderer-neutral Codec registration
  - id: geometry-fixture
    resource: ../../../packages/glyph-example-raster/src/geometry-fixture.ts
    title: Portable GLB-like indexed geometry fixture
  - id: typegpu
    resource: ../../../packages/glyph-example-raster/src/typegpu.ts
    title: TypeGPU shader realization
  - id: tsl
    resource: ../../../packages/glyph-example-raster/src/tsl.ts
    title: TSL shader realization
  - id: baker
    resource: ../../../packages/glyph-example-raster/src/baker.ts
    title: Package-owned baker module
  - id: artifact
    resource: ../../../packages/glyph-example-raster/src/artifact.ts
    title: Package-owned companion GLB and record payload
  - id: lifecycle-tests
    resource: ../../../packages/glyph-example-raster/tests/glyph-example.test.ts
    title: Public bake, load, resolver, and lifecycle tests
  - id: renderer-variant-tests
    resource: ../../../packages/glyph-example-raster/tests/renderer-variants.test.ts
    title: Manual Three registration and shader variant test
  - id: browser-proof
    resource: ../../../apps/benchmarks/vitexec/external-raster-proof.probe.ts
    title: Dual-backend product rendering probe
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-04T00:13:53Z'
---

# Package reference: `@pmndrs/glyph-example-raster`

Status: ✅ Milestone 10.4 external extension proof

This private workspace package is a consumer proof, not a fourth recommended production raster. It imports only published
`@pmndrs/glyph` entry points and optional shader-language subpaths. It owns the literal `glyphExample` kind, companion
extension and descriptor, deterministic baker, standalone-valid GLB framing, embedded or external RGBA glyph records,
runtime baker, declarative Rust packing expressions, matching TypeGPU and TSL shader realizations,
paragraph/local-run render-order
inheritance, abort behavior, and disposal. Rust owns retained instance storage, dirty-range publication, and overflow handling.
A source boundary test rejects imports from core internals or the Three first-party raster and baker subpaths.

The raster format makes the proof observable by assigning each source-local glyph ID a deterministic color and drawing a framed
em-relative diagnostic cell at the position produced by core shaping and paragraph layout. Its visual output is deliberately
diagnostic rather than a text-quality recommendation. The baker accepts both embedded and external artifact/page packaging.
The external lane authenticates the companion GLB and its separate record payload through the public raster and resource
resolvers; the embedded lane proves recursive `BufferView` rebasing through the public Node composition host.

The package now supplies the portable Codec and renderer-facing halves of the Rust command-buffer boundary separately. `glyphExample` is a portable
`defineRasterFormat` that owns identity, decoding, one stable resource identity, and disposal while importing no renderer or
instance-packing contract. Importing the package root runs the renderer-neutral `registerRasterCodec` call through a
dedicated registration module. The manifest marks that module and its root facade as side-effectful so a production bundle
keeps the registration; the portable definition and shader subpaths remain free of registration side effects.
The `/typegpu` and `/tsl` subpaths export shader functions and the same named-input descriptor; they do not register a
renderer or own resource/material caches. A Three consumer imports `/tsl` and manually calls public
`registerThreeRasterProgram`, while the example renderer imports `/typegpu`. The Codec body describes the exact Rust
inputs, buffers, scalar operations, and storage/draw keys. A cold compiler lowers validated glyph colors and inset data
into one font binding and retains the supplied indexed quad under that stable resource identity; the selected host binds
the resulting origin, size, and color buffers plus geometry to its shader. The package no longer owns a
`ParagraphBatchTarget`, target revision, slack planner, dirty-range upload loop, or mesh transaction.
Its package subpaths publish a custom `source` condition so opted-in workspace Vite consumers resolve these TypeScript
modules directly; default package resolution continues to use built ESM and declarations.
Focused tests cover deterministic bytes, public Node bake, standalone companion validation, external resource
resolution, abort-before-decode, plus a compiled-Wasm public `Text` lifecycle that verifies Rust-packed sizes and colors
and observes retained draw/geometry identity. No test reconstructs the removed TypeScript selector, storage, or writer.

The package's actual render resource is a small immutable indexed unit quad. It follows the portable GLB-like contract—semantic
three-component position and two-component UV vertex attributes, typed accessors, indices, topology, and draw range—so an engine can choose supplied
geometry without importing Three or learning raster-format-private implementation details. The command-buffer primitive's record span,
not the geometry payload, supplies the draw's instance count.

The hardware-browser target uses a public `FontFace`, package runtime baker, and a spread-wrapped `ThreeConfig` whose font
format map includes `glyphExample`. It then exercises public `Text` and `TextGroup`, warm matrix-lifecycle publication, TSL
compilation, draw, asynchronous render-target readback, and complete disposal. WebGPU and forced WebGL2 each produced two
deterministic samples with visible glyph frames, one draw,
retained mesh and geometry identity, individual `Text.visible` behavior inside an indexed shared draw, caller-owned
Group ordering, and the same RGBA SHA-256
`0231a1849628dbe5ceba9a0539020624dbfbbc825ff3908b10c80567a00d022d`.
When the benchmark route supplies an exclusive execution context, the target borrows that renderer, restores render target,
clear, viewport, scissor, and scissor-test state, and never creates or disposes a parallel renderer. Run the focused lane with
`pnpm scripts run benchmark:external-raster`.

## Boundary findings

The proof found and closed three public integration defects. First, portable `RasterDrawBatch` correctly promised only disposal
while Three-backed `Text` silently required an `Object3D`. Core now publishes renderer-neutral
`RasterObjectDrawBatch<Object>` and the Three adapter publishes `ThreeRasterDrawBatch`; the portable contract still imports no
renderer. Second, `RasterRuntime.load` accepted `resolveResource` but dropped it when constructing cache-owned load options;
it now preserves the resolver and the package's authenticated external-record test fails without that forwarding.
Third, generated raster Groups replaced the ordering inherited from caller-owned parent Groups before draws reached Three.js
sorting. `Text` and the example batch now use neutral `Object3D` containers. The example implements the public base-order
method so its child mesh combines `Text.renderOrder` with glyph-run-local order across cold and in-place updates.

Porting the proof to target-v1 surfaced a fourth, still-open finding. Three derives a render list's `groupOrder` from
`Object3D.isGroup`, and `TextGroup` extends `Object3D` rather than `Group`, so a `TextGroup` does not by itself establish the
ordering boundary a caller-owned `THREE.Group` does. A scene that orders text against other content through group render
order therefore needs a real `Group` above its `TextGroup`; this target keeps one, which is what makes its layering
assertion meaningful. `TextGroup.renderOrder` still sets the text-local base every program adds its run index to, and the
target checks both contracts separately.

The remaining friction is documented rather than hidden. Static discovery maps an imported factory export name to
`package.json#pmndrs.glyph[exportName]` and requires the default baker's kind to equal that export name. A standalone companion
also needs ordinary valid glTF content in addition to its extension data so it remains a portable GLB artifact. Runtime loading
trusts the bake-time schema contract and reports parse or attachment failures where they occur instead of bundling the Khronos
validator. This package owns a one-point witness mesh and its GLB encoder without a private import. A future generic
companion-artifact helper could remove that boilerplate, but its absence does not force a fork or block the extension contract.
