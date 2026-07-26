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
  at: "2026-07-26T21:54:09Z"
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

The admission record is an experiment, not a recommendation. Milestone 8 can recommend MSDF only after the generator, payload, runtime shader, visual corpus, transforms, effects, and performance gates all close.
