---
type: API Specification
title: TypeGPU raster programs and text engine
description: Target v1 API for the package-owned TypeGPU integration subpath containing reusable technique shaders, variant-aware raster programs, and a direct WebGPU text engine that consumes renderer-neutral core paragraph batches without Three.js.
documentation_type: reference
tags: [api, typegpu, webgpu, shaders, raster, engine, batching, variants]
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
  - id: typegpu-roots
    resource: https://docs.swmansion.com/TypeGPU/apis/roots/
    title: TypeGPU roots and device ownership
  - id: typegpu-functions
    resource: https://docs.swmansion.com/TypeGPU/apis/functions/
    title: TypeGPU typed GPU functions
  - id: typegpu-buffers
    resource: https://docs.swmansion.com/TypeGPU/apis/buffers/
    title: TypeGPU buffers and range writes
  - id: typegpu-bind-groups
    resource: https://docs.swmansion.com/TypeGPU/apis/bind-groups/
    title: TypeGPU bind groups
  - id: typegpu-pipelines
    resource: https://docs.swmansion.com/TypeGPU/apis/pipelines/
    title: TypeGPU render pipelines and raw WebGPU interop
  - id: typegpu-interop
    resource: https://docs.swmansion.com/TypeGPU/integration/webgpu-interoperability/
    title: TypeGPU WebGPU interoperability
  - id: typegpu-three
    resource: https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-three/
    title: TypeGPU and TSL interoperability
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-07T04:31:24Z'
---

# TypeGPU raster programs and text engine

This is an engine-integration subpath, not part of the renderer-neutral core entry:

```ts
import { createTextRuntime, type ParagraphBatchTarget } from '@pmndrs/text';
import { createTypeGpuTextEngine } from '@pmndrs/text/typegpu';
```

`@pmndrs/text/typegpu` is maintained and shipped by this package. Its dependency direction is still enforced: it consumes
renderer-neutral core and technique contracts, core never imports TypeGPU, and the subpath receives no package-private
shaping or batching state.

The TypeGPU surface has two independent jobs:

```ts
RasterTechnique                 // portable decoded CPU data and canonical glyph storage
  -> TypeGpuRasterShader        // canonical Bitmap, MTSDF, or Slug GPU algorithm
  -> TypeGpuRasterProgram       // resources, variants, pipelines, and draw compilation
  -> TypeGpuTextEngine          // retained core synchronization and pass encoding
```

The shader and program can be reused by Wayfare or another WebGPU host. The direct engine is the smallest complete renderer
for applications that already own a `GPUDevice` and render pass. It owns neither a canvas nor a scene graph nor a frame
loop.

## Create an engine from an existing TypeGPU root

```ts
import tgpu from 'typegpu';
import { createTypeGpuTextEngine, createTypeGpuSlugProgram } from '@pmndrs/text/typegpu';
import { slug } from '@pmndrs/text/raster/slug';

const root = tgpu.initFromDevice({ device });
const program = createTypeGpuSlugProgram(root);

const text = await createTypeGpuTextEngine({
  root,
  colorFormat: navigator.gpu.getPreferredCanvasFormat(),
  depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  sampleCount: 4,
});

const font = await text.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: slug },
});

const labels = text.createParagraphBatch({ technique: slug, program });
const score = labels.add({ font, text: 'Score 0' });

score.text = 'Score 1';
text.update();

const pass = commandEncoder.beginRenderPass(renderPassDescriptor);
labels.encode(pass, { viewProjection, viewport: [width, height], pixelRatio: devicePixelRatio });
pass.end();
```

`createTypeGpuTextEngine()` accepts a caller-owned root. It never requests an adapter/device and never destroys the root.
TypeGPU itself preserves that ownership when a root is initialized from an existing device. The application owns device
loss, canvas configuration, command encoders, pass descriptors, queue submission, and frame fences.

## Proposed public surface (compile gate required)

