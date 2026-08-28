---
type: Workspace Package
title: '@pmndrs/glyph-example-renderer'
description: Proves the published core engine surface through a real TypeGPU/WebGPU host without Three.js.
resource: ../../packages/glyph-example-renderer
workspace_package: '@pmndrs/glyph-example-renderer'
documentation_type: reference
source_digest: 'sha256:560a42beefa10acc09790263025d446c6e87194fde56e50375aef75b39b0afff'
tags: [package, core, engine, integration-proof, typegpu]
sources:
  - id: manifest
    resource: ../../packages/glyph-example-renderer/package.json
    title: Package manifest
  - id: engine-driver
    resource: ../../packages/glyph-example-renderer/src/engine.ts
    title: Retention-protocol frame driver
  - id: policy
    resource: ../../packages/glyph-example-renderer/src/policy.ts
    title: Host-authored system lanes and render policy
  - id: plan-reader
    resource: ../../packages/glyph-example-renderer/src/plan-reader.ts
    title: Retained-publication reader and draw decoder
  - id: draw-list
    resource: ../../packages/glyph-example-renderer/src/draw-list.ts
    title: Device-neutral draw list owned by the host
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
  by: anthropic/claude-opus-5
  at: '2026-08-23T09:15:00Z'
---

# Package reference: `@pmndrs/glyph-example-renderer`

Status: Active external-engine proof. It drives a real immutable font through the retained public `/core` contract,
portable raster registration, resource realization, and concrete TypeGPU/WebGPU submission without Three.js.

The package is a standing consumer proof. Source imports only published root assets, `/core`, and the example raster's
public main and `/typegpu` subpaths—never `internal/`, `generated/`, `/three`, or Three itself. Its policy supplies its own
system lane, semantic capability set, allocation mode, transform mode, and program namespace while reusing the technique's
portable policy body. Capability wire IDs are automatic; stable author-owned identities are branded numeric hashes.

`ExampleTextEngine` receives a `TextRuntime`, creates its host through `runtime.createTextEngineHost()`, installs its policy,
binds immutable fonts/stacks, opens one retained synchronous session, and exposes `createText()`, `update()`, `publish()`,
and disposal. The session owns every paragraph/style/flow identity and one `PlanTarget`; callers do not author raw IDs,
revisions, acknowledgments, request bytes, or ABI numbers. `layout()` and `glyphs()` remain available on the retained core
text when an integration needs current desired metrics or positioned glyphs before publication.

The plan target consumes the borrowed A/B publication synchronously. `plan-reader.ts` decodes resources, buffers, patches,
primitives, draws, and retirements through semantic `/core` readers and copies only borrowed patch/table bytes that its
accepted draw list retains. Resource records resolve through `candidate.acquirePayload()`, producing counted leases over
validated portable geometry and companion resources. The target indexes accepted plan-resource generations by branded
numeric handle, releases a payload lease after its last accepted plan reference retires, and never substitutes stale
payloads after failure. Target disposal releases any leases and device-cache realizations that remain live without
claiming ownership of the caller's device.

`RecordingExampleRendererDevice` is the deterministic CPU oracle. It validates complete candidate state against the
selected technique, program, variant, named buffers, geometry, resource and storage generations, patch ranges, primitive
spans, order, and exact retirements before one commit changes accepted state. Rejected candidates discard staging and
leave accepted state untouched.

`TypeGpuExampleRendererDevice` is the concrete backend. It realizes GLB-like position, UV, and index accessors; creates
TypeGPU/WebGPU vertex, index, and instance buffers; builds the selected pipeline; encodes an indexed instanced pass; and
submits to an offscreen `rgba8unorm` target. Validation acceptance is awaited without stalling every frame on queue
completion. Empty idle deltas produce no submission, while accepted removal clears the target. Device replacement drops
physical realizations, asks the retained session for a complete checkpoint, reacquires portable resources, and redraws
without an authored text mutation.

The acceptance fixture bakes Inter, loads it through root `loadFont()`, creates a core runtime, binds the external
technique, publishes initial and updated retained text, and asserts non-empty draws, required named buffers and geometry,
changed visible pixels, idle submission suppression, failure atomicity, checkpoint behavior, exact retirement, and
disposal. A separate async-target fixture transfers and returns the same one-copy plan buffer under backpressure.

See [Example renderer](../planning/example-renderer.md) for why the package exists and how it divides
work with the technique-owned `/typegpu` shader subpath.
