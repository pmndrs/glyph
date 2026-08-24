---
type: API Specification
title: Making a technique implementable end to end
description: Separates the portable half of a technique's contract from the renderer half, so a technique is written once for every engine and a non-Three renderer can consume third-party techniques through the render policy and plan.
documentation_type: explanation
tags: [planning, public-api, techniques, bakers, extensibility]
status: draft
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-24T00:00:00Z'
---

# Making a technique implementable end to end

## The defect

A technique must supply three things. Two are portable and one is not, and all three are registered through a Three-only door.

`ThreeRasterPlanProgram` (`packages/glyph/src/three/plan-program-registry.ts:44-53`):

| member | what it is | portable |
| --- | --- | --- |
| `policy` | static validated policy bytecode descriptor | **yes** |
| `compileFont(compiler)` | cold font registration, producing the Rust wire binding | **yes** |
| `createMaterial(context)` | returns a `NodeMaterial` | no |

The portability is not a judgement call. `PolicyProgram` (`packages/glyph/src/core/render-policy.ts:34-48`) is entirely numbers -- technique and program ids, primitive kind, resource/semantic/storage/draw masks, input counts, capability bits -- and `core/render-policy.ts` imports only `textShaperAbi`. `compileFont`'s helpers (`compileFontBinding`, `emptyFontBindingTable`, `fontBindingResources`, `RenderWireIdentityRegistry`) are all imported from `../core.js` by the Three module that declares the interface. Only `createMaterial` names a renderer type.

The consequence is visible in the two call paths that consume a font binding:

```ts
// three/engine-runtime.ts:201 -- registry first, first-party fallback second
const program = this.#planPrograms.get(font.technique.id);
if (program === undefined) { this.#registerResources(font); loadedFontBindingBytes(font, ...) }
else { const compiled = program.compileFont(...); /* binding + resources */ }

// paragraph.ts:689 -- the portable path, no registry lookup at all
this.host.registerFontBinding(handle, font.font.handle, loadedFontBindingBytes(font, ...));
```

`loadedFontBindingBytes` (`core/font-binding.ts:55-74`) is a closed branch over bitmap, msdf, and slug ending in `throw new TypeError('no first-party font-binding compiler is registered for "<id>"')`. So:

- a third-party technique **works** through `Text`, because Three checks its registry first;
- the same technique **throws** through `Paragraph`, the framework-neutral surface `/core` exists to provide;
- a non-Three engine has no registration mechanism at all, so it can only ever use the three built-ins.

`packages/glyph-example-raster` is cited as proof that an external technique integrates. It proves the Three half only: six imports from the root and one from `/three` purely to register. It is a custom technique plugged into Three, not a second engine, so it does not exercise the portable path it appears to validate.

## The shape of the fix

Split the contract along the line the types already draw.

```ts
// portable -- registered in /core, consumed by any engine
interface RasterPlanProgram<Technique> {
  readonly technique: Technique;
  readonly policy: Omit<PolicyProgram, 'techniqueId' | 'programId'>;
  compileFont(compiler: RasterPlanProgramFontCompiler<Technique>): void;
}

// renderer -- registered in /three, keyed to a technique id
interface ThreeRasterPlanProgram<Technique, Resource> {
  readonly technique: Technique;
  createMaterial(context: ThreePlanProgramMaterialContext<Resource>): NodeMaterial;
}
```

`registerRasterPlanProgram` moves to `/core` with the rules the existing Three registry already proves out (`plan-program-registry.ts:87-102`): keyed by `technique.id`, idempotent re-registration, a different program for a taken id throws, and registration after a runtime has snapshotted the registry throws while naming how many runtimes already read it. That last rule is what makes import-time registration safe rather than a silent no-op; **this stack already delivered it in `680ae364`, and main still has the silent `programs.set` it replaces.**

`loadedFontBindingBytes` resolves through the portable registry, then falls back to the first-party compilers. `paragraph.ts:689` and `three/engine-runtime.ts:201` then take the same path, and the portable surface stops being second-class.

### Why this is N + N x M, not N x M

