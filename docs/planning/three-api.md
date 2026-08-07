---
type: API Specification
title: Three.js text API
description: Target v1 API for an external Three.js integration package that loads fonts, declares scene-local text batches, retains transform-bearing Text objects, and synchronizes hidden core work inside the Three.js render lifecycle.
documentation_type: reference
tags: [api, threejs, fonts, text, batching, lifecycle, rendering]
status: stable
sources:
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: effect-composition
    resource: text-effect-composition.md
    title: Optional Three.js effect composition
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
  - id: current-loader
    resource: ../../packages/text/src/loader.ts
    title: Current font loader
  - id: current-text
    resource: ../../packages/text/src/text.ts
    title: Current Three.js Text lifecycle
  - id: three-object3d
    resource: https://threejs.org/docs/pages/Object3D.html
    title: Three.js Object3D
  - id: three-loader
    resource: https://threejs.org/docs/pages/Loader.html
    title: Three.js Loader
  - id: three-group
    resource: https://threejs.org/docs/pages/Group.html
    title: Three.js Group
  - id: three-buffer-attribute
    resource: https://threejs.org/docs/pages/BufferAttribute.html
    title: Three.js BufferAttribute
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-07T02:38:24Z'
---

# Three.js text API

`@pmndrs/text-three` is an engine integration over public `@pmndrs/text` contracts. It may be maintained in this monorepo or
an external repository; core never imports Three.js, and consumers do not need an `@pmndrs/text/three` subpath.

Three.js owns the core API internally. A Three.js application never creates a `TextRuntime`,
`ParagraphBatch`, `Paragraph`, prepared revision, or glyph run.

```ts
FontLoader
  -> LoadedFont[]
  -> TextGroup                       // explicit batch for one scene render phase
  -> Text[]                          // transform-bearing Three.js objects
  -> renderer.render(scene, camera)  // membership, shaping, packing, and uploads synchronize here
```

## The complete public surface