```ts
import type { TgpuRoot } from 'typegpu';

interface TypeGpuTextEngine {
  readonly root: TgpuRoot;
  readonly current: TextRuntimeRevision;
  readonly disposed: boolean;

  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;

  createParagraphBatch<Technique extends AnyRasterTechnique, Program extends AnyTypeGpuRasterProgram<Technique>>(
    options: TypeGpuParagraphBatchOptions<Technique, Program>,
  ): TypeGpuParagraphBatch<Technique, TypeGpuVariantOf<Program>, Program>;

  update(): TextRuntimeRevision;
  updateAsync(options?: AsyncTextUpdateOptions): Promise<TextUpdateOutcome>;
  updateAsync(callback: TextUpdateCallback): void;
  updateAsync(options: AsyncTextUpdateOptions, callback: TextUpdateCallback): void;
  dispose(): void;
}

interface TypeGpuTextEngineOptions {
  readonly root: TgpuRoot;
  readonly colorFormat: GPUTextureFormat;
  readonly depthStencil?: GPUDepthStencilState;
  readonly sampleCount?: number;
  readonly runtime?: TextRuntimeOptions;
}

declare function createTypeGpuTextEngine(options: TypeGpuTextEngineOptions): Promise<TypeGpuTextEngine>;
```

The engine privately owns one core `TextRuntime`. Its font, paragraph, synchronization, failure, capacity, and disposal
semantics are exactly the core semantics. Unlike Three, TypeGPU has no scene traversal hook, so synchronization is explicit:
mutate any paragraph handles, call `update()` or `updateAsync()` at the application's chosen frame boundary, then encode
the last committed revision into as many passes as needed. Calling `encode()` never shapes and never publishes pending
desired state.

## Retain a renderable paragraph batch

```ts
interface TypeGpuParagraphBatchOptions<
  Technique extends AnyRasterTechnique,
  Program extends AnyTypeGpuRasterProgram<Technique>,
> {
  readonly technique: Technique;
  readonly program: Program;
  readonly capacity?: GlyphBufferCapacity;
  readonly rasterPixelRatio?: number;
  readonly renderVariant?: TypeGpuVariantOf<Program>;
}

interface TypeGpuParagraphBatch<
  Technique extends AnyRasterTechnique,
  Variant,
  Program extends AnyTypeGpuRasterProgram<Technique>,
> {
  readonly technique: Technique;
  readonly program: Program;
  readonly current: TypeGpuParagraphBatchTargetRevision<TypeGpuDrawOf<Program>> | undefined;
  readonly error: TextPreparationError | ParagraphBatchTargetError | undefined;
  readonly disposed: boolean;

  rasterPixelRatio: number;
  renderVariant: Variant | undefined;
  add(properties: TypeGpuParagraphProperties<Technique, Variant>): TypeGpuParagraph<Technique, Variant>;
  has(paragraph: TypeGpuParagraph<Technique, Variant>): boolean;
  setCapacity(capacity: GlyphBufferCapacity): void;
  retry(): void;
  encode(pass: GPURenderPassEncoder, frame: TypeGpuFrame): void;
  dispose(): void;
}

interface TypeGpuFrame {
  readonly viewProjection: Float32Array;
  readonly viewport: readonly [width: number, height: number];
  readonly pixelRatio: number;
}
```

One TypeGPU paragraph batch wraps one core `ParagraphBatch` and one attached target. `encode()` calls the hidden
attachment's `prepare()`, commits its ready candidate, binds program resources, and encodes the target revision's compiled
draws into the supplied pass. The standard target stages synchronously; an alternative target that needs asynchronous
pipeline work uses the public attachment contract directly and resolves it before encoding. The caller
may encode the same live batch in several compatible passes or omit it for a frame. A batch is fixed to the root/device and
render-target compatibility declared at engine construction.

## Transform paragraphs without reshaping

