---
type: Workspace Package
title: "@pmndrs/text"
description: Defines public core contracts, static discovery, portable bitmap artifacts, validation, and generic composition.
resource: ../../packages/text
workspace_package: "@pmndrs/text"
documentation_type: reference
source_digest: "sha256:5b5390b8d5e135c4052d05143e63ab6592b67ffaa2eacd3c3bebee2e96cc2b0d"
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
  - id: bitmap-baker
    resource: ../../packages/text/rust/bitmap-baker
    title: Portable bitmap generator implementation
  - id: bitmap-validator
    resource: ../../packages/text/src/bakers/bitmap-validator.ts
    title: Layered bitmap artifact validator
  - id: composition
    resource: ../../packages/text/src/internal/compose-bake.ts
    title: Generic core/raster artifact composer
  - id: node-host
    resource: ../../packages/text/src/node/bake.ts
    title: Node bake API and filesystem host
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T05:47:27Z"
---

# Package reference: `@pmndrs/text`

Status: 🟡 implementation slice; Milestone 2 complete and roadmap item 3.1 active

This package owns the accepted public core and React contract types. Its fixtures prove literal font and raster inference, capability composition, source/baked input rules, paragraph constraints, React prop derivation, lazy raster and `useFont` inference, and invalid combinations at compile time. React and React Three Fiber remain optional peer capabilities and are not reachable from the core entry point.

The browser-safe `@pmndrs/text/raster/bitmap` subpath now owns bitmap generator/format constants, exact runtime validation of the non-empty static strike tuple, ascending canonical strike order, the complete generator-versioned descriptor, RFC 8785 serialization, and SHA-256 raster-key derivation. Equivalent strike sets therefore produce one identity regardless of caller order, while duplicate, non-integral, non-finite, non-positive, or out-of-range values fail before baking. The implementation uses Web Crypto and imports no Node built-ins.[^bitmap-identity]

The optional `@pmndrs/text/bakers/bitmap` subpath wraps a zero-import `no_std + alloc` Wasm generator through its Rust-generated JSON ABI and direct linear-memory shim. Fontations/Skrifa owns font and outline interpretation; a small pen bridge feeds Zeno's maintained antialiased rasterizer. A deterministic shelf packer emits one dense 20-byte record per source glyph plus lossless linear R8 KTX2 pages, either embedded in the companion GLB or emitted as hashed external artifacts. Binaryen 129.0.0 `-Oz` reduces the distributed module to 654,666 bytes raw, 237,352 bytes gzip, and 182,025 bytes Brotli without changing its authoritative output.

The isolated `@pmndrs/text/bakers/bitmap/validate` entry reuses the core package's strict GLB framing and pinned Khronos validator, evaluates byte-identical Draft-04 bitmap/resource schemas, parses every declared page variant with `ktx-parse` 1.1.0, and enforces reciprocal identity, exact strikes, dense records, page bounds, KTX2 dimensions/format/levels, GPU-format/feature/quality mapping, external length/hash, arithmetic limits, and GPU budgets. Rust independently parses every native-test KTX2 through `ktx2` 0.5.0. Canonical Inter source/Wasm/artifact/report/record/page identities, embedded/external parity, 65,535-glyph boundaries, generated/published ABI identity, deterministic arbitrary-font Rust fuzz smoke, and fixed-seed artifact mutation fuzz smoke are executable fixtures.[^bitmap-baker]

The internal generic composer authenticates every returned artifact, checks reciprocal shaping/glyph/raster identity, retains external companions and pages, and embeds package-owned companion data without interpreting its semantics. Integer glTF buffer-view references are rebased through the shared naming convention, so multiple distinct extension types compose without a closed registry. Exact Inter goldens cover combined embedded, combined external, and the identity-neutral empty raster set; both the core and bitmap validators round-trip the combined bytes.

The Node-only `@pmndrs/text/bake` subpath closes roadmap item 2.4 around the item-2.1 TypeScript 7 AST/symbol discovery engine. `bakeFont` handles an explicit filesystem input/output pair and retains each selected raster package's exact option type. `bakeProject` finds composed tokens and statically visible core/React raw forms across TypeScript, TSX, JavaScript, and JSX; reduces immutable font/raster expressions; maps URL pathnames into canonical asset roots; groups identical sources; and dynamically imports only the exact verified raster-package ESM entry. It never executes application modules. One internal compiler adapter owns every unstable TypeScript import, project snapshot, symbol handle, alias, and declaration-resolution operation; an exact-version assertion and source-boundary test make compiler upgrades explicit.

The native-ESM `pmndrs-text-bake` command is a thin `bakeProject` adapter. The host writes exclusive same-directory temporary files and atomically renames them only after every artifact is ready, rejects input/output overlap and unsafe package-owned filenames, and cleans temporary files on cancellation. Its report adds phase/total timing, before/after RSS, explicitly process-lifetime peak RSS, output paths and hashes, and raw/gzip/Brotli transport sizes to the authoritative core/raster/container byte report. Exact Inter goldens plus repeated mixed-raster project runs bind deterministic output. The core validator also has a Node `Buffer` purity regression so validation cannot mutate the SFNT checksum field through aliasing slice semantics.[^node-host]

It does not yet load/register fonts, run the Worker fallback, shape text at runtime, perform paragraph layout, or render glyphs. The public runtime bitmap upload/module belongs to milestone 6.1 after loader and layout dependencies; it is not an artifact-pipeline shortcut. The [roadmap](../roadmap/roadmap.md) owns the implementation order.

## Package scripts

| Script | Purpose |
| --- | --- |
| `typecheck` | Type-check package source without emission. |
| `test` | Build, run compile-only API/Node-host fixtures, discovery and CLI tests, Rust/Wasm bitmap generation, layered validators, goldens, deterministic project bakes, and malformed artifacts. |
| `test:types` | Compile positive and negative public-contract fixtures. |
| `test:unit` | Run focused Rust bitmap-core unit tests. |
| `test:integration` | Run Rust public-boundary, Wasm/package, golden, and malformed-artifact integration tests. |
| `test:fuzz-smoke` | Run fixed-seed bitmap artifact mutations twice and require deterministic validation outcomes. |
| `build` | Emit ESM/declarations, compile the no-WASI bitmap Wasm, optimize it with pinned Binaryen, and publish its generated ABI. |

The [API contract](../planning/api-shapes.md) remains authoritative for proposed public behavior; this concept explains the package that currently embodies its compile-time subset.[^api-contract]

[^api-contract]: The implementation must not be inferred to exist merely because its types compile.
[^bitmap-identity]: Raster-specific descriptor fields remain owned by this subpath and never enter a closed core union.
[^bitmap-baker]: Artifact generation, validation, and generic composition are complete; GPU resource creation is deliberately deferred to the renderer milestone.
[^node-host]: The Node host trusts selected installed baker code but authenticates every returned artifact; hostile baked assets are independently revalidated at the loader boundary.
