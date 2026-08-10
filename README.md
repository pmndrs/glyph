# @pmndrs/text

Portable font baking, Unicode shaping, paragraph layout, and batched text rendering for every Canvas.

This README specifies the target v1 API. The repository's merged implementation is v0; v1 is declared only after the core API and
engine integrations below are implemented and pass their portability gates.

## Render text with React Three Fiber

```tsx
import { Text, TextGroup, useFont } from '@pmndrs/text/r3f';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

function Labels() {
  const Inter = useFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: mtsdf },
  });

  return (
    <TextGroup technique={mtsdf}>
      <Text font={Inter}>Hello, world!</Text>
    </TextGroup>
  );
}
```

## Render text with Three.js

```ts
import { FontLoader, Text, TextGroup } from '@pmndrs/text/three';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const loader = new FontLoader();
const Inter = await loader.loadAsync({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: mtsdf },
});

const labels = new TextGroup({ technique: mtsdf });
labels.add(new Text({ font: Inter, text: 'Hello, world!' }));

scene.add(labels);
```

Both integrations load fonts explicitly and add one same-technique text batch to the scene. Three.js owns shaping and buffer synchronization inside its normal render lifecycle.

## Batch text with `TextGroup`

```ts
import { createFontStack } from '@pmndrs/text';
import { FontLoader, Text, TextGroup, span, txt, type SpanStyle } from '@pmndrs/text/three';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const loader = new FontLoader();
const loadMSDF = (baked: string) =>
  loader.loadAsync({
    input: { baked },
    raster: { technique: mtsdf },
  });

const [Inter, Noto, IconFont] = await Promise.all([
  loadMSDF('/fonts/Inter.font.glb'),
  loadMSDF('/fonts/NotoSans.font.glb'),
  loadMSDF('/fonts/Icons.font.glb'),
]);

const BodyFont = createFontStack(Inter, Noto);

const labels = new TextGroup({
  technique: mtsdf,
});

scene.add(labels);
```

Create retained `Text` objects, then add them through the ordinary Three scene graph:

```ts
const body = new Text({
  font: BodyFont,
  text: 'This paragraph uses Noto when Inter is missing a glyph.',
  contentBox: {
    width: { mode: 'at-most', size: 480 },
    wrap: 'word',
  },
});
const score = new Text({ font: Inter, text: 'Player 1' });

labels.add(body, score);

score.position.set(0, 2, 0);
score.rotation.y = Math.PI / 4;
```

`TextGroup.add()` binds a `Text` to the batch; `TextGroup.remove()` unbinds it without disposing the retained object. Internal glyph slots are created later, when Three synchronizes the group for rendering.

Grouped glyph buffers belong to `TextGroup`, not to each `Text`. Moving `score` lets the old group recycle its slot and gives the destination a new paragraph membership; the old group's retained buffer stays alive for its other text and future reuse.

```ts
const overlayLabels = new TextGroup({ technique: mtsdf });

overlayLabels.add(score); // Three removes it from labels and binds it to overlayLabels

score.removeFromParent(); // reusable desired state; no batch membership while detached
score.dispose(); // permanent: score cannot be added again
```

Disposing a populated group destroys the batch, not its retained `Text` children:

```ts
labels.dispose();

body.disposed; // false
body.bound; // false

overlayLabels.add(body); // creates fresh membership; no old buffer or paragraph transfers
```

`body` keeps its desired state, transform, glyph overrides, and font leases. The disposed group cannot be reused. Destination validation happens before reparenting, so an incompatible technique or invalid font leaves `body` unbound instead of partially moving it.

Call `dispose()` when the public `Text` will never be reused. It releases text-owned cached state and any standalone batch, but it does not dispose a group's shared buffers or the loaded font. Dispose the `TextGroup` when that render phase is done, then dispose fonts after no retained `Text` or core `Paragraph` holds them. A `FontStack` is an immutable selection value, not an owner; retaining the value does not prevent font disposal, and a stack containing a disposed font cannot be used again.

Construction alone owns no renderer resource. A `Text` gets a text-owned implicit batch only after it is attached outside a `TextGroup` and synchronized for rendering. Moving that rendered standalone text into a group publishes new group membership before retiring its implicit target at a GPU-safe boundary. Calling `dispose()` after removal is therefore not a no-op or a defensive convention: it cancels pending work, clears retained caches and references, marks the object permanently disposed, and prevents it from being attached again.

## Text spans

Compose typed spans without managing UTF-16 ranges by hand:

