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
  at: "2026-07-25T01:15:06Z"
---

# Font baker implementation status

This page records implementation truth for the portable core started from roadmap item 2.2. It does not replace the [canonical roadmap](../roadmap/roadmap.md), the [bake API contract](api-shapes.md#shared-bake-core), or the [shaping data contract](shaping-data-contract.md).

Status key: ✅ complete for the declared slice · 🟡 in progress · ⬜ not started · ⛔ blocked

| Area | Status | Current evidence | Next gate |
| --- | :---: | --- | --- |
| Package placement | ✅ | Rust, Wasm, TypeScript, build support, and tests live together in `packages/font-baker`; no new implementation workspace is rooted at the repository top level. | Keep future baker artifacts inside package directories. |
| Portable Rust core | 🟡 | Delegates SFNT/TTC and typed-table parsing to Fontations `read-fonts`, and metrics/bounds interpretation to `skrifa`; project code owns only the closed table policy, reduced-SFNT serialization, V0 extent encoding, shaping hash, GLB, and payload report.[^fontations] | Exercise it against the pinned authorized font and malformed corpus. |
| Stable Wasm ABI | ✅ | Rust generates the JSON contract at compile time from the response-layout constants. The `wasm32-unknown-unknown` module embeds those bytes, `generate-abi` emits them for package tooling, and the TypeScript shim resolves exports and offsets from them. It uses no WASI or generated binding runtime. | Add ABI compatibility fixtures before changing version 0. |
| Wasm allocator | 🟡 | The `no_std + alloc` build uses ABI-private `dlmalloc` as a working baseline. | Run the [`rlsf`/`lol_alloc` experiment](font-baker-allocator.md) in representative one-shot and repeated-bake Worker lifecycles. |
| TypeScript wrapper | 🟡 | Instantiates the raw Wasm module, reads its ABI JSON, transfers bytes through linear memory, returns typed GLB bytes and reports, and maps Rust diagnostics to `FontBakeError`. | Integrate the wrapper behind the internal host-independent bake interface used by Node and Worker hosts. |
| Unit verification | ✅ | Rust unit tests isolate checksum padding, outward V0 bounds encoding, and GLB alignment behavior. | Add a focused regression with every internal defect or policy branch. |
| Package integration | ✅ | Public Rust tests validate generated ABI fields and structured descriptor/font errors. The compiled Wasm test validates zero imports, generated/published ABI identity, direct-memory wrapper behavior, and structured Rust errors. | Add fixture-level SFNT, GLB-schema, and HarfRust-equivalence cases. |
| Real-font vertical slice | 🟡 | A package E2E lane bakes an explicitly supplied licensed OpenType font twice through the compiled TypeScript/Wasm surface, verifies deterministic bytes, and parses the complete GLB container, references, dense extents cardinality, and embedded SFNT envelope. It skips until `PMNDRS_TEXT_TEST_FONT` is supplied. | Pin the canonical font, license, version, and hash; then add the pinned Khronos, JSON Schema, and semantic validator layers required by the tooling plan. |
| Product end-to-end | ⬜ | The package test stops at the produced GLB and is not presented as real-product coverage. | Exercise discovery/load, Node/Worker parity, shaping, layout, and rendering through public APIs in `apps/benchmarks`. |
| TypeScript verification | ✅ | Generated/embedded ABI equality, zero-import, structured-error handling, declaration generation, package build, and workspace type checks pass with the pinned workspace dependencies. | Keep these checks mandatory as public host surfaces are added. |
| Roadmap item 2.2 | 🟡 | The core request/result path and canonical core artifact have an implementation, but fixture and host parity evidence is incomplete. | Complete the 2.2 fixture gate before marking it ✅. |
| Roadmap items 2.1 and 2.3–2.4 | ⬜ | Static discovery, bitmap composition, the public Node host, filesystem output, and CLI are intentionally absent. | Follow the canonical dependency and exit gates. |
| Runtime shaping (milestone 4) | ⬜ | This package bakes shaping input; it does not yet embed or call HarfRust for runtime shaping. | Start only at the milestone 4 gate. |

The TypeScript package is intentionally internal. The public API remains the planned `@pmndrs/text/bake` Node subpath, and the runtime path remains a dynamically imported Worker host. Both will reuse this portable core without exposing its raw allocation protocol.

[^fontations]: `read-fonts` provides checked zero-allocation OpenType table access and `skrifa` provides maintained glyph metadata and bounds. HarfRust remains the separate shaping engine scheduled by milestone 4.
