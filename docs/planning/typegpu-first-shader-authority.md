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
    resource: ../../packages/text/src/raster/bitmap.ts
    title: Merged v0 Bitmap TSL implementation
  - id: slug-v0
    resource: ../../packages/text/src/raster/slug.ts
    title: Merged v0 Slug TSL implementation
  - id: slug-texture-v0
    resource: ../../packages/text/src/internal/slug-shaders/slug-texture.ts
    title: Merged v0 Slug texture access
  - id: gpucat
    resource: https://github.com/isaac-mason/gpucat/tree/11cf91b5172cc5143f68ff6ebf01c5e815de4e94
    title: gpucat at the reviewed revision
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-07T02:38:24Z'
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

## Preserve the accepted core

TypeGPU does not enter shaping, layout, paragraph ownership, physical glyph partitioning, canonical CPU storage, variants,
or target synchronization:

```ts
import {
  createTextRuntime,
  type ParagraphBatchTarget,
  type PreparedGlyphBatch,
  type PreparedGlyphRun,
} from '@pmndrs/text';
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
@pmndrs/text
  core loading, shaping, layout, batches, storage, runs, target protocol

@pmndrs/text-raster-{bitmap,mtsdf,slug}
  baker + portable decoder + resource selection + canonical storage schema

@pmndrs/text-typegpu
  TypeGPU vertex/fragment functions + resource ABI + program factories
  optional direct pass encoder; no scene graph, canvas, RAF, or adapter request

@pmndrs/text-three
  Three objects, loader, target, ordering, materials, native TSL programs

@pmndrs/text-three-typegpu                 // experiment
  @typegpu/three bridge into Three-owned NodeMaterials; WebGPU-only today

@pmndrs/text-gpucat                        // external fitness package
  gpucat objects, target, resource wrappers, draws, and shader adaptation
```

All engine packages may live outside this repository. They depend only on packed public packages; no internal subpath is a
privileged integration API.

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
attachment.commit();
target.encode(pass, attachment.current, frame);
```

The host owns the `TgpuRoot`, device, render pass, command submission, frame loop, transforms, and composition. The program
owns typed layouts, GPU font-resource caches, bounded pipeline/variant caches, shader functions, and draw compilation. The
target owns one batch's instance/transform buffers and committed draw revision.

Wayfare can reuse the program if it exposes compatible WebGPU device and render-pass interop. It does not need to adopt the
direct text engine or surrender its own entity lifecycle.

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

This is not proven for the real techniques. Official `@typegpu/three` documentation currently states that the bridge works
only on WebGPU-enabled devices. Its examples capture supported TSL values inside a nullary closure; they do not prove that
Three textures can enter TypeGPU as sampleable resources, that Slug's dependent texture loads and dynamic loops survive,
or that a structured vertex/fragment ABI returns usable TSL nodes.

Therefore the native TSL program remains the flagship implementation. Retiring it is permitted only after the bridge
passes the complete Bitmap, MTSDF, and Slug proof on every backend promised by `@pmndrs/text-three`. If TypeGPU remains
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
- `@pmndrs/text-typegpu` is specified as an independent WebGPU shader/program package with an optional direct encoder;
- `@pmndrs/text-three-typegpu` is an isolated experiment;
- gpucat remains an external public-API fitness test;
- no TypeGPU, Three, or gpucat type enters core.
