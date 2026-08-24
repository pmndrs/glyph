---
type: API Specification
title: Making a technique reusable across engines
description: Gives a technique a reusable identity lookup and a policy-body factory so a second engine composes it instead of re-authoring it, and makes the third-party-technique-in-third-party-engine cell provable.
documentation_type: explanation
tags: [planning, public-api, techniques, bakers, extensibility]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-24T00:00:00Z'
---

# Making a technique reusable across engines

## What is actually wrong

Not impossibility. `TextEngineHost` publicly accepts arbitrary binding and policy bytes (`core/host.ts:105`, `:140`), and `/core` exports `compileFontBinding`, the resource helpers, and the policy DSL (`core.ts:62`, `:72`). A custom engine can author and register a custom technique today by hand.

What is missing is **reuse**: there is no technique-id lookup outside `/three`, and no composition step that turns a technique plus a renderer's own system lanes into a registered policy and binding. So the second engine re-authors what the first already wrote.

Two consequences follow:

- `paragraph.ts:689` calls `loadedFontBindingBytes` with no lookup, while `three/engine-runtime.ts:201` consults its registry first. The same technique that renders through `Text` throws through `Paragraph`.
- Every renderer-independent part of a technique -- its schema, its binding compilation, its policy body -- is written once per engine instead of once.

## What is not portable, and why the obvious split fails

`PolicyProgram` contains no renderer objects, but **its numbers live in a host-specific namespace.** Three owns system buffers and publishes their ids through `threePolicyAbi`; the external raster declares and writes Three's transform buffer `15` (`three/render-policy.ts:27`, `glyph-example-raster/src/three.ts:33`). The non-Three example defines its own system buffer `20` and compiles its own policy and capabilities (`glyph-example-renderer/src/policy.ts:23`, `:59`). A Three-authored descriptor is therefore not consumable by another engine, and moving it to `/core` unchanged would export one host's numbering as if it were neutral.

In the starting design, `compileFont` was likewise not portable: its parameter was the Three-owned `ThreePlanProgramFontCompiler`, and the fourth variant of `ThreeTextEngineResource` carried a `CompiledThreeRasterPlanProgram` that exposed `createMaterial(): NodeMaterial` (`three/plan-program-registry.ts:33`, `:48`, `three/engine-runtime.ts:52`). That union did contain renderer behaviour; renaming and moving it would have dragged Three into `/core`. The implementation now keeps the core compiler result byte/resource-only and leaves the renderer association in `/three`.

## Design

**Portable half — technique schema plus a policy-body factory.** The technique publishes its schema and a factory that takes the renderer's system lanes and capability set and returns the policy body. Each engine finishes its own `PolicyProgram` with its own ids. Nothing exports one host's numbering.

**Portable half — a core compiled result.** Define a core compilation returning binding bytes plus constrained portable resource payloads. `loadedFontBindingBytes` stays a byte projection over it, so `Paragraph` takes exactly the path Three takes and the two stop disagreeing.

**Renderer half — resources and materials, not materials alone.** Built-ins create and cache GPU resources separately from materials, keyed by resource reference (`three/engine-plan-target.ts:896`, `:923`). The renderer contract therefore needs resource realization as well as `createMaterial`. The association between a resource and its renderer program stays in `/three`, resolved from the Three registry rather than embedded in the portable payload.

**Typing.** Infer `Resource` at `registerRasterPlanProgram`, where `retain()` is a real inference site. `RasterTechnique` has no resource-valued member, so a fourth phantom parameter has nothing to infer from and must not be added there.

**Registry scope.** Limit the core registry to technique-id lookup and binding composition. A broader core snapshot/read/release API touching `host.wireIdentities` is a separate change; `TextEngineRenderPlanView` is only a decoder today (`core/plan-view.ts:47`).

**Bakers: nothing to build.** Build-time discovery already maps an imported raster through `package.json#pmndrs.glyph`, resolves and imports the baker, and validates its kind (`discovery.ts:239`, `node/bake.ts:292`); the external raster already supplies that mapping. Runtime discovery exists through `RasterTechnique.runtimeBaker`. No baker work is in scope.

## Cost

Today a technique costs roughly `2NM` -- schema, binding, and policy body re-authored per engine alongside the material. After this it is about `N + NM`: schema, binding, and policy body once, material and resource realization once per engine.

## Acceptance

The matrix, corrected:

|  | Three engine | third-party engine |
| --- | --- | --- |
| first-party technique | covered | **unproven** |
| third-party technique | `example-raster` | `glyph-example-renderer` acceptance test |

`glyph-example-renderer` now proves the lower-right cell: its production source registers the portable binding, owns a concrete recording device/submission path, and asserts non-empty draws. The acceptance fixture uses the root loader and `/bake` only to obtain a real loaded font; the package boundary test narrows that exception to `tests/example-render.test.ts`.

Done means `glyph-example-renderer` loads a font, registers a binding, realizes resources through a concrete device and submission path, and produces **non-empty draws** for `glyph-example-raster`'s technique -- composed from the portable half rather than re-authored.

## Sequencing

1. ✅ Extract the technique schema and policy-body factory into `/core`; leave `PolicyProgram` assembly with each engine.
2. ✅ Define the core compiled result; make `loadedFontBindingBytes` a projection over it so `paragraph.ts:689` and `engine-runtime.ts:201` share one path.
3. ✅ Add `registerRasterPlanProgram` in `/core`, scoped to id lookup and binding composition.
4. ✅ Extend the Three contract with resource realization; keep the resource-to-program association in `/three`.
5. ✅ Build the acceptance case above in `example-renderer`, including its device and submission path.

Steps 1-4 are not done until step 5 draws.