```ts
interface TypeGpuParagraphProperties<Technique extends AnyRasterTechnique, Variant> extends ParagraphProperties<
  Technique,
  Variant
> {
  readonly transform?: ArrayLike<number>;
  readonly visible?: boolean;
}

interface TypeGpuParagraph<Technique extends AnyRasterTechnique, Variant> {
  readonly id: ParagraphId;
  readonly disposed: boolean;
  readonly layout: ParagraphLayout | undefined;

  font: FontSelection<Technique>;
  text: TextInput<Technique>;
  spans: readonly ParagraphSpan<Technique, Variant>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  rasterPixelRatio: number;
  order: number;
  renderVariant: Variant | undefined;
  visible: boolean;

  set(properties: TypeGpuParagraphUpdate<Technique, Variant>): void;
  setSpan(index: number, span: ParagraphSpan<Technique, Variant>): void;
  removeSpan(index: number): void;
  setTransform(columnMajorMatrix4: ArrayLike<number>): void;
  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;
  snapshotProperties(): TypeGpuParagraphSnapshot<Technique, Variant>;
  dispose(): void;
}

type TypeGpuParagraphUpdate<Technique extends AnyRasterTechnique, Variant> = ParagraphUpdate<Technique, Variant> &
  Readonly<{
    transform?: ArrayLike<number>;
    visible?: boolean;
  }>;

interface TypeGpuParagraphSnapshot<Technique extends AnyRasterTechnique, Variant> extends ParagraphSnapshot<
  Technique,
  Variant
> {
  readonly transform: Float32Array;
  readonly visible: boolean;
}
```

`setTransform()` copies exactly 16 finite column-major values into retained engine state. Transform and visibility changes
dirty only the target's transform/visibility storage; they do not call core shaping. The program may repeat matrices per
glyph, index a transform table, use indirect draws, or cull complete paragraphs. This choice never changes paragraph-local
core layout. `encode()` flushes those target-owned dirty ranges before encoding the first draw that observes them.

`rasterPixelRatio` participates in core resource selection and must be assigned before `update*()`. `TypeGpuFrame.pixelRatio`
is later frame state used by vertex snapping and screen-space evaluation during `encode()`; it cannot retroactively select a
Bitmap strike. An integration normally keeps the two equal and updates the batch density before synchronization when the
render target density changes.

## Define a canonical TypeGPU technique shader

```ts
interface TypeGpuRasterStage<InputSchema, OutputSchema, Evaluate> {
  readonly input: InputSchema;
  readonly output: OutputSchema;
  readonly evaluate: Evaluate;
}

interface TypeGpuRasterShader<Technique extends AnyRasterTechnique, Vertex, Fragment, ResourceSchema> {
  readonly technique: Technique;
  readonly vertex: Vertex;
  readonly fragment: Fragment;
  readonly resources: ResourceSchema;
}

declare function defineTypeGpuRasterShader<Technique extends AnyRasterTechnique, Vertex, Fragment, ResourceSchema>(
  shader: TypeGpuRasterShader<Technique, Vertex, Fragment, ResourceSchema>,
): TypeGpuRasterShader<Technique, Vertex, Fragment, ResourceSchema>;
```

Each concrete TypeGPU stage supplies the actual validation. For example, `fragment.evaluate` is the exact value returned by
`tgpu.fn([SlugFragmentInput], SlugFragmentOutput)(implementation)`, while `vertex.evaluate` owns Slug dilation and its
varying output. The helper infers and retains both functions, their input/output schemas, and the complete resource schema;
no associated type widens to `any`. JavaScript-authored functions require TypeGPU's build transform, while WGSL-shell
functions remain a supported package implementation choice.

First-party shaders export their typed function as a public customization seam:

```ts
const base = slugShader.fragment.evaluate(context);
const output = { ...base, color: gradient(base.color, context.localPosition) };
```

`context` contains only technique and semantic instance inputs. `base` is the canonical resolved Slug fragment result.
The custom program keeps curve traversal, coverage, clipping, and technique validation instead of rewriting them.

## Define variants and compile runs

