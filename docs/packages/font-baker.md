---
type: Workspace Package
title: "@pmndrs/text-font-baker"
description: Implements the internal portable Rust/Wasm shaping-resource bake core and direct-memory TypeScript wrapper.
resource: ../../packages/font-baker
workspace_package: "@pmndrs/text-font-baker"
documentation_type: reference
source_digest: "sha256:76af1233e8499e4fe67853f7c7d62e36d07f4642e59fb3f011f3b0ca9de0a83d"
tags: [package, rust, wasm, baking, internal]
sources:
  - id: manifest
    resource: ../../packages/font-baker/package.json
    title: Package manifest
  - id: implementation-status
    resource: ../planning/font-baker-implementation.md
    title: Font baker implementation status
  - id: validator
    resource: ../../packages/font-baker/src/validator.ts
    title: Core font artifact validator
  - id: wasm-url
    resource: ../../packages/font-baker/src/wasm-url.ts
    title: Canonical optimized Wasm URL
  - id: fontations
    resource: https://github.com/googlefonts/fontations
    title: Fontations
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T14:19:44Z"
---

# Package reference: `@pmndrs/text-font-baker`

Status: ✅ Milestone 2 portable bake and validation core; reused by the Node host

This package keeps the Rust crate, `no_std + alloc` Wasm build, generated JSON ABI contract, direct-linear-memory TypeScript wrapper, core artifact validator, vendored schema bundle, and tiered tests together. It emits a deterministic shaping-only core GLB. The generated contract also carries the exact baker, font-format, HarfRust, HarfBuzz, Unicode, glTF schema, validator, and Binaryen pins consumed by provenance and fixtures.

The separate `@pmndrs/text-font-baker/validate` ESM entry treats every baked asset as untrusted. It enforces exact GLB framing and padding, retains the pinned Khronos 2.0.0-dev.3.10 report with only exact unsupported-extension and extension-buffer informational messages admitted, evaluates the canonical Draft-04 extension schema with Ajv 6.15.0 against the vendored Khronos revision, and checks buffer ranges, versions, reciprocal raster identity, reduced-SFNT checksums/metrics, dense extents, zero padding, and the domain-separated shaping hash. Its exact Khronos allowlist accepts open package-owned extension names while semantic validation remains with their packages. It exports the strict framing, report, and generic extension-schema primitives used by companion validators without moving companion semantics into core. Node `Buffer` inputs are explicitly copied before the temporary checksum-adjustment normalization, and repeat-validation tests prove the validator never mutates their bytes. The main baker entry has no static edge to either validation engine.

The build applies pinned Binaryen 129.0.0 `-Oz` after Rust release linking. The current hardened zero-import module is 434,285 raw bytes, 168,326 gzip bytes, and 136,887 Brotli bytes while preserving the embedded ABI and canonical font artifact hash. This package is the sole owner of those optimized bytes and exposes one browser-safe canonical URL; the offline Node host reads that URL and the runtime Worker fetches it instead of `@pmndrs/text` shipping a second copy. Reports keep raw and transport costs distinct.

The direct-memory boundary owns every request and response allocation in a module registry. Caller-controlled requests are capped at 64 MiB and use fallible reservation; use and release require the exact active pointer/length pair, forged or repeated releases are harmless, checked response arithmetic prevents truncation, and response metadata cannot outlive its owned bytes. The fixed, tiny `WasmState` allocation still uses stable Rust's infallible `Box::new` once per Wasm instance; replacing that theoretical OOM trap would require unstable allocator APIs or a disproportionate static-state design.

Font interpretation is library-owned: Fontations `read-fonts` parses SFNT/TTC tables and `skrifa` supplies metrics and glyph bounds.[^fontations] Project code owns the accepted table policy, reduced-SFNT serialization, V0 extent encoding, hashes, reports, ABI, and GLB contract.

The portable bake path does not run HarfRust, shape Unicode, generate a bitmap, discover application fonts, or provide a filesystem/Worker host. The public Node host now wraps it from `@pmndrs/text/bake`; the Worker and runtime shaper remain separate packages. Its host-only `generate-shaping-oracle` binary uses pinned HarfRust 0.12.0 to produce deterministic UTF-16 fixture JSON and is not linked into the `no_std` Wasm artifact. The oracle-only `inspect-font-fixture` binary uses Fontations rather than a project parser to emit deterministic glyph/table/cmap facts. Mandatory package E2E lanes authenticate Inter 4.1, Amiri 1.002, and Noto Sans CJK JP 2.004 before exercising the compiled Wasm API; none can skip based on the environment. Noto proves the 65,535-glyph boundary, `cmap` formats 12/14, supplementary/variation mappings, exact source/reduced HarfRust and HarfBuzz equality, and exact retention of source `BASE`, `VORG`, `vhea`, and `vmtx` without fabricating absent tables or implementing vertical layout.

## Package scripts

| Script | Purpose |
| --- | --- |
| `build` | Compile the `no_std` Wasm module, apply pinned `wasm-opt -Oz`, generate the ABI JSON, and emit the TypeScript package. |
| `test:unit` | Run Rust unit tests. |
| `test:integration` | Run public Rust, compiled Wasm/TypeScript, package-isolation, schema, and malformed-artifact tests. |
| `test:fuzz-smoke` | Run deterministic artifact-mutation smoke; Rust arbitrary-byte smoke is part of `test:integration`. |
| `test:e2e` | Verify, bake, validate, inspect, and shape the canonical licensed Inter, Amiri, and Noto CJK fixtures through packaged APIs. |
| `test` | Build and run unit, integration, fuzz-smoke, and real-font end-to-end layers. |
| `fuzz:validator` | Run the longer seeded TypeScript validator mutation driver locally. |
| `fuzz:rust` | Run pinned cargo-fuzz/libFuzzer against the public bake boundary using the nested mise-owned nightly workspace. |
| `fuzz:rust-mutation` | Run the longer deterministic stable-Rust source-font mutation driver. |
| `generate:shaping-oracle` | Produce the pinned HarfRust shaping oracle from explicit font/corpus paths. |
| `inspect:font-fixture` | Emit deterministic Fontations-owned glyph, table, cmap-format, nominal, SVS, and IVS facts for an explicit fixture. |

See the [implementation status](../planning/font-baker-implementation.md) for evidence and open gates.[^implementation-status]

[^fontations]: The package does not maintain a parallel OpenType parser or outline geometry engine.
[^implementation-status]: The implementation-status concept records the executable evidence and next canonical gate.