```ts
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type {
  FontSelection,
  FormattedText,
  GlyphBatchKey,
  GlyphRange,
  ParagraphBatchTargetError,
  PreparedGlyphBatch,
  PreparedGlyphRun,
  RasterBindingOf,
  TextInput,
  TextPreparationError,
} from '@pmndrs/text';

type TextError = TextPreparationError | ParagraphBatchTargetError;

interface ThreeRenderVariant {
  readonly effects?: readonly ThreeTextEffectBinding[];
}

interface ThreeTextEffectDefinition<Parameters, ParameterSchema, Context, Output> {
  readonly parameters: ParameterSchema;
  compose(base: Output, parameters: Parameters, context: Context): Output;
  bind(parameters: Parameters): ThreeTextEffectBinding<Parameters>;
}

interface ThreeTextEffectBinding<Parameters = unknown> {
  readonly effect: ThreeTextEffectDefinition<Parameters, unknown, unknown, unknown>;
  readonly parameters: Parameters;
}

declare function defineTextEffect<Parameters, ParameterSchema, Context, Output>(
  definition: Omit<ThreeTextEffectDefinition<Parameters, ParameterSchema, Context, Output>, 'bind'>,
): ThreeTextEffectDefinition<Parameters, ParameterSchema, Context, Output>;

type ThreeProgramVariantKey = PropertyKey | object;

interface ThreeRasterShader<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  vertex(context: ThreeRasterVertexContextOf<Technique>): ThreeRasterVertexOutput;
  fragment(context: ThreeRasterFragmentContextOf<Technique>): ThreeRasterFragmentOutput;
}

interface ThreeRasterVertexContextOf<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly localPosition: ReturnType<typeof TSL.vec2>;
  readonly glyphIndex: ReturnType<typeof TSL.uint>;
  readonly viewport: ReturnType<typeof TSL.vec2>;
}

interface ThreeRasterVertexOutput {
  readonly position: ReturnType<typeof TSL.vec4>;
  readonly techniqueVaryings: Readonly<Record<string, THREE.Node>>;
}

interface ThreeRasterFragmentOutput {
  readonly color: ReturnType<typeof TSL.vec4>;
  readonly coverage: ReturnType<typeof TSL.float>;
}

interface ThreeRasterFragmentContextOf<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly localPosition: ReturnType<typeof TSL.vec2>;
  readonly glyphIndex: ReturnType<typeof TSL.uint>;
  readonly paintIndex: ReturnType<typeof TSL.uint>;
}

interface ThreeProgramMaterialContext<Technique extends AnyRasterTechnique> {
  readonly renderer: THREE.WebGPURenderer;
  readonly shader: ThreeRasterShader<Technique>;
  readonly font: LoadedFont<Technique>;
  readonly binding: RasterBindingOf<Technique>;
  readonly pipelineVariant: number;
}

interface ThreeProgramVariantWriteContext<Variant> {
  readonly runs: readonly PreparedGlyphRun<Variant>[];
  readonly ranges: readonly GlyphRange[];
}

interface ThreeProgramRunContext<Technique extends AnyRasterTechnique, Variant> {
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];
  readonly glyphRuns: readonly PreparedGlyphRun<Variant>[];
}

interface ThreeProgramDraw {
  readonly object: THREE.Object3D;
  readonly batch: GlyphBatchKey;
  readonly start: number;
  readonly count: number;
}

interface ThreeRasterProgram<Technique extends AnyRasterTechnique, Variant> {
  readonly technique: Technique;
  readonly shader: ThreeRasterShader<Technique>;
  supportsVariant(value: unknown): value is Variant;
  variantKey(value: Variant | undefined): ThreeProgramVariantKey;
  createMaterial(context: ThreeProgramMaterialContext<Technique>): THREE.NodeMaterial;
  writeVariants(context: ThreeProgramVariantWriteContext<Variant>): void;
  compileRuns(context: ThreeProgramRunContext<Technique, Variant>): readonly ThreeProgramDraw[];
  dispose(): void;
}

declare function defineThreeRasterProgram<Technique extends AnyRasterTechnique, Variant>(
  program: ThreeRasterProgram<Technique, Variant>,
): ThreeRasterProgram<Technique, Variant>;

interface FontLoaderOptions {
  readonly runtimeBake?: RuntimeFontBake;
  readonly createWorker?: () => TextPreparationWorker;
}

declare class FontLoader extends THREE.Loader<LoadedFont<AnyRasterTechnique>, LoadedFontRequest<AnyRasterTechnique>> {
  constructor(manager?: THREE.LoadingManager, options?: FontLoaderOptions);

  load<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    onLoad: (font: LoadedFont<Technique>) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void;

  loadAsync<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<LoadedFont<Technique>>;

  dispose(): void;
}

declare class TextGroup<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> extends THREE.Object3D {
  constructor(options: TextGroupOptions<Technique, Variant>);

  readonly technique: Technique;
  readonly capacity: GlyphBufferCapacity;
  readonly program: ThreeRasterProgram<Technique, Variant>;
  readonly textCount: number;
  readonly disposed: boolean;
  readonly error: TextError | undefined;
  onError: ((error: TextError) => void) | undefined;
  renderVariant: Variant | undefined;

  add<const Children extends readonly THREE.Object3D[]>(
    ...children: CompatibleTextChildren<Technique, Variant, Children>
  ): this;
  setCapacity(capacity: GlyphBufferCapacity): void;
  retry(): void;
  clone(recursive?: boolean): never;
  copy(source: THREE.Object3D, recursive?: boolean): never;
  dispose(): void;
}

declare class Text<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> extends THREE.Object3D {
  constructor(properties: StandaloneTextProperties<Technique, Variant>);

  readonly textGroup: TextGroup<Technique, Variant> | undefined;
  readonly bound: boolean;
  readonly disposed: boolean;
  readonly layout: ParagraphLayout | undefined;
  readonly error: TextError | undefined;
  onError: ((error: TextError) => void) | undefined;

  font: FontSelection<Technique>;
  get text(): string;
  set text(value: TextInput<Technique>);
  spans: readonly TextSpan<Technique, Variant>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  rasterPixelRatio: number;
  renderVariant: Variant | undefined;

  set(properties: TextUpdate<Technique, Variant>): void;
  setSpan(index: number, span: TextSpan<Technique, Variant>): void;
  removeSpan(index: number): void;

  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;

  setCapacity(capacity: GlyphBufferCapacity): void;
  retry(): void;
  dispose(): void;
}

type SameType<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;

type CompatibleTextChildren<
  Technique extends AnyRasterTechnique,
  Variant,
  Children extends readonly THREE.Object3D[],
> = {
  readonly [Index in keyof Children]: Children[Index] extends Text<infer ChildTechnique, infer ChildVariant>
    ? SameType<ChildTechnique, Technique> extends true
      ? SameType<ChildVariant, Variant> extends true
        ? Children[Index]
        : never
      : never
    : Children[Index];
};

export { txt, span } from '@pmndrs/text';
export { defineTextEffect, defineThreeRasterProgram };
export type {
  FormattedText,
  GlyphBufferCapacity,
  SpanFormat,
  SpanStyle,
  SpanTag,
  TextPreparationError,
  UnboundSpanTag,
} from '@pmndrs/text';
export type { ThreeRasterProgram, ThreeRasterShader, ThreeRenderVariant, ThreeTextEffectBinding };
```

First-party programs keep bounded material/pipeline and materialized-variant caches. Factory options declare the limits,
eviction retires resources through renderer-safe disposal, and `program.dispose()` releases every remaining entry. A fresh
object-valued variant each frame therefore cannot grow the cache without bound. Custom programs own and document the same
policy.

## Load fonts with the Three.js loader

```ts
import { createFontStack } from '@pmndrs/text';
import { FontLoader } from '@pmndrs/text-three';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const loader = new FontLoader();

const [inter, noto, iconFont] = await Promise.all([
  loader.loadAsync({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: mtsdf },
  }),
  loader.loadAsync({
    input: { baked: '/fonts/NotoSans.font.glb' },
    raster: { technique: mtsdf },
  }),
  loader.loadAsync({
    input: { baked: '/fonts/Icons.font.glb' },
    raster: { technique: mtsdf },
  }),
]);

const uiFont = createFontStack(inter, noto);
```

The first load in a Three font-cache domain lazily creates the single core text runtime and shaping engine. Concurrent loads
share that initialization Promise, and later loaders in the same domain reuse the resolved runtime and shaper. The cache
domain is integration-owned; Three users do not construct a core registry or runtime. `loadAsync()` does not resolve until
the font, selected technique data, and synchronous shaper are ready. Loading remains an explicit application wait; shaping
ordinary warm edits does not become a readiness Promise.

The callback `load()` and Promise-returning `loadAsync()` follow the standard Three.js loader pattern and participate in the
provided `LoadingManager`. The loaded font is a Three-surface handle; it does not expose the hidden core runtime or core font
handle.

