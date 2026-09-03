---
type: API Specification
title: Raster technique and engine resource API
description: Canonical boundary between portable raster baking and decoding, core glyph packing, reusable shader backends, and engine-specific GPU targets.
documentation_type: reference
tags: [api, raster, baking, resources, shaders, engines, typegpu, tsl]
status: deprecated
sources:
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
  - id: gpucat-integration
    resource: gpucat-integration.md
    title: External gpucat integration fitness plan
  - id: current-raster
    resource: ../../../packages/glyph/src/raster.ts
    title: Current combined raster module
  - id: current-bake
    resource: ../../../packages/glyph/src/bake.ts
    title: Current portable raster baker contract
  - id: current-mtsdf
    resource: ../../../packages/glyph/src/raster/msdf.ts
    title: Current MTSDF decoder and Three.js target
  - id: external-proof
    resource: ../../../packages/glyph-example-raster/src/raster.ts
    title: Current external raster proof
  - id: typegpu-bindings
    resource: https://docs.swmansion.com/TypeGPU/apis/bind-groups/
    title: TypeGPU bind groups and raw WebGPU resource interop
  - id: typegpu-pipelines
    resource: https://docs.swmansion.com/TypeGPU/apis/pipelines/
    title: TypeGPU pipelines and raw WebGPU pipeline interop
  - id: typegpu-three
    resource: https://docs.swmansion.com/TypeGPU/ecosystem/typegpu-three/
    title: TypeGPU to TSL integration
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

> Historical design record. The Rust render-plan cutover superseded the TypeScript glyph binding, storage, and packing
> interfaces described below. Use [the current package reference](../packages/glyph.md),
> [core API](core-api.md), and [Three API](three-api.md) for the blessed surface.

# Raster technique and engine resource API

One raster should not be one engine plugin. The stable split is:

```ts
source font
  -> RasterBaker                         // portable, build time or Worker
  -> raster artifact + page artifacts    // portable bytes
  -> RasterTechnique.decode()            // portable validated CPU data
  -> TextRuntime.update*()                // portable partitioned instance storage
  -> RasterShader                         // reusable backend technique algorithm
  -> RasterProgram                        // engine resources, variants, and draw policy
  -> ParagraphBatchTarget                 // engine lifecycle, GPU resources, draws
```

Bitmap, MTSDF, and Slug each need one baker and one portable technique implementation. They do not need to duplicate
baking, artifact validation, external-page fetching, fallback resolution, glyph partitioning, or canonical CPU instance
packing for every engine.

Every engine still needs a target. The maintained Three.js and TypeGPU targets ship as package subpaths, while a third-party
engine may provide an external consumer package over the same public contract. Technique-specific GPU realization and
shader code can be shared when several engines
expose the same shader/resource backend, but scene traversal, render-pass placement, transforms, submission, fences, and
retirement remain engine-specific.

## Bake portable artifacts

The baker knows font outlines and the serialized raster format. It knows nothing about a renderer, GPU device, material,
scene, or draw call.

```ts
interface RasterBakerModule<Kind extends string, Options, Descriptor extends JsonValue> {
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;

  descriptor(options: Options): Descriptor;
  bake(request: RasterBakeRequest<Descriptor>): Promise<RasterBakeArtifact<Kind>>;
}
```

```ts
interface RasterBakeArtifact<Kind extends string> {
  readonly rasterKey: RasterKey;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly artifacts: readonly BakeArtifact[];
}

interface BakeArtifact {
  readonly role: 'raster' | 'raster-page';
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly sha256: Sha256Hex;
}
```

A bitmap baker may emit strike textures, MTSDF may emit atlas pages, and Slug may emit curve, header, and reference pages.
Embedded versus external packaging changes where those bytes live, not which engine can consume them.

## Load portable CPU data

`runtime.loadFont()` owns the complete asynchronous loading boundary:

```ts
const font = await runtime.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: mtsdf },
});
```

Before it resolves, core has loaded and validated the shaping artifact, found the selected raster companion, resolved every
required embedded resource or hash-validated external resource, and called the technique decoder. No GPU resource exists
yet.

```ts
interface RegisteredRaster<Kind extends string> {
  readonly rasterKey: RasterKey;
  readonly kind: Kind;
  readonly extensionData: JsonValue;

  view(bufferView: number): Uint8Array;
  resource(source: RasterResourceSource, signal?: AbortSignal): Promise<Uint8Array>;
}

type RasterResourceSource =
  | { readonly type: 'bufferView'; readonly bufferView: number }
  | {
      readonly type: 'external';
      readonly uri: string;
      readonly byteLength: number;
      readonly artifactHash: Sha256Hex;
    };
```

