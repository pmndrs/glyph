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
  by: openai-codex/gpt-5.6
  at: '2026-08-26T18:18:53Z'
---

# Example renderer

`packages/glyph-example-renderer` is a second consumer of the engine, built on `@pmndrs/glyph/core` and nothing else. It exists because the repository twice reasoned its way to a wrong conclusion about that surface, and reasoning is evidently not enough.

## Why it exists

`/core` was demoted from the package's `exports` on the finding that it had **no consumers**. The finding was false: `@pmndrs/glyph/three` imports `/core` directly, exactly as `core.ts`'s docstring says it does. The accurate finding was "no consumers outside this package", which is a statement about adoption rather than about the surface being unnecessary — and withdrawing the entry point on it would have left the package with no third-party integration story at all.

A planning document is not able to prevent that. A package that stops compiling is. `glyph-example-renderer` is that package: if a second renderer cannot be written against the published surface without reaching into `internal/`, `generated/`, or `/three`, its boundary test fails and the build goes red.

It is deliberately not a product. Its production source owns no scene graph or technique shader implementation, but it
does own a small concrete TypeGPU-backed host/submission seam that resolves the example technique's `/typegpu` realization,
maps named buffers/resources, realizes supplied indexed geometry, creates a hardware WebGPU pipeline, and proves
non-empty changing pixels without depending on Three. Its recording device is a deterministic CPU oracle behind the same
validation seam.

## What it proves today

The plan surface is richer than the audit first credited. One publication carries seven tables — `resources`, `buffers`, `patches`, `primitives`, `draws`, `retirements`, `diagnostics` — and a decoded draw already carries `clipId`, `depthKey`, `orderToken`, `materialId`, and `transformId`. Clipping, render ordering, material selection, incremental patching, and resource retirement are all modelled. A host that owns its own instancing has what it needs.

What it proves about **ownership** is now the headline. The package drives real Wasm, the portable raster plan from `glyph-example-raster`, a runtime-owned host, a host-installed `/core` policy, a target-bound retained session, a deterministic recording oracle, and a concrete TypeGPU/WebGPU device. Its normal target consumes borrowed A/B memory synchronously; the separate `AsyncPlanTarget` contract owns and transfers exactly one copy only when CPU consumption crosses a real asynchronous boundary. The recording oracle validates complete candidate resource and draw state before commit, including technique/program/variant identity, resource metadata, buffer generations, patch ranges, primitive spans, and draw references. The TypeGPU device uploads supplied geometry and policy records, creates a real render pipeline, submits indexed instanced draws, and exposes pixel readback. A failed submission leaves the last accepted plan revision and generation unchanged, so explicit renderer invalidation requests a checkpoint instead of replaying copied bytes. Tests cover borrowed lifetime, async transfer ownership, revision conflicts, dirty patch ranges, exact-generation retirement, and failed publication. The browser lab runtime-bakes Inter, creates and updates an `ExampleText`, and requires non-empty, changing RGBA pixels.

The example's resource map is the recording device's concrete realization pool, not a core requirement to store payloads
in a `Map`. `ExampleTextEngine.registerFont` walks `compiled.declaredResources`, assigns the same numeric `referenceId`
the plan will publish, and passes the portable payload to `device.prepareResources`. The recording device keeps validated
CPU objects; the TypeGPU device creates real WebGPU buffers, textures, bind groups, and geometry. A production renderer
normally scopes that pool to its GPU device and shares immutable realizations across all sessions that lease the same
`(referenceId, generation)`.

Font acquisition remains root vocabulary while runtime construction belongs to `/core`. The acceptance calls root `loadFont()`, creates a `/core` runtime and host, installs its policy, then binds the immutable `Font` through `host.bindFontStack()`. This keeps font loading and engine execution separate while proving that the published core surface is sufficient for a non-Three host to render a real text frame.

| Surface                           | Owns                                                                                   | Status                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@pmndrs/glyph/tsl`               | The technique shaders realized as three.js TSL node graphs                             | Published                                                                                                                                                              |
| `@pmndrs/glyph/typegpu`           | The same technique shaders realized as TypeGPU functions, reusable by any TypeGPU host | **Bitmap shipped.** The old pull request from TypeGPU's author was read as the reference idiom; the parity pin extracts both realizations' generated WGSL at test time |
| `packages/glyph-example-renderer` | A TypeGPU-backed host consumer proving `/core` and `/typegpu` are sufficient           | Implemented; named resource/buffer mapping, supplied geometry, real WebGPU submission and readback, retained text updates, and non-empty changing pixels               |

The technique's `/typegpu` subpath is a shader library and mirrors `/tsl`: technique realization plus named-input metadata,
without scene integration or renderer registration. Anyone using TypeGPU can import it without adopting our renderer. The
example renderer is the concrete headless consumer: it maps the selected named inputs, creates TypeGPU resources and a
pipeline, submits indexed instanced draws to WebGPU, and reads the offscreen target back. The recording oracle reuses the
same contract for deterministic negative tests. Keeping the shader artifact separate from the device is what lets another
TypeGPU host reuse it.

When porting a shader, the TSL realization is rendered to WGSL and GLSL in a device-free probe and the final source extracted, rather than translated by inspection — that extraction is what the Bitmap parity test pins, and it caught two facts inspection missed: data-texture coverage reads compile to exact clamped `textureLoad` fetches, never filtered samples, and the pixel-snapping chain multiplies reciprocals in Three's own emitted order. The slug port on the open pull request shows how far the approach gets. It was written by TypeGPU's author, so its shader structure, buffer typing, and workarounds for `@typegpu/three` are the reference idiom even where the branch itself is too old to rebase.

## Rules

- Import application font vocabulary from `@pmndrs/glyph`, integration contracts from `@pmndrs/glyph/core`, and the technique's public `/typegpu` subpath. Never import from `internal/`, `generated/`, or `/three`. The boundary test allowlists those exact public imports and no renderer-specific runtime.
- The engine package must never learn this package's name. A registration edit inside `packages/glyph` to make an integration work is the defect this package is here to catch.
- Prefer making a gap visible over working around it. When the published surface is insufficient, the correct response is a failing test and an audit item, not a private import.
