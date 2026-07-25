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
    resource: "../../packages/font-baker/src/validator.ts"
    title: "Core font artifact validator"
  - id: "fontations"
    resource: "https://github.com/googlefonts/fontations"
    title: "Fontations"

generated:
  by: "openai-codex/gpt-5"
  at: "2026-07-25T06:14:20Z"
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
| Package integration | ✅ | Public Rust tests validate ABI fields, source/container/table policy, TTC face selection, and structured errors. Compiled-Wasm tests validate the pinned optimized module, zero imports, generated/published ABI identity, direct-memory behavior, and errors. The reusable validation entry adds strict GLB framing, exact Khronos-report admission, Draft-04 required/union coverage, schema-copy identity, semantic identity, hostile payload mutation tests, and repeatable non-mutating Node `Buffer` validation. | Reuse the same hostile-input discipline at loader, shaping, and paragraph boundaries. |
| Fuzz verification | ✅ | CI runs deterministic arbitrary-byte Rust bake smoke and artifact-mutation validation smoke with seed `0x504d4e44`. Longer source/artifact mutation drivers remain stable-toolchain tools. The isolated coverage target uses mise-owned `nightly-2026-06-01`, cargo-fuzz 0.13.2, and libfuzzer-sys 0.4.13 against the same public bake boundary, seeded from pinned Inter without copying fixture bytes. Minimized failures must enter the malformed corpus. | Add package-owned targets whenever bitmap, loader, shaping, layout, or renderer trust boundaries arrive. |
| Real-font vertical slice | ✅ | The mandatory package E2E verifies canonical Inter identity, deterministic exact artifact/report values, validates the artifact through the shipped layered validator, and proves source-versus-reduced HarfRust equality over every checked-in case. Item 2.3 adds exact split/combined bitmap and empty-raster identities over that same core; item 2.4 proves the same bytes through explicit and discovered Node paths. | Prove authoritative Worker parity in item 3.3, then consume the extracted SFNT in runtime shaping. |
| Product end-to-end | 🟡 | Item 3.1 now sends exact Inter GLBs through the public baked-first loader/registry and compares every retained shaping view to independent validation; this is a real package vertical slice but not yet the benchmark product path. | Add Worker parity, then consume the registered views in shaping/layout and the benchmark application. |
| TypeScript verification | ✅ | Generated/embedded ABI equality, zero-import, structured-error handling, declaration generation, package build, and workspace type checks pass with the pinned workspace dependencies. | Keep these checks mandatory as public host surfaces are added. |
| Roadmap item 2.2 | ✅ | The exact host-independent request/result boundary, source validation/face selection, deterministic reduction, Inter identities, reduced-SFNT HarfRust conformance, and pinned Binaryen build are executable. | Preserve this core unchanged behind both hosts; host parity closes in 3.3. |
| Roadmap item 2.1 | ✅ | `@pmndrs/text` has a TypeScript 7 AST/symbol analyzer with the complete static-source, raw-form, raster-manifest, path-safety, and negative fixture matrix across typed and plain-JavaScript inputs. One version-guarded adapter owns all unstable compiler imports and snapshot/symbol resolution; it remains internal until the complete Node host ships. | Reuse its report in item 2.4 without creating a second manifest or analyzer. |
| Roadmap item 2.3 | ✅ | Core and bitmap validators are shipped on import-isolated entries with offline pinned schemas, exact Khronos-report admission, semantic/payload checks, malformed-field matrices, KTX2 parsing, deterministic Rust-input/artifact-mutation fuzz smoke, and real-Inter round trips. The no-std bitmap core uses Fontations/Skrifa, Zeno, generated direct-memory ABI, Binaryen, dense records, and R8 KTX2. The generic composer authenticates results, checks reciprocal identity, handles external artifacts/pages, rebases opaque companion views, and pins combined/empty goldens. | Preserve byte identity behind both hosts; runtime bitmap upload remains milestone 6.1. |
| Roadmap item 2.4 | ✅ | `@pmndrs/text/bake` exposes typed explicit and project APIs over the shared core, selected ESM raster imports, deterministic grouping/composition, safe atomic publication, cancellation, exact output mapping, and complete timing/memory/raw/compressed byte reports. The thin ESM CLI uses that API; exact and repeated Inter fixtures cover embedded/external output plus unsafe filename rejection. | Preserve these bytes behind the dynamically imported Worker host; item 3.2 is active. |
| Roadmap item 3.1 | ✅ | The public loader/registry performs canonical baked probing, full hostile-input validation, shaping-identity registration, exact reduced-SFNT/extents extraction, embedded/external raster attachment, streaming limits, provenance checks, lifecycle invalidation, request deduplication, structured fallback diagnostics, and deterministic loader mutation fuzz smoke. | Supply the default dynamically imported module-Worker fallback in item 3.2. |
| Runtime shaping (milestone 4) | ⬜ | This package bakes shaping input; it does not yet embed or call HarfRust for runtime shaping. | Start only at the milestone 4 gate. |

The portable TypeScript package remains intentionally internal. The public `@pmndrs/text/bake` Node subpath wraps it without exposing the raw allocation protocol; the runtime path remains a dynamically imported Worker host over the same core.

[^fontations]: `read-fonts` provides checked zero-allocation OpenType table access and `skrifa` provides maintained glyph metadata and bounds. HarfRust remains the separate shaping engine scheduled by milestone 4.
