---
type: Workspace Package
title: "@pmndrs/text"
description: Defines the public core and React TypeScript contracts plus compile-time composition fixtures.
resource: ../../packages/text
workspace_package: "@pmndrs/text"
documentation_type: reference
source_digest: "sha256:b119b83f743b5a7eeba6618d7c7a1ea094c75b6db277263b9cdce98e59e76a47"
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
  at: "2026-07-25T01:34:41Z"
---

# Package reference: `@pmndrs/text`

Status: 🟡 contract scaffold; not a runtime implementation

This package owns the accepted public core and React contract types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, React prop derivation, lazy raster and `useFont` inference, and invalid combinations at compile time. React and React Three Fiber remain optional peer capabilities and are not reachable from the core entry point.

It does not currently load fonts, shape text, perform paragraph layout, bake assets, or render glyphs. The [roadmap](../roadmap/roadmap.md) owns the implementation order for those behaviors.

## Package scripts

| Script | Purpose |
| --- | --- |
| `typecheck` | Type-check package source without emission. |
| `test` | Run compile-only API fixtures and package-manifest contract tests. |
| `test:types` | Compile positive and negative public-contract fixtures. |
| `build` | Emit the ESM package and declarations. |

The [API contract](../planning/api-shapes.md) remains authoritative for proposed public behavior; this concept explains the package that currently embodies its compile-time subset.[^api-contract]

[^api-contract]: The implementation must not be inferred to exist merely because its types compile.
