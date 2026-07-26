---
type: Research
title: MTSDF generator admission
description: Audits generator candidates and defines the evidence required before Milestone 8 accepts one.
tags: [rust, wasm, msdf, mtsdf, quality, fuzzing]
sources:
  - id: klyff-msdf
    resource: https://docs.rs/klyff_msdf/0.1.3/klyff_msdf/
    title: klyff_msdf 0.1.3 documentation
  - id: klyff-source
    resource: https://codeberg.org/SnailBionicLab/klyff
    title: Klyff source repository
  - id: native-msdfgen
    resource: https://github.com/Chlumsky/msdfgen
    title: Chlumsky msdfgen
  - id: rust-msdfgen-bindings
    resource: https://docs.rs/msdfgen/0.2.1/msdfgen/
    title: Rust msdfgen 0.2.1 bindings
  - id: oxitext-sdf
    resource: https://docs.rs/oxitext-sdf/0.2.0/oxitext_sdf/
    title: oxitext-sdf 0.2.0 documentation
generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-26T22:02:41Z"
---

# MTSDF generator admission

Status: 🟡 `klyff_msdf` 0.1.3 is the leading patch candidate; no generator is accepted unchanged.

Milestone 8 needs deterministic linear RGBA8 MTSDF bytes from maintained font outlines in `wasm32-unknown-unknown`. The shipped baker must remain package-owned and platform-independent. A native implementation may serve as an independent oracle, but cannot silently become a browser dependency or a platform-binary release matrix.

## Candidate assessment

| Candidate | Strengths | Admission blockers | Role |
| --- | --- | --- | --- |
| `klyff_msdf` 0.1.3 | MIT; pure Rust; direct CPU MTSDF generation; optional Skrifa and WGPU features; reusable allocation owner | Published core uses `std`; default feature selects Skrifa 0.40 rather than the repository's 0.45 line; public threshold setter asserts; intersecting-outline cleanup can panic, always constructs a diagnostic string, and flattens split quadratics to lines | Leading upstream-patch candidate |
| Rust `msdfgen` 0.2.1 bindings | Safe high-level API over the established implementation; error correction and estimation APIs | Ships C++ FFI through `msdfgen-sys`; native build/runtime surface conflicts with the Rust-only, platform-independent Wasm baker and creates an additional font-parser path | Rejected as product dependency |
| `oxitext-sdf` 0.2.0 | Apache-2.0; pure-Rust MTSDF and atlas APIs | Pulls a separate OxiText/`ttf-parser`/Rayon stack, duplicates existing Fontations ownership, and has no demonstrated `no_std` or small Wasm profile | Rejected for current package boundary |
| Chlumsky `msdfgen` | Canonical MTSDF behavior, error correction, test rendering, and mature outline corpus | C++/native toolchain and platform matrix | Pinned test-only quality oracle |

The audited crates.io archive for `klyff_msdf` 0.1.3 has SHA-256 `ba670d53fac1c079f354bef3af3b18e6b29165a63c8ac14f871c6e725c1de235`. The audit used the exact published archive, not a moving repository branch.

The independent oracle is Chlumsky `msdfgen` 1.13.0 at tag `v1.13`, commit `1874bcf7d9624ccc85b4bc9a85d78116f690f35b`; its source archive has SHA-256 `93cd1ad8918c1a78c5c96e82d4f4c77f0eb86c2e7e8579a0967e54196c4b7167`. `@pmndrs/text` provisions only the dependency-free core and standalone shape-description tool under its ignored package cache. Font, FreeType, PNG, SVG, Skia, OpenMP, vcpkg, installation, and shared-library features stay disabled. This native executable is test infrastructure, never a package file, runtime dependency, browser artifact, or platform release.

