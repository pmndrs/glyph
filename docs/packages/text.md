---
type: Workspace Package
title: "@pmndrs/text"
description: Defines the public core TypeScript contracts and compile-time composition fixtures.
resource: ../../packages/text
workspace_package: "@pmndrs/text"
documentation_type: reference
source_digest: "sha256:b2b35dc4d70e9a3537d3443027ec0c9e0f14a1f5a44285acd4e6438905861c64"
tags: [package, public-api, typescript, contracts]
sources:
  - id: manifest
    resource: ../../packages/text/package.json
    title: Package manifest
  - id: api-contract
    resource: ../planning/api-shapes.md
    title: Runtime and bake API V0
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T01:15:06Z"
---

# Package reference: `@pmndrs/text`

Status: 🟡 contract scaffold; not a runtime implementation

This package owns the proposed public core types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, and invalid combinations at compile time.

It does not currently load fonts, shape text, perform paragraph layout, bake assets, or render glyphs. The [roadmap](../roadmap/roadmap.md) owns the implementation order for those behaviors.

## Package scripts

| Script | Purpose |
| --- | --- |
| `typecheck` | Type-check package source without emission. |
| `test:types` | Compile positive and negative public-contract fixtures. |
| `build` | Emit the ESM package and declarations. |

The [API contract](../planning/api-shapes.md) remains authoritative for proposed public behavior; this concept explains the package that currently embodies its compile-time subset.[^api-contract]

[^api-contract]: The implementation must not be inferred to exist merely because its types compile.
