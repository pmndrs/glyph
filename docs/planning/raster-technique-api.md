---
type: API Specification
title: Raster technique and engine resource API
description: Canonical boundary between portable raster baking and decoding, core glyph packing, reusable shader backends, and engine-specific GPU targets.
documentation_type: reference
tags: [api, raster, baking, resources, shaders, engines, typegpu, tsl]
status: stable
sources:
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: current-raster
    resource: ../../packages/text/src/raster.ts
    title: Current combined raster module
  - id: current-bake
    resource: ../../packages/text/src/bake.ts
    title: Current portable raster baker contract
  - id: current-mtsdf
    resource: ../../packages/text/src/raster/msdf.ts
    title: Current MTSDF decoder and Three.js target
  - id: external-proof
    resource: ../../packages/glyph-example-raster/src/raster.ts
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
  at: '2026-08-06T22:55:24Z'
---

# Raster technique and engine resource API

One raster should not be one engine plugin. The stable split is:

```ts
source font
  -> RasterBaker                         // portable, build time or Worker
  -> raster artifact + page artifacts    // portable bytes
  -> RasterTechnique.decode()            // portable validated CPU data
  -> TextRuntime.update*()                // portable partitioned instance storage
  -> RasterProgram                        // optional shader-backend reuse seam
  -> ParagraphBatchTarget                 // engine lifecycle, GPU resources, draws
```

Bitmap, MTSDF, and Slug each need one baker and one portable technique implementation. They do not need to duplicate
baking, artifact validation, external-page fetching, fallback resolution, glyph partitioning, or canonical CPU instance
packing for every engine.

Every engine still needs a target. Technique-specific GPU realization and shader code can be shared when several engines
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
required embedded or authenticated external resource, and called the technique decoder. No GPU resource exists yet.

```ts
interface RegisteredRaster<Kind extends string> {
  readonly rasterKey: RasterKey;
  readonly kind: Kind;
  readonly extensionData: JsonValue;

  view(bufferView: number): Uint8Array;
  resource(source: RasterResourceSource, signal?: AbortSignal): Promise<Uint8Array>;
}
```

Raster authors use `view()` for embedded bytes and `resource()` for either embedded or SHA-256-authenticated external page
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
  Storage extends GlyphBatchStorage,
> extends AnyRasterTechnique {
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap<Options, Descriptor, Data, Binding, Storage>;

  readonly id: Id;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly runtimeBaker?: RuntimeRasterBakerLoader<Kind, Options>;

  descriptor(options: RasterOptionsArgument<Options>): Descriptor;
  decode(font: RegisteredFont, raster: RegisteredRaster<Kind>, signal?: AbortSignal): Promise<Data>;

  select(input: RasterGlyphInput<Data>): RasterGlyphSelection<Binding>;
  createStorage(capacity: number): Storage;
  writeStorage(storage: Storage, range: GlyphRange, input: RasterGlyphWriteInput<Data>): void;
  validatePaint?(paint: GlyphPaint): void;
  dispose(data: Data): void;
}

interface RasterGlyphInput<Data> {
  readonly data: Data;
  readonly glyphId: number;
  readonly fontSize: number;
  readonly rasterPixelRatio: number;
  readonly paint: ResolvedPaint;
}

interface RasterGlyphWriteInput<Data> {
  readonly data: Data;
  readonly glyphs: readonly RasterGlyphInput<Data>[];
}

type GlyphBatchStorage = Readonly<Record<string, ArrayBufferView>>;

declare const rasterTechniqueTypes: unique symbol;

interface RasterTechniqueTypeMap<
  Options = unknown,
  Descriptor extends JsonValue = JsonValue,
  Data = unknown,
  Binding = unknown,
  Storage extends GlyphBatchStorage = GlyphBatchStorage,
> {
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
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap;
}

type RasterTechniqueTypesOf<Technique extends AnyRasterTechnique> = NonNullable<Technique[typeof rasterTechniqueTypes]>;
type RasterDataOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['data'];
type RasterBindingOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['binding'];
type GlyphBatchStorageOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['storage'];

declare function defineRasterTechnique<
  const Id extends RasterTechniqueId,
  const Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
  Binding,
  Storage extends GlyphBatchStorage,