Raster authors use `view()` for embedded bytes and `resource()` for either embedded or SHA-256-validated external page
bytes. Applications normally do not call either method; the selected technique's `decode()` does.

```ts
interface LoadedFont<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
}
```

`font.data` is retained renderer-neutral CPU state. For example:

```ts
interface MtsdfData {
  readonly records: Uint8Array;
  readonly pages: readonly {
    readonly width: number;
    readonly height: number;
    readonly format: 'rgba8unorm';
    readonly bytes: Uint8Array;
  }[];
  readonly emSize: number;
  readonly pixelRange: number;
}
```

The exact data type belongs to the technique. Core retains it until the loaded font is disposed so another target can
attach later without fetching or decoding the font again. Engine GPU copies may coexist with this CPU source by design.

## Let the portable technique partition and pack

The current `RasterModule` combines portable decoding with Three.js textures, TSL material creation, instance allocation,
and scene objects. The replacement separates those responsibilities:

```ts
interface RasterTechnique<
  Id extends RasterTechniqueId,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
  Binding,
  Storage extends GlyphBatchStorageShape<Storage>,
> extends AnyRasterTechnique {
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap<Options, Descriptor, Data, Binding, Storage>;

  readonly id: Id;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly runtimeBaker?: RuntimeRasterBakerLoader<Kind, Options>;

  descriptor(options: RasterOptionsArgument<Options>): Descriptor;
  decode(font: RegisteredFont, raster: RegisteredRaster<Kind>, signal?: AbortSignal): Promise<Data>;

  select(input: RasterGlyphInput<Data>): RasterGlyphSelection<Binding> | undefined;
  createStorage(capacity: number): Storage;
  writeStorage(storage: Storage, range: GlyphRange, input: RasterGlyphWriteInput<Data, Binding>): void;
  validatePaint?(paint: GlyphPaint): void;
  dispose(data: Data): void;
}

interface RasterGlyphInput<Data> {
  readonly data: Data;
  readonly glyphId: number;
  readonly fontSize: number;
  readonly originX: number;
  readonly originY: number;
  readonly rasterPixelRatio: number;
  readonly paint: ResolvedPaint;
}

interface RasterGlyphWriteInput<Data, Binding> {
  readonly data: Data;
  readonly binding: Binding;
  readonly glyphs: readonly RasterGlyphInput<Data>[];
}

type GlyphBatchStorageShape<Storage> = {
  readonly [Field in keyof Storage]: ArrayBufferView;
};

type GlyphBatchStorage = Readonly<Partial<Record<PropertyKey, ArrayBufferView>>>;

declare const rasterTechniqueTypes: unique symbol;

interface RasterTechniqueTypeMap<Options, Descriptor, Data, Binding, Storage> {
  readonly options: Options;
  readonly descriptor: Descriptor;
  readonly data: Data;
  readonly binding: Binding;
  readonly storage: Storage;
}

interface AnyRasterTechnique {
  readonly id: RasterTechniqueId;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap<unknown, JsonValue, unknown, unknown, unknown>;
}

type RasterTechniqueTypesOf<Technique extends AnyRasterTechnique> =
  Technique extends RasterTechnique<
    infer _Id,
    infer _Kind,
    infer Options,
    infer Descriptor,
    infer Data,
    infer Binding,
    infer Storage
  >
    ? RasterTechniqueTypeMap<Options, Descriptor, Data, Binding, Storage>
    : RasterTechniqueTypeMap<unknown, JsonValue, unknown, unknown, GlyphBatchStorage>;
type RasterOptionsOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['options'];
type RasterDataOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['data'];
type RasterBindingOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['binding'];
type GlyphBatchStorageOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['storage'];

type RasterTechniqueDefinition<
  Id extends string,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
  Binding,
  Storage extends GlyphBatchStorageShape<Storage>,
> = Omit<RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data, Binding, Storage>, 'id'> & {
  readonly id: Id;
};

declare function defineRasterTechnique<
  const Id extends string,
  const Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
  Binding,
  Storage extends GlyphBatchStorageShape<Storage>,
>(
  technique: RasterTechniqueDefinition<Id, Kind, Options, Descriptor, Data, Binding, Storage>,
): RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data, Binding, Storage>;

declare function defineRasterResourceId<const Id extends string>(id: Id): RasterResourceId & Id;
```

