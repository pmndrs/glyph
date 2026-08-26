---
type: Workspace Package
title: '@pmndrs/glyph-example-renderer'
description: Proves the published core engine surface through a real TypeGPU/WebGPU host without Three.js.
resource: ../../packages/glyph-example-renderer
workspace_package: '@pmndrs/glyph-example-renderer'
documentation_type: reference
source_digest: 'sha256:856ef87ca7ced7f5e4196cd6eafcb0e9472a53ac21c15b657db78bc53ee5f16e'
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
  - id: reader-tests
    resource: ../../packages/glyph-example-renderer/tests/plan-reader.test.ts
    title: Publication-lifetime, patch-range, and decode proof
generated:
  by: anthropic/claude-opus-5
  at: '2026-08-23T09:15:00Z'
---

# Package reference: `@pmndrs/glyph-example-renderer`

Status: Active external-engine proof. It drives a real loaded font through the retention protocol, portable raster
registration, resource realization, and a concrete submission seam without importing Three.js.

This private workspace package is a consumer proof for `@pmndrs/glyph/core` and the example technique's `/typegpu`
shader realization, the way
`@pmndrs/glyph-example-raster` is a consumer proof for the raster and baker boundary. It imports the
published core and shader entry points — no `internal/`, no `generated/`, no `/three`, and no
Three dependency — so a second renderer that cannot be written against the published
surface turns the build red instead of turning into a planning argument. The boundary test scans every
file under `src/` _and_ `tests/`; only the acceptance fixture may import the root loader and `/bake` to create its
temporary font, while all other files remain limited to `/core` and the published Wasm artifact.

It imports the portable example schema, plan, and `/typegpu` shader from `@pmndrs/glyph-example-raster`, and authors its own host render
policy with `/core`'s compilers (`src/policy.ts`). Capability objects carry only actual limits and flags;
`compileRenderPolicy()` assigns the ABI identity, and the single-profile frame omits any capability number. It then runs the retention protocol on every frame in
`ExampleTextEngine.render`: update for the borrow,
`assertLive` before decoding, `retain` for one contiguous host-owned copy, and decoded views over owned bytes only — dirty
patch ranges and retirements included. The frame driver carries a separate device-accepted generation and plan revision;
retaining bytes never advances that wire fence before `prepareSubmission(...).commit()` succeeds. The engine revision
still advances when Wasm accepts the update, so a rejected device candidate is superseded by the next frame and the old
consumed-plan fence forces a safe checkpoint instead of a retry latch. A throw-once acceptance test pins all three wire
values and compares the recovered buffers byte-for-byte with an oracle that observed the rejected candidate.
`readDrawList` demands the branded `RetainedTextEnginePublication`, so passing a live-but-doomed borrow
is a compile error. The tests drive a real `TextEngineHost` over the published Wasm artifact: retained
plans survive three frames plus capacity growth, stale borrows throw
`TextEnginePublicationExpiredError`, a backwards acknowledgement is refused at the wire as a revision
conflict. `RecordingExampleRendererDevice` is the deterministic CPU oracle: it validates the complete resource, buffer,
patch, primitive, draw, and retirement publication against the selected technique/program/variant before accepted state can
change. Allocation, offset write, u32 fill, copy, replacement generation, exact retirement, stale candidates, and a throwing
backend publication callback have direct negative coverage.

`TypeGpuExampleRendererDevice` is the concrete acceptance backend. It realizes the retained GLB-like geometry as TypeGPU
vertex/index buffers, stages the per-draw policy instance buffers, and commits through an awaited WebGPU validation scope.
Only a successfully submitted indexed pass publishes the same candidate to the CPU oracle and advances engine device
fences. A rejected stage releases its unowned buffers and cannot restore or expose older bytes because live state was never
changed. Commit awaits validation acceptance while queue completion remains pipelined. The offscreen `rgba8unorm` target supports padded asynchronous readback; an all-empty delta skips GPU allocation
and submission, while an accepted removal still encodes the clear pass.
The browser lab runtime-bakes Inter, creates one retained `ExampleText`, proves one initial and one updated draw, and observes
7,740 then 6,588 non-transparent pixels with 10,287 changed pixels, zero GPU submissions for the following idle frame, and
one clear-only submission on disposal. Ordered readback observes zero visible pixels after the clear. Disposal publishes an
empty scene without retaining retired instance buffers. A same-host 101-sample A/B measured changed-frame `render()` at
0.300 ms median / 0.645 ms p95 when pipelined versus 0.760 / 1.585 ms with the rejected per-frame queue-completion fence.

`ExampleTextEngine.createText()` supplies the application lifecycle that raw frame fixtures intentionally expose but do not
recommend as the ordinary path. `ExampleText.render()` emits the initial paragraph/text/style/constraint/region state,
`update()` changes desired content/style/layout and advances geometry revisions when dimensions change, and `dispose()`
publishes paragraph removal and returns its identity slot for later reuse. Live texts remain unique while process-wide ID
collision tracking grows with peak concurrent slots rather than create/dispose churn. The engine still exposes its session
and raw `render(frame)` method for integrators implementing their own retained object model.
The raw frame surface and managed `ExampleText` façade are alternative paragraph owners; callers do not interleave both
ownership models inside one session.

The package still does not make font loading part of `/core`: `createTextRuntime` remains a root API. The acceptance uses
the root loader only to obtain a `LoadedFont`, then hands that value to the core-facing engine registration method. This
keeps font acquisition and engine execution separate while proving that a non-Three host can render a real text frame.

See [Example renderer](../planning/example-renderer.md) for why the package exists and how it divides
work with the technique-owned `/typegpu` shader subpath.
