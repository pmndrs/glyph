---
type: Research Plan
title: TypeGPU-first shader authority
description: Exploratory architecture for authoring canonical text raster programs in TypeGPU and adapting them to direct WebGPU hosts, Three.js, and gpucat without coupling the renderer-neutral core to a GPU framework.
documentation_type: explanation
tags: [research, typegpu, three, gpucat, shaders, raster, webgpu, webgl]
status: draft
sources:
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: raster-technique
    resource: raster-technique-api.md
    title: Raster technique and engine resource API
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: gpucat-plan
    resource: gpucat-integration.md
    title: External gpucat integration fitness plan
  - id: typegpu-three
    resource: https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-three/
    title: Official TypeGPU and TSL integration documentation
  - id: typegpu-functions
    resource: https://docs.swmansion.com/TypeGPU/apis/functions/
    title: Official TypeGPU shader-function documentation
  - id: typegpu-philosophy
    resource: https://docs.swmansion.com/TypeGPU/why-typegpu/
    title: Official TypeGPU architecture and WebGPU scope
  - id: bitmap-v0
    resource: ../../../packages/glyph/src/raster/bitmap.ts
    title: Merged v0 Bitmap TSL implementation
  - id: slug-v0
    resource: ../../../packages/glyph/src/raster/slug.ts
    title: Merged v0 Slug TSL implementation
  - id: slug-texture-v0
    resource: ../../../packages/glyph/src/typegpu/slug-shaders/slug-texture.ts
    title: Merged v0 Slug texture access
  - id: gpucat
    resource: https://github.com/isaac-mason/gpucat/tree/11cf91b5172cc5143f68ff6ebf01c5e815de4e94
    title: gpucat at the reviewed revision
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

# TypeGPU-first shader authority

## The question

Could TypeGPU become the authoritative implementation of Bitmap, MTSDF, and Slug GPU logic while the same programs feed:

```ts
TypeGPU shader source
  -> direct TypeGPU/WebGPU text engine
  -> Wayfare or another WebGPU host
  -> @typegpu/three -> Three.js WebGPURenderer
  -> generated WGSL -> gpucat WebGPU
```

This is an exploratory answer, not an accepted replacement for the native TSL implementation. The strongest form is worth
testing because one authoritative shader implementation would reduce drift and give custom programs the real Slug,
MTSDF, and Bitmap logic without copying it. The boundary must still survive if only part of that bridge works.

## Reviewed-version baseline

TypeGPU is not installed in this repository, so no TypeGPU declaration in this plan is yet compile evidence. The external
review inspected `three@0.185.1`, `typegpu@0.11.9`, and `@typegpu/three@0.11.0` exactly. At those versions:

- `toTSL()` accepts a nullary closure and resolves it to WGSL text parsed by Three's `WGSLNodeBuilder`; it is not a native
  TSL graph conversion;
- `fromTSL()` carries WGSL data values, not a demonstrated sampleable-resource handle for Slug's dependent loads;
- the package deep-imports Three WebGPU internals and has no forced-WebGL2 path; and
- an argument-taking `tgpu.fn(...)` cannot be passed directly to `toTSL()`.

Those are current falsifiers for outcome A, not permanent claims about future releases. The experiment pins all three exact
versions, reruns the capability fixture on every upgrade, and constrains released peer ranges to combinations that passed.
The broad upstream peer range is not compatibility evidence because the bridge deep-imports renderer internals.

## Preserve the accepted core

TypeGPU does not enter shaping, layout, paragraph ownership, physical glyph partitioning, canonical CPU storage, variants,
or target synchronization:

```ts
import {
  createTextRuntime,
  type ParagraphBatchTarget,
  type PreparedGlyphBatch,
  type PreparedGlyphRun,
} from '@pmndrs/glyph';
```

The core prepares renderer-neutral revisions. A TypeGPU, Three, or gpucat integration consumes those same public values.
The experiment may correct an incomplete public datum—such as stable `GlyphBatchKey` identity or the pre-update
`rasterPixelRatio` input—but it must not add `TgpuRoot`, TSL nodes, gpucat nodes, GPU handles, materials, or pipeline types
to core.

That separation is the fitness criterion:

```ts
expect(core).not.toImport('typegpu');
expect(core).not.toImport('@typegpu/three');
expect(core).not.toImport('three');
expect(core).not.toImport('gpucat');
```

## Strongest TypeGPU-first package shape

The reusable TypeGPU package does not need to be a complete scene engine. Its primary product can be typed raster programs:

