---
type: Workspace Package
title: "@pmndrs/text"
description: Defines the public core contracts, package-owned bitmap identity, and internal Node static-discovery implementation.
resource: ../../packages/text
workspace_package: "@pmndrs/text"
documentation_type: reference
source_digest: "sha256:cb6a5dce74a00bae16a87219a8272b9e0dd8dff34b52bdc394fd78f3c95735eb"
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
  - id: compiler-adapter
    resource: ../../packages/text/src/compiler-adapter.ts
    title: Pinned TypeScript compiler adapter
  - id: bitmap-identity
    resource: ../../packages/text/src/raster/bitmap.ts
    title: Bitmap descriptor and raster identity implementation
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T04:32:34Z"
---

# Package reference: `@pmndrs/text`

Status: 🟡 public contract scaffold with static discovery and bitmap identity implemented

This package owns the accepted public core and React contract types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, React prop derivation, lazy raster and `useFont` inference, and invalid combinations at compile time. React and React Three Fiber remain optional peer capabilities and are not reachable from the core entry point.

The browser-safe `@pmndrs/text/raster/bitmap` subpath now owns bitmap generator/format constants, exact runtime validation of the non-empty static strike tuple, ascending canonical strike order, the complete generator-versioned descriptor, RFC 8785 serialization, and SHA-256 raster-key derivation. Equivalent strike sets therefore produce one identity regardless of caller order, while duplicate, non-integral, non-finite, non-positive, or out-of-range values fail before baking. The implementation uses Web Crypto and imports no Node built-ins.[^bitmap-identity]

Its Node-only internal discovery module completes roadmap item 2.1 with pinned TypeScript 7 AST and symbol analysis over TypeScript, TSX, JavaScript, and JSX projects. It finds composed tokens and statically visible core/React raw forms, reduces immutable font/raster expressions, maps URL pathnames into canonical asset roots, and validates only the exact imported raster package's ESM baker manifest. It never executes application modules. One internal compiler adapter owns every unstable TypeScript import, project snapshot, symbol handle, alias, and declaration-resolution operation; an exact-version assertion and source-boundary test make compiler upgrades explicit. The module is intentionally absent from the package export map until item 2.4 supplies the complete `@pmndrs/text/bake` API.

It does not currently load fonts, shape text, perform paragraph layout, write baked assets, or render glyphs. The [roadmap](../roadmap/roadmap.md) owns the implementation order for those behaviors.

## Package scripts

| Script | Purpose |
| --- | --- |
| `typecheck` | Type-check package source without emission. |
| `test` | Build, run compile-only API fixtures, package/adapter guards, and TypeScript/JavaScript discovery integration tests. |
| `test:types` | Compile positive and negative public-contract fixtures. |
| `build` | Emit the ESM package and declarations. |

The [API contract](../planning/api-shapes.md) remains authoritative for proposed public behavior; this concept explains the package that currently embodies its compile-time subset.[^api-contract]

[^api-contract]: The implementation must not be inferred to exist merely because its types compile.
[^bitmap-identity]: The emitted bitmap payload, semantic validator, and runtime module remain gated by roadmap item 2.3; this entry claims only the implemented descriptor and identity boundary.