The public definition boundary accepts an ordinary non-empty string literal and returns the branded technique identity.
Technique authors use `defineRasterResourceId()` for the stable resource identities returned by `select()`. The original
specification required both branded strings as inputs but exposed no safe constructor, forcing third-party packages to use
unchecked casts before they could implement the interface. The implementation proof preserved the branded outputs while
moving validation to the only boundaries that create them. Empty identifiers fail immediately.

`AnyRasterTechnique` contains only the common identity shape. It does not instantiate the generic technique with `any`, and
it cannot be used to perform typed decode, selection, or storage writes. Its associated types intentionally widen to
`unknown` / `GlyphBatchStorage` at a heterogeneous boundary. Concrete values retain their complete relationships:

```ts
const mtsdf = defineRasterTechnique({
  id: 'pmndrs.mtsdf',
  kind: 'mtsdf',
  extension: 'PMNDRS_font_distance_field',
  version: 0,
  descriptor: mtsdfDescriptor,
  decode: decodeMtsdf,
  select: selectMtsdfGlyph,
  createStorage: createMtsdfStorage,
  writeStorage: writeMtsdfStorage,
  dispose: disposeMtsdfData,
});

const atlasPage = defineRasterResourceId('inter/atlas/0');

type Data = RasterDataOf<typeof mtsdf>; // MtsdfData
type Binding = RasterBindingOf<typeof mtsdf>; // MtsdfBinding
type Storage = GlyphBatchStorageOf<typeof mtsdf>; // MtsdfGlyphBatchStorage
```

The helper's generic parameters are inference variables in its declaration; raster authors do not supply them. An unresolved
associated type remains `unknown`, which blocks technique-specific use until the author supplies enough type information. It
never silently degrades to `any`.

The erased `GlyphBatchStorage` record is partial because a concrete storage has a finite set of named fields. A total
`Record<PropertyKey, ArrayBufferView>` would falsely claim that every possible lookup exists and would reject ordinary
interfaces such as `{ origins: Float32Array; glyphs: Uint16Array }` for lacking an index signature. The self-mapped
`GlyphBatchStorageShape<Storage>` remains the strict concrete check: every field a technique declares must be an
`ArrayBufferView`.

`select()` returns the physical resource and pipeline division for one resolved glyph. It returns `undefined` for a shaped
glyph that intentionally has no renderable raster record, such as whitespace. Missing-glyph fallback is already resolved
before this call; omission is not another fallback mechanism. Core uses the result while building stable glyph batches, and
a target never repeats this selection. `resource` must be a stable technique/runtime identity, while `binding` is an
immutable value that describes how to address that resource. Implementations need not allocate either value per glyph.

```ts
interface RasterGlyphSelection<Binding> {
  readonly resource: RasterResourceId;
  readonly pipelineVariant: number;
  readonly binding: Binding;
}

interface PreparedGlyphBatch<Technique extends AnyRasterTechnique> {
  readonly key: GlyphBatchKey;
  readonly font: LoadedFont<Technique>;
  readonly binding: RasterBindingOf<Technique>;
  readonly storage: GlyphBatchStorageOf<Technique>;
  readonly dirtyRanges: readonly GlyphRange[];
}

interface GlyphBatchKey {
  readonly technique: RasterTechniqueId;
  readonly resource: RasterResourceId;
  readonly pipelineVariant: number;
  readonly generation: number;
  readonly chunk: number;
}
```

`binding` is renderer-neutral, typed selection data. Bitmap can identify one strike and page; MTSDF can identify an atlas
view; Slug can identify one curve/header/reference page set. The target receives the answer instead of inspecting glyph IDs
or font records to derive it again.

`GlyphBatchKey.pipelineVariant` is a technique-authored physical-storage/resource constraint—for example a record format
that requires another vertex layout. It is not the generic paragraph/span `renderVariant` and is not an application effect
key. A raster program combines this technique value with its own variant compatibility key when compiling final draws.

The technique also defines the canonical structure-of-arrays storage and writes it during core synchronization. Each glyph
input carries its paragraph-local displayed origin after any caller override, while the write request carries the exact
immutable binding that core already used to form the physical batch. This is where origin, size, glyph-record index, page
index, paint index, or other technique values become renderer-ready CPU fields without repeating layout or resource
selection.