```ts
const AlertStyle = {
  color: '#ffddff',
  fontSize: 18,
} satisfies SpanStyle;

const alert = span(Noto, AlertStyle);

score.text = txt`
  Player ${alert`Two`}
`;
```

`span(inter)`, `span(uiFont)`, `span(importantStyle)`, and `span(inter, { color: '#ffddff' })` are the same composition path.
A style-only span inherits its surrounding font. The Three entry point re-exports the renderer-neutral `txt`, `span`, and
style types from `@pmndrs/text`. A plain string remains valid anywhere a formatted text literal is accepted.

Keep the inputs as a tuple when they need to be extended before binding:

```ts
const AlertFormat = [Inter, AlertStyle] as const;
const alertFormat = span(...AlertFormat);
```

An unattached `Text` stores desired state without shaping. When it is added, the nearest `TextGroup` allocates it before the
first shape and render. Moving it to another group removes its old paragraph allocation and adds a new allocation while
retaining the same `Text` object, properties, and transform.

```ts
score.text = 'First value';
score.text = 'Second value';
score.text = 'Player 2';

renderer.render(scene, camera); // shapes only "Player 2"
```

One `TextGroup` is one intentional text render phase. Create separate groups for simultaneous scene placements, different
renderer lifetimes, or places where non-text draws must appear between text draws. Ordinary Three reparenting may move one
group between scenes. Every `Text` owns its `Font` or `FontStack`; every effective font must use the group's rendering
technique.

## Preallocate glyph buffers when it matters

Capacity is optional. A `TextGroup` defaults to 4,096-glyph chunks if unspecified. Ordinary applications do not need to size batches up front. Paragraph handles and their metadata are not capacity-limited.

Set capacity when a workload has a known upper bound or needs a different overflow policy:

```ts
const denseLabels = new TextGroup({
  technique: mtsdf,
  capacity: { size: 20_000, policy: 'chunk' },
});
```

- `size` is the number of glyph-instance slots in each physical raster-resource buffer.
- `policy: chunk` preserves existing buffers and allocates another when one fills.
- `policy: grow` replaces a full buffer and doubles its capacity until the pending glyphs fit.
- `policy: fixed` turns `size` into a hard limit.

Core preserves paragraph order when text crosses physical buffers.

`TextGroup.add()` validates ownership and technique compatibility, but it does not shape and therefore cannot know final glyph
demand. A fixed-capacity overflow is discovered by synchronization: core reports a typed `capacity-exceeded` preparation
error before publication and keeps the prior revision current. The Three.js integration catches that failure inside its
render synchronization, keeps the last complete text visible, and exposes it through the owning
`TextGroup.error` plus a deferred `onError` callback.

Applications that manage fixed capacity resize explicitly:

```ts
const overflow = labels.error;
if (overflow?.kind !== 'capacity-exceeded') throw new Error('No fixed-capacity overflow to resize');

labels.setCapacity({ size: overflow.required, policy: 'fixed' });
```

## Control batch render order

A `TextGroup` is an `Object3D`, so its program-compiled draws naturally retain the nearest parent Three `Group` order:

```ts
const hud = new THREE.Group();
hud.renderOrder = 100;

const labels = new TextGroup({ technique: mtsdf });

hud.add(labels); // text draws use groupOrder 100
scene.add(hud);
```

Set the batch's secondary render-order base through the ordinary Three property:

```ts
labels.renderOrder = 10;
```

Core sorts each `Text.renderOrder` inside the batch. The integration assigns the program's ordered physical draws
consecutive Three render orders beginning at `TextGroup.renderOrder`. Use separate `TextGroup`s when unrelated Three draws
must appear between text phases.

## Core API

Baking, loading, shaping, layout, and physical glyph batching are renderer-neutral core concepts.

### Bake fonts

```ts
import { rasterBake } from '@pmndrs/text';
import { bakeFont } from '@pmndrs/text/bake';
import mtsdfBaker from '@pmndrs/text/raster/mtsdf/baker';

await bakeFont({
  input: new URL('./Inter-Regular.ttf', import.meta.url),
  output: new URL('./Inter.font.glb', import.meta.url),
  font: { fontFaceIndex: 0 },
  rasters: [
    rasterBake(mtsdfBaker, {
      packaging: { artifact: 'embedded', pages: 'embedded' },
      options: undefined,
    }),
  ],
});
```

Baking creates font metrics, glyph records, and technique resources before the application runs. Development fallback can perform the same work in a Worker. Loading remains explicit either way.

For a known local font, the CLI exposes the same path without a project-discovery module:

```sh
pnpm exec pmndrs-text-bake --input Inter-Regular.ttf --output Inter.font.glb --bitmap 32 --msdf --slug
```

