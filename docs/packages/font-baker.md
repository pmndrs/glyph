---
type: Workspace Package
title: "@pmndrs/text-font-baker"
description: Implements the internal portable Rust/Wasm shaping-resource bake core and direct-memory TypeScript wrapper.
resource: ../../packages/font-baker
workspace_package: "@pmndrs/text-font-baker"
documentation_type: reference
source_digest: "sha256:6a688ec19f514bbd7cb2a78ef1bed0fc4a62dfaa4e2f695cd0016a6788379ff6"
tags: [package, rust, wasm, baking, internal]
sources:
  - id: manifest
    resource: ../../packages/font-baker/package.json
    title: Package manifest
  - id: implementation-status
    resource: ../planning/font-baker-implementation.md
    title: Font baker implementation status
  - id: fontations
    resource: https://github.com/googlefonts/fontations
    title: Fontations
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T01:15:06Z"
---

# Package reference: `@pmndrs/text-font-baker`

Status: 🟡 internal bake-core slice; paused behind roadmap dependencies

This package keeps the Rust crate, `no_std + alloc` Wasm build, generated JSON ABI contract, direct-linear-memory TypeScript wrapper, and tiered tests together. It emits a deterministic shaping-only core GLB.

Font interpretation is library-owned: Fontations `read-fonts` parses SFNT/TTC tables and `skrifa` supplies metrics and glyph bounds.[^fontations] Project code owns the accepted table policy, reduced-SFNT serialization, V0 extent encoding, hashes, reports, ABI, and GLB contract.

It does not run HarfRust, shape Unicode, generate a bitmap, discover application fonts, or provide the public Node/Worker host. Those remain separate roadmap gates.

## Package scripts

| Script | Purpose |
| --- | --- |
| `build` | Compile the `no_std` Wasm module, generate the ABI JSON, and emit the TypeScript package. |
| `test:unit` | Run Rust unit tests. |
| `test:integration` | Run public Rust and compiled Wasm/TypeScript integration tests. |
| `test:e2e` | Bake the licensed real-font fixture when the fixture gate is available. |
| `test` | Run all three test layers. |

See the [implementation status](../planning/font-baker-implementation.md) for evidence and open gates.[^implementation-status]

[^fontations]: The package does not maintain a parallel OpenType parser or outline geometry engine.
[^implementation-status]: The implementation-status concept records why existing milestone-2 code is paused until milestones 0–1 close.
