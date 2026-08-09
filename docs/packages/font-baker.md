---
type: Workspace Package
title: '@pmndrs/text-font-baker'
description: Implements the internal portable Rust/Wasm shaping-resource bake core and direct-memory TypeScript wrapper.
resource: ../../packages/font-baker
workspace_package: '@pmndrs/text-font-baker'
documentation_type: reference
source_digest: 'sha256:80fb2bd14e5b3ad0f8f9e87bd455057998c0a1c7f9e5acda51b45815857d480c'
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
  at: '2026-08-04T17:42:34Z'
---

# Package reference: `@pmndrs/text-font-baker`

Status: ✅ portable shaping-data core complete; shared by offline and runtime hosts; Latin, Arabic, and CJK conformance proven

This package keeps the Rust crate, `no_std + alloc` Wasm build, compiler-derived ABI contract, direct-linear-memory TypeScript wrapper, core artifact validator, vendored schema bundle, and tiered tests together. It emits a deterministic shaping-only core GLB. A build-only Rust generator emits both portable JSON and an exact typed `as const` TypeScript module from the same compiler facts. The generated contract also carries the exact baker, font-format, HarfRust, HarfBuzz, Unicode, glTF schema, validator, and Binaryen pins consumed by provenance and fixtures. Its contract-only subpath exposes the baker and format versions shared by the bridge, validator, and public loader without importing Wasm host code.

Build and typecheck commands invoke the repository-pinned TypeScript compiler directly. The previous native-process memory guard was removed after the patched `@types/three` declaration graph eliminated the checker expansion; this package does not import TSL but shares the same ordinary workspace compiler path.

Build-only command capture waits for the producer's stdout stream to close before parsing compiler-derived ABI JSON. Child-process exit alone is not treated as output completion: a causal integration regression keeps inherited stdout open beyond producer exit and proves the complete JSON payload is retained before parsing.

The separate `@pmndrs/text-font-baker/validate` ESM entry treats every baked asset as untrusted. It enforces exact GLB framing and padding, retains the pinned Khronos 2.0.0-dev.3.10 report with only exact unsupported-extension and extension-buffer informational messages admitted, evaluates the canonical Draft-04 extension schema with Ajv 6.15.0 against the vendored Khronos revision, and checks buffer ranges, versions, reciprocal raster identity, reduced-SFNT checksums/metrics, dense extents, zero padding, and the domain-separated shaping hash. URI-addressed external raster entries require a lowercase SHA-256 artifact hash; resolver-only entries may omit both URI and hash. Its exact Khronos allowlist accepts open package-owned extension names while semantic validation remains with their packages. Closed-profile SFNT tags are compared as their four raw directory bytes, so non-ASCII hostile tags fail through the same structured issue contract instead of escaping through UTF-8 decoding. It exports the strict framing, report, and generic extension-schema primitives used by companion validators without moving companion semantics into core. Node `Buffer` inputs are explicitly copied before the temporary checksum-adjustment normalization, and repeat-validation tests prove the validator never mutates their bytes. The main baker entry has no static edge to either validation engine.

The integration suite also compiles the canonical MTSDF and Slug Draft-04 schemas directly from the knowledge bundle with their shared resource references. Positive V0 specimens and one-field mutations keep required members, 20/40-byte record strides, MTSDF encoding, linear color space, lossless RGBA8 MTSDF pages, and lossless RGBA16F Slug curve pages executable before either generator lands. These schema tests do not claim an implemented raster; they prevent Milestone 8 and 9 code from beginning against an internally inconsistent draft.

The build applies pinned Binaryen 129.0.0 `-Oz` after Rust release linking. Canonical path remapping removes host workspace and Cargo registry prefixes before compilation. The current hardened zero-import module is 422,538 raw bytes while preserving the canonical font artifact hash. Pinned dynamic Talc 5.0.4 owns the ABI-private Wasm heap; it saves 9,801 raw, 3,352 gzip, and 2,342 Brotli bytes relative to the measured `dlmalloc` build without imposing a fixed arena reservation. Its ABI JSON remains a published tool artifact, but production Wasm embeds neither that JSON nor ABI pointer/length exports; production TypeScript imports and publicly re-exports the generated constant directly, while construction validates the contract-declared Wasm exports once. Native Rust/Binaryen hosts may permute equivalent internal Wasm function indices across CPU architectures, so source/product goldens and the optimized length are portable checks while the exact module hash is canonical release-builder provenance. This package is the sole owner of those optimized bytes and exposes one browser-safe canonical URL; the offline Node host reads that URL and the runtime Worker fetches it instead of `@pmndrs/text` shipping a second copy. Reports keep raw and transport costs distinct.