```txt
@pmndrs/glyph
  core loading, shaping, layout, batches, storage, runs, target protocol

@pmndrs/glyph/raster/{bitmap,mtsdf,slug}
  baker + portable decoder + resource selection + canonical storage schema

@pmndrs/glyph/typegpu
  TypeGPU vertex/fragment functions + resource ABI + program factories
  optional direct pass encoder; no scene graph, canvas, RAF, or adapter request

@pmndrs/glyph/three
  Three objects, loader, target, ordering, materials, native TSL programs

@pmndrs/glyph/three/typegpu                 // experiment
  @typegpu/three bridge into Three-owned NodeMaterials; WebGPU-only today

@pmndrs/glyph-gpucat                        // external fitness package
  gpucat objects, target, resource wrappers, draws, and shader adaptation
```

Three, React Three Fiber, and TypeGPU are package-owned subpaths. The gpucat fitness package remains external and proves
that the renderer-neutral contracts are sufficient without deep imports.

## Author a complete raster kernel, not only fragment coverage

The existing `RasterShader.evaluate()` sketch is too narrow if it implies one fragment function. The merged v0 proves that
the hard technique contract includes both stages:

```ts
interface TypeGpuRasterKernel<Technique, VertexInput, VertexOutput, FragmentInput, FragmentOutput> {
  readonly technique: Technique;
  readonly vertex: TypeGpuFn<VertexInput, VertexOutput>;
  readonly fragment: TypeGpuFn<FragmentInput, FragmentOutput>;
  readonly resources: TypeGpuRasterResourceSchema<Technique>;
}
```

- Bitmap expands the glyph quad, samples an R8 strike, and snaps projected vertex edges to physical framebuffer pixels.
- MTSDF expands the quad, samples its atlas, evaluates screen derivatives, reconstructs distance, and applies fill,
  outline, and shadow coverage.
- Slug dilates geometry for antialiasing, passes a render coordinate, follows header/reference indirection, performs
  dependent curve-texture loads inside bounded dynamic loops, and computes analytic coverage.

An implementation that shares only the final coverage function is not authoritative for the technique.

## Direct TypeGPU host

The cleanest success path consumes the kernel without translation:

```ts
const program = createTypeGpuSlugProgram(root, { kernel: slugKernel });
const target = createTypeGpuParagraphBatchTarget({
  root,
  technique: slug,
  program,
  colorFormat,
});

const attachment = paragraphs.attach(target);

runtime.update();
attachment.prepare();
attachment.commit();
target.encode(pass, attachment.current, frame);
```

The host owns the `TgpuRoot`, device, render pass, command submission, frame loop, transforms, and composition. The program
owns typed layouts, GPU font-resource caches, bounded pipeline/variant caches, shader functions, and draw compilation. The
target owns one batch's instance/transform buffers and committed draw revision.

Wayfare is only a candidate consumer if it exposes compatible WebGPU device and render-pass interop. Its source has not yet
been inspected in this research pass, so reuse is a Gate 3 proof obligation rather than a claim. If compatible, it need not
adopt the direct text engine or surrender its own entity lifecycle.

## Bridge to Three.js

The optimistic adapter captures Three nodes inside a zero-argument `toTSL()` closure:

```ts
const colorNode = t3.toTSL(() => {
  'use gpu';

  return slugKernel.fragment({
    coordinate: t3.fromTSL(renderCoordinate, d.vec2f).$,
    color: t3.fromTSL(instanceColor, d.vec4f).$,
    resources: readSlugResourcesFromThree(),
  });
});

material.colorNode = colorNode.rgb;
material.opacityNode = colorNode.a;
```

Three still owns `MeshBasicNodeMaterial`, attributes/accessors, texture objects, render state, hidden meshes, scene
ordering, renderer isolation, resource retirement, and custom TSL composition. TypeGPU supplies only the kernel embedded in
that Three program.

This does not work for the real techniques at the reviewed versions. Official `@typegpu/three` documentation states that
the bridge works only on WebGPU-enabled devices. Its examples capture supported TSL values inside a nullary closure; they do not prove that
Three textures can enter TypeGPU as sampleable resources, that Slug's dependent texture loads and dynamic loops survive,
or that a structured vertex/fragment ABI returns usable TSL nodes.