Constructing a `Text` acquires a lease on every concrete font in its `Font` or `FontStack`, even while the object is
detached. Changing `text.font` acquires the complete replacement selection before releasing the old leases.
`LoadedFont.dispose()` fails while a live `Text` lease remains, so disposing a group or moving text can never silently drop
fallback data or replace a glyph with missing-glyph output. A `FontStack` value alone owns no lease; using a stack with a
successfully disposed member for a new `Text` is rejected.

## Create an explicit batch with `TextGroup`

```ts
import { TextGroup } from '@pmndrs/text-three';

const worldText = new TextGroup({
  technique: mtsdf,
});

scene.add(worldText);
```

```ts
interface TextGroupOptions<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> {
  readonly technique: Technique;
  readonly program?: ThreeRasterProgram<Technique, Variant>;
  readonly capacity?: GlyphBufferCapacity;
  readonly renderOrder?: number;
  readonly renderVariant?: Variant;
}

interface GlyphBufferCapacity {
  readonly size: number;
  readonly policy: 'grow' | 'chunk' | 'fixed';
}
```

## Select a program and render variant

`technique` remains construction-only because it fixes decoded resources and canonical glyph-buffer layout. `program` is
also construction-only because it fixes the accepted variant type, technique shader, Three attributes, node material,
pipeline compatibility, and final draw compiler. Fonts remain per `Text` and are never declared on the group.

```ts
const gradientSlug = createThreeSlugProgram({
  fragment({ shader, context }) {
    const base = shader.fragment(context);
    return { ...base, color: gradient(base.color, context.localPosition) };
  },
});

const labels = new TextGroup({
  technique: slug,
  program: gradientSlug,
  renderVariant: { gradient: 'ui-default' },
});

const label = new Text({
  font: uiFont,
  text: 'Warning',
  renderVariant: { gradient: 'warning' },
});
labels.add(label);
```

The first-party default program is selected when `program` is omitted. A group, text, and manual span may each set a
variant; inheritance is group → text → span. The hidden core batch carries those exact values through ordered glyph runs.
The Three program decides whether adjacent variants use one material/draw with indexed sidecar parameters or require
separate draw proxies. A variant is not automatically a material and is not automatically a draw boundary.

The standard programs accept `ThreeRenderVariant`, whose optional `effects` list is produced by the effect helpers:

```ts
const chromatic = defineTextEffect({
  parameters: { phase: 'f32' },
  compose(base, parameters, context) {
    return { ...base, color: chromaticColor(base.color, context.paintIndex, parameters.phase) };
  },
});

const animated = chromatic.bind({ phase: phaseUniform });
const effectLabels = new TextGroup({ technique: slug }); // standard ThreeRenderVariant program
const effectLabel = new Text({
  font: uiFont,
  text: 'Warning',
  renderVariant: { effects: [animated] },
});
effectLabels.add(effectLabel);

effectLabel.setSpan(0, {
  start: 0,
  end: 7,
  renderVariant: { effects: [animated] },
});
```

Effects compose after the canonical Bitmap, MTSDF, or Slug shader has resolved coverage and base output. Definitions with
the same ordered graph identity share a material program; binding values are stored per text/span and do not create a new
pipeline. This is an optional TSL authoring convenience, not a core API and not a requirement for custom programs. A custom
program may define a completely different `Variant` type while still reusing the exported canonical technique shader.

React Three Fiber expresses the same span variant through nested text:

```tsx
<Text font={uiFont}>
  Normal <Text renderVariant={{ effects: [animated] }}>animated</Text>
</Text>
```

A TypeGPU-authored first-party shader may enter the same program through `@typegpu/three` `toTSL()`. Three still owns its
accessors, material, blend/depth state, render-list integration, draw compilation, and lifecycle. Native TSL and adapted
TypeGPU shaders are alternative program implementations, not different core techniques.

### Use the default or preallocate explicitly

An explicit `TextGroup` defaults to `{ size: 4_096, policy: 'chunk' }`. Storage is allocated lazily for each physical
font-resource buffer, so an empty group allocates no glyph arrays or GPU buffer. Text objects and their metadata are not
capacity-limited.

```ts
const denseText = new TextGroup({
  technique: mtsdf,
  capacity: { size: 20_000, policy: 'chunk' },
});
```

`size` counts glyph-instance slots per physical buffer, not texts and not total glyphs across the `TextGroup`. `chunk`
allocates another buffer without replacing published storage, `grow` transactionally replaces the full buffer with a
buffer whose capacity doubles until the pending glyphs fit, and `fixed` makes `size` a hard per-buffer limit. The readonly
`capacity` property exposes the normalized explicit or default value.

`add()` validates text lifetime, font lifetime, and technique compatibility. It does not shape, so it cannot know whether a
fixed physical buffer will overflow. That check occurs during the owning group's pre-render synchronization, after fallback,
shaping, and layout reveal exact per-resource glyph counts.

Resize explicitly when a fixed group needs a larger allocation:

```ts
const overflow = labels.error;
if (overflow?.kind !== 'capacity-exceeded') throw new Error('No fixed-capacity overflow to resize');

labels.setCapacity({ size: overflow.required, policy: 'fixed' });
```

`setCapacity()` preserves the public `TextGroup`, every nested `Text`, and every bound core `Paragraph`. It forwards the
normalized capacity to the existing hidden `ParagraphBatch`, clears an unchanged capacity-overflow latch, and schedules a
transactional canonical-storage and target-storage replacement for the next synchronization. The previous complete draw
objects remain live until the replacement commits; renderer fences then retire them normally. No scene reparenting,
listener transfer, ref replacement, or cleanup is required.

