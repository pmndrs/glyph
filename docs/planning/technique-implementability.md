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

### Trivial is the measurable bar, and the baker already meets it

`glyph-example-raster` is 594 lines. The split says where the contract earns its keep and where it does not:

| file | lines | |
| --- | --- | --- |
| `baker.ts` | 24 | the one side with an open contract |
| `runtime-baker.ts` | 25 | |
| `contract.ts` | 32 | |
| `raster.ts` | 143 | technique definition |
| `three.ts` | 168 | policy + `compileFont` + `createMaterial`, conflated |
| `artifact.ts` | 192 | encode/decode the baked payload |

A third-party baker costs **24 lines**, because `RasterBakerModule` asks for exactly what only the author can supply. That is the bar the consume side should meet, and it is evidence the open-contract shape works rather than an aspiration.

Two things inflate the rest, and both are ours:

- **Container mechanics, owner undecided.** `artifact.ts` hand-rolls `GLB_MAGIC`, `encodeGlb`, `concatenate`, `align4`, and manual `bufferViews`, while this package implements the same thing in `internal/compose-bake.ts` and its four validators and exports none of it. Before proposing an export, settle what `BakeArtifact` actually requires: it carries raw `bytes` with no stated container, and first-party bakers write no GLB at all -- `compose-bake` wraps for them. So either `role: 'raster'` requires a container, in which case a third-party baker cannot produce one without private code and the writer must become reachable; or the role accepts arbitrary bytes, in which case `example-raster` chose GLB for realism and owns that choice, and exporting a writer would add public surface for one example -- the same pattern this audit deleted eight subpaths for. **Answer that before adding a seam.** If a seam is warranted it is baker-side and integrator-only, so it belongs beside the bake contract rather than at the root.
- **`three.ts` conflates three contracts.** After the split its portable half is authored once and consumed by `example-renderer` as well, instead of being Three-shaped code a second engine must rewrite.

Re-measure `example-raster` after the split, and settle the container question above rather than assuming an export. If a third-party technique is not close to its baker in size, the consume-side contract is still asking for the wrong things.

## Sequencing

1. Extract `RasterPlanProgram` and `registerRasterPlanProgram` into `/core`, carrying `technique`, `policy`, and `compileFont` unchanged. Reduce `ThreeRasterPlanProgram` to `technique` plus `createMaterial`, and have the Three registry look the portable half up rather than own it.
2. Make `loadedFontBindingBytes` resolve through the portable registry before its first-party branch, so `Paragraph` and the Three runtime agree.
3. Register the three first-party plan programs portably, then delete the first-party fallback branch and the eager bitmap/msdf/slug imports from `core/font-binding.ts`.
4. Add `registerRasterBaker` and kind-based discovery.
5. Prove it by closing the matrix: **`glyph-example-renderer` consumes `glyph-example-raster`.** The two existing proofs are disjoint and neither covers the claim. `example-raster` is a third-party technique that registers through `/three`, so it proves technique-on-Three; `example-renderer` is a third-party engine importing only `/core`, but it consumes no technique at all -- its sole reference to one is a comment reading "bitmap-style". The matrix is therefore:

   |  | Three engine | third-party engine |
   | --- | --- | --- |
   | first-party technique | covered | `example-renderer` |
   | third-party technique | `example-raster` | **nothing** |

   The empty cell is the only one where neither side can be special-cased, so it is the only one that proves the portable half is portable. Every other cell passes today while `paragraph.ts:689` still has no registry lookup.
6. Re-test `Paragraph` at the root entry once the eager technique imports are gone; the delivery gate rejecting the root pulling `raster/bitmap-technique.js` is what currently blocks it.

Step 5 is the acceptance criterion. Steps 1-4 are not done until a technique the package does not know about completes the round trip inside an engine the package does not know about either.

### Third-party resources stay typed without module augmentation

`ThreeTextEngineResource` is a closed union of three first-party members plus an escape hatch typed
`resource: unknown` (`three/engine-runtime.ts:52-56`). A third party gets no type safety and cannot add
a member, so the union does not survive being made extensible.

It does not need augmentation. `RasterTechnique` already carries a phantom type map --
`RasterTechniqueTypeMap<Options, Descriptor, Data>` -- and `Data` is already an open, third-party-defined
type recovered generically through `RasterDataOf`. `Resource` rides the same rail:

```ts
interface RasterTechniqueTypeMap<Options, Descriptor, Data, Resource> {
  readonly options: Options;
  readonly descriptor: Descriptor;
  readonly data: Data;
  readonly resource: Resource;
}
export type RasterResourceOf<T extends AnyRasterTechnique> = RasterTechniqueTypesOf<T>['resource'];

type RasterEngineResource<T extends AnyRasterTechnique = AnyRasterTechnique> =
  Readonly<{ technique: T['id']; resource: RasterResourceOf<T> }>;
```

The three-member union collapses to one generic shape, and a third-party resource type is inferred at
its `defineRasterTechnique` site and flows to every call site holding the technique.

Prefer this to `declare module` augmentation. Augmentation is global and single-instance: two versions of
a technique package collide in one interface map, the consumer must import the augmenting module purely
for types, and a site generic over techniques cannot say which technique a resource belongs to.
Parameterisation has none of those, and it is the erasure story this package already runs for `Data`.
`unknown` remains correct only inside a deliberately erased registry interior, as
`ThreeRasterPlanProgram<AnyRasterTechnique, unknown>` already does.

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