The reviewed implementation confirms WGSL injection, no WebGL2 route, and no demonstrated way to carry the required
sampleable Three resources. Therefore the native TSL program remains the flagship implementation. Retiring it is permitted only after the bridge
passes the complete Bitmap, MTSDF, and Slug proof on every backend promised by `@pmndrs/glyph/three`. If TypeGPU remains
WebGPU-only, it is an optional package rather than a silent implementation detail of the default Three integration.

## Bridge to gpucat

The WebGPU hypothesis is:

```ts
const source = resolveTypeGpuKernel(slugKernel);
const evaluateSlug = wgslFn(source.wgsl, {
  output: SlugOutput,
  params: SlugParameters,
  glsl: source.glsl,
});
```

Gpucat can consume the same core batches and dirty ranges, but its instance ABI is not Three's. Reviewed gpucat meshes
expect per-instance data in data textures indexed by `instanceIndex`; the Three implementation currently uses instanced
attributes. The shared kernel must consume semantic inputs supplied by an engine wrapper rather than directly naming
either layout.

Gpucat's raw `wgslFn()` escape hatch also requires a GLSL companion on its WebGL backend. TypeGPU intentionally targets
WebGPU, so a TypeGPU-generated WGSL function alone cannot be authoritative for gpucat's two backends. The experiment must
choose explicitly:

```ts
type GpucatShaderSupport =
  | { backend: 'webgpu'; wgsl: string }
  | { backend: 'webgpu+webgl'; wgsl: string; glsl: string };
```

If WebGL is required, a native GLSL companion verified against the same semantic vectors is valid duplication. If the
package is WebGPU-only, its name and documentation must say so.

## Where authority can actually live

There are three viable outcomes:

### A. TypeGPU is the complete shader authority

```ts
TypeGPU vertex + fragment kernels
  -> direct WebGPU programs
  -> Three through @typegpu/three
  -> gpucat through resolved WGSL
```

This is the ideal and the least proven. It requires full resource, loop, derivative, stage, and customization bridges.

### B. TypeGPU is the WebGPU authority

```ts
TypeGPU kernels -> direct WebGPU + Wayfare + gpucat WebGPU
native TSL      -> Three WebGPU + WebGL2
native GLSL     -> gpucat WebGL when supported
```

This still gives WebGPU hosts one implementation while retaining engine-native fallbacks. It is the most plausible
TypeGPU-first result today.

### C. The semantic raster specification is authoritative

```ts
resource ABI + stage semantics + CPU reference evaluator + golden vectors
  -> TypeGPU implementation
  -> native TSL implementation
  -> gpucat WGSL/GLSL implementation
```

If compiler bridges cannot carry Slug or vertex work, the shared source of truth becomes behavior rather than one shader
language. This is not hand-wavy prose: the specification must name exact record layouts, resource addressing, coordinate
spaces, bounded loops, sampling modes, derivatives, compositing, and stage outputs, with executable CPU vectors and image
gates. Users still receive exported first-party shader implementations and never have to rewrite Slug for a gradient.

Outcome C is the fallback, not a core API change.

The semantic resource ABI names logical records and addressing, not one GPU storage class. Slug may realize the same
header/reference/curve records as storage buffers on WebGPU and integer textures on WebGL2. Each backend wrapper must prove
that its accessor implements the same bounds, indices, texel/word decoding, and coordinate convention before it calls the
shared math. This separates the algorithm without pretending that a WebGPU bind-group layout is portable to WebGL2.

## Preserve customization and batching

Core `renderVariant` remains opaque and resolves batch → paragraph → span intent onto ordered runs:

```ts
label.renderVariant = gradient.bind({ from: pink, to: blue });
```

The program chooses how variants affect draws:

```ts
program.compileRuns({ glyphBatches, glyphRuns })
  -> one draw when effect parameters fit indexed sidecar storage
  -> several ordered draws when graph, blend, depth, or binding compatibility differs
```

For indexed sidecar batching, the program makes the opaque-to-slot step explicit:

```ts
for (const run of glyphRuns) {
  const compatibility = variantCodec.key(run.renderVariant);
  const variantSlot = variantTable.intern(variantCodec.value(run.renderVariant));
  draws.appendOrMerge({ run, compatibility, variantSlot });
}
```

The sidecar table belongs to the program revision, is bounded with the pipeline/material caches, and writes its slot index
into target-owned instance data while staging. Core neither assigns the slot nor splits physical storage by variant.

A custom program imports the canonical kernel and replaces final composition, not the technique:

```ts
const base = slugKernel.fragment(context);
return { ...base, color: gradient(base.color, context.localPosition, parameters) };
```

