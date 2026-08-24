---
type: API Specification
title: Making a technique implementable end to end
description: Closes the gap that lets a third party bake an artifact and then neither bind a font nor render it, by giving the raster side the behaviour contract the bake side already has.
documentation_type: explanation
tags: [planning, public-api, techniques, bakers, extensibility]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-24T00:00:00Z'
---

# Making a technique implementable end to end

## The defect

The bake and raster sides are dependent twins across the artifact boundary. Only one is implementable.

`RasterBakerModule` (`packages/glyph/src/bake.ts:101-107`) carries behaviour:

```ts
interface RasterBakerModule<Kind, Options, Descriptor> {
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  descriptor(options: Options): Descriptor;
  bake(request: RasterBakeRequest<Descriptor>): Promise<RasterBakeArtifact<Kind>>;
}
```

A third party writes one, passes it to the bake call, and it bakes. Nothing resolves it by name, because the caller supplies the module.

`RasterTechnique` (`packages/glyph/src/raster-technique.ts:30-42`) carries identity only -- `id`, `kind`, `extension`, `version`, and a phantom type map. It has no methods. A technique therefore cannot state how to consume what its twin produced, so every consumer has to know it by name:

| site | shape | failure for a third party |
| --- | --- | --- |
| `core/font-binding.ts:55-74` | closed branch over bitmap/msdf/slug | `TypeError: no first-party font-binding compiler is registered for "<id>"` |
| `three/engine-runtime.ts:217-234` | same shape again | `TypeError: no first-party Three resource resolver is registered for "<id>"` |
| `three/engine-plan-target.ts:781` | `resolved.technique === bitmap.id` | bitmap-only branch |

Nothing is registered in any of them; the word describes a hard-coded `if`. So a third-party technique can bake a correct artifact and then do nothing with it. That contradicts what `/core` is for: the example-renderer package exists to prove a renderer can drive the engine itself.

The pieces to *build* a binding are already public -- `compileFontBinding`, `schemaFieldTable`, `FontBindingDescriptor`, `fontBindingResources` are all exported from `/core` -- so an integrator can produce exactly the right bytes and find nowhere to put them.

## What already works, and is the model

`registerThreeRasterPlanProgram` (`packages/glyph/src/three/plan-program-registry.ts:87-102`) is a real registry with the hard parts solved:

- keyed by `technique.id`;
- re-registering the identical program is a no-op, so a module evaluated twice is not an error;
- registering a *different* program for a taken id throws;
- registering after any runtime has snapshotted the registry throws, naming how many runtimes already read it.

That last rule is what makes lazy import-time registration safe rather than a silent no-op. Audit item F6 asks for exactly this, and **this stack already delivered it** in `680ae364` -- main still has the silent no-op F6 describes. F6 should be marked done rather than re-derived, and the same rule copied to any new registry.

## Design

Two seams, and they are not the same kind of thing. Keeping them separate is the whole design.

### Seam 1 -- portable: the technique carries its own binding compiler

The technique already owns the data shape (`BitmapData`, `BitmapStrikeData`) and the binding layout (`bitmapSchema.binding.f32` / `.u32`, `raster/bitmap-technique.ts:205-233`). Only the compiler that walks one into the other was split into `core/`. Put it back:

```ts
interface RasterTechnique</* ... */> {
  readonly id: RasterTechniqueId;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  /** Compile one baked artifact into the engine's field-major immutable binding. */
  compileBinding(request: TechniqueBindingRequest<Data>): Uint8Array;
}
```

`loadedFontBindingBytes` then resolves through `font.technique` -- which the call site already holds, only to compare ids -- instead of switching on identity.

**Why on the object rather than a registry here.** This seam is portable and has no renderer types, so it needs no discovery: every call site already has the technique instance in hand. Carrying the method on it has no order dependence, needs no `sideEffects` declaration to survive bundling, cannot be registered late, and tree-shakes naturally. A registry would add all four hazards to buy nothing.

### Seam 2 -- renderer: the Three resource resolver stays in the registry

`three/engine-runtime.ts:217-234` and `engine-plan-target.ts:781` resolve renderer-owned resources -- `DataArrayTexture`, materials, buffers. That cannot move onto the portable technique without dragging Three into `/core`, which the entry-point rule forbids.

It belongs on `ThreeRasterPlanProgram`, which is already registered per technique through the mechanism above. Add the resource resolver to that interface and delete the second switch. A third-party technique then registers one Three program and is complete on the renderer side.

### Seam 3 -- bake: discovery, not registration

Bakers are already implementable and need no registry for the programmatic path, because the caller passes the module. What is missing is *discovery*: resolving a baker from a kind string when the caller did not name it (a CLI or manifest naming `"pmndrs.bitmap"`).

Add `registerRasterBaker(module)` with the same three rules as the plan-program registry, and resolve by `kind` at discovery time. First-party bakers register from their own module, so `import '@pmndrs/glyph/bakers/bitmap'` is what makes bitmap discoverable -- nothing is discoverable that was not imported.

## Consequences

- A third-party technique is implementable end to end: bake, bind, render.
- The two "no first-party X is registered" throws become honest -- a real registry lookup that misses, naming what to import.
- Removing the switches removes the eager import of all three techniques from `core/font-binding`, which is what currently blocks `Paragraph` from the root entry (the delivery gate rejects the root pulling `raster/bitmap-technique.js`). That is a consequence, not the motivation.
- A consumer shipping one technique stops paying for three.

## Sequencing

1. Add `compileBinding` to `RasterTechnique`; move the three first-party compilers onto their technique objects; reduce `loadedFontBindingBytes` to a resolve-and-call. Keep `compileFontBinding` and `schemaFieldTable` exported -- they are what an implementor builds with.
2. Add the resource resolver to `ThreeRasterPlanProgram`; delete the `engine-runtime` switch and the `engine-plan-target` bitmap branch.
3. Add `registerRasterBaker` plus kind-based discovery; register the three first-party bakers from their own modules.
4. Prove it: extend the example-renderer package with a technique defined entirely outside the package -- baked, bound, and rendered -- so "implementable end to end" is a test rather than a claim.
5. Re-test `Paragraph` at the root entry once the eager technique imports are gone.

Step 4 is the acceptance criterion. Steps 1-3 are not done until a technique the package does not know about completes the round trip.

## Risks

- **Type erasure at the registry boundary.** The existing plan-program registry erases to `ThreeRasterPlanProgram<AnyRasterTechnique, unknown>`. The binding seam avoids this by staying on the object; the baker registry will need the same erase-at-the-boundary discipline, with the generic surface preserved for the caller.
- **Late registration.** Already solved for plan programs and must be copied verbatim for bakers, including the idempotent re-registration allowance.
- **Bundler side-effect elision.** Discovery through import means the package must declare its baker modules as having side effects, or a bundler may drop the registration. This is exactly why seam 1 does not use a registry.
