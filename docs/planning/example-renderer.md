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

It is deliberately not a product. Its production source owns no scene graph or shader implementation, but it does own a
small concrete device/submission seam so the acceptance test can prove resource realization and non-empty draws without
depending on Three.

## What it proves today

The plan surface is richer than the audit first credited. One publication carries seven tables — `resources`, `buffers`, `patches`, `primitives`, `draws`, `retirements`, `diagnostics` — and a decoded draw already carries `clipId`, `depthKey`, `orderToken`, `materialId`, and `transformId`. Clipping, render ordering, material selection, incremental patching, and resource retirement are all modelled. A host that owns its own instancing has what it needs.

What it proves about **ownership** is now the headline. Item 11's retention protocol landed on the session, and this package drives it against a real engine: real Wasm, the portable raster plan from `glyph-example-raster`, a host-owned policy assembled through `/core` (`src/policy.ts`), real frames through `TextEngineSession.update`, and a recording device/submission path (`src/device.ts`). The protocol steps run in order on every frame in `ExampleTextEngine.render` — update to get the borrow, `assertLive` as the cheap liveness gate, `retain` for one contiguous host-owned copy that acknowledges consumption, then decoding views over owned bytes only. The tests hold a retained plan across three frames plus a capacity growth, watch a stale borrow die loudly with `TextEnginePublicationExpiredError`, replay an older acknowledged generation at the wire and see the engine refuse it with a revision conflict, and decode dirty patch ranges out of the plan. The acceptance test additionally loads a baked font, registers its portable binding and resource, and asserts non-empty draws and one submission. The reader demands the `RetainedTextEnginePublication` brand in its parameter type, so handing it a live-but-doomed borrow is a compile error; the brand is checked again at runtime because plain JavaScript callers bypass the types. The old defensive per-table copy is gone: copying happens once, in `session.retain`.

What the package also pinned down is the font gap. A `/core`-only host cannot register a shaping font: `RuntimeShaper.registerFont` requires loader-registered state, Rust refuses `registerFontBinding` with `fontMissing` without it, and `createTextRuntime` is exported only from the root entry point. Real *text* frames are therefore unreachable from the published surface, and the test asserts the clean rejection instead of reaching past the boundary. That is audit item 12's evidence, recorded where the next person will trip over it.

| Surface | Owns | Status |
| --- | --- | --- |
| `@pmndrs/glyph/tsl` | The technique shaders realized as three.js TSL node graphs | Published |
| `@pmndrs/glyph/typegpu` | The same technique shaders realized as TypeGPU functions, reusable by any TypeGPU host | **Bitmap shipped.** The old pull request from TypeGPU's author was read as the reference idiom; the parity pin extracts both realizations' generated WGSL at test time |
| `packages/glyph-example-renderer` | An engine consumer proving `/core` is sufficient | Implemented; recording device, resource realization, submission, and non-empty draws |

`/typegpu` is a shader library and mirrors `/tsl` exactly: the technique realizations, no scene integration, no engine driving. Anyone using TypeGPU can import it without adopting our renderer. The example renderer is the opposite half — it drives the engine and knows nothing about shading — and it will consume `/typegpu` once that subpath exists. Keeping them apart is what stops the shader work from being trapped inside an example.

When porting a shader, the TSL realization is rendered to WGSL and GLSL in a device-free probe and the final source extracted, rather than translated by inspection — that extraction is what the Bitmap parity test pins, and it caught two facts inspection missed: data-texture coverage reads compile to exact clamped `textureLoad` fetches, never filtered samples, and the pixel-snapping chain multiplies reciprocals in Three's own emitted order. The slug port on the open pull request shows how far the approach gets. It was written by TypeGPU's author, so its shader structure, buffer typing, and workarounds for `@typegpu/three` are the reference idiom even where the branch itself is too old to rebase.

## Rules

- Import from `@pmndrs/glyph/core`, and later `@pmndrs/glyph/typegpu`. Never from `internal/`, `generated/`, or `/three`.
- The engine package must never learn this package's name. A registration edit inside `packages/glyph` to make an integration work is the defect this package is here to catch.
- Prefer making a gap visible over working around it. When the published surface is insufficient, the correct response is a failing test and an audit item, not a private import.