The proof must inspect the generated shader and show one Slug traversal, not one traversal per chained effect. Pipeline and
material caches must be bounded or explicitly disposed; fresh variant object identity each frame cannot leak forever.

## Proof ladder

Run the cheapest falsifier first.

### Gate 0 — bridge capability

Using repository-pinned Three plus pinned `typegpu` and `@typegpu/three`:

1. capture typed scalar/vector TSL accessors inside `toTSL()` and consume the result;
2. sample the real Bitmap and MTSDF Three textures;
3. perform Slug dependent texture loads inside its bounded dynamic loop;
4. express Bitmap pixel snapping and Slug vertex dilation;
5. return the structured values the Three program must compose;
6. run the bridge on forced WebGPU and confirm forced WebGL2 fails or passes explicitly.

Failure narrows the bridge immediately; it does not trigger a core redesign.

### Gate 1 — exact types and isolation

- compile concrete interface-shaped glyph storage through `defineRasterTechnique()`;
- infer every shader, resource, variant, pipeline, and draw associated type without `any`;
- install packed public packages in isolated Three and gpucat fixtures;
- reject deep imports and prove portable/core graphs load no GPU framework.

### Gate 2 — complete techniques

- compare Bitmap WebGPU output byte-for-byte with the existing deterministic reference;
- compare MTSDF and Slug against their accepted error envelopes and visual corpora;
- inspect generated stages for pixel snapping, dilation, dependent loads, bounded loops, and one canonical traversal;
- prove fallback-font order across several physical batches and several engine draws.

### Gate 3 — integration behavior

- direct TypeGPU/Wayfare, Three, and gpucat consume identical core revisions and canonical bytes;
- adjacent revisions upload dirty ranges; skipped revisions upload all live ranges;
- first render observes late-bound text without an intentional frame delay;
- fixed overflow, resize, attachment retry, font disposal, and GPU retirement preserve old complete revisions;
- scene/render ordering limitations are documented rather than hidden behind claimed atomic batches.

### Gate 4 — effects and cost

- one gradient effect and two chained effects reuse the canonical technique in one compatible draw;
- an incompatible variant deliberately creates ordered additional draws;
- measure tree-shaken raw/gzip/Brotli transfer, graph construction, first pipeline compilation, and steady state;
- prove an application using only native Three TSL pays no TypeGPU dependency cost.

## Decision rule

Do not retire native TSL merely because a constant-color `toTSL()` sample compiles. Choose outcome A only if every complete
technique passes all promised Three and gpucat backends. Choose B if TypeGPU proves a strong WebGPU authority but engine
fallbacks remain native. Choose C if compiler/resource bridges prevent one shader source from expressing the complete
pipeline.

The core API is sound for all three outcomes when it publishes stable keys, explicit pre-update raster density, exact typed
storage, complete bindings, ordered runs, canonical dirty/live ranges, and the stage/commit target protocol. Shader
authority is an integration-package decision layered above that boundary.

## Current disposition

Outcome A is an attractive hypothesis, not the plan of record. Current primary-source evidence supports TypeGPU as modular
WebGPU building blocks and confirms a WebGPU-only Three bridge; it does not yet prove the real text resource and stage ABI.
Implement Gate 0 before building a TypeGPU engine. Until then:

- native TSL remains the flagship Three implementation;
- `@pmndrs/glyph/typegpu` is the package-owned WebGPU shader/program subpath with an optional direct encoder;
- `@pmndrs/glyph/three/typegpu` is an isolated package-owned experiment;
- gpucat remains an external public-API fitness test;
- no TypeGPU, Three, or gpucat type enters core.

## External review disposition

This ledger covers the complete retained Claude Opus report, not only its top findings. “Gate” means the prose claim was
narrowed and cannot become accepted architecture until that executable evidence exists.