`fixed` prevents automatic growth; it does not make the configured size permanently immutable. `setCapacity()` may also
switch policies or shrink deliberately. Passing the current normalized capacity is a no-op. A shrink that cannot hold the
desired generation reports the ordinary typed overflow while preserving the prior complete draw.

`TextGroup.clone()` and `TextGroup.copy()` are unsupported and throw. A group owns identity-bearing text membership,
subscriptions, attachment state, and renderer resources that cannot follow ordinary recursive `Object3D` copy semantics
safely. Construct a separate group and add intentionally distinct `Text` objects when a second independently renderable
tree is required.

A `TextGroup` is one author-declared text render phase and one hidden core paragraph batch. Its technique fixes the
canonical instance layout and shader family before any text is attached. Every `Text` owns its font selection, which must
use that technique. Core may produce several physical resource batches and ordered variant-bearing glyph runs beneath one
`TextGroup`; the selected program compiles those runs into Three draw objects.

The `add()` override preserves normal `Object3D` children while conditionally rejecting any directly supplied
`Text<OtherTechnique>` tuple member. Runtime ancestry validation remains mandatory for JavaScript, React reconciliation,
and text nested below arbitrary containers.

`TextGroup` deliberately extends `THREE.Object3D`, not `THREE.Group`. Three carries the nearest real ancestor Group's
`renderOrder` through non-Group descendants as `groupOrder`; another Group would replace it, including with its default
value of `0`. The integration does not insert a hidden Group.

`TextGroup.renderOrder` is the secondary render-order base for the batch. The integration maps the program's ordered
physical draws to consecutive native Three render orders beginning at that base. `Text.renderOrder` remains the paragraph
sorting value inside core; it cannot create a Three render-list boundary inside one GPU batch.

```ts
parent.renderOrder = 100;
parent.add(textGroup); // physical draws use groupOrder 100

textGroup.renderOrder = 10; // physical draws begin at secondary order 10
```

A nested `TextGroup` starts a new batch and render-order domain; it never joins its nearest outer `TextGroup`.

Create separate `TextGroup` instances when text belongs to different scenes, render phases, or renderer lifetimes:

```ts
const mainSceneText = new TextGroup(worldOptions);
const minimapSceneText = new TextGroup(minimapOptions);

mainScene.add(mainSceneText);
minimapScene.add(minimapSceneText);
```

One Three object can have only one parent, so one `TextGroup` cannot be present in two scenes simultaneously. The group binds
to the first renderer that draws it. Rendering it through a different renderer fails before drawing; create a separate
`TextGroup` so attributes, materials, upload ranges, fences, and retirement remain renderer-owned. Standalone implicit
batches follow the same rule.

## Add and remove text through the scene graph

```ts
import { Text } from '@pmndrs/text-three';

const label = new Text({
  font: inter,
  text: 'Player 1',
});

worldText.add(label);

label.position.set(0, 2, 0);
label.rotation.y = Math.PI / 4;
label.scale.setScalar(2);
```

There is no `TextGroup.allocate()` shortcut. Construction creates one retained, late-bound `Text`; inherited
`Object3D.add()` and `Object3D.remove()` are the only membership operations. Adding binds the object to the batch before
the next synchronization. Removing releases its internal paragraph membership without disposing the public object, so it
can be added elsewhere.

A `Text` joins its nearest `TextGroup` ancestor. Ordinary `Object3D` containers may appear between them. A nested
`TextGroup` stops membership discovery:

```ts
worldText.add(container);
container.add(label); // label still belongs to worldText

worldText.add(overlayText);
overlayText.add(icon); // icon belongs to overlayText, never worldText
```

## A standalone `Text` is a batch of one

```ts
const title = new Text({
  font: uiFont,
  text: 'Standalone title',
});

scene.add(title);
```

```ts
type StandaloneTextProperties<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> = TextProperties<
  Technique,
  Variant
> &
  Readonly<{
    capacity?: GlyphBufferCapacity;
  }>;
```

When a render-attached `Text` has no `TextGroup` ancestor, it owns an implicit paragraph batch containing only itself. Its
required font selection supplies that implicit batch's technique. Adding that same object to a `TextGroup` retires the
implicit batch, validates its font selection against the explicit group technique, and creates new paragraph membership in
the group.

An unattached or detached `Text` remains unbound and owns no implicit batch. `textGroup.remove(text)` therefore leaves only
the reusable public object and desired state. Adding it directly to a scene later creates its implicit batch before that
scene's first shaping and render; adding it to another `TextGroup` creates membership there instead. The public `Text`,
transform, desired properties, and glyph overrides remain the same object throughout.

The standalone `capacity` value configures only that implicit batch and defaults to `{ size: 256, policy: 'grow' }` to
avoid reserving a full explicit-group chunk for every isolated label. While the object is inside a `TextGroup`, the parent
group's technique and capacity policy are authoritative; the `Text` always retains its own font selection.
`text.setCapacity()` changes the retained implicit-batch capacity without replacing the `Text`; while grouped, that setting
is retained but inactive until the text becomes standalone again.

## Bind late; render on the first frame

Constructing an unattached `Text` stores desired state only. It creates no core paragraph, performs no shaping, allocates no
glyph slots, and creates no GPU object.

```ts
const score = new Text({ font: inter, text: '0' });

score.text = '1';
score.text = '2';
score.text = '3';

hudText.add(score);
renderer.render(scene, camera); // shapes and renders only "3"
```