```ts
interface TypeGpuVariantCodec<Variant, Key, Schema, Value> {
  readonly schema: Schema;
  key(variant: Variant | undefined): Key;
  value(variant: Variant | undefined): Value;
}

declare const typeGpuRasterProgramTypes: unique symbol;

interface TypeGpuRasterProgramTypeMap<Variant, Shader, Codec, FontResources, Pipeline, Draw> {
  readonly variant: Variant;
  readonly shader: Shader;
  readonly codec: Codec;
  readonly fontResources: FontResources;
  readonly pipeline: Pipeline;
  readonly draw: Draw;
}

interface AnyTypeGpuRasterProgram<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly [typeGpuRasterProgramTypes]?: TypeGpuRasterProgramTypeMap<
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown
  >;
}

type TypeGpuProgramTypesOf<Program extends AnyTypeGpuRasterProgram<AnyRasterTechnique>> = NonNullable<
  Program[typeof typeGpuRasterProgramTypes]
>;
type TypeGpuVariantOf<Program extends AnyTypeGpuRasterProgram<AnyRasterTechnique>> =
  TypeGpuProgramTypesOf<Program>['variant'];
type TypeGpuDrawOf<Program extends AnyTypeGpuRasterProgram<AnyRasterTechnique>> =
  TypeGpuProgramTypesOf<Program>['draw'];

interface TypeGpuRasterProgram<
  Technique extends AnyRasterTechnique,
  Variant,
  Shader extends TypeGpuRasterShader<Technique, Vertex, Fragment, ResourceSchema>,
  Vertex,
  Fragment,
  ResourceSchema,
  VariantKey,
  VariantSchema,
  VariantValue,
  FontResources,
  Pipeline,
  Draw,
> extends AnyTypeGpuRasterProgram<Technique> {
  readonly [typeGpuRasterProgramTypes]?: TypeGpuRasterProgramTypeMap<
    Variant,
    Shader,
    TypeGpuVariantCodec<Variant, VariantKey, VariantSchema, VariantValue>,
    FontResources,
    Pipeline,
    Draw
  >;
  readonly shader: Shader;
  readonly variant: TypeGpuVariantCodec<Variant, VariantKey, VariantSchema, VariantValue>;
  readonly cacheLimits: {
    readonly pipelines: number;
    readonly materializedVariants: number;
  };

  createFontResources(root: TgpuRoot, font: LoadedFont<Technique>, binding: RasterBindingOf<Technique>): FontResources;
  createPipeline(root: TgpuRoot, key: VariantKey, pipelineVariant: number): Pipeline;
  compileRuns(
    context: TypeGpuProgramRunContext<Technique, Variant, VariantKey, FontResources, Pipeline>,
  ): readonly Draw[];
  encode(pass: GPURenderPassEncoder, draw: Draw, frame: TypeGpuFrame): void;
  disposeFontResources(resources: FontResources): void;
  disposePipeline(pipeline: Pipeline): void;
  dispose(): void;
}

declare function defineTypeGpuRasterProgram<
  Technique extends AnyRasterTechnique,
  const Program extends AnyTypeGpuRasterProgram<Technique>,
>(program: Program): Program;

interface TypeGpuProgramRunContext<Technique extends AnyRasterTechnique, Variant, VariantKey, FontResources, Pipeline> {
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];
  readonly glyphRuns: readonly PreparedGlyphRun<Variant>[];
  readonly fontResources: ReadonlyMap<GlyphBatchKey, FontResources>;
  pipeline(key: VariantKey, pipelineVariant: number): Pipeline;
}
```

`AnyTypeGpuRasterProgram` contains only common identity plus an associated-type witness. A concrete program returned by
`defineTypeGpuRasterProgram()` preserves the exact shader input/output/function, variant key/schema/value, font-resource,
pipeline, and draw types. A heterogeneous registry exposes associated values as `unknown` and must narrow before
program-specific work. No public default uses `any` as an inference placeholder.