The non-shipping admission harness pins that archive with default features disabled. Its locked graph contains neither Skrifa, `ttf-parser`, nor WGPU, and optimized `wasm32-unknown-unknown` imports no host or WASI function. A deterministic 40×40 synthetic MTSDF fixture has FNV-1a identity `1627af29` after correcting its outer-contour winding to the TrueType convention. At Rust 1.97.1 and Binaryen 129, the candidate core measures 81,308 raw bytes, 72,510 optimized bytes (70.8 KiB), 32,161 gzip bytes (31.4 KiB), and 27,829 Brotli bytes (27.2 KiB). This proves that generator code size is viable; it does not waive the published crate's use of `std`, panic paths, or quality gates.

The package-owned native-oracle corpus sends one command stream and explicit pixel-center framing to both engines; native auto-framing is forbidden. At a 32×32 inner region, four-pixel padding, and one-em distance range, ordinary, acute-corner, overlapping-contour, quadratic, cubic, and counter fixtures have zero reconstruction mismatches outside the one-byte quantization band. Candidate-versus-native alpha mean absolute error ranges from 0.470 to 1.742 bytes on those admitted shapes. Empty and provider-malformed outlines return structured errors, and a changed-alpha negative control proves the comparison observes mutated bytes. The checked evidence embeds the pinned native bytes, so CI freshness checks rerun the Rust candidate without provisioning a host binary.

The self-intersection case remains a hard blocker: 768 of 1,600 reconstructed pixels disagree, with 22.500-byte alpha mean absolute error and 171-byte maximum error. The evidence intentionally reproduces that failure and changes state only when a hardened provider closes it; it is not a waived threshold. This also demonstrates why a deterministic candidate checksum alone was insufficient admission evidence.

## Required upstreamable patch

The first patch stays generator-generic and suitable for upstream review:

1. replace the public threshold assertion with a fallible validated configuration boundary;
2. return an explicit invalid-outline error when intersection cleanup removes every segment;
3. construct diagnostic geometry only on the error path, with no formatting allocation in successful generation;
4. preserve quadratic/cubic curve semantics across intersection splitting or prove a reviewed error bound before flattening;
5. isolate `alloc` from `std`, remove `std::error::Error` as a core trait requirement, and compile CPU generation with default features disabled;
6. let this repository supply a narrow OutlineProvider over its pinned Fontations/Skrifa version rather than enabling the candidate's older default font feature.

No product-side `catch_unwind`, Wasm trap recovery, ignored panic, or copied private fork counts as closure. If upstream cannot take the complete patch promptly, the repository may pin a reviewed upstream branch only with explicit provenance, a replacement/removal condition, and identical tests.

## Admission evidence

Correctness precedes timing:

- fixed RGBA8 bytes for simple, acute-corner, overlapping, self-intersecting, quadratic, cubic, empty, and complex glyphs;
- reconstructed coverage and distance error against pinned native `msdfgen`, including a negative control that proves the comparison observes changed bytes;
- complete Inter generation plus representative Amiri, Devanagari, and CJK outline samples without panic or missing non-empty outlines;
- malformed outline/font unit tests and a nightly cargo-fuzz target over the package boundary;
- exact native/Node/Worker artifact equality through the same C ABI and JSON contract strategy as the existing bakers;
- `wasm32-unknown-unknown` raw/minified/gzip/Brotli size and cold/warm timing with the font parser, MTSDF generator, atlas packer, KTX2 writer, and GLB writer reported separately where possible.

The package-owned `measure:mtsdf-admission` script rebuilds and optimizes the Wasm, executes the synthetic export, rejects WGPU and duplicate-font-parser lock entries, rejects host imports, and compares every byte count/hash with the checked-in evidence. The intentionally green panic-detection test is a blocker sensor: it must be inverted or removed when the upstreamable fallible API lands; it is not evidence that trapping is acceptable.

The admission record is an experiment, not a recommendation. Milestone 8 can recommend MSDF only after the generator, payload, runtime shader, visual corpus, transforms, effects, and performance gates all close.