Membership is resolved before the first shaping call. `Object3D` `added`, `removed`, `childadded`, and `childremoved`
events mark scene membership dirty synchronously. Because those events do not bubble through every arbitrary ancestor
change, `Text` and `TextGroup` perform a final ancestry reconciliation at the start of `updateMatrixWorld()`.

The integration uses `updateMatrixWorld()` as its automatic synchronization hook. `TextGroup` owns a private
`ThreeTextBatchBinding`; this is the object that holds the core `ParagraphBatch`, its `ParagraphBatchAttachment`, the
`ThreeParagraphBatchTarget`, the internal draw meshes, and the map from each child `Text` to its core `Paragraph`.
It is implementation machinery, not another public API.

The implementation sequence is:

```ts
class TextGroup<Technique extends AnyRasterTechnique, Variant> extends THREE.Object3D {
  readonly #binding: ThreeTextBatchBinding<Technique, Variant>;

  override updateMatrixWorld(force?: boolean): void {
    this.#binding.reconcileMembership(this);
    this.#binding.applyPendingMembership();

    // Runtime-wide: shape, lay out, sort, partition, allocate, pack, and publish.
    // Returns runtime.current without allocating when no desired state is dirty.
    this.#binding.runtime.update();

    // Commit any target revision staged by the runtime publication. This installs
    // the exact internal meshes needed by the program-compiled draw sequence.
    this.#binding.commitPreparedRevision();

    // Three computes this group, every child Text, and every newly installed mesh.
    super.updateMatrixWorld(force);

    // Core glyph origins are paragraph-local. Compose them with the now-current
    // Text transforms, copy only changed transform slots, and mark those attribute
    // ranges for WebGPURenderer.
    this.#binding.writeGlyphTransforms();
  }
}
```

`applyPendingMembership()` is where scene membership becomes core membership. For each newly bound object it calls
`paragraphBatch.add(text.desiredState)` and records the returned `Paragraph`; for each departure it calls
`paragraph.dispose()`. It applies desired-state setters to already bound paragraphs before `runtime.update()`. No shaping
happens in `Text.text`, `Text.set()`, `Text.setSpan()`, or the scene-graph event handlers.

`runtime.update()` publishes one atomic `TextRuntimeRevision`. Each attached paragraph-batch target receives its changed
`PreparedParagraphBatchRevision` by calling:

```ts
threeTarget.stage(attachment.current, preparedParagraphBatchRevision);
```

`ThreeParagraphBatchTarget.stage()` performs the engine-layout work: it creates or reuses the required Three
`BufferAttribute` storage, selects `PreparedGlyphBatch.dirtyRanges` when its committed target revision is the immediate
predecessor, otherwise selects every live range for that batch from the prepared glyph runs, copies those ranges, sets the
corresponding Three update ranges and `needsUpdate`, and asks the selected `ThreeRasterProgram` to compile ordered
compatible runs into internal meshes or draw proxies. It does not shape, sort paragraph source order, repartition physical
storage, or upload directly to a GPU queue. A ready
stage is still unpublished until `commitPreparedRevision()` calls `attachment.commit()` at this render boundary and swaps
the binding's live internal draw objects.

With Three's default `scene.matrixWorldAutoUpdate = true`, the complete WebGPURenderer 0.185.1 call chain is:

```ts
renderer.render(scene, camera)
  -> Renderer._renderScene(scene, camera)
  -> scene.updateMatrixWorld()
     -> TextGroup.updateMatrixWorld(force)
        -> binding.reconcileMembership(textGroup)
        -> binding.applyPendingMembership()
           -> ParagraphBatch.add(...) / Paragraph.dispose() / Paragraph setters
        -> TextRuntime.update()
           -> publish TextRuntimeRevision
           -> ThreeParagraphBatchTarget.stage(previous, preparedBatch)
        -> binding.commitPreparedRevision()
           -> ParagraphBatchAttachment.commit()
           -> install the staged internal draw meshes
        -> Object3D.updateMatrixWorld(force)
           -> Text.updateMatrixWorld(force)        // transform only when grouped
           -> drawMesh.updateMatrixWorld(force)
        -> binding.writeGlyphTransforms()
           -> BufferAttribute.addUpdateRange(...)
           -> BufferAttribute.needsUpdate = true
  -> Renderer._projectObject(...)                  // build and sort the render list
  -> drawMesh.onBeforeRender(...)
  -> Renderer._renderObjectDirect(...)
  -> Geometries.updateForRender(...)
  -> Attributes.update(...)
  -> WebGPUBackend.updateAttribute(...)            // actual dirty-range GPU write
  -> backend.draw(...)                             // one program-compiled draw
```

Names beginning with `Renderer._` are shown to locate the integration in Three.js 0.185.1's implementation; they are not
APIs the package calls or overrides. The supported hook is the public `Object3D.updateMatrixWorld()` override. The internal
draw meshes use ordinary Three render-list and buffer-update behavior.

If an application sets `scene.matrixWorldAutoUpdate = false`, Three deliberately skips `scene.updateMatrixWorld()` and
therefore skips this automatic text synchronization. That application has opted into manual scene updates and must call
`scene.updateMatrixWorld()` before `renderer.render(scene, camera)`; it does not call a text-specific update method.

Publishing the target revision before `super.updateMatrixWorld()` ensures newly installed meshes receive a world matrix in
the same traversal. Writing transform attributes after it ensures they read completed `Text.matrixWorld` values. Both
happen before `_projectObject()` builds the render list, so resident text added immediately before `renderer.render()` is
present, transformed, uploaded, and drawn in that call; no preparatory frame is required.

