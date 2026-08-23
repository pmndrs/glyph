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
  - id: plan-reader
    resource: ../../packages/glyph-example-renderer/src/plan-reader.ts
    title: Borrowed-publication reader and draw decoder
  - id: draw-list
    resource: ../../packages/glyph-example-renderer/src/draw-list.ts
    title: Device-neutral draw list owned by the host
  - id: device
    resource: ../../packages/glyph-example-renderer/src/device.ts
    title: GPU seam a TypeGPU backend implements
  - id: boundary-tests
    resource: ../../packages/glyph-example-renderer/tests/package-boundary.test.ts
    title: Published-entry-point boundary proof
  - id: reader-tests
    resource: ../../packages/glyph-example-renderer/tests/plan-reader.test.ts
    title: Publication-lifetime and decode proof
generated:
  by: anthropic/claude-opus-5
  at: '2026-08-23T09:15:00Z'
---

# Package reference: `@pmndrs/glyph-example-renderer`

Status: 🚧 Stub. Device seam only; it renders nothing.

This private workspace package is a consumer proof for `@pmndrs/glyph/core`, the way
`@pmndrs/glyph-example-raster` is a consumer proof for the raster and baker boundary. It imports the
published core entry point and nothing else — no `internal/`, no `generated/`, no `/three`, and no
renderer dependency of its own — so a second renderer that cannot be written against the published
surface turns the build red instead of turning into a planning argument.

It reads one borrowed `TextEnginePublication` into host-owned memory. The publication's bytes are
valid only until the next Wasm call, so `readDrawList` copies all seven plan tables and decodes the
`draws` table, which already carries `clipId`, `depthKey`, `orderToken`, `materialId`, and
`transformId`. The reader test overwrites the source buffer after reading and asserts the decoded
result survives, which is the standing evidence that a retained host must copy today.

See [Example renderer](../planning/example-renderer.md) for why the package exists and how it divides
work with the planned `@pmndrs/glyph/typegpu` shader subpath.