>(
  technique: RasterTechnique<Id, Kind, Options, Descriptor, Data, Binding, Storage>,
): RasterTechnique<Id, Kind, Options, Descriptor, Data, Binding, Storage>;
```

`AnyRasterTechnique` contains only the common identity shape. It does not instantiate the generic technique with `any`, and
it cannot be used to perform typed decode, selection, or storage writes. Its associated types intentionally widen to
`unknown` / `GlyphBatchStorage` at a heterogeneous boundary. Concrete values retain their complete relationships:

```ts
const mtsdf = defineRasterTechnique({
  id: MTSDF_TECHNIQUE_ID,
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

type Data = RasterDataOf<typeof mtsdf>; // MtsdfData
type Binding = RasterBindingOf<typeof mtsdf>; // MtsdfBinding
type Storage = GlyphBatchStorageOf<typeof mtsdf>; // MtsdfGlyphBatchStorage
```

The helper's generic parameters are inference variables in its declaration; raster authors do not supply them. An unresolved
associated type remains `unknown`, which blocks technique-specific use until the author supplies enough type information. It
never silently degrades to `any`.

`select()` returns the physical resource and pipeline division for one resolved glyph. Core uses it while building stable
glyph batches; a target never repeats this selection. `resource` must be a stable technique/runtime identity, while
`binding` is an immutable value that describes how to address that resource. Implementations need not allocate either value
per glyph.

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
  readonly chunk: number;
}
```

`binding` is renderer-neutral, typed selection data. Bitmap can identify one strike and page; MTSDF can identify an atlas
view; Slug can identify one curve/header/reference page set. The target receives the answer instead of inspecting glyph IDs
or font records to derive it again.

The technique also defines the canonical structure-of-arrays storage and writes it during core synchronization. This is
where origin, size, glyph-record index, page index, paint index, or other technique values become renderer-ready CPU fields.

## Realize resources in an engine target

The target turns portable font data and bindings into resources usable by one renderer:

```ts
class ThreeMtsdfTarget implements ParagraphBatchTarget<typeof mtsdf, ThreeMtsdfRevision> {
  readonly technique = mtsdf;

  stage(previous, next) {
    for (const batch of next.glyphBatches) {
      const resources = this.resources.getOrCreate(batch.font, batch.binding, () => ({
        atlas: createThreeDataArrayTexture(batch.font.data, batch.binding),
        material: createThreeMtsdfTslMaterial(batch.binding),
      }));

      copySelectedRangesToThreeAttributes(batch.storage, resources, previous, next);
    }

    return stageThreeSubmissions(next.submissions);
  }
}
```

That target owns Three textures, attributes, TSL materials, internal draw objects, render-list placement, and GPU-safe
retirement. A Wayfare target owns Wayfare entities/passes instead. Neither owns artifact decoding, font fallback, shaping,
glyph-resource selection, batching, or submission order.

GPU resources should normally be cached by the engine integration using loaded-font identity plus the technique binding.
Several paragraph batches can then share one atlas or curve buffer while retaining separate instance buffers and draw
plans. Disposing a batch attachment releases its batch resources; disposing the last engine lease releases shared font GPU
resources; disposing `LoadedFont` releases the portable CPU data only after its text and target leases are gone.

## Share shader programs where the backend permits it

Shader authoring is not inherently engine-neutral. It is backend-neutral only when the consuming engines agree on the
shader compiler, binding schema, resource handles, vertex/instance layout, and render-pass handoff.

```ts
interface RasterProgram<Technique extends AnyRasterTechnique, Device, Resources, Pipeline> {
  readonly technique: Technique;

  createResources(device: Device, font: LoadedFont<Technique>, binding: RasterBindingOf<Technique>): Resources;
  createPipeline(device: Device, pipelineVariant: number): Pipeline;
  disposeResources(resources: Resources): void;
  disposePipeline(pipeline: Pipeline): void;
}
```

This is an optional adapter-level seam, not a core requirement. A shared TypeGPU MTSDF program can create typed bind-group
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

TSL is a Three.js node-graph API and produces Three materials, so a completed TSL program remains Three-only. Its raster
shader logic does not have to be authored independently, however. `@typegpu/three` can translate a TypeGPU function into a
TSL node with `toTSL()`, while `fromTSL()` lets that function consume Three-owned nodes such as UVs, instance attributes, or
resource accessors:

```ts
const coverageNode = t3.toTSL(mtsdfCoverage);
createThreeMtsdfTarget({ renderer, program: createThreeMtsdfTslProgram({ coverageNode }) });
```

This admits two Three program implementations behind the same target contract: a native TSL implementation, and an optional
TypeGPU-authored implementation adapted through `toTSL()`. In the latter, TypeGPU can become the authoritative source for
shared raster evaluation while the Three adapter still owns material construction, renderer accessors, blending, depth,
pipeline state, and lifecycle. `toTSL()` is an authoring bridge; it does not move Three scene or render-pass ownership into
the portable technique.

The TypeGPU-authored path remains an experiment until the implementation proof:

- compiles against the repository-pinned Three.js version and the selected `@typegpu/three` version;
- inspects the emitted WebGPU shader and proves Bitmap and Slug output parity against the native TSL path;
- measures tree-shaken raw, gzip, and Brotli transfer cost plus graph construction and shader compilation cost;
- distinguishes `typegpu`, `@typegpu/three`, transform metadata, and optional build-plugin cost;
- keeps the dependency behind an explicit Three export subpath so the default Three path and portable technique do not pay
  for it.

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

expect(threeRevision.submissions).toEqual(typeGpuRevision.submissions);
expect(threeRevision.storageBytes).toEqual(typeGpuRevision.storageBytes);
expect(await render(typeGpuThreeMtsdfProgram)).toMatchRaster(await render(nativeThreeMtsdfProgram));
```

Visual equivalence remains a renderer proof. Shared artifacts and CPU bytes prove that an engine adapter is consuming the
same technique contract; they do not by themselves prove shader output, blending, color space, transforms, or ordering.