`super.updateMatrixWorld()` visits every child `Text` exactly once. A grouped `Text` still performs that normal transform
update but skips its standalone preparation branch because its nearest `TextGroup` owns the paragraph membership and draw
objects. Joining or leaving a group never changes `matrixAutoUpdate` or `matrixWorldAutoUpdate`; caller-authored Three matrix
policy survives unchanged. A detached text owns no preparation, while a directly rendered standalone text resumes its own
implicit-batch branch. That branch uses the same method order through a private one-paragraph `ThreeTextBatchBinding`.

## Moving between batches is remove plus add

```ts
overlayText.add(label);
```

Three.js removes `label` from its old parent before adding it to `overlayText`. The integration responds by staging two core
operations:

```ts
oldParagraph.dispose();
const nextParagraph = overlayParagraphBatch.add(label.desiredState);
```

It does not move a core paragraph handle between batches. Pending removal and allocation publish in the same pre-render
synchronization, so the old batch cannot leave ghost glyphs while the new batch renders the object. Cached shaping and
layout may be reused when their inputs are unchanged, but the destination receives new batch slots.

The old paragraph slot and glyph instances belong to the old batch, not to `label`. Removal makes those slots reusable and
updates the old batch's logical counts and glyph runs. It does not dispose or shrink a shared buffer merely because one
text left. The old `TextGroup` retains that capacity until a later transactional replacement or `TextGroup.dispose()`.
The destination group owns any new physical storage it needs. Moving from a standalone implicit batch also retires that
text-owned target storage according to the renderer's in-flight-frame rules.

That standalone-to-group transition is transactional. The integration validates and stages destination membership first,
publishes the new complete group revision, then retires the previous implicit target only after no in-flight frame can use
it. It never destroys the old target first and risks a missing frame or unrecoverable destination failure.

Removal marks old membership dirty synchronously. Slot recycling and the updated glyph-run list publish at the old
group's next render synchronization. If the old group remains visible, that synchronization occurs before Three builds the
next render list. If the entire group is removed and will never render again, the application disposes the group rather
than waiting for another synchronization.

Changing parents during an active Three.js traversal is unsupported, matching Three.js scene-graph expectations. Scene
membership changes must complete before `renderer.render()` enters world-matrix traversal.

## Dispose a group; retain its text

`TextGroup.dispose()` is terminal for the group, not recursive destruction of its scene children:

```ts
groupA.add(label);
renderer.render(scene, camera);

groupA.dispose();

groupA.disposed; // true
label.disposed; // false
label.bound; // false
label.textGroup; // undefined, even while label.parent is still groupA

groupB.add(label); // Three reparents the same object
renderer.render(scene, camera); // new paragraph membership renders in groupB
```

Disposal synchronously invalidates `groupA` as a text-batch boundary, unbinds every direct or nested member `Text`, cancels
the group's unpublished preparation, and begins retirement of its core paragraph batch and renderer targets. Existing
children keep their transforms, desired state, glyph-origin override state, and font leases. The group contributes no
further text draws and rejects new text membership, but disposal does not mutate Three parent/child relationships.
While a live `Text` remains below the disposed group in the scene graph, that disposed group stays a terminal non-rendering
batch boundary: ancestry reconciliation must not fall through to an outer `TextGroup` or create an implicit standalone
batch. The caller moves the text explicitly when it should render elsewhere.

`groupB.add(label)` validates the live text, every leased font, and technique compatibility before calling Three's
reparenting operation. Failure leaves `label` unchanged and unbound; success creates a new core paragraph handle and group-B
slots before its first render. No group-A paragraph handle or GPU allocation transfers to group B, and group-A resources
retire independently according to their renderer fences.

## Three.js owns synchronization

```ts
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

Applications do not call a core update and then copy the result into Three. The integration coalesces desired-state and
membership changes, invokes the shared runtime's `update()` from each encountered standalone `Text` or `TextGroup`, publishes
that owner's resulting Three draw objects, and then continues normal matrix traversal. Core specifies that a no-op
`update()` returns the current revision without allocation or notification. The first call after a mutation therefore
prepares every dirty paragraph across every paragraph batch; later calls in the same frame, scene, or render pass are cheap
revision checks unless their own membership reconciliation introduced new dirty work.

`WebGPURenderer.render(scene, camera)` updates and projects only the supplied scene or object root. Three does not first
update every scene known to the application. When an application renders several scenes, each scene traversal naturally
encounters its own text owners and calls the same shared runtime. No application-level text update is required: the first
encounter after a mutation performs the work, and every later encounter observes the published revision. Warm edits are
current in the render call that observes them. Loading and raster-page misses remain explicit readiness work owned by
`FontLoader` and the loaded font handle rather than being silently started as ordinary shaping.

## Change retained text at runtime

```ts
label.text = 'First value';
label.text = 'Second value';
label.text = 'Player 2';

label.contentBox = {
  width: { mode: 'at-most', size: 360 },
  wrap: 'word',
};
```

Those writes update desired state only. The parent batch shapes the final values once during its next render-loop
synchronization. Nested records are immutable replacement values; direct deep mutation is unsupported.

```ts
interface TextBaseProperties<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> {
  readonly font: FontSelection<Technique>;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
  readonly renderVariant?: Variant;
}

type TextContentProperties<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> =
  | Readonly<{
      text: string;
      spans?: readonly TextSpan<Technique, Variant>[];
    }>
  | Readonly<{
      text: FormattedText<Technique>;
      spans?: never;
    }>;

type TextProperties<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> = TextBaseProperties<
  Technique,
  Variant
> &
  TextContentProperties<Technique, Variant>;

