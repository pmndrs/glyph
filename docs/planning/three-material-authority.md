---
type: Research Concept
title: Three material authority for text draws
description: Proposes that a render variant carry an optional user material factory over the exported canonical shaders, so applications compose text materials with ordinary Three.js idioms instead of a bespoke effects vocabulary.
documentation_type: explanation
status: draft
tags: [planning, threejs, tsl, materials, render-variants, follow-up]
sources:
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: raster-technique
    resource: raster-technique-api.md
    title: Raster technique and engine resource API
  - id: variant-run-split
    resource: ../../packages/text/src/paragraph-batch.ts
    title: Ordered run compilation and variant splitting
  - id: bitmap-target
    resource: ../../packages/text/src/three/bitmap-target.ts
    title: Three Bitmap target and its program-owned material
  - id: program-registry
    resource: ../../packages/text/src/three/program-registry.ts
    title: Three raster program registry
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-07T19:05:00Z'
---

# Three material authority for text draws

**Status: work in progress.** This records a proposal made during the target-v1 Three slice so it is not lost. Maintainers
have identified incorrect edges in it that are not yet resolved. Treat every section as a starting position for that
discussion rather than an accepted design, and do not implement from it without settling the open questions below.

## The problem

Target-v1's Three targets construct their own material and never expose it:

```ts
new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, side: THREE.DoubleSide, transparent: true })
```

That single choice decides more than it appears to. `MeshBasicNodeMaterial` is unlit, so text cannot receive lighting.
Without depth write or depth test, text never enters the depth buffer, so it cannot cast shadows, receive them, or
participate in depth-composited effects such as depth of field. Text renders as a depth-less transparent overlay, which
is a reasonable default for labels and heads-up displays and is part of what makes the pinned Bitmap conformance exact,
but it prevents text from behaving like an ordinary object in a three-dimensional scene.

Colour-space composition already works: a third party can register a program and compose over the exported canonical
shaders, which is how the composed-program proof masks its own paint over `bitmapShader`. The gap is that doing so
requires implementing an entire `ThreeRasterProgram` — owning buffers, geometry, pipeline, and draw compilation — which
is heavy ceremony for an application that only wants a different material.

## The proposal

Three.js attaches materials to objects, and overriding an object's material is ordinary practice. Text should accept a
user-defined material through that same instinct rather than through a bespoke effects vocabulary.

The routing already exists. Core treats a render variant as opaque render intent and splits ordered runs by it: the
run-merge condition requires `Object.is(previousRun.variant, variant)`, so two variants already produce two runs and
therefore two draws. Nothing new is needed to dispatch a per-variant material.

So the render variant carries an optional material factory, invoked where each program currently constructs its own
material. That call happens per glyph batch, because each batch binds different pages and textures — which is already
the shape the exported shaders take.

```ts
const etched = {
  material: (text) => {
    const material = new MeshStandardNodeMaterial();
    material.colorNode = mix(base, sheen, text.coverage);
    material.opacityNode = text.coverage;
    return material;
  },
};

new TextGroup({ technique: slug, renderVariant: etched });
```

Composing a variant of an existing technique then needs no raster module. `registerThreeRasterProgram` remains for
implementing a genuinely new technique, not for restyling one that exists.

Lighting, shadows, and depth of field stop being this package's concern under this shape. They follow from the material
the application chose — a standard material with depth write enabled participates in depth and lighting like any other
object — rather than from flags this package invents and maintains.

## Factory rather than subclass

Export a factory returning exactly the material each program builds internally, so an application starts from that
material and changes one node instead of reconstructing it. A subclassable base class would bind applications to a
package-owned class and work against the ecosystem idiom, which is to assign nodes to a material the application chose.
A factory also keeps the internal path and the application path on the same code, the same property that makes the
exported canonical shaders trustworthy: deleting the export breaks the built-in target.

## Consequence for the effect placeholder

`ThreeRenderVariant.effects` is declared and never read. Under this proposal a variant carrying a material is the
effect, so the placeholder becomes unnecessary and should be removed rather than implemented. That also settles the
deferred `TextEffect` helper in the direction of not building it.

## Constraint

The default path must stay byte-identical. The pinned Bitmap conformance frame depends on the exact current material
state, so application materials are opt-in per variant and the default variant keeps the program-owned material.

## Open questions and known incorrect edges

Maintainers have flagged that this proposal has edges that are wrong as written. Those are not yet enumerated here, and
enumerating them is the first task when this is picked up. Known open items so far:

- Whether glyph coverage drives a shadow-casting depth prepass cleanly is empirical and unproven. It should be spiked
  against a standard material before any of this is committed to.
- The relationship between a per-variant material and paint resolved per glyph is unspecified. Core resolves paint into
  canonical instance storage, so a material that ignores the resolved paint would silently discard authored colour, and
  the interaction between authored spans and an application material needs a stated rule.
- Whether a material factory can be reconciled with the requirement that programs own variant compatibility and final
  draw compilation is unexamined. Two variants that differ only by material may or may not be safely coalescable.
- A separate request asked for text usable as a sampled function, `getTextNode({ coordinates })`, which is a different
  model from instanced glyph geometry. Rendering a group to a render target satisfies it today with no package change,
  and that route should be documented; an analytic evaluation at arbitrary paragraph coordinates is conceivable for
  MSDF and Slug but not for Bitmap, whose atlas sampling and pixel snapping are per quad.