The engine does not need per-technique knowledge to shape GPU buffers. The policy is declarative bytecode describing inputs, physical buffers, scalar operations, and batching keys; the plan carries the data. A renderer executes the policy generically -- that is what makes `TextEngineRenderPlanView` a usable integration surface at all.

So a technique costs:

- **once, for every engine**: the policy and the font binding, both portable by construction;
- **once per engine**: material realization, which is irreducibly renderer-specific because a material *is* a renderer object.

Today both halves cost once per engine, and for any engine that is not Three the portable half is unobtainable. Fixing the scope of registration is what collapses N x M to N + N x M.

### Bakers

`RasterBakerModule` (`bake.ts:101-107`) is already open: `kind`, `extension`, `version`, `descriptor(options)`, `bake(request)`, and the caller passes the module, so nothing resolves it by name. What is missing is *discovery* -- resolving a baker from a kind string a manifest or CLI names rather than one the caller holds. Add `registerRasterBaker` with the same rules and resolve by `kind`; first-party bakers register from their own modules, so importing the baker is what makes it discoverable.

Side-effect registration is the right mechanism and is not the problem anywhere in this document. The problem is registering portable behaviour in a renderer-scoped registry.

## Sequencing

1. Extract `RasterPlanProgram` and `registerRasterPlanProgram` into `/core`, carrying `technique`, `policy`, and `compileFont` unchanged. Reduce `ThreeRasterPlanProgram` to `technique` plus `createMaterial`, and have the Three registry look the portable half up rather than own it.
2. Make `loadedFontBindingBytes` resolve through the portable registry before its first-party branch, so `Paragraph` and the Three runtime agree.
3. Register the three first-party plan programs portably, then delete the first-party fallback branch and the eager bitmap/msdf/slug imports from `core/font-binding.ts`.
4. Add `registerRasterBaker` and kind-based discovery.
5. Prove it: a technique defined entirely outside the package, baked, bound, and rendered **through `Paragraph`** rather than through `Text`. That is the assertion no current test makes.
6. Re-test `Paragraph` at the root entry once the eager technique imports are gone; the delivery gate rejecting the root pulling `raster/bitmap-technique.js` is what currently blocks it.

Step 5 is the acceptance criterion. Steps 1-4 are not done until a technique the package does not know about completes the round trip on the portable path.

### Resources are data, not GPU objects

`compileFont` returns a binding plus resources, and the resources look renderer-owned because
`ThreeTextEngineResource` lives in `/three`. Its contents are not: every first-party variant is a
baked data type from the technique module -- `BitmapStrikeData`, `MsdfData`, `SlugPageData`
(`three/engine-runtime.ts:52-56`) -- and the third-party variant carries an opaque `resource` plus its
program. No Three object appears in it. The GPU object is created later and elsewhere, from those
bytes: `engine-plan-target.ts:910` builds `new THREE.DataArrayTexture(bytes, width, height, pages)`
from the strike.

So the boundary the split needs already exists and is only mislabelled. The baked payload carries the
data; `compileFont` yields the binding and handles into that data; each engine binds those handles its
own way -- a `DataArrayTexture` in Three, a `GPUTexture` in a WebGPU-native renderer. Rename
`ThreeTextEngineResource` to `RasterEngineResource` and move it with the portable half; the texture
and buffer caches stay in each renderer's plan target, which is where they already are.

## Risks

- **Type erasure at the registry boundary.** The Three registry erases to `ThreeRasterPlanProgram<AnyRasterTechnique, unknown>`; the portable registry needs the same discipline with the generic surface preserved for the caller.
- **Two registries, one technique.** A technique registered portably but not for Three must fail with a message naming which registration is missing, not a generic missing-technique error. The current messages -- "no first-party font-binding compiler is registered", "no first-party Three resource resolver is registered" -- describe hard-coded branches rather than registry misses and must be rewritten either way.
- **Bundler side-effect elision.** Discovery through import means the package must declare technique and baker modules as having side effects, or a bundler may drop the registration.
- **Import cycles.** First-party techniques registering portably means `raster/*-technique.ts` gains a dependency on the `/core` registry. Verify no cycle results before moving the first-party registrations in step 3.