type TextUpdate<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> =
  | (Partial<TextBaseProperties<Technique, Variant>> &
      Readonly<{
        text?: string;
        spans?: readonly TextSpan<Technique, Variant>[];
      }>)
  | (Partial<TextBaseProperties<Technique, Variant>> &
      Readonly<{
        text: FormattedText<Technique>;
        spans?: never;
      }>);

interface TextSpan<Technique extends AnyRasterTechnique, Variant = ThreeRenderVariant> {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly renderVariant?: Variant;
}
```

`font` and every span font must match the effective batch technique. Changing `font` to another same-technique `Font` or
`FontStack` is a retained update. Assigning an incompatible selection throws without changing current desired or rendered
state.

## Compose typed spans

The Three entry point re-exports core's renderer-neutral `txt` and `span` tags. It does not add formatting methods to the
`Text` class or parse a markup language.

```ts
import { Text, span, txt } from '@pmndrs/text-three';

const emphasis = span(noto, { color: '#ffddff' });

const label = new Text({
  font: uiFont,
  text: txt`Fast ${emphasis`accurate`} text`,
});

label.text = 'Plain text';
label.text = txt`Player ${span(noto)`Two`}`;
```

`txt` returns one immutable typed literal containing the flattened string and computed UTF-16 spans. `span()` accepts a
style by itself, or a `Font` / `FontStack` followed by styles and same-technique font overrides, merging left to right into
a reusable typed tag. TypeScript validates fonts, style and paint fields, property names, and technique. Assignment of a
plain string clears spans, while assignment of a literal replaces text and spans atomically. Explicit `spans`, `setSpan()`,
and `removeSpan()` remain the lower-level imperative form.

React Three Fiber uses the same composer internally:

```tsx
<Text font={uiFont}>
  Fast <Text font={noto}>accurate</Text> text
</Text>
```

The nested React form and `txt` literal above must produce the same source string and span ranges. A nested React `<Text>`
is inline paragraph data; `label.add(new Text(...))` remains an ordinary spatial Three child and a separate paragraph.

Three-native state remains Three-native:

```ts
label.position.x += 1;
label.visible = false;
label.layers.set(2);
label.renderOrder = 10;
```

Transforms never reshape. `Text.renderOrder` maps to the paragraph ordering value inside the effective batch. Visibility,
layers, and transform changes update instance visibility/transform storage without changing shaping. `TextGroup.renderOrder`
sets the secondary Three render-order base for the batch's ordered physical draws. The nearest real Three Group owns
their primary `groupOrder`.

## Structural, rebuilding, and hot changes

### Construction-only batch identity

Technique defines compatibility and has no setter:

```ts
new TextGroup({
  technique, // canonical instance layout and shader family
  program, // accepted variant type, attributes, material/pipeline, and draw compiler
  capacity, // initial physical glyph-buffer size and overflow policy
});
```

Changing technique or program requires a new `TextGroup`. Capacity is deliberately mutable through `setCapacity()` because storage
replacement must preserve the group, its text identities, and its core paragraph handles.

For standalone `Text`, `setCapacity()` changes its implicit batch without changing the public object. Its font selection is
mutable; changing technique rebuilds the implicit batch. Inside an explicit `TextGroup`, changing to a different technique
is rejected and requires moving the retained `Text` to a compatible group.
The renderer identity becomes fixed on first draw and is also structural. `renderOrder` remains mutable.

### Retained changes that rebuild internal storage

These operations retain public objects but may allocate new internal glyph slots, chunks, attributes, or materials:

```ts
destination.add(text); // remove old paragraph allocation, add new allocation
textGroup.setCapacity(nextCapacity); // preserve handles; replace canonical and target storage transactionally
text.font = anotherFont; // reshape and possibly change physical resource batch
text.spans = nextSpans; // reshape and possibly change raster-resource glyph runs
text.rasterPixelRatio = next; // select resources and rebuild affected target storage
text.renderVariant = nextVariant; // rebuild run/draw compatibility without reshaping
```

Glyph overflow follows the owning group's `grow`, `chunk`, or `fixed` policy. All fallible replacement work stages before
publication; failure preserves the last complete revision.

### Text errors do not escape rendering

A synchronous core preparation failure is caught by the Three adapter before it can escape `renderer.render()`. An
asynchronous failure enters the same adapter state. The owner is the effective `TextGroup`, or the standalone `Text` for an
implicit batch:

```ts
labels.onError = (error) => {
  if (error.kind === 'capacity-exceeded') {
    console.error(`Text needs ${error.required} glyph slots; the fixed limit is ${error.capacity}.`);
  }
};

renderer.render(scene, camera);
labels.error; // typed preparation or target failure, or undefined after a successful revision
```

The integration sets `error` during synchronization and defers `onError` until after the active Three traversal. Core
preparation failure or retained `attachment.error` preserves the last complete target revision; a first-render failure
submits nothing for that owner. The failed desired generation stays retained, but Three does not retry an identical failure
every frame. A relevant text, font, content-box, membership, or explicit `setCapacity()` change schedules new core work;
`retry()` requests one explicit attempt against unchanged state. Successful publication clears `error`. Capacity recovery
means resizing explicitly, reducing demand, or removing or moving text. No failure can partially publish or escape the
render call.

While a `Text` is grouped, the group is the synchronization owner: read `text.textGroup.error` and use the group's callback.
The `Text` properties report and observe only its implicit standalone batch and are inactive while grouped. One failed
generation schedules one deferred callback, not one callback per render frame. `text.retry()` delegates to that effective
group while grouped and to the retained implicit attachment while standalone; `group.retry()` retries only that group's
attachment.

### Hot retained changes

These never recreate the `Text` or `TextGroup`:

```ts
text.text = nextText;
text.contentBox = nextContentBox;
text.style = nextStyle;
text.paint = nextPaint;
text.renderOrder = nextOrder;
text.position.copy(nextPosition);
text.visible = nextVisible;
text.setGlyphOrigins(nextOrigins);
```

Dirty channels determine whether the hidden update shapes, reflows, rewrites paint/origins/transforms, or only rebuilds the
glyph-run plan.

## Manual glyph motion

```ts
const snapshot = label.snapshotGlyphs();
const x = snapshot.displayedX.slice();
const y = snapshot.displayedY.slice();

