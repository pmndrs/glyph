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
  - id: abi-source
    resource: ../../packages/font-baker/rust/src/abi_contract.rs
    title: Generated ABI and version-contract source
  - id: binaryen
    resource: https://www.npmjs.com/package/binaryen/v/129.0.0
    title: Binaryen 129.0.0
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T02:56:50Z"
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
| Binaryen / `wasm-opt` | `129.0.0` | npm package; `-Oz`, bulk memory, nontrapping float-to-int |
| TypeScript discovery compiler | `7.0.2` | npm package; exact runtime assertion and isolated unstable-API adapter |
| `PMNDRS_font` format | `0` | extension schema and shaping contract |
| Portable baker ABI | `0` | generated `font-baker-abi-v0.json` |
| Font baker | `0.0.0` | Cargo/npm package version during the integration slice |
| Bitmap generator | `0.0.0` | reserved initial package version for roadmap item 2.3 |

## Generated contract

The Rust ABI source generates the published JSON contract at build time. Its `versions` object carries the baker, format, shaper, oracle, Unicode, glTF schema, validator, and Binaryen pins; Rust provenance and the TypeScript direct-memory shim consume that same source rather than repeating freehand values.

Every raster generator stamps its exact owning package semantic version into its canonical descriptor and artifact provenance. A generator upgrade changes its descriptor hash and therefore its raster key. The bitmap generator begins at `0.0.0`; additional raster generators receive their own exact pins when their packages enter the roadmap.

## Change rules

| Change | Required evidence |
| --- | --- |
| Shaper or oracle | Old/new structured shaping diff over the complete pinned corpus. |
| Unicode | Version-matched UAX data, conformance runs, and package-size report. |
| glTF schema or validator | Schema/validator report diff with reviewed extension-only allowlist changes. |
| Binaryen | Raw/compressed module diff plus zero-import, ABI, deterministic artifact, and real-font equivalence. |
| TypeScript discovery compiler | Adapter compatibility, unstable-import isolation, typed/plain-JavaScript discovery, and complete discovery fixture suite. |
| ABI or font format | Explicit version increment, compatibility decision, and old/new fixture coverage. |
| Baker or raster generator | Deterministic artifact diff, payload report, and Node/Worker parity run. |

Fixture manifests record these values explicitly. Updating this page alone never upgrades the code: the generated ABI, package locks, fixtures, and compatibility tests must change in the same atomic workstream.