| Finding                                       | Disposition in the canonical docs                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1 raster density had no core path            | Corrected: batch and paragraph density are pre-update core inputs; spans do not override target density.                                         |
| B2 target font leases did not exist           | Corrected by removing the lease claim: targets synchronously copy required CPU font data during staging and own the result.                      |
| B3 interface storage failed `Record`          | Corrected with the self-mapped storage constraint; the focused TypeScript probe passed.                                                          |
| B4 key identity/IDs were undefined            | Corrected with branded IDs and interned frozen key identity through a physical allocation generation.                                            |
| B5 `toTSL` capability claims                  | Falsified at `three@0.185.1` / `typegpu@0.11.9` / `@typegpu/three@0.11.0`; exact-version Gate 0 replaces the claim.                              |
| B6 WebGL2 omitted from the gate               | Corrected: forced WebGPU and forced WebGL2 are explicit acceptance cases.                                                                        |
| H1 reusable shader omitted vertex work        | Corrected: the reusable algorithm includes typed vertex and fragment stages; Bitmap snap and Slug dilation are named requirements.               |
| H2 Three context could not express techniques | Corrected: each technique exports exact resource, instance, vertex, fragment, derivative, and screen-scale context types.                        |
| H3 effect generics inferred `unknown`         | Three helper corrected by binding schema inference to an exact shader. TypeGPU helper remains gated on an installed compile fixture.             |
| H4 program inference helper undeclared        | Corrected: `defineTypeGpuRasterProgram()` is declared, but remains unverified until the TypeGPU fixture exists.                                  |
| H5 per-group hook staged unrelated targets    | Corrected: core publication only records attachment source; the observed engine calls `attachment.prepare()`.                                    |
| H6 Three silently assumed ready staging       | Corrected: the standard Three target must synchronously return `ready`; pending custom targets cannot claim same-frame publication.              |
| H7 unbounded variant/pipeline caches          | Corrected: first-party programs require configurable bounds and GPU-safe eviction; custom programs must document equivalents.                    |
| H8 gpucat order interval could interleave     | Corrected as a limitation: no interval is claimed reserved; strict adjacency requires one aggregate object or host reservation support.          |
| H9 gpucat WebGL needed GLSL                   | Corrected: WebGL support requires an explicit GLSL companion and parity gate; WGSL alone is WebGPU-only.                                         |
| H10 gpucat instance ABI differs               | Corrected: semantic canonical SoA is shared; Three attributes and gpucat data textures are target-owned accessors.                               |
| M1 duplicate `LoadedFont`                     | Removed; integration docs import the core declaration.                                                                                           |
| M2 resize/chunk identity was undefined        | Corrected: every real capacity change creates a complete new physical allocation generation and retires old keys.                                |
| M3 adjacent revision rule was ambiguous       | Corrected: only successful publication increments runtime/batch revisions.                                                                       |
| M4 no instance-to-paragraph mapping           | Corrected: the contract defines the complete derivation by scanning disjoint ordered runs.                                                       |
| M5 duplicate run `order`                      | Removed; array position is authoritative.                                                                                                        |
| M6 duplicate batch `chunk`                    | Removed from `PreparedGlyphBatch`; `GlyphBatchKey.chunk` is authoritative.                                                                       |
| M7 “complete API” used undefined types        | Corrected for core-owned public values; external `TgpuRoot` remains an imported TypeGPU type and TypeGPU declarations remain a draft gate.       |
| M8 topology semantics were undefined          | Corrected: the exact invalidation/preservation rules and stale-write behavior are specified.                                                     |
| M9 duplicate decision IDs                     | Corrected by assigning D-146 through D-151 to the duplicate rows.                                                                                |
| M10 broad peers hid deep-import drift         | Corrected: the experiment pins exact versions and reruns the compatibility fixture per upgrade.                                                  |
| L1 `msdf`/`mtsdf` naming mismatch             | Documented as an intentional target-v1 rename from the merged v0 export.                                                                         |
| L2 preparing/pending/failure flags            | Corrected: active async work, eligible dirty work, and latched failure are distinct states.                                                      |
| L3 gpucat failing test attribution            | Rechecked: 256/260 passed; one failure proves process-global symbol instability and three are stale flip-Y golden snapshots, none text evidence. |
| U1 newer bridge versions may differ           | Kept open through an exact-version rerun gate, never a floating peer-range assumption.                                                           |
| U2 “technique compositing order” undefined    | Corrected to visual run-array order plus adjacent program-expanded per-run passes.                                                               |
| U3 vertex ownership unclear                   | Corrected: canonical semantics/specification are shared; each engine program owns its executable vertex stage.                                   |
| U4 Slug buffer-vs-texture split               | Corrected with a semantic resource ABI and backend-specific storage accessors.                                                                   |
| U5 variant-to-sidecar mapping absent          | Corrected with an explicit program-owned codec/intern/write step and bounded revision lifetime.                                                  |
| U6 Wayfare was not inspected                  | Claim withdrawn; Wayfare reuse is an explicit source-inspection and execution gate.                                                              |
| U7 async variant mapping under supersession   | Corrected: candidate input/span tables are immutable and generation-tagged; stale Worker results never map against current state.                |
