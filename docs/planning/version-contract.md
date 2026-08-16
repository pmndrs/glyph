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
  - id: harfbuzz-r3f-assets
    resource: https://github.com/harfbuzz/harfbuzz/releases/tag/14.2.0
    title: HarfBuzz 14.2.0
  - id: harfbuzz-utilities-build
    resource: https://github.com/harfbuzz/harfbuzz/blob/a0fc099681a69ae40665fbea74982a2e9d7a5260/util/meson.build
    title: HarfBuzz 13.0.0 utility build definition
  - id: meson
    resource: https://github.com/mesonbuild/meson/releases/tag/1.11.1
    title: Meson 1.11.1
  - id: ninja
    resource: https://github.com/ninja-build/ninja/releases/tag/v1.13.2
    title: Ninja 1.13.2
  - id: unicode
    resource: https://www.unicode.org/versions/Unicode17.0.0/
    title: Unicode 17.0.0
  - id: unicode-linebreak
    resource: https://www.npmjs.com/package/@cto.af/linebreak/v/4.0.3
    title: '@cto.af/linebreak 4.0.3'
  - id: unicode-segmenter
    resource: https://www.npmjs.com/package/unicode-segmenter/v/0.15.0
    title: unicode-segmenter 0.15.0
  - id: unicode-bidi
    resource: https://crates.io/crates/unicode-bidi/0.3.18
    title: unicode-bidi 0.3.18
  - id: read-fonts-runtime
    resource: https://crates.io/crates/read-fonts/0.41.0
    title: read-fonts 0.41.0
  - id: read-fonts-bakers
    resource: https://crates.io/crates/read-fonts/0.42.1
    title: read-fonts 0.42.1
  - id: skrifa
    resource: https://crates.io/crates/skrifa/0.45.1
    title: Skrifa 0.45.1
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
    resource: ../../packages/glyph/rust/font-baker/src/abi_contract.rs
    title: Generated ABI and version-contract source
  - id: shaper-abi-source
    resource: ../../packages/glyph/rust/shaper/src/abi_contract.rs
    title: Generated shaper ABI and version-contract source
  - id: bitmap-abi-source
    resource: ../../packages/glyph/rust/bitmap-baker/src/abi_contract.rs
    title: Generated bitmap baker ABI source
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
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

# V0 toolchain and format version pins

These values are exact fixture and provenance inputs. “Latest” is never a valid stored version.

## Authoritative pins

| Surface                               | Pin                                                                               | Source identity                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust toolchain                        | `1.97.1`                                                                          | `rust-toolchain.toml`                                                                                                                                     |
| HarfBuzz build system                 | Meson `1.11.1` + Ninja `1.13.2`                                                   | exact workload-scoped `apps/benchmarks/mise.toml` pins; used only to build the authenticated HarfBuzz oracle utilities from source                        |
| HarfRust                              | `0.12.0`                                                                          | tag commit `60b28ea22b5261710018d69c168a762bcb28794c`                                                                                                     |
| HarfBuzz oracle                       | `13.0.0`                                                                          | tag commit `a0fc099681a69ae40665fbea74982a2e9d7a5260`                                                                                                     |
| R3F example asset subsetter           | HarfBuzz `14.2.0`                                                                 | authenticated release archive; used only to reproduce the checked Inter Latin and Font Awesome globe assets                                               |
| MTSDF quality oracle                  | Chlumsky `msdfgen` `1.13.0`                                                       | tag `v1.13`, commit `1874bcf7d9624ccc85b4bc9a85d78116f690f35b`; source archive SHA-256 `93cd1ad8918c1a78c5c96e82d4f4c77f0eb86c2e7e8579a0967e54196c4b7167` |
| Unicode                               | `17.0.0`                                                                          | versioned UCD and UAX data                                                                                                                                |
| Unicode Script/Script_Extensions data | `@unicode/unicode-17.0.0` `1.6.17`                                                | build-only generated range-table source                                                                                                                   |
| UAX #29 implementation                | `unicode-segmenter` `0.15.0`                                                      | Unicode 17 extended-grapheme segmentation                                                                                                                 |
| UAX #14 implementation                | `@cto.af/linebreak` `4.0.3`                                                       | Unicode 17 line breaking; complete official corpus gate                                                                                                   |
| UAX #9 implementation                 | `unicode-bidi` `0.3.18`                                                           | `default-features = false`; Unicode 17 bidi classes and brackets are generated in-package                                                                 |
| Runtime shaper font reader            | `read-fonts` `0.41.0`                                                             | HarfRust-matched checked SFNT access                                                                                                                      |
| Baker font reader                     | `read-fonts` `0.42.1`                                                             | portable core and bitmap parsing                                                                                                                          |
| Baker glyph metadata/outlines         | Skrifa `0.45.1`                                                                   | metrics, bounds, and outline interpretation                                                                                                               |
| glTF specification                    | `2.0`                                                                             | Khronos schema commit `77b44be7bef26e01fb0b140e3d5bb1716421c5e9`                                                                                          |
| Khronos glTF Validator                | `2.0.0-dev.3.10`                                                                  | npm package                                                                                                                                               |
| JSON Schema Draft-04 evaluator        | Ajv `6.15.0`                                                                      | npm package; exact extension-schema negative matrix                                                                                                       |
| Binaryen / `wasm-opt`                 | `129.0.0`                                                                         | npm package; `-Oz`, bulk memory, nontrapping float-to-int                                                                                                 |
| TypeScript discovery compiler         | `7.0.2`                                                                           | npm package; exact runtime assertion and isolated unstable-API adapter                                                                                    |
| Rust mutation fuzzer                  | Font baker `0.0.0`                                                                | host-only binary compiled by the canonical Rust toolchain; seed `0x504d4e44`                                                                              |
| Coverage-guided Rust fuzzer           | `nightly-2026-06-01` (`14210df0e`) + cargo-fuzz `0.13.2` + libfuzzer-sys `0.4.13` | nested mise-owned fuzz workspace; fixed default seed `0x504d4e44`; excluded from product builds                                                           |
| `PMNDRS_font` format                  | `0`                                                                               | extension schema and shaping contract                                                                                                                     |
| Portable baker ABI                    | `0`                                                                               | generated `font-baker-abi-v0.json`                                                                                                                        |
| Text shaper ABI                       | `0`                                                                               | generated `text-shaper-abi-v0.json`                                                                                                                       |
| Bitmap baker ABI                      | `0`                                                                               | generated `bitmap-baker-abi-v0.json`                                                                                                                      |
| Font baker                            | `0.0.0`                                                                           | Cargo/npm package version during the integration slice                                                                                                    |
| Bitmap generator                      | `0.0.0`                                                                           | Cargo/package version embedded into descriptors and artifacts                                                                                             |
| Bitmap outline rasterizer             | Zeno `0.3.3`                                                                      | unhinted grayscale mask generation from Skrifa outline commands                                                                                           |
| KTX2 Rust model/parser                | `ktx2` `0.5.0`                                                                    | compile-time R8 DFD generation plus native artifact validation                                                                                            |
| KTX2 JavaScript parser                | `ktx-parse` `1.1.0`                                                               | package-owned artifact and runtime page validation                                                                                                        |

