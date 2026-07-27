---
type: Implementation Evidence
title: Portable font baker implementation evidence
description: Records package-owned evidence for the portable Rust bake core, generated Wasm ABI, TypeScript wrapper, and validator.
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
  by: "openai-codex/gpt-5.6"
  at: "2026-07-27T23:09:57Z"
---

# Portable font baker implementation evidence

This page records evidence owned by `packages/font-baker`. It does not repeat program-wide milestone status: the [canonical roadmap](../roadmap/roadmap.md) owns that checklist, while the [bake API contract](api-shapes.md#shared-bake-core) and [shaping data contract](shaping-data-contract.md) own behavior.

Status key: ✅ complete for the declared slice · 🟡 in progress · ⬜ not started · ⛔ blocked

| Area | Status | Current evidence | Next gate |
| --- | :---: | --- | --- |
| Package placement | ✅ | Rust, Wasm, TypeScript, build support, and tests live together in `packages/font-baker`; no new implementation workspace is rooted at the repository top level. | Keep future baker artifacts inside package directories. |
| Portable Rust core | ✅ | Delegates SFNT/TTC and typed-table parsing to Fontations `read-fonts`, and metrics/bounds interpretation to `skrifa`; public fixtures cover container/table policy, face selection, deterministic reduction, dense extents, shaping identity, and exact Inter 4.1 output.[^fontations] | Keep every new policy branch paired with a focused regression. |
| Stable Wasm ABI | 🟡 | Rust generates and embeds the JSON contract, `generate-abi` emits it for package tooling, and the TypeScript shim resolves exports and offsets from it without WASI or a generated binding runtime. Review found that several layout sizes and offsets are still hand-authored constants rather than compiler-derived facts. | Replace every mirror with fixed-width `#[repr(C)]` layouts, derive JSON through `size_of`/`align_of`/`offset_of!`, add compile-time assertions, and regenerate every dependent resource under roadmap item 8.6. |
| Wasm allocator | 🟡 | The `no_std + alloc` build uses ABI-private `dlmalloc`. Module-owned allocation registries cap caller-controlled requests at 64 MiB, reserve fallibly, retain actual `Vec` ownership, require exact pointer/length pairs, and check response sizes; forged and repeated releases have regression coverage. One fixed small `WasmState` still uses infallible `Box::new` once per instance because stable Rust lacks the proportionate fallible API. | Run the [`rlsf`/`talc`/lifecycle-specific arena experiment](font-baker-allocator.md) in representative one-shot and repeated-bake Worker lifecycles. |
| TypeScript wrapper | ✅ | Implements the accepted `FontBakeRequestV0 → FontBakeResultV0` boundary, instantiates the raw Wasm module, reads generated ABI JSON, transfers bytes through linear memory, returns typed bytes/reports, and maps structured errors. Its package owns the sole optimized Wasm artifact and canonical URL consumed by both the offline Node host and item-3.2 Worker. | Preserve exact offline/Worker output parity and one-copy artifact ownership. |
| Unit verification | ✅ | Rust unit tests isolate checksum padding, outward V0 bounds encoding, and GLB alignment behavior. | Add a focused regression with every internal defect or policy branch. |
| Package integration | ✅ | Public Rust tests validate ABI fields, source/container/table policy, TTC face selection, and structured errors. Compiled-Wasm tests validate the pinned optimized module, zero imports, generated/published ABI identity, direct-memory behavior, exact and forged release metadata, and recovery. The reusable validation entry adds strict GLB framing, exact Khronos-report admission, Draft-04 required/union coverage, schema-copy identity, semantic identity, hostile payload mutation tests, and repeatable non-mutating Node `Buffer` validation. | Reuse the same hostile-input discipline at loader, shaping, paragraph, and renderer boundaries. |
| Fuzz verification | ✅ | CI runs deterministic arbitrary-byte Rust bake smoke and artifact-mutation validation smoke with seed `0x504d4e44`. Longer source/artifact mutation drivers remain stable-toolchain tools. The isolated coverage target uses mise-owned `nightly-2026-06-01`, cargo-fuzz 0.13.2, and libfuzzer-sys 0.4.13 against the same public bake boundary, seeded from pinned Inter without copying fixture bytes. Minimized failures must enter the malformed corpus. | Add package-owned targets whenever bitmap, loader, shaping, layout, or renderer trust boundaries arrive. |
| Real-font vertical slice | ✅ | Mandatory Inter, Amiri, and Noto Sans CJK E2E tests authenticate each source, bake and validate the GLB, extract the reduced SFNT, and prove complete source/reduced HarfRust equality. The Noto lane also fixes the maximum 65,535-glyph boundary, `cmap` 12/14 mappings, conditional vertical-data retention, payload arithmetic, and exact HarfBuzz 13 equality. | Preserve this evidence while raster and renderer packages consume the artifact. |
| TypeScript verification | ✅ | Generated/embedded ABI equality, zero-import, structured-error handling, declaration generation, package build, and workspace type checks pass with the pinned workspace dependencies. | Keep these checks mandatory as public host surfaces evolve. |

The portable TypeScript package remains intentionally internal. The public `@pmndrs/text/bake` Node subpath wraps it without exposing the raw allocation protocol; the runtime path remains a dynamically imported Worker host over the same core.

[^fontations]: `read-fonts` provides checked zero-allocation OpenType table access and `skrifa` provides maintained glyph metadata and bounds. HarfRust is the separately owned runtime shaping engine and is not linked into the portable bake core.
