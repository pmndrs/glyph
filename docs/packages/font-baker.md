---
type: Workspace Package
title: "@pmndrs/text-font-baker"
description: Implements the internal portable Rust/Wasm shaping-resource bake core and direct-memory TypeScript wrapper.
resource: ../../packages/font-baker
workspace_package: "@pmndrs/text-font-baker"
documentation_type: reference
source_digest: "sha256:529c6a7b600babed7edd6fb28ceb80a25ad46d47554dc853b917142a8f903a14"
tags: [package, rust, wasm, baking, internal]
sources:
  - id: manifest
    resource: ../../packages/font-baker/package.json
    title: Package manifest
  - id: implementation-status
    resource: ../planning/font-baker-implementation.md
    title: Portable font baker implementation evidence
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
  by: openai-codex/gpt-5.6
  at: "2026-07-26T20:08:45Z"
---

# Package reference: `@pmndrs/text-font-baker`

Status: ✅ portable shaping-data core complete; shared by offline and runtime hosts; Latin, Arabic, and CJK conformance proven

This package keeps the Rust crate, `no_std + alloc` Wasm build, generated JSON ABI contract, direct-linear-memory TypeScript wrapper, core artifact validator, vendored schema bundle, and tiered tests together. It emits a deterministic shaping-only core GLB. The generated contract also carries the exact baker, font-format, HarfRust, HarfBuzz, Unicode, glTF schema, validator, and Binaryen pins consumed by provenance and fixtures. Its contract-only subpath exposes the baker and format versions shared by the bridge, validator, and public loader without importing Wasm host code.

The separate `@pmndrs/text-font-baker/validate` ESM entry treats every baked asset as untrusted. It enforces exact GLB framing and padding, retains the pinned Khronos 2.0.0-dev.3.10 report with only exact unsupported-extension and extension-buffer informational messages admitted, evaluates the canonical Draft-04 extension schema with Ajv 6.15.0 against the vendored Khronos revision, and checks buffer ranges, versions, reciprocal raster identity, reduced-SFNT checksums/metrics, dense extents, zero padding, and the domain-separated shaping hash. URI-addressed external raster entries require a lowercase SHA-256 artifact hash; resolver-only entries may omit both URI and hash. Its exact Khronos allowlist accepts open package-owned extension names while semantic validation remains with their packages. Closed-profile SFNT tags are compared as their four raw directory bytes, so non-ASCII hostile tags fail through the same structured issue contract instead of escaping through UTF-8 decoding. It exports the strict framing, report, and generic extension-schema primitives used by companion validators without moving companion semantics into core. Node `Buffer` inputs are explicitly copied before the temporary checksum-adjustment normalization, and repeat-validation tests prove the validator never mutates their bytes. The main baker entry has no static edge to either validation engine.

The integration suite also compiles the canonical MTSDF and Slug Draft-04 schemas directly from the knowledge bundle with their shared resource references. Positive V0 specimens and one-field mutations keep required members, 20/40-byte record strides, MTSDF encoding, linear color space, lossless RGBA8 MTSDF pages, and lossless RGBA16F Slug curve pages executable before either generator lands. These schema tests do not claim an implemented raster; they prevent Milestone 8 and 9 code from beginning against an internally inconsistent draft.

The build applies pinned Binaryen 129.0.0 `-Oz` after Rust release linking. Canonical path remapping removes host workspace and Cargo registry prefixes before compilation. The current hardened zero-import module is 433,755 raw bytes, 168,251 gzip bytes, and 136,793 Brotli bytes while preserving the embedded ABI and canonical font artifact hash. Native Rust/Binaryen hosts may permute equivalent internal Wasm function indices across CPU architectures, so source/product goldens and the optimized length are portable checks while the exact module hash is canonical release-builder provenance. This package is the sole owner of those optimized bytes and exposes one browser-safe canonical URL; the offline Node host reads that URL and the runtime Worker fetches it instead of `@pmndrs/text` shipping a second copy. Reports keep raw and transport costs distinct.

The direct-memory boundary owns every request and response allocation in a module registry. Caller-controlled requests are capped at 64 MiB and use fallible reservation; use and release require the exact active pointer/length pair, forged or repeated releases are harmless, checked response arithmetic prevents truncation, and response metadata cannot outlive its owned bytes. The TypeScript wrapper enters cleanup before its first copy, releases each successful allocation after any later failure, and validates the complete generated ABI plus every promised response/error field before constructing a public result. It decodes the response while the Wasm allocation is live and copies only the artifact ranges that must survive release, avoiding a redundant full-response copy. The fixed, tiny `WasmState` allocation still uses stable Rust's infallible `Box::new` once per Wasm instance; replacing that theoretical OOM trap would require unstable allocator APIs or a disproportionate static-state design.

Font interpretation is library-owned: Fontations `read-fonts` parses SFNT/TTC tables and `skrifa` supplies metrics and glyph bounds.[^fontations] Project code owns the accepted table policy, reduced-SFNT serialization, V0 extent encoding, hashes, reports, ABI, and GLB contract. A source `STAT` table alone is not evidence of variation axes and no longer rejects an otherwise static font; actual axis/delta tables still reject V0 input, and `STAT` remains omitted from the reduced static payload.

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

See the [implementation evidence](../planning/font-baker-implementation.md) for package-owned proof; the roadmap owns cross-package milestone status.[^implementation-status]

[^fontations]: The package does not maintain a parallel OpenType parser or outline geometry engine.
[^implementation-status]: The implementation-status concept records the executable evidence and next canonical gate.