The reusable program does not own paragraph-batch instance buffers or a live target revision. A target created from that
program owns those per-batch values:

```ts
interface TypeGpuParagraphBatchTargetRevision<Draw> extends ParagraphBatchTargetRevision {
  readonly draws: readonly Draw[];
}

interface TypeGpuParagraphBatchTarget<
  Technique extends AnyRasterTechnique,
  Variant,
  Program extends AnyTypeGpuRasterProgram<Technique>,
> extends ParagraphBatchTarget<Technique, Variant, TypeGpuParagraphBatchTargetRevision<TypeGpuDrawOf<Program>>> {
  readonly root: TgpuRoot;
  readonly program: Program;
  encode(
    pass: GPURenderPassEncoder,
    revision: TypeGpuParagraphBatchTargetRevision<TypeGpuDrawOf<Program>>,
    frame: TypeGpuFrame,
  ): void;
}

declare function createTypeGpuParagraphBatchTarget<
  Technique extends AnyRasterTechnique,
  Program extends AnyTypeGpuRasterProgram<Technique>,
>(options: {
  readonly root: TgpuRoot;
  readonly technique: Technique;
  readonly program: Program;
  readonly colorFormat: GPUTextureFormat;
  readonly depthStencil?: GPUDepthStencilState;
  readonly sampleCount?: number;
}): TypeGpuParagraphBatchTarget<Technique, TypeGpuVariantOf<Program>, Program>;
```

`TypeGpuTextEngine.createParagraphBatch()` constructs this target, attaches it to the hidden core batch, and exposes the
retained convenience shown earlier. Another engine may call the factory directly only after proving compatible WebGPU
device/pass interop, attach it to its own public core batch, and decide when to prepare, commit, and encode. Wayfare remains
an unverified candidate rather than a claimed consumer. Several targets and batches can lease one program without sharing their
instance, transform, draw-revision, or fence state.

`variant.key()` describes pipeline/material compatibility, not authored identity. Two different parameter bindings may
return the same key and occupy one draw when the program writes their values to indexed sidecar storage. Conversely, a
variant that changes shader graph, bind-group layout, blend mode, depth policy, or another pipeline constraint returns a
different key. The program compiles adjacent core runs by physical glyph batch plus variant key and may split further for
engine limits. It does not reorder non-equivalent runs.

Changing a core variant rebuilds the run plan but does not reshape. Mutating values inside a stable program-owned binding
may update only its TypeGPU sidecar buffer and need no core update at all. Programs should use immutable variant snapshots
or stable binding objects so equality and lifetime remain explicit.

First-party program caches are bounded. Their factory options declare maximum pipeline and materialized-variant entries;
least-recently-used entries retire through the same GPU-safe path as explicit program disposal. A new object-valued variant
each frame cannot create an unbounded cache. Custom programs own and document equivalent bounds.

## Compose effects without replacing the technique

The convenience helper's exact declaration is intentionally not claimed yet. TypeGPU is not installed in this repository,
and the earlier five-parameter sketch could infer `Parameters`, `Context`, and `Output` as `unknown`. The accepted shape is
constrained instead:

- the helper takes the exact technique shader as an inference anchor;
- parameter values are derived from the declared TypeGPU schema through the installed TypeGPU type utilities;
- fragment context and output are derived from that shader's exact fragment stage; and
- the returned binding accepts only the derived parameter value.

Milestone 11's compile fixture must name the actual TypeGPU schema-value utility and prove contextual callback types before
this helper becomes public. If TypeGPU cannot expose that relation, the package exports only already-typed `tgpu.fn()`
composition values and does not manufacture a weaker wrapper.

```ts
const gradient = defineTypeGpuTextEffect(slugShader, {
  parameters: GradientParameters,
  compose(base, parameters, context) {
    return { ...base, color: applyGradient(base.color, context.localPosition, parameters) };
  },
});

const gradientSlug = createTypeGpuSlugProgram(root, {
  effects: [gradient],
});
```

