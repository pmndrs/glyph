---
type: Workspace Package
title: '@pmndrs/text-glyph-example-raster'
description: Proves the published raster and baker extension boundary with a private diagnostic technique.
resource: ../../packages/glyph-example-raster
workspace_package: '@pmndrs/text-glyph-example-raster'
documentation_type: reference
source_digest: 'sha256:1b25dd5a8c679e241da5d73402e42c3441087587efffc9a25799d69dc5f229a0'
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
  at: '2026-08-04T17:42:34Z'
---

# Package reference: `@pmndrs/text-glyph-example-raster`

Status: ✅ Milestone 10.4 external extension proof

This private workspace package is a consumer proof, not a fourth recommended production raster. It imports only published
`@pmndrs/text` entry points and its own pinned Three.js dependency. It owns the literal `glyphExample` kind, companion
extension and descriptor, deterministic baker, standalone-valid GLB framing, embedded or authenticated external RGBA glyph
records, decoder validation, runtime baker, TSL material, retained instance storage, dirty upload policy, overflow replacement,
abort behavior, and disposal. A source boundary test rejects imports from core internals or the three first-party raster and
baker subpaths.

The technique makes the proof observable by assigning each source-local glyph ID a deterministic color and drawing a framed
em-relative diagnostic cell at the position produced by core shaping and paragraph layout. Its visual output is deliberately
diagnostic rather than a text-quality recommendation. The baker accepts both embedded and external artifact/page packaging.
The external lane authenticates the companion GLB and its separate record payload through the public raster and resource
resolvers; the embedded lane proves recursive `BufferView` rebasing through the public Node composition host.

The retained adapter allocates 25% instance slack capped at 256 entries, keeps logical count separate from capacity, updates
every origin, size, color, and glyph identity in place, coalesces changes into 32-instance dirty buckets with an eight-range
full-upload fallback, and replaces transactionally on overflow. Focused tests cover deterministic bytes, public Node bake,
standalone companion validation, external resource resolution, abort-before-load, staged abort preservation, shrink,
exact-capacity growth, overflow cleanup, and idempotent batch/resource disposal.

The hardware-browser target uses the public source-font fallback, package runtime baker, generic attachment, public `Text`,
warm matrix-lifecycle publication, TSL compilation, draw, asynchronous render-target readback, and complete disposal. WebGPU
and forced WebGL2 each produced two deterministic samples with visible glyph frames, one draw, retained object and geometry
identity, and the same RGBA SHA-256 `4c664f22222b8a4fce66a1c2921a0f131500280b029664a82833c33393b57826`.
When the benchmark route supplies an exclusive execution context, the target borrows that renderer, restores render target,
clear, viewport, scissor, and scissor-test state, and never creates or disposes a parallel renderer. Run the focused lane with
`pnpm scripts run benchmark:external-raster`.

## Boundary findings

The proof found and closed two public integration defects. First, portable `RasterDrawBatch` correctly promised only disposal
while Three-backed `Text` silently required an `Object3D`. Core now publishes renderer-neutral
`RasterObjectDrawBatch<Object>` and the Three adapter publishes `ThreeRasterDrawBatch`; the portable contract still imports no
renderer. Second, `RasterRuntime.load` accepted `resolveResource` but dropped it when constructing cache-owned load options;
it now preserves the resolver and the package's authenticated external-record test fails without that forwarding.

The remaining friction is documented rather than hidden. Static discovery maps an imported factory export name to
`package.json#pmndrs.text[exportName]` and requires the default baker's kind to equal that export name. A standalone companion
also needs ordinary valid glTF content in addition to its extension data because external/runtime attachment runs the pinned
Khronos validator. This package owns a one-point witness mesh and its GLB encoder without a private import. A future generic
companion-artifact helper could remove that boilerplate, but its absence does not force a fork or block the extension contract.