## Realize resources in an engine target

The target turns portable font data and bindings into resources usable by one renderer:

```ts
class ThreeMtsdfTarget implements ParagraphBatchTarget<typeof mtsdf, ThreeMtsdfVariant, ThreeMtsdfRevision> {
  readonly technique = mtsdf;

  stage(previous, next) {
    for (const batch of next.glyphBatches) {
      const resources = this.resources.getOrCreate(batch.font, batch.binding, () => ({
        atlas: createThreeDataArrayTexture(batch.font.data, batch.binding),
        material: createThreeMtsdfTslMaterial(batch.binding),
      }));

      copySelectedRangesToThreeAttributes(batch.storage, resources, previous, next);
    }

    return stageThreeDraws(program.compileRuns(next.glyphRuns, next.glyphBatches));
  }
}
```

That target owns Three textures, attributes, TSL materials, internal draw objects, render-list placement, and GPU-safe
retirement. A Wayfare target owns Wayfare entities/passes instead. Neither owns artifact decoding, font fallback, shaping,
glyph-resource selection, physical glyph storage partitioning, or source order. Each target does own the final compatible
draw plan for its program.

GPU resources should normally be cached by the engine integration using loaded-font identity plus the technique binding.
Several paragraph batches can then share one atlas or curve buffer while retaining separate instance buffers and draw
plans. During synchronous `stage()`, a target copies every CPU page/table value it needs into independently owned engine
resources. Disposing a batch attachment releases its batch resources; disposing the last engine cache entry releases shared
font GPU resources. Core font leases belong to live paragraphs only. A target does not retain `font.data` after `stage()`
returns, so it neither needs nor receives a hidden target lease.

## Reuse the technique shader without surrendering the program

Shader authoring is not inherently engine-neutral. It is backend-neutral only when the consuming engines agree on the
shader compiler, binding schema, resource handles, vertex/instance layout, and render-pass handoff.

```ts
interface RasterStage<Input, Output, Evaluate> {
  readonly input: Input;
  readonly output: Output;
  readonly evaluate: Evaluate;
}

interface RasterShader<Technique extends AnyRasterTechnique, Vertex, Fragment, Resources> {
  readonly technique: Technique;
  readonly vertex: Vertex;
  readonly fragment: Fragment;
  readonly resources: Resources;
}

interface RasterProgram<Technique extends AnyRasterTechnique, Variant, Shader, Device, Resources, Pipeline, Draw> {
  readonly technique: Technique;
  readonly shader: Shader;

  createResources(device: Device, font: LoadedFont<Technique>, binding: RasterBindingOf<Technique>): Resources;
  createPipeline(device: Device, pipelineVariant: number): Pipeline;
  compileRuns(
    runs: readonly PreparedGlyphRun<Variant>[],
    batches: readonly PreparedGlyphBatch<Technique>[],
  ): readonly Draw[];
  disposeResources(resources: Resources): void;
  disposePipeline(pipeline: Pipeline): void;
}
```

`RasterShader` is a backend implementation of the complete hard technique algorithm: vertex expansion and pixel snapping,
resource access, Bitmap sampling, MTSDF distance and coverage reconstruction, or Slug dilation, curve traversal, and
coverage. Each concrete stage retains its backend-authored input/output/function types; the contract never replaces its
arguments or result with `any`. The resource schema names the semantic pages, tables, buffers, sampling rules, and
coordinate spaces those stages consume. A shader returns resolved vertex outputs and fragment values such as linear
premultiplied color, opacity, and coverage. It does not own a material, pipeline, pass, variant, or draw.

`RasterProgram` composes that canonical shader with resources, application variants, pipeline/material state, and a draw
compiler. A custom gradient program normally calls `shader.fragment.evaluate(context)` and modifies the resolved output. Replacing
the complete technique shader is a low-level escape hatch, not the expected customization path; users should never need to
reimplement Slug merely to change final color.

These are optional adapter-level seams declared by integration or shader packages, not core exports or requirements. A shared TypeGPU MTSDF program can create typed bind-group
layouts, GPU resources, and pipelines once for any host that exposes a compatible WebGPU device and lets the adapter encode
those pipelines in its render pass. TypeGPU can also unwrap pipelines and bindings to raw WebGPU handles, so the host does
not have to use TypeGPU for the rest of its renderer.

