---
type: Workspace Package
title: '@pmndrs/glyph-example-renderer'
description: Proves the published core engine surface through a headless TypeGPU-backed host without Three.js.
resource: ../../packages/glyph-example-renderer
workspace_package: '@pmndrs/glyph-example-renderer'
documentation_type: reference
source_digest: 'sha256:ab76591650e5b60f1c5d133f780a787c46aac779213c4744e17191e2422acfa5'
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
    title: GPU seam a TypeGPU backend implements
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
policy with `/core`'s compilers (`src/policy.ts`). It then runs the retention protocol on every frame in
`ExampleTextEngine.render`: update for the borrow,
`assertLive` before decoding, `retain` for one contiguous host-owned copy, and decoded views over owned bytes only — dirty
patch ranges and retirements included. The frame driver carries a separate device-accepted generation and plan revision;
retaining bytes never advances that wire fence before `prepareSubmission(...).commit()` succeeds. A rejected publication
remains owned for retry, and a throw-once acceptance test compares the recovered buffers byte-for-byte with a no-failure
oracle.
`readDrawList` demands the branded `RetainedTextEnginePublication`, so passing a live-but-doomed borrow
is a compile error. The tests drive a real `TextEngineHost` over the published Wasm artifact: retained
plans survive three frames plus capacity growth, stale borrows throw
`TextEnginePublicationExpiredError`, a backwards acknowledgement is refused at the wire as a revision
conflict. The recording device validates the complete resource, buffer, patch, primitive, draw, and retirement publication
against the selected technique/program/variant before it can mutate accepted state. Allocation, offset write, u32 fill,
copy, replacement generation, and exact retirement all have direct negative coverage. Font resources and frame submissions
use prepare/commit handles: if host binding registration or plan validation throws, the prepared candidate remains
unpublished instead of restoring an older snapshot. The acceptance test also loads a baked font through the public root
loader, registers its portable binding and resource, resolves the example `/typegpu` shader to WGSL, realizes named
resources, and asserts non-empty draws and one submission. A second test realizes supplied indexed GLB-like geometry and
checks its index count while the primitive record span supplies the instance count.

The package still does not make font loading part of `/core`: `createTextRuntime` remains a root API. The acceptance uses
the root loader only to obtain a `LoadedFont`, then hands that value to the core-facing engine registration method. This
keeps font acquisition and engine execution separate while proving that a non-Three host can render a real text frame.

See [Example renderer](../planning/example-renderer.md) for why the package exists and how it divides
work with the technique-owned `/typegpu` shader subpath.
