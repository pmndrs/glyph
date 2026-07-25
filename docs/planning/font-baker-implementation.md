---
type: Implementation Status
title: Font baker implementation status
description: Tracks the implemented portable Rust bake core, TypeScript Wasm wrapper, validation evidence, and remaining integration boundaries.
resource: ../../packages/font-baker
tags: [baking, rust, wasm, typescript, implementation]
sources:
  - id: "citation-1"
    resource: "api-shapes.md#shared-bake-core"
    title: "Shared bake core API contract"
  - id: "citation-2"
    resource: "shaping-data-contract.md"
    title: "Shaping data contract V0"
  - id: "citation-3"
    resource: "../roadmap/roadmap.md"
    title: "Canonical implementation roadmap"
  - id: "citation-4"
    resource: "../../packages/font-baker"
    title: "`packages/font-baker`"
  - id: "citation-5-1"
    resource: "../../packages/font-baker/rust/src/abi_contract.rs"
    title: "ABI contract constants"
  - id: "citation-5-2"
    resource: "../../packages/font-baker/rust/build.rs"
    title: "compile-time generator"
  - id: "citation-6"
    resource: "../../packages/font-baker/tests/support/font-glb.mjs"
    title: "Real-font GLB probe"
  - id: "fontations"
    resource: "https://github.com/googlefonts/fontations"
    title: "Fontations"

generated:
  by: "openai-codex/gpt-5"
  at: "2026-07-25T02:56:50Z"
---

# Font baker implementation status

This page records implementation truth for the portable core started from roadmap item 2.2. It does not replace the [canonical roadmap](../roadmap/roadmap.md), the [bake API contract](api-shapes.md#shared-bake-core), or the [shaping data contract](shaping-data-contract.md).

Status key: ✅ complete for the declared slice · 🟡 in progress · ⬜ not started · ⛔ blocked

| Area | Status | Current evidence | Next gate |
| --- | :---: | --- | --- |
| Package placement | ✅ | Rust, Wasm, TypeScript, build support, and tests live together in `packages/font-baker`; no new implementation workspace is rooted at the repository top level. | Keep future baker artifacts inside package directories. |
| Portable Rust core | ✅ | Delegates SFNT/TTC and typed-table parsing to Fontations `read-fonts`, and metrics/bounds interpretation to `skrifa`; public fixtures cover container/table policy, face selection, deterministic reduction, dense extents, shaping identity, and exact Inter 4.1 output.[^fontations] | Keep every new policy branch paired with a focused regression. |
| Stable Wasm ABI | ✅ | Rust generates the JSON contract at compile time from the response-layout constants. The `wasm32-unknown-unknown` module embeds those bytes, `generate-abi` emits them for package tooling, and the TypeScript shim resolves exports and offsets from them. It uses no WASI or generated binding runtime. | Add ABI compatibility fixtures before changing version 0. |
| Wasm allocator | 🟡 | The `no_std + alloc` build uses ABI-private `dlmalloc` as a working baseline. | Run the [`rlsf`/`lol_alloc` experiment](font-baker-allocator.md) in representative one-shot and repeated-bake Worker lifecycles. |
| TypeScript wrapper | ✅ | Implements the accepted `FontBakeRequestV0 → FontBakeResultV0` boundary, instantiates the raw Wasm module, reads generated ABI JSON, transfers bytes through linear memory, returns typed bytes/reports, and maps structured errors. | Reuse this exact core in the Node and Worker hosts. |
| Unit verification | ✅ | Rust unit tests isolate checksum padding, outward V0 bounds encoding, and GLB alignment behavior. | Add a focused regression with every internal defect or policy branch. |
| Package integration | ✅ | Public Rust tests validate ABI fields, source/container/table policy, TTC face selection, and structured errors. Compiled-Wasm tests validate the pinned optimized module, zero imports, generated/published ABI identity, direct-memory behavior, and errors. | Item 2.3 adds reusable GLB/schema validators rather than test-only inspection. |
| Real-font vertical slice | ✅ | The mandatory package E2E verifies canonical Inter identity, deterministic exact artifact/report values, closed SFNT structure/checksums/metrics, dense extents/hash, and source-versus-reduced HarfRust equality over every checked-in case. | Item 2.3 adds pinned Khronos and JSON Schema reports plus bitmap composition. |
| Product end-to-end | ⬜ | The package test stops at the produced GLB and is not presented as real-product coverage. | Exercise discovery/load, Node/Worker parity, shaping, layout, and rendering through public APIs in `apps/benchmarks`. |
| TypeScript verification | ✅ | Generated/embedded ABI equality, zero-import, structured-error handling, declaration generation, package build, and workspace type checks pass with the pinned workspace dependencies. | Keep these checks mandatory as public host surfaces are added. |
| Roadmap item 2.2 | ✅ | The exact host-independent request/result boundary, source validation/face selection, deterministic reduction, Inter identities, reduced-SFNT HarfRust conformance, and pinned Binaryen build are executable. | Preserve this core unchanged behind both hosts; host parity closes in 3.3. |
| Roadmap item 2.1 | ✅ | `@pmndrs/text` has a TypeScript 7 AST/symbol analyzer with the complete static-source, raw-form, raster-manifest, path-safety, and negative fixture matrix across typed and plain-JavaScript inputs. One version-guarded adapter owns all unstable compiler imports and snapshot/symbol resolution; it remains internal until the complete Node host ships. | Reuse its report in item 2.4 without creating a second manifest or analyzer. |
| Roadmap item 2.3 | 🟡 | Reusable core/raster validators and package-owned bitmap output are the active slice. | Close schema, semantic, bitmap artifact, and golden gates. |
| Roadmap item 2.4 | ⬜ | The public Node host, filesystem output, and CLI remain intentionally absent. | Start only after 2.3 closes. |
| Runtime shaping (milestone 4) | ⬜ | This package bakes shaping input; it does not yet embed or call HarfRust for runtime shaping. | Start only at the milestone 4 gate. |

The TypeScript package is intentionally internal. The public API remains the planned `@pmndrs/text/bake` Node subpath, and the runtime path remains a dynamically imported Worker host. Both will reuse this portable core without exposing its raw allocation protocol.

[^fontations]: `read-fonts` provides checked zero-allocation OpenType table access and `skrifa` provides maintained glyph metadata and bounds. HarfRust remains the separate shaping engine scheduled by milestone 4.
