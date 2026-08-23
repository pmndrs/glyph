---
type: Workspace Package
title: '@pmndrs/glyph-example-renderer'
description: Proves the published core engine surface is sufficient for a second renderer by driving it without Three.js.
resource: ../../packages/glyph-example-renderer
workspace_package: '@pmndrs/glyph-example-renderer'
documentation_type: reference
source_digest: 'sha256:31a285a4a1068726926a76f30734b33c61c0700a82483a6568ebf4f906567057'
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
    title: Host-authored technique schema and render policy
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
  - id: engine-tests
    resource: ../../packages/glyph-example-renderer/tests/example-engine.test.ts
    title: Real-frame retention protocol proof
  - id: reader-tests
    resource: ../../packages/glyph-example-renderer/tests/plan-reader.test.ts
    title: Publication-lifetime, patch-range, and decode proof
generated:
  by: anthropic/claude-opus-5
  at: '2026-08-23T09:15:00Z'
---

# Package reference: `@pmndrs/glyph-example-renderer`

Status: Active consumer proof. It drives real engine frames through the item 11 retention protocol;
shaping fonts remain unreachable from `/core` (audit item 12), so text frames are out of reach by design.

This private workspace package is a consumer proof for `@pmndrs/glyph/core`, the way
`@pmndrs/glyph-example-raster` is a consumer proof for the raster and baker boundary. It imports the
published core entry point and nothing else — no `internal/`, no `generated/`, no `/three`, and no
renderer dependency of its own — so a second renderer that cannot be written against the published
surface turns the build red instead of turning into a planning argument. The boundary test scans every
file under `src/` *and* `tests/`, and rejects any `@pmndrs/glyph` subpath except `/core` and the
published Wasm artifact.

It authors its own technique schema and render policy with `/core`'s compilers (`src/policy.ts`), then
runs the retention protocol on every frame in `ExampleTextEngine.render`: update for the borrow,
`assertLive` before decoding, `retain` for one contiguous host-owned copy that acknowledges the
generation, and decoded views over owned bytes only — dirty patch ranges and retirements included.
`readDrawList` demands the branded `RetainedTextEnginePublication`, so passing a live-but-doomed borrow
is a compile error. The tests drive a real `TextEngineHost` over the published Wasm artifact: retained
plans survive three frames plus capacity growth, stale borrows throw
`TextEnginePublicationExpiredError`, a backwards acknowledgement is refused at the wire as a revision
conflict, and registering a font stack without a shaping font fails cleanly with `fontMissing` — the
recorded evidence for audit item 12.

See [Example renderer](../planning/example-renderer.md) for why the package exists and how it divides
work with the planned `@pmndrs/glyph/typegpu` shader subpath.
