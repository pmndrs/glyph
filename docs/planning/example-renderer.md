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

It is deliberately not a product. Its production source owns no scene graph or technique shader implementation, but it
does own a small concrete TypeGPU-backed host/submission seam that resolves the example technique's `/typegpu` realization,
maps named buffers/resources, realizes synthetic or supplied indexed geometry, and proves resource realization and
non-empty draws without depending on Three. It is a headless host proof; a browser or native backend can use the same
seam to create a hardware pipeline later.

## What it proves today

The plan surface is richer than the audit first credited. One publication carries seven tables — `resources`, `buffers`, `patches`, `primitives`, `draws`, `retirements`, `diagnostics` — and a decoded draw already carries `clipId`, `depthKey`, `orderToken`, `materialId`, and `transformId`. Clipping, render ordering, material selection, incremental patching, and resource retirement are all modelled. A host that owns its own instancing has what it needs.

What it proves about **ownership** is now the headline. Item 11's retention protocol landed on the session, and this package drives it against a real engine: real Wasm, the portable raster plan from `glyph-example-raster`, a host-owned policy assembled through `/core` (`src/policy.ts`), real frames through `TextEngineSession.update`, and a recording device/submission path (`src/device.ts`). The protocol steps run in order on every frame in `ExampleTextEngine.render` — update to get the borrow, `assertLive` as the cheap liveness gate, `retain` for one contiguous host-owned copy that acknowledges consumption, then decoding views over owned bytes only. The recording device validates complete candidate resource and draw state before publication, including technique/program/variant identity, resource metadata, buffer generations, patch ranges, primitive spans, and draw references. Font registration and frame submission use prepare/commit handles: a failed host call or invalid plan leaves the candidate unpublished rather than rolling live state backward. The tests hold a retained plan across three frames plus a capacity growth, watch a stale borrow die loudly with `TextEnginePublicationExpiredError`, replay an older acknowledged generation at the wire and see the engine refuse it with a revision conflict, and exercise dirty patch ranges and exact-generation retirement. The acceptance test additionally loads a baked font through the root loader, registers its portable binding and resource, resolves the example `/typegpu` shader to WGSL, and asserts non-empty draws and one submission. A supplied-geometry test also proves indexed GLB-like geometry while the primitive record span alone drives its instance count through the same host seam. The reader demands the `RetainedTextEnginePublication` brand in its parameter type, so handing it a live-but-doomed borrow is a compile error; the brand is checked again at runtime because plain JavaScript callers bypass the types. The old defensive per-table copy is gone: copying happens once, in `session.retain`.

Font acquisition remains outside `/core`: `createTextRuntime` is a root API and a core-only host cannot itself load a shaping font. The acceptance uses that root API only to obtain a `LoadedFont`, then hands it to the core-facing engine registration method. This keeps font loading and engine execution separate while proving that the published core surface is sufficient for a non-Three host to render a real text frame.

| Surface                           | Owns                                                                                   | Status                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pmndrs/glyph/tsl`               | The technique shaders realized as three.js TSL node graphs                             | Published                                                                                                                                                              |
| `@pmndrs/glyph/typegpu`           | The same technique shaders realized as TypeGPU functions, reusable by any TypeGPU host | **Bitmap shipped.** The old pull request from TypeGPU's author was read as the reference idiom; the parity pin extracts both realizations' generated WGSL at test time |
| `packages/glyph-example-renderer` | A TypeGPU-backed host consumer proving `/core` and `/typegpu` are sufficient           | Implemented; WGSL resolution, named resource/buffer mapping, supplied geometry, submission, and non-empty draws                                                        |

The technique's `/typegpu` subpath is a shader library and mirrors `/tsl`: technique realization plus named-input metadata,
without scene integration or renderer registration. Anyone using TypeGPU can import it without adopting our renderer. The
example renderer is the concrete headless consumer: it resolves the shader to WGSL, maps the selected named inputs, and
submits non-empty draw lists. A hardware backend can replace the recording device while reusing that contract.
Keeping the shader artifact separate from the device is what lets another TypeGPU host reuse it.

When porting a shader, the TSL realization is rendered to WGSL and GLSL in a device-free probe and the final source extracted, rather than translated by inspection — that extraction is what the Bitmap parity test pins, and it caught two facts inspection missed: data-texture coverage reads compile to exact clamped `textureLoad` fetches, never filtered samples, and the pixel-snapping chain multiplies reciprocals in Three's own emitted order. The slug port on the open pull request shows how far the approach gets. It was written by TypeGPU's author, so its shader structure, buffer typing, and workarounds for `@typegpu/three` are the reference idiom even where the branch itself is too old to rebase.

## Rules

- Import from `@pmndrs/glyph/core` and the technique's public `/typegpu` subpath. Never from `internal/`, `generated/`, or `/three`. The engine driver uses a type-only root import for `LoadedFont` and `AnyRasterTechnique`; only the real-font acceptance fixture additionally uses the public root loader and `/bake` entry point to create its temporary font. The boundary test allowlists those exact imports and no runtime renderer import.
- The engine package must never learn this package's name. A registration edit inside `packages/glyph` to make an integration work is the defect this package is here to catch.
- Prefer making a gap visible over working around it. When the published surface is insufficient, the correct response is a failing test and an audit item, not a private import.
