---
type: Workspace Package
title: '@pmndrs/text-glyph-example-raster'
description: Proves the published raster and baker extension boundary with a private diagnostic technique.
resource: ../../packages/glyph-example-raster
workspace_package: '@pmndrs/text-glyph-example-raster'
documentation_type: reference
source_digest: 'sha256:9e9be536340b1bf98d11d8d8a15f50f78451546ce63121c78b7d0525da94c65a'
tags: [package, raster, extension-proof, threejs, tsl]
sources:
  - id: manifest
    resource: ../../packages/glyph-example-raster/package.json
    title: Package manifest and static discovery mapping
  - id: runtime
    resource: ../../packages/glyph-example-raster/src/raster.ts
    title: Public-contract decoder and retained Three.js adapter
  - id: baker
    resource: ../../packages/glyph-example-raster/src/baker.ts
    title: Package-owned baker module
  - id: artifact
    resource: ../../packages/glyph-example-raster/src/artifact.ts
    title: Package-owned companion GLB and record payload
  - id: lifecycle-tests
    resource: ../../packages/glyph-example-raster/tests/glyph-example.test.ts
    title: Public bake, load, resolver, and lifecycle tests
  - id: browser-proof
    resource: ../../apps/benchmarks/vitexec/external-raster-proof.probe.ts
    title: Dual-backend product rendering probe
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-10T02:32:26Z'
---

# Package reference: `@pmndrs/text-glyph-example-raster`

Status: ✅ Milestone 10.4 external extension proof

This private workspace package is a consumer proof, not a fourth recommended production raster. It imports only published
`@pmndrs/text` entry points and its own pinned Three.js dependency. It owns the literal `glyphExample` kind, companion
extension and descriptor, deterministic baker, standalone-valid GLB framing, embedded or authenticated external RGBA glyph
records, decoder validation, runtime baker, declarative Rust packing policy, TSL material, paragraph/local-run render-order
inheritance, abort behavior, and disposal. Rust owns retained instance storage, dirty-range publication, and overflow handling.
A source boundary test rejects imports from core internals or the Three first-party raster and baker subpaths.

The technique makes the proof observable by assigning each source-local glyph ID a deterministic color and drawing a framed
em-relative diagnostic cell at the position produced by core shaping and paragraph layout. Its visual output is deliberately
diagnostic rather than a text-quality recommendation. The baker accepts both embedded and external artifact/page packaging.
The external lane authenticates the companion GLB and its separate record payload through the public raster and resource
resolvers; the embedded lane proves recursive `BufferView` rebasing through the public Node composition host.

The package now supplies both halves of the Rust render-plan boundary separately. `glyphExample` is a portable
`defineRasterTechnique` that owns identity, decoding, one shared resource, and disposal while importing no renderer or
instance-packing contract.
`@pmndrs/text-glyph-example-raster/three` registers a static policy program through public
`registerThreeRasterPlanProgram`, so nothing in `@pmndrs/text` names this package. The policy describes the exact Rust
inputs, buffers, scalar operations, and storage/draw keys. A cold compiler lowers validated glyph colors and inset data
into one font binding; a renderer factory consumes the resulting buffers to construct the TSL material. The package no
longer owns a `ParagraphBatchTarget`, target revision, slack planner, dirty-range upload loop, or mesh transaction.
Focused tests cover deterministic bytes, public Node bake, standalone companion validation, external resource
resolution, abort-before-decode, plus a compiled-Wasm public `Text` lifecycle that verifies Rust-packed sizes and colors
and observes retained draw/geometry identity. No test reconstructs the removed TypeScript selector, storage, or writer.

The hardware-browser target uses the public source-font fallback, package runtime baker, the target-v1 `FontLoader`, public
`Text` and `TextGroup`, warm matrix-lifecycle publication, TSL compilation, draw, asynchronous render-target readback, and
complete disposal. WebGPU and forced WebGL2 each produced two deterministic samples with visible glyph frames, one draw,
retained mesh and geometry identity, individual `Text.visible` behavior inside an indexed shared draw, caller-owned
Group ordering, and the same RGBA SHA-256
`817495c4afe3a8f88d2af85d972f43be88b9f834ed0268d0d0b2e3de86ba9d46`.
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
`package.json#pmndrs.text[exportName]` and requires the default baker's kind to equal that export name. A standalone companion
also needs ordinary valid glTF content in addition to its extension data because external/runtime attachment runs the pinned
Khronos validator. This package owns a one-point witness mesh and its GLB encoder without a private import. A future generic
companion-artifact helper could remove that boilerplate, but its absence does not force a fork or block the extension contract.