Add `--unicodes U+0020-007E` to subset the shaping font through `hb-subset`, or `--check` to rebuild temporarily and
require byte-identical output.

### Load, shape, and render

```ts
import { createFontStack, createTextRuntime } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';
import { slug } from '@pmndrs/text/raster/slug';

const runtime = await createTextRuntime({
  async: {
    createWorker: () => new Worker(new URL('./text-worker.js', import.meta.url)),
  },
});

const Inter = await runtime.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: mtsdf },
});
const Noto = await runtime.loadFont({
  input: { baked: '/fonts/NotoSans.font.glb' },
  raster: { technique: mtsdf },
});

const [InterBitmap, InterMsdf, InterSlug] = await runtime.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: mtsdf }, { technique: slug }],
});

const UiFont = createFontStack(Inter, Noto);

const paragraphs = runtime.createParagraphBatch({
  technique: mtsdf,
});

const label = paragraphs.add({
  font: UiFont,
  text: 'Player 1',
});
```

Change desired state, then choose the synchronization boundary explicitly:

```ts
label.text = 'Player 2';

const revision = runtime.update();
// or: const outcome = await runtime.updateAsync();
```

Core returns technique-specific canonical CPU storage, exact adjacent-revision dirty ranges, and ordered glyph runs carrying
the paragraph/span render variant. An integration maps those ranges into its own buffers and compiles compatible runs into
engine draws; it never reshapes, re-sorts source text, or rediscovers physical resource membership.

## How a rendering engine uses core

Call core once after application text changes and before the engine submits text. Everything marked `RENDERER` is the thin
technique adapter the engine implements for Bitmap, MTSDF, or Slug.

```text
CREATE target implementing ParagraphBatchTarget for the selected raster technique

target.stage(previous, prepared):
  FOR EACH glyphBatch IN prepared.glyphBatches:
    RENDERER create or reuse safe unpublished buffers for:
      glyphBatch.key
      glyphBatch.capacity
      glyphBatch.storage fields defined by GlyphBatchStorageOf<Technique>

    IF previous.sourceRevision is the immediately preceding batch revision:
      ranges = glyphBatch.dirtyRanges
    ELSE:
      ranges = the live ranges for glyphBatch named by prepared.glyphRuns

    FOR EACH range IN ranges:
      RENDERER upload that range from every glyphBatch.storage field

    RENDERER realize glyphBatch.binding from glyphBatch.font.data
    RENDERER retain those font resources with the instance buffers
    RASTER TECHNIQUE defines the portable data, binding, and instance semantics
    RASTER PROGRAM defines shader and pipeline semantics for this renderer backend

  RASTER PROGRAM compile prepared.glyphRuns into ordered compatible draws
    it may coalesce adjacent compatible variants or split for engine limits
    it must preserve order unless its compositing policy proves another order equivalent
  RETURN a ready ParagraphBatchTargetStage
    commit() publishes this complete target revision
    abort() releases only this unpublished target revision

target.dispose():
  RENDERER retire target resources after in-flight work finishes

CALL attachment = paragraphs.attach(target) once

BEFORE EACH TEXT RENDER PHASE:
  CALL runtime.update()
    core shapes every dirty paragraph across the runtime
    core publishes prepared paragraph batches atomically
    attachments record their newest source revision without touching renderer resources

  CALL attachment.prepare()
    calls target.stage(previous, prepared) only for this observed render phase
    repeated calls are no-ops when that source revision is already prepared

  CALL attachment.commit()
    publishes a ready renderer revision at this safe frame boundary

  READ prepared = paragraphs.current
  READ live = attachment.current

  FOR EACH paragraph IN prepared.paragraphs:
    RENDERER update the current engine transform for paragraph.paragraph
    transform-only changes do not call runtime.update()

  FOR EACH draw IN live.draws, in the compiled order:
    RENDERER select the physical buffers and resources identified by draw
    RENDERER bind the raster program, variant data, and pipeline
    RENDERER encode the draw
```

Read the complete [Three.js API](docs/planning/three-api.md), [core API](docs/planning/core-api.md),
[engine integration contract](docs/planning/engine-integration-contract.md), and
[raster technique boundary](docs/planning/raster-technique-api.md),
[TypeGPU program and engine API](docs/planning/typegpu-api.md), the
[TypeGPU-first shader authority research](docs/planning/typegpu-first-shader-authority.md), then the
[implementation plan](docs/planning/engine-integration-boundary.md).

```sh
mise install
pnpm install
pnpm dev
```

`@pmndrs/text` is ESM-only and MIT licensed.