GLib development metadata is a native build-host prerequisite for the HarfBuzz benchmark workload, not a root contributor requirement or fixture identity input. HarfBuzz 13.0.0 and 14.2.0 gate their `hb-shape` and `hb-subset` targets on `HAVE_GLIB`; the shared provisioner therefore requires `-Dglib=enabled`, authenticates each version's source archive independently, and the pinned Ubuntu 24.04 CI job installs `libglib2.0-dev` explicitly and prints the resolved `glib-2.0` version. The 13.0.0 build remains the shaping oracle and CJK fixture authority; 14.2.0 is isolated to the R3F example's checked asset subsets. Every unrelated optional HarfBuzz backend is disabled explicitly so host-installed FreeType, Cairo, ICU, CoreText, or experimental raster/vector dependencies cannot change the source-build graph. GLib owns the utility frontend, while the authenticated HarfBuzz source and exact generated-byte comparison remain authoritative for fixture semantics. Contributors may supply the documented versions directly; the nested mise config is the reproducible installation option and does not create a second task surface.

## Generated contract

The Rust ABI sources generate all three published JSON contracts at build time. Their `versions` objects carry the applicable baker, bitmap generator, format, shaper, oracle, Unicode, glTF schema, validator, and Binaryen pins; Rust provenance and the TypeScript direct-memory shims consume those sources rather than relying on a hand-authored contract artifact. Rust package/generator versions derive from Cargo metadata. The package-internal contract module gives the TypeScript loader, validator, and direct-memory bridge one version authority without exposing another package or pulling the bridge into the root browser graph.

Every raster generator stamps its exact owning package semantic version into its canonical descriptor and artifact provenance. A generator upgrade changes its descriptor hash and therefore its raster key. The bitmap generator begins at `0.0.0`; additional raster generators receive their own exact pins when their packages enter the roadmap.

## Change rules

| Change                        | Required evidence                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shaper or oracle              | Old/new structured shaping diff over the complete pinned corpus.                                                                                                                                  |
| Unicode                       | Version-matched UAX data, conformance runs, and package-size report.                                                                                                                              |
| glTF schema or validator      | Schema/validator report diff with reviewed extension-only allowlist changes; vendored schema archive SHA-256 is `0f1e200bb081d1fcc7a976ee40f05f95b406ed80f43836550af96b73e5a64bef`.               |
| Binaryen                      | Raw/compressed module diff plus zero-import, ABI, deterministic artifact, and real-font equivalence.                                                                                              |
| TypeScript discovery compiler | Adapter compatibility, unstable-import isolation, typed/plain-JavaScript discovery, and complete discovery fixture suite.                                                                         |
| Fuzz harness                  | Deterministic seed replay, fixed-seed stable smoke, bounded cargo-fuzz execution, exact root/nested toolchain authorities, mise/cargo-fuzz/libFuzzer drift guards, and minimized-crash promotion. |
| ABI or font format            | Explicit version increment, compatibility decision, and old/new fixture coverage.                                                                                                                 |
| Baker or raster generator     | Deterministic artifact diff, payload report, and Node/Worker parity run.                                                                                                                          |

Fixture manifests record these values explicitly. Updating this page alone never upgrades the code: the generated ABI, package locks, fixtures, and compatibility tests must change in the same atomic workstream.