The direct-memory boundary owns every request and response allocation in a module registry. Its fixed-width `#[repr(C)]` response header publishes compiler-derived size, alignment, and offsets from `size_of`, `align_of`, and `offset_of!`. Rust serialization consumes those same facts; build-only generation makes them an exact TypeScript type and value, and CI fails when checked-in output is stale. There is no numeric layout mirror to maintain and no runtime JSON parse, QuickType, JSON Schema, or binding-generator dependency in the baker. Caller-controlled requests are capped at 64 MiB and use fallible reservation; use and release require the exact active pointer/length pair, forged or repeated releases are harmless, checked response arithmetic prevents truncation, and response metadata cannot outlive its owned bytes. The TypeScript wrapper enters cleanup before its first copy, releases each successful allocation after any later failure, and validates every promised Wasm export and response/error field before constructing a public result. It decodes the response while the Wasm allocation is live and copies only the artifact ranges that must survive release, avoiding a redundant full-response copy. The fixed, tiny `WasmState` allocation still uses stable Rust's infallible `Box::new` once per Wasm instance; replacing that theoretical OOM trap would require unstable allocator APIs or a disproportionate static-state design.

Font interpretation is library-owned: Fontations `read-fonts` parses SFNT/TTC tables and `skrifa` supplies metrics and glyph bounds.[^fontations] Project code owns the accepted table policy, reduced-SFNT serialization, V0 extent encoding, hashes, reports, ABI, and GLB contract. Provenance requires the selected collection face index alongside the descriptor hash so later runtime raster baking cannot silently fall back to face zero; the schema, validator, loader, and generated artifacts all enforce that single unpublished V0 contract. A source `STAT` table alone is not evidence of variation axes and no longer rejects an otherwise static font; actual axis/delta tables still reject V0 input, and `STAT` remains omitted from the reduced static payload.

The portable bake path does not run HarfRust, shape Unicode, generate a bitmap, discover application fonts, or provide a filesystem/Worker host. The public Node host now wraps it from `@pmndrs/text/bake`; the Worker and runtime shaper remain separate packages. Its host-only `generate-shaping-oracle` binary uses pinned HarfRust 0.12.0 to produce deterministic UTF-16 fixture JSON and is not linked into the `no_std` Wasm artifact. The oracle-only `inspect-font-fixture` binary uses Fontations rather than a project parser to emit deterministic glyph/table/cmap facts. Mandatory package E2E lanes authenticate Inter 4.1, Amiri 1.002, and Noto Sans CJK JP 2.004 before exercising the compiled Wasm API; none can skip based on the environment. Noto proves the 65,535-glyph boundary, `cmap` formats 12/14, supplementary/variation mappings, exact source/reduced HarfRust and HarfBuzz equality, and exact retention of source `BASE`, `VORG`, `vhea`, and `vmtx` without fabricating absent tables or implementing vertical layout.

The isolated nightly fuzz workspace also hosts the repository-owned MTSDF outline target because cargo-fuzz remains centralized under one pinned exception. That target depends on the non-shipping admission adapter, not on a product dependency or font parser, and mutates bounded contour commands through core generation. Its separate command, corpus, and artifact directory keep shaping-font and geometry failures attributable.

## Package scripts

| Script  | Purpose                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build` | Derive the ABI contract, compile and optimize the `no_std` Wasm module, and emit the package. CI checks that committed generated output is fresh. |
| `check` | Run the complete package test and type-check gates.                                                                                               |
| `test`  | Build and run Rust unit/integration, compiled Wasm/TypeScript, deterministic fuzz-smoke, and licensed real-font end-to-end tests.                 |

Run `pnpm scripts list font-baker` from the workspace root to discover shaping-oracle, inspection, validator-fuzz, mutation-fuzz, and isolated nightly cargo-fuzz workflows.

See the [implementation evidence](../planning/font-baker-implementation.md) for package-owned proof; the roadmap owns cross-package milestone status.[^implementation-status]

[^fontations]: The package does not maintain a parallel OpenType parser or outline geometry engine.

[^implementation-status]: The implementation-status concept records the executable evidence and next canonical gate.