```ts
const program = createTypeGpuMtsdfProgram(root);

createWayfareTextTarget({ engine, program });
createAnotherWebGpuTextTarget({ renderer, program });
```

This does not make the two engine targets identical. They still differ in lifecycle hooks, transforms, visibility,
culling, pass ordering, command ownership, and retirement. If an engine does not expose compatible WebGPU device/pass
interop, the TypeGPU program cannot be inserted merely because the engine itself runs on WebGPU.

The exact TypeGPU shader, program, variant codec, direct engine, pass-encoding, and ownership declarations live in the
[TypeGPU raster programs and text engine](typegpu-api.md) specification.

TSL is a Three.js node-graph API and produces Three materials, so a completed TSL program remains Three-only.
`@typegpu/three@0.11.0` can inject a resolved zero-argument TypeGPU WGSL closure through Three's WebGPU node builder, while
`fromTSL()` exposes supported Three-owned data nodes inside that closure. Inspection of that release found no forced-WebGL2
path and no demonstrated sampleable-resource bridge for dependent Slug loads; it is not a general TypeGPU-to-native-TSL
translation:

```ts
const coverageNode = t3.toTSL(() => {
  'use gpu';
  return mtsdfCoverage(readMtsdfContextFromTsl());
});
createThreeMtsdfTarget({ renderer, program: createThreeMtsdfTslProgram({ coverageNode }) });
```

The sample can admit limited pure-WebGPU math inside an optional Three program. It does not establish a complete second
Bitmap/MTSDF/Slug implementation. If a future exact-version gate proves the full resource and stage contract, TypeGPU could
become authoritative for that supported path while the Three adapter still owns material construction, accessors,
blending, depth, pipeline state, and lifecycle.

The bridge is currently WebGPU-only according to the official `@typegpu/three` documentation. It cannot replace the native
TSL path while the Three integration promises WebGL2. The TypeGPU-authored path remains an experiment until the
implementation proof:

- compiles against the repository-pinned Three.js version and the selected `@typegpu/three` version;
- proves the real texture/resource ABI, dependent Slug loads, vertex-stage Bitmap snapping and Slug dilation, and returned
  value shapes rather than only a constant-color fragment;
- either supplies the required forced-WebGL2 path or remains an explicitly WebGPU-only optional package;
- inspects the emitted WebGPU shader and proves Bitmap and Slug output parity against the native TSL path;
- measures tree-shaken raw, gzip, and Brotli transfer cost plus graph construction and shader compilation cost;
- distinguishes `typegpu`, `@typegpu/three`, transform metadata, and optional build-plugin cost;
- keeps the dependency in an optional shader/integration subpath so the default Three path and portable technique
  do not pay for it.

The npm package's unpacked size is not application bundle evidence. If the proof makes TypeGPU the authoritative source,
the measured generated program—not package metadata—owns the cost decision.

## Package the boundaries independently

The dependency direction is one-way:

```ts
RasterBaker
  -> RasterTechnique
     -> TypeGpuShaderLogic?
        -> TypeGpuRasterProgram       -> EngineTarget
        -> @typegpu/three toTSL       -> ThreeTslRasterProgram -> ThreeTarget
     -> NativeThreeTslRasterProgram?  -> ThreeTarget
```

Do not publish one monolithic “raster plugin” that imports an engine at its portable entry point. A technique package may
offer several subpaths, but importing its baker or portable runtime must not load Three.js, TypeGPU, Wayfare, or another
engine.

The implementation proof must demonstrate:

```ts
expect(mtsdfBaker).not.toImportAnyRenderer();
expect(mtsdfTechnique).not.toImportAnyRenderer();

expect(threeMtsdfTarget.technique).toBe(mtsdfTechnique);
expect(typeGpuMtsdfProgram.technique).toBe(mtsdfTechnique);
expect(typeGpuThreeMtsdfProgram.technique).toBe(mtsdfTechnique);

expect(threeRevision.glyphRuns).toEqual(typeGpuRevision.glyphRuns);
expect(threeRevision.storageBytes).toEqual(typeGpuRevision.storageBytes);
expect(await render(typeGpuThreeMtsdfProgram)).toMatchRaster(await render(nativeThreeMtsdfProgram));
```

Visual equivalence remains a renderer proof. Shared artifacts and CPU bytes prove that an engine adapter is consuming the
same technique contract; they do not by themselves prove shader output, blending, color space, transforms, or ordering.
