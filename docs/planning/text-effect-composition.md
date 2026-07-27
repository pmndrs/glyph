---
type: Research Note
title: Composable text effects over TSL
description: Proposes a raster-independent node-composition seam for GPU text effects without baking product-specific shaders into core.
tags: [rendering, effects, tsl, webgpu, webgl2, research]
status: draft
sources:
  - id: raster-contract
    resource: ../../packages/text/src/raster.ts
    title: Raster module contract
  - id: mtsdf-runtime
    resource: ../../packages/text/src/raster/msdf.ts
    title: MTSDF runtime material and paint implementation
  - id: text-runtime
    resource: ../../packages/text/src/text.ts
    title: Framework-neutral Text lifecycle
  - id: tsl-skill
    resource: ../../.agents/skills/tsl/SKILL.md
    title: Repository TSL implementation guidance
generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-27T12:07:13Z"
---

# Composable text effects over TSL

This note records a research direction, not an accepted public API. The immediate Paint & Effects benchmark updates retained `Text` instances through their synchronous paint-only path: React does not drive the animation, shaping and layout remain unchanged, and the raster batch rewrites only owned instance paint attributes. Moving an effect such as a per-word hue phase entirely onto the GPU first requires a general composition seam. A rainbow-specific branch in core or in the shared MTSDF material would be the wrong abstraction.

## Proposed boundary

An effect should compose over a raster's resolved fragment result rather than replace its sampling implementation. The following sketch communicates ownership and chaining; exact names and types remain evidence-gated:

```ts
const chromaticPaint = defineTextEffect({
  key: 'chromatic-paint-v1',
  uniforms: { phase: 0 },
  compose({ color, opacity, paintIndex, uniforms }) {
    return {
      color: chromaticColor(color, paintIndex, uniforms.phase),
      opacity,
    }
  },
})

const text = new Text({
  effects: [chromaticPaint],
})
```

The effect list composes in declaration order. Each stage receives the previous stage's color and opacity plus a deliberately small semantic context. Bitmap, MTSDF, and Slug retain ownership of atlas or curve sampling, coverage reconstruction, clipping, outline limits, shadows, and technique-specific validation. An effect cannot reach into those private graphs or mutate a shared material.

## Required invariants

- **Graph identity:** every effect supplies a deterministic key for its graph shape. Material variants cache by raster identity plus the ordered effect-key list; uniform values are never part of that key.
- **Object-local uniforms:** changing `phase.value` updates one retained `Text` without rebuilding a node graph, replacing geometry, touching React, or changing another text object that shares the same graph variant.
- **Technique-independent inputs:** core exposes only reviewed semantic nodes such as resolved color, opacity, paint/span index, glyph index, and normalized local coordinates. A new input is added only when all intended raster adapters can define it precisely.
- **Compositional output:** a stage returns color and opacity nodes for the next stage. Coverage stays raster-owned unless a separately reviewed effect class explicitly requires geometry or coverage expansion.
- **Shared-material safety:** ordinary unmodified text continues to share the raster's canonical material. Effects use a cached variant and per-object bindings; no caller mutates the singleton atlas material.
- **Backend parity:** the same public TSL graph must compile through the installed Three.js `WebGPURenderer` for asserted WebGPU and forced WebGL2. Backend-specific shader strings are not part of the public contract.
- **Failure and disposal:** unsupported semantic inputs fail before publication. Effect-owned uniforms, buffers, and material variants have explicit owners and deterministic disposal.
- **Performance accounting:** measurements separate graph construction/compilation, first pipeline creation, uniform updates, instance uploads avoided, CPU submission, and GPU frame time. A GPU path is adopted only if it materially improves the complete workload rather than moving unmeasured work.

## Paint identity and word phases

The current paragraph model already resolves span paint into per-glyph paint indices. A GPU hue effect should consume a stable semantic paint/span index rather than infer words from glyph IDs, clusters, positions, or display text. The host may assign authored word phases once when it constructs spans; the RAF then changes only an object-local phase uniform. That preserves complex-script shaping and keeps word segmentation outside the shader.

This semantic attribute needs an explicit batching contract. Reusing a palette index is safe only if its identity remains stable across repainting and the renderer does not deduplicate distinct authored phases merely because their current colors match. Otherwise the raster batch needs a separate compact effect index. The choice requires layout, batching, byte-size, and cross-raster evidence before it becomes API.

## Admission gate

Do not add `effects` to public `Text` until a prototype proves all of the following on the repository's exact Three.js and TypeScript pins:

1. two effects chain in a deterministic order without broad type erasure;
2. two text objects share graph structure while retaining independent uniforms;
3. Bitmap and MTSDF produce the intended effect without exposing private sampling nodes;
4. toggling or disposing an effect leaves no stale material, uniform, listener, or GPU resource;
5. WebGPU and forced WebGL2 execute the real graph with causal pixel evidence and negative controls;
6. a live workload shows a material CPU or upload improvement over the retained paint-only batch update; and
7. initial browser-core size and untouched-text pipeline counts remain within their existing budgets.

Until that gate closes, product demonstrations should use the existing direct `Text.setProperties` paint-only update path and describe its measured CPU/upload cost honestly.