simulateGlyphs(x, y, delta);

label.setGlyphOrigins({
  topology: snapshot.topology,
  start: 0,
  x,
  y,
});
```

Clear overrides to return to shaped positions:

```ts
label.clearGlyphOriginOverrides();
```

The next Three render-loop synchronization writes the changed origins without reshaping. Later content changes may reshape
the authoritative targets; the application can snapshot again and interpolate from its current displayed values.

## Dispose ownership explicitly

```ts
label.dispose();
worldText.dispose();
inter.dispose();
noto.dispose();
loader.dispose();
```

`remove()` changes membership; `dispose()` ends ownership. Use the explicit destroy sequence when a text will never be
reused:

```ts
label.removeFromParent();
label.dispose();
```

`Text.dispose()` is idempotent and permanent. It releases the current core paragraph membership, renderer-neutral cached
state, and any implicit standalone batch and target. It does not dispose explicit-group buffers or loaded fonts, and it
does not mutate the caller-owned scene graph; a disposed object still parented in Three is skipped but remains referenced
until the caller removes it. When grouped, disposal stages the same old-membership cleanup as `remove()` and the group
publishes that cleanup before its next render. When already detached and unbound, disposal still cancels pending work,
clears retained shaping/layout state and font references, marks the object permanently disposed, and prevents future
attachment. Mutating or adding a disposed `Text` throws.

`TextGroup` owns its hidden paragraph batch, canonical batch storage, renderer-specific targets, materials, attributes,
and subscriptions. Removing a child only frees/recycles logical slots inside those shared resources. `TextGroup.dispose()`
permanently releases the group-owned resources, but does not dispose or remove child `Text` objects; callers may remove
those retained children and add them to a live compatible group. A disposed group rejects text attachment and cannot be
reactivated.

`LoadedFont.dispose()` fails while any live `Text` lease remains. After the final text is disposed or changes font, font
disposal releases that loaded-font ownership. `FontStack` itself owns no lifecycle and cannot keep a disposed concrete font
valid. `FontLoader.dispose()` releases its cache-domain ownership; loaded fonts and their shared shaping state remain valid
until their own final owners are gone.

Renderer-specific GPU resources retire according to the renderer target's in-flight-frame rules. Disposal is idempotent.

## Required conformance cases

The implementation is not complete until tests prove:

- an unattached `Text` performs no shaping or GPU allocation;
- direct `scene.add(text)` renders through an implicit batch of one on its first render;
- `TextGroup` exposes no duplicate creation or allocation shortcut; `new Text()` plus ordinary `add()` is the only explicit-group path;
- direct and nested descendants join the nearest `TextGroup`, while nested `TextGroup` boundaries do not merge;
- a detached `Text` owns desired state but no paragraph batch or GPU resources, and direct scene attachment creates its implicit batch before first render;
- add/remove/reparent events plus pre-render ancestry reconciliation cannot leave stale or duplicate membership;
- moving a `Text` performs an atomic old allocation removal and new allocation creation without ghost glyphs;
- removing one text recycles its slots without shrinking or disposing shared group buffers;
- disposing a populated group unbinds but does not dispose its direct or nested text, and each retained text can bind to a live compatible group;
- text left parented below a disposed group remains unbound and cannot fall through to an outer group or implicit standalone batch;
- disposed text rejects mutation and attachment, text disposal does not dispose group/font resources, and group disposal does not dispose child text/fonts;
- font disposal fails while paragraph or text leases remain, and group disposal or reparenting cannot create missing glyphs by releasing font data;
- fixed capacity is checked after shaping rather than by `add()`, preserves the last complete revision, never throws from Three traversal, reports once, and retries only after a relevant change;
- `setCapacity()` preserves the group, every public `Text`, every core paragraph handle, and existing target attachments while replacing canonical and GPU storage transactionally;
- `TextGroup.clone()` and `copy()` are rejected rather than silently duplicating identity-bearing text, listener, and renderer state;
- simultaneous scene placements use separate groups, ordinary reparenting can move one group between scenes, and attempting
  to draw one group through a second renderer fails before encoding;
- construction-only incompatibilities fail without mutating the current group;
- runtime setters coalesce and select the narrowest dirty work;
- automatic synchronous preparation renders warm edits in the observing frame;
- a same-technique `FontStack` produces the core-authored minimum physical batches and exact ordered glyph runs;
- mixed-technique group additions and font stacks fail before shaping without replacing live text;
- font-bound, font-stack-bound, style-only, reusable-tag, and readonly-tuple `span()` forms normalize identically, while mixed-technique format lists fail;
- `txt`/`span`, explicit spans, and nested React `<Text>` produce the same UTF-16 source/span snapshot;
- WebGPU and forced WebGL2 execute the same Bitmap, MTSDF, and Slug behavior on Three.js 0.185.1.
