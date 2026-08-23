---
type: Explanation
title: Example renderer
description: Explains why the repository carries a second engine consumer built only on the published core surface, what it is allowed to prove, and how the TypeGPU shader subpath and the example renderer divide the work.
tags: [core, engine, integration, typegpu, renderer, proof]
sources:
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
  - id: api-surface-audit
    resource: api-surface-audit.md
    title: API surface audit
  - id: uikit-integration
    resource: uikit-integration.md
    title: uikit integration
generated:
  by: anthropic/claude-opus-5
  at: '2026-08-23T09:15:00Z'
---

# Example renderer

`packages/glyph-example-renderer` is a second consumer of the engine, built on `@pmndrs/glyph/core` and nothing else. It exists because the repository twice reasoned its way to a wrong conclusion about that surface, and reasoning is evidently not enough.

## Why it exists

`/core` was demoted from the package's `exports` on the finding that it had **no consumers**. The finding was false: `@pmndrs/glyph/three` imports `/core` directly, exactly as `core.ts`'s docstring says it does. The accurate finding was "no consumers outside this package", which is a statement about adoption rather than about the surface being unnecessary — and withdrawing the entry point on it would have left the package with no third-party integration story at all.

A planning document is not able to prevent that. A package that stops compiling is. `glyph-example-renderer` is that package: if a second renderer cannot be written against the published surface without reaching into `internal/`, `generated/`, or `/three`, its boundary test fails and the build goes red.

It is deliberately not a product. It renders nothing, owns no device, and has no renderer dependency. Its whole job is to exercise the seam and to make the cost of the seam visible.

## What it proves today

The plan surface is richer than the audit first credited. One publication carries seven tables — `resources`, `buffers`, `patches`, `primitives`, `draws`, `retirements`, `diagnostics` — and a decoded draw already carries `clipId`, `depthKey`, `orderToken`, `materialId`, and `transformId`. Clipping, render ordering, material selection, incremental patching, and resource retirement are all modelled. A host that owns its own instancing has what it needs.

What the package also makes concrete is the hazard. A `TextEnginePublication` is valid only until the next Wasm call, so `readDrawList` copies every table into host-owned memory before returning. `tests/plan-reader.test.ts` fills the source buffer with `0xff` after reading and asserts the decoded draws survive. That copy is currently the host's problem and its cost is unmeasured; item 11 of the [API surface audit](api-surface-audit.md) is the contract that should replace it.

## The division with `/typegpu`

Two separate deliverables, often confused:

| Surface | Owns | Status |
| --- | --- | --- |
| `@pmndrs/glyph/tsl` | The technique shaders realized as three.js TSL node graphs | Published |
| `@pmndrs/glyph/typegpu` | The same technique shaders realized as TypeGPU functions, reusable by any TypeGPU host | **Not built.** An old pull request from TypeGPU's author carries a partial slug port. Its age means it likely needs reimplementation rather than resumption, but it is authoritative on TypeGPU idiom and should be read closely before starting |
| `packages/glyph-example-renderer` | An engine consumer proving `/core` is sufficient | Stubbed, device seam only |

`/typegpu` is a shader library and mirrors `/tsl` exactly: the technique realizations, no scene integration, no engine driving. Anyone using TypeGPU can import it without adopting our renderer. The example renderer is the opposite half — it drives the engine and knows nothing about shading — and it will consume `/typegpu` once that subpath exists. Keeping them apart is what stops the shader work from being trapped inside an example.

When porting a shader, the TSL realization can be rendered to WGSL and GLSL in a browser probe and the final source extracted, rather than translated by inspection. The slug port on the open pull request shows how far that approach gets. It was written by TypeGPU's author, so its shader structure, buffer typing, and workarounds for `@typegpu/three` are the reference idiom even where the branch itself is too old to rebase.

## Rules

- Import from `@pmndrs/glyph/core`, and later `@pmndrs/glyph/typegpu`. Never from `internal/`, `generated/`, or `/three`.
- The engine package must never learn this package's name. A registration edit inside `packages/glyph` to make an integration work is the defect this package is here to catch.
- Prefer making a gap visible over working around it. When the published surface is insufficient, the correct response is a failing test and an audit item, not a private import.
