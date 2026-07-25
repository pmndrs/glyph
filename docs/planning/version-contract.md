---
type: Version Contract
title: V0 toolchain and format version pins
description: Lists the exact source, oracle, schema, validator, ABI, format, and generator versions used by V0 artifacts and fixtures.
documentation_type: reference
tags: [versions, provenance, compatibility, tooling]
sources:
  - id: harfrust
    resource: https://crates.io/crates/harfrust/0.12.0
    title: HarfRust 0.12.0
  - id: harfbuzz
    resource: https://github.com/harfbuzz/harfbuzz/releases/tag/13.0.0
    title: HarfBuzz 13.0.0
  - id: unicode
    resource: https://www.unicode.org/versions/Unicode17.0.0/
    title: Unicode 17.0.0
  - id: gltf-schema
    resource: https://github.com/KhronosGroup/glTF/tree/77b44be7bef26e01fb0b140e3d5bb1716421c5e9/specification/2.0/schema
    title: Pinned glTF 2.0 schema revision
  - id: gltf-validator
    resource: https://www.npmjs.com/package/gltf-validator/v/2.0.0-dev.3.10
    title: glTF Validator 2.0.0-dev.3.10
  - id: ajv
    resource: https://www.npmjs.com/package/ajv/v/6.15.0
    title: Ajv 6.15.0
  - id: abi-source
    resource: ../../packages/font-baker/rust/src/abi_contract.rs
    title: Generated ABI and version-contract source
  - id: binaryen
    resource: https://www.npmjs.com/package/binaryen/v/129.0.0
    title: Binaryen 129.0.0
  - id: cargo-fuzz
    resource: https://crates.io/crates/cargo-fuzz/0.13.2
    title: cargo-fuzz 0.13.2
  - id: libfuzzer-sys
    resource: https://crates.io/crates/libfuzzer-sys/0.4.13
    title: libfuzzer-sys 0.4.13
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T04:18:36Z"
---

# V0 toolchain and format version pins

These values are exact fixture and provenance inputs. “Latest” is never a valid stored version.

## Authoritative pins

| Surface | Pin | Source identity |
| --- | --- | --- |
| Rust toolchain | `1.97.1` | `rust-toolchain.toml` |
| HarfRust | `0.12.0` | tag commit `60b28ea22b5261710018d69c168a762bcb28794c` |
| HarfBuzz oracle | `13.0.0` | tag commit `a0fc099681a69ae40665fbea74982a2e9d7a5260` |
| Unicode | `17.0.0` | versioned UCD and UAX data |
| glTF specification | `2.0` | Khronos schema commit `77b44be7bef26e01fb0b140e3d5bb1716421c5e9` |
| Khronos glTF Validator | `2.0.0-dev.3.10` | npm package |
| JSON Schema Draft-04 evaluator | Ajv `6.15.0` | npm package; exact extension-schema negative matrix |
| Binaryen / `wasm-opt` | `129.0.0` | npm package; `-Oz`, bulk memory, nontrapping float-to-int |
| TypeScript discovery compiler | `7.0.2` | npm package; exact runtime assertion and isolated unstable-API adapter |
| Rust mutation fuzzer | Font baker `0.0.0` | host-only binary compiled by the canonical Rust toolchain; seed `0x504d4e44` |
| Coverage-guided Rust fuzzer | `nightly-2026-06-01` (`14210df0e`) + cargo-fuzz `0.13.2` + libfuzzer-sys `0.4.13` | nested mise-owned fuzz workspace; fixed default seed `0x504d4e44`; excluded from product builds |
| `PMNDRS_font` format | `0` | extension schema and shaping contract |
| Portable baker ABI | `0` | generated `font-baker-abi-v0.json` |
| Font baker | `0.0.0` | Cargo/npm package version during the integration slice |
| Bitmap generator | `0.0.0` | reserved initial package version for roadmap item 2.3 |
| Bitmap outline rasterizer | Zeno `0.3.3` | unhinted grayscale mask generation from Skrifa outline commands |
| KTX2 Rust model/parser | `ktx2` `0.5.0` | compile-time R8 DFD generation plus native artifact validation |
| KTX2 JavaScript parser | `ktx-parse` `1.1.0` | package-owned artifact and runtime page validation |

## Generated contract

The Rust ABI source generates the published JSON contract at build time. Its `versions` object carries the baker, format, shaper, oracle, Unicode, glTF schema, validator, and Binaryen pins; Rust provenance and the TypeScript direct-memory shim consume that same source rather than repeating freehand values.

Every raster generator stamps its exact owning package semantic version into its canonical descriptor and artifact provenance. A generator upgrade changes its descriptor hash and therefore its raster key. The bitmap generator begins at `0.0.0`; additional raster generators receive their own exact pins when their packages enter the roadmap.

## Change rules

| Change | Required evidence |
| --- | --- |
| Shaper or oracle | Old/new structured shaping diff over the complete pinned corpus. |
| Unicode | Version-matched UAX data, conformance runs, and package-size report. |
| glTF schema or validator | Schema/validator report diff with reviewed extension-only allowlist changes; vendored schema archive SHA-256 is `0f1e200bb081d1fcc7a976ee40f05f95b406ed80f43836550af96b73e5a64bef`. |
| Binaryen | Raw/compressed module diff plus zero-import, ABI, deterministic artifact, and real-font equivalence. |
| TypeScript discovery compiler | Adapter compatibility, unstable-import isolation, typed/plain-JavaScript discovery, and complete discovery fixture suite. |
| Fuzz harness | Deterministic seed replay, fixed-seed stable smoke, bounded cargo-fuzz execution, exact root/nested toolchain authorities, mise/cargo-fuzz/libFuzzer drift guards, and minimized-crash promotion. |
| ABI or font format | Explicit version increment, compatibility decision, and old/new fixture coverage. |
| Baker or raster generator | Deterministic artifact diff, payload report, and Node/Worker parity run. |

Fixture manifests record these values explicitly. Updating this page alone never upgrades the code: the generated ABI, package locks, fixtures, and compatibility tests must change in the same atomic workstream.
