---
type: Workspace Package
title: "@pmndrs/text"
description: Defines the public core and React TypeScript contracts plus the internal Node static-discovery implementation.
resource: ../../packages/text
workspace_package: "@pmndrs/text"
documentation_type: reference
source_digest: "sha256:e82e29986d9e1463d6f44ec2d2ea4c5cc25f99a788ce9eb13ad602b2121d57e8"
tags: [package, public-api, typescript, contracts]
sources:
  - id: manifest
    resource: ../../packages/text/package.json
    title: Package manifest
  - id: api-contract
    resource: ../planning/api-shapes.md
    title: Runtime and bake API V0
  - id: discovery
    resource: ../../packages/text/src/discovery.ts
    title: Static project discovery implementation
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T02:42:19Z"
---

# Package reference: `@pmndrs/text`

Status: 🟡 public contract scaffold with completed internal static discovery

This package owns the accepted public core and React contract types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, React prop derivation, lazy raster and `useFont` inference, and invalid combinations at compile time. React and React Three Fiber remain optional peer capabilities and are not reachable from the core entry point.

Its Node-only internal discovery module completes roadmap item 2.1 with TypeScript 7 AST and symbol analysis. It finds composed tokens and statically visible core/React raw forms, reduces immutable font/raster expressions, maps URL pathnames into canonical asset roots, and validates only the exact imported raster package's ESM baker manifest. It never executes application modules. The module is intentionally absent from the package export map until item 2.4 supplies the complete `@pmndrs/text/bake` API.

It does not currently load fonts, shape text, perform paragraph layout, write baked assets, or render glyphs. The [roadmap](../roadmap/roadmap.md) owns the implementation order for those behaviors.

## Package scripts

| Script | Purpose |
| --- | --- |
| `typecheck` | Type-check package source without emission. |
| `test` | Build, run compile-only API fixtures, package-manifest checks, and Node discovery integration tests. |
| `test:types` | Compile positive and negative public-contract fixtures. |
| `build` | Emit the ESM package and declarations. |

The [API contract](../planning/api-shapes.md) remains authoritative for proposed public behavior; this concept explains the package that currently embodies its compile-time subset.[^api-contract]

[^api-contract]: The implementation must not be inferred to exist merely because its types compile.