This is target syntax for the gated helper, not current compile evidence.

The effect helper is optional program authoring sugar. It produces a typed program variant and composes after the canonical
technique shader. Applications may instead define their own variant and complete program. Core never imports or interprets
the effect. Effect-definition identity contributes to the program key; parameter values live in sidecar storage and do not
create a pipeline per text instance.

## Adapt the same shader to Three

`@typegpu/three@0.11.0` can inject a resolved zero-argument TypeGPU WGSL closure through Three's WebGPU node builder:

```ts
const slugNode = t3.toTSL(() => {
  'use gpu';
  return slugShader.fragment.evaluate(readSlugContextFromTsl());
});
const threeProgram = createThreeSlugProgram({ shader: slugNode });
```

`fromTSL()` can expose supported Three-owned data nodes where the closure needs them. The reviewed bridge has not carried
the real Slug sampleable resources, Bitmap texture sampling, returned structures, or both techniques' vertex work; those
are executable gates, not accepted capabilities. Three still
owns its node material, render-list integration, pipeline state, lifecycle, and final variant/draw compiler. Only a passed
complete-technique gate permits saying the direct TypeGPU and Three programs share the hard algorithm; they remain different
engine targets in every case.

This bridge remains WebGPU-only in the currently documented `@typegpu/three` release and experimental until generated
shader inspection, Bitmap and Slug pixel parity, repository-pinned Three compatibility, and measured tree-shaken
transfer/graph-build/compile cost pass. Native TSL remains the authoritative Three path for WebGPU plus WebGL2 unless the
bridge proves both backends.

## Ownership and failure

```ts
TypeGpuTextEngine owns: hidden TextRuntime, batch attachments, target CPU/GPU storage, program leases
TypeGpuRasterProgram owns: bind-group layouts, pipelines, program caches, variant sidecar schemas
TypeGpuParagraphBatch owns: core ParagraphBatch, target revision, instance/transform buffers, draw plan
TypeGpuParagraph owns: desired paragraph state, font leases, transform, visibility
Application owns: TgpuRoot, GPUDevice, canvas, passes, queue submission, RAF, frame fences
```

Core preparation failures follow the core sync/async contract. Program staging failures remain retained on the batch and
do not replace the live target revision. `encode()` does not throw a previously retained preparation or staging failure;
it draws the last committed revision or nothing. Invalid pass/root compatibility and use-after-dispose are immediate API
errors. Device loss belongs to the application and invalidates every engine using that root.

Dispose paragraphs before their batch when individually finished, batches before the engine, and the engine before
releasing its program leases. `engine.dispose()` cascades through its batches and hidden runtime but not the caller-owned
root/device. A program shared with another engine remains live until its final lease is released.

## Conformance

The surface is not implemented until the proof demonstrates:

- Bitmap, MTSDF, and Slug consume the same portable artifacts, glyph batches, glyph runs, and canonical storage as Three;
- adjacent updates write only dirty byte ranges through TypeGPU buffers, while first/gapped attachment initializes live
  ranges referenced by the current glyph runs;
- one program batches several parameterized variants in one draw and another deliberately splits incompatible variants;
- paragraph and span variants preserve fallback-font order without forcing shaping boundaries;
- transform, visibility, and effect-parameter animation cause no shaping;
- sync and Worker updates publish atomically and encode never exposes a partial revision;
- the engine encodes into caller-owned passes and never creates a canvas, RAF, adapter, device, or queue submission;
- raw `root.unwrap()` interop works for a host that does not otherwise use TypeGPU;
- Wayfare renders through the same programs while retaining its own entities, passes, transforms, and lifecycle;
- `toTSL()` renders canonical Bitmap and Slug output through Three with inspected generated shaders and measured cost; and
- disposal, fixed-capacity recovery, target staging failure, and device loss leave no stale buffers, bind groups, pipelines,
  listeners, or hidden work.
