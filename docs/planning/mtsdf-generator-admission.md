---
type: Research
title: MTSDF generator admission
description: Records the concluded dependency admission and the evidence required for the repository-owned Milestone 8 generator.
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
  at: "2026-07-27T00:28:33Z"
---

# MTSDF generator admission

Status: 🟢 dependency admission is concluded: the production generator is repository-owned; no reviewed generator is accepted as a product dependency.

Milestone 8 needs deterministic linear RGBA8 MTSDF bytes from maintained font outlines in `wasm32-unknown-unknown`. The shipped baker must remain package-owned and platform-independent. A native implementation may serve as an independent oracle, but cannot silently become a browser dependency or a platform-binary release matrix.

## Candidate assessment

| Candidate | Strengths | Admission blockers | Role |
| --- | --- | --- | --- |
| `klyff_msdf` 0.1.3 | MIT metadata; pure Rust; direct CPU MTSDF generation; optional Skrifa and WGPU features; reusable allocation owner | Published core uses `std`; default feature selects Skrifa 0.40 rather than the repository's 0.45 line; public threshold setter asserts; intersecting-outline cleanup can panic, always constructs a diagnostic string, and flattens split quadratics to lines; the audited crate archive omits a standalone license file | Design reference and differential evidence only |
| Rust `msdfgen` 0.2.1 bindings | Safe high-level API over the established implementation; error correction and estimation APIs | Ships C++ FFI through `msdfgen-sys`; native build/runtime surface conflicts with the Rust-only, platform-independent Wasm baker and creates an additional font-parser path | Rejected as product dependency |
| `oxitext-sdf` 0.2.0 | Apache-2.0; pure-Rust MTSDF and atlas APIs | Pulls a separate OxiText/`ttf-parser`/Rayon stack, duplicates existing Fontations ownership, and has no demonstrated `no_std` or small Wasm profile | Rejected for current package boundary |
| Chlumsky `msdfgen` | MIT; canonical MTSDF behavior, exact curve-distance selectors, overlap combination, error correction, test rendering, and mature outline corpus | C++/native toolchain and platform matrix | Pinned test-only quality oracle and port reference |

The audited crates.io archive for `klyff_msdf` 0.1.3 has SHA-256 `ba670d53fac1c079f354bef3af3b18e6b29165a63c8ac14f871c6e725c1de235`. The audit used the exact published archive, not a moving repository branch.

The independent oracle is Chlumsky `msdfgen` 1.13.0 at tag `v1.13`, commit `1874bcf7d9624ccc85b4bc9a85d78116f690f35b`; its source archive has SHA-256 `93cd1ad8918c1a78c5c96e82d4f4c77f0eb86c2e7e8579a0967e54196c4b7167`. `@pmndrs/text` provisions only the dependency-free core and standalone shape-description tool under its ignored package cache. Font, FreeType, PNG, SVG, Skia, OpenMP, vcpkg, installation, and shared-library features stay disabled. This native executable is test infrastructure, never a package file, runtime dependency, browser artifact, or platform release.

The non-shipping admission harness now links the repository-owned core with default features disabled. Its compiled dependency tree contains neither Skrifa, `ttf-parser`, nor WGPU, and optimized `wasm32-unknown-unknown` imports no host or WASI function. A deterministic 40×40 synthetic MTSDF fixture has FNV-1a identity `3d9625f1`. At Rust 1.97.1 and Binaryen 129, the owned core plus admission export measures 47,088 raw bytes, 42,607 optimized bytes (41.6 KiB), 18,318 gzip bytes (17.9 KiB), and 15,333 Brotli bytes (15.0 KiB).

The package-owned native-oracle corpus sends one command stream and explicit pixel-center framing to both engines; native auto-framing is forbidden. At a 32×32 inner region, four-pixel padding, and one-em distance range, ordinary, acute-corner, overlapping-contour, self-intersection, quadratic, cubic, and counter fixtures all have zero coverage mismatches. Candidate-versus-native alpha mean absolute error ranges from 0.472 to 0.549 bytes. Contour-aware overlap combination and a nonzero-fill sign-correction pass close the former self-intersection failure without removing or weakening the fixture. Empty and provider-malformed outlines return structured errors, and a changed-alpha negative control proves the comparison observes mutated bytes. The checked evidence embeds the pinned native bytes, so CI freshness checks rerun the Rust candidate without provisioning a host binary.

The Fontations adapter generates 2,915 drawable Inter 4.1 glyphs, rejects 22 empty or invalid-bound glyph records without panic, and returns checksum `3233904205` identically across one cold and five warm passes. The scalar oracle measured 40.196 seconds at the warm median on the recorded local arm64 run. That observation is a performance baseline, not a portability threshold or an acceptable final baker result. A deterministic 1,000-run cargo-fuzz smoke covers bounded outline command mutation with 44 MiB peak reported RSS.

## Concluded ownership decision

The Klyff audit proved a viable Wasm size and exposed useful data-oriented mechanisms, but hardening crossed the geometry kernel's correctness boundary. The repository would have to co-own its panic model, degenerate-curve termination, self-intersection signs, allocation behavior, and Fontations integration. The permanent product boundary therefore owns a purpose-built Rust port rather than pinning a patched dependency or copying an external crate.

The implementation may retain proven ideas—reusable scratch ownership, SoA edge traversal, compact distance values, and deterministic fixtures—but its types, API, limits, error model, curve policy, data layout, and control flow follow this repository's standards. Pinned native `msdfgen` remains an independent executable oracle and algorithm reference. The [generation research](mtsdf-generation-research.md) records the literature, reviewed libraries, license evidence, owned boundary, and SIMD hypotheses.

The shipped core must remain `no_std + alloc`, accept the package-selected allocator, expose typed failures without panic recovery, reuse bounded scratch storage, and connect to JavaScript through the same generated C ABI/JSON contract and direct Wasm memory access as the existing bakers. It does not acquire a second font parser, atlas owner, container writer, Worker abstraction, or binding generator.

## Admission evidence

Correctness precedes timing:

- fixed RGBA8 bytes for simple, acute-corner, overlapping, self-intersecting, quadratic, cubic, empty, and complex glyphs;
- reconstructed coverage and distance error against pinned native `msdfgen`, including a negative control that proves the comparison observes changed bytes;
- complete Inter generation plus representative Amiri, Devanagari, and CJK outline samples without panic or missing non-empty outlines;
- malformed outline/font unit tests and a nightly cargo-fuzz target over the package boundary;
- exact native/Node/Worker artifact equality through the same C ABI and JSON contract strategy as the existing bakers;
- `wasm32-unknown-unknown` raw/minified/gzip/Brotli size and cold/warm timing with the font parser, MTSDF generator, atlas packer, KTX2 writer, and GLB writer reported separately where possible.

The package-owned `measure:mtsdf-admission` script rebuilds and optimizes the Wasm, executes the synthetic export, inspects the compiled dependency tree rather than optional lockfile entries, rejects WGPU and duplicate font parsers, rejects host imports, and compares every byte count/hash with the checked-in evidence. Unit and fuzz regressions exercise typed malformed-input and allocation-limit paths; no panic sensor or catch policy remains.

Dependency admission is closed; generator implementation remains active. Milestone 8 can recommend MSDF only after the repository-owned generator, payload, runtime shader, visual corpus, transforms, effects, and performance gates all close.
