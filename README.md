# @pmndrs/text

Portable font baking, Unicode shaping, paragraph layout, and renderer-ready glyph batching for Three.js or your own engine.

```ts
fontFile
  -> bakeFont()
  -> runtime.loadFont()
  -> runtime.createFontGroup()
  -> runtime.createParagraphBatch()
  -> paragraph.text = next
  -> runtime.update() // or updateAsync()
  -> core-populated glyph batches + ordered submissions
  -> your engine draws
```

## Bake fonts

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

Baking creates font metrics, glyph records, and technique resources before the application runs. Development fallback can
perform the same work in a Worker.

## Create the runtime

```ts
import { createTextRuntime } from '@pmndrs/text';

const runtime = await createTextRuntime({
  async: {
    createWorker: () => new Worker(new URL('./text-worker.js', import.meta.url)),
  },
});
```

The runtime can perform either synchronous or asynchronous updates. Runtime creation provisions the Worker capability; it
does not force every update down one execution path.

## Load fonts explicitly

```ts
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const inter = await runtime.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: mtsdf },
});

const noto = await runtime.loadFont({
  input: { baked: '/fonts/NotoSans.font.glb' },
  raster: { technique: mtsdf },
});

const iconMtsdf = await runtime.loadFont({
  input: { baked: '/fonts/Icons.font.glb' },
  raster: { technique: mtsdf },
});
```

`loadFont()` resolves after shaping data and the selected technique data are decoded into renderer-neutral CPU state. It does not create engine textures, buffers, pipelines, materials, meshes, or entities.

## Group fallback fonts

```ts
const fonts = runtime.createFontGroup({
  fonts: [inter, noto, iconMtsdf],
  fallback: [inter, noto],
});
```

One font group can contain multiple fonts but exactly one rendering technique. Different fonts may require separate GPU
resources and draws. Bitmap and Slug cannot share a font group; a renderer combining their data is a new technique with
its own artifacts and shader.

## Create a paragraph batch

```ts
const worldText = runtime.createParagraphBatch({
  fonts,
  capacity: {
    paragraphs: 1_000,
    glyphs: 20_000,
    overflow: 'chunk',
  },
});
```

A paragraph batch is an intentional render-phase boundary. Core may sort and batch every paragraph inside it, but never
merges it with another paragraph batch.

Create another one when your engine must draw text in another phase:

```ts
const overlayText = runtime.createParagraphBatch({
  fonts,
  capacity: {
    paragraphs: 100,
    glyphs: 2_000,
    overflow: 'grow',
  },
});
```

## Add paragraphs

A multiline block, one-line label, and font-backed icon are all paragraphs.

```ts
const body = worldText.add({
  primaryFont: inter,
  text: 'Fallback can shape this paragraph through every font in the group.',
  contentBox: {
    width: { mode: 'at-most', size: 480 },
    wrap: 'word',
  },
});

const label = worldText.add({
  primaryFont: inter,
  text: 'Player 1',
});

const icon = overlayText.add({
  primaryFont: iconMtsdf,
  text: '\uf013',
});
```

`primaryFont` and every span font must belong to the paragraph batch's font group. Missing glyphs resolve through the
group's fallback order.

## Change paragraphs directly

```ts
label.text = 'First value';
label.text = 'Second value';
label.text = 'Player 2';

label.contentBox = {
  width: { mode: 'at-most', size: 360 },
  wrap: 'word',
};
```

Setters update desired state and mark the paragraph dirty. They do not shape immediately. Repeated writes naturally coalesce, so the next update shapes only `Player 2` with the final content box.

Replace nested configuration values as immutable snapshots:

```ts
paragraph.contentBox = nextContentBox;
paragraph.style = nextStyle;
paragraph.setSpan(0, nextSpan);
```

Deep mutation such as `paragraph.contentBox.width.size = 320` is not observable and is unsupported.

## Update synchronously

```ts
const revision = runtime.update();
```

`update()` synchronously snapshots every dirty paragraph across the runtime, shapes them together, lays them out, updates
physical glyph batches, rebuilds affected submission plans, publishes one atomic revision, and returns it.

Calling `update()` with no dirty paragraphs returns `runtime.current` without allocating or notifying subscribers.

## Update asynchronously

```ts
label.text = 'Prepared in a Worker';
const revision = await runtime.updateAsync();
```

Use the callback overload when a hot path should not allocate a public Promise:

```ts
runtime.updateAsync({ signal: controller.signal }, (result) => {
  if (!result.ok) {
    handleTextUpdateError(result.error);
    return;
  }

  publish(result.value);
});
```

Both forms snapshot pending changes when called. Mutations made afterward remain dirty for the next update.

A newer synchronization supersedes an unfinished asynchronous candidate:

```ts
label.text = 'A';
const preparingA = runtime.updateAsync();

label.text = 'B';
runtime.update(); // B is current before this returns

await preparingA; // rejects as superseded; A cannot replace B
```

## Render with Three.js

```ts
import { ThreeParagraphBatch } from '@pmndrs/text/three';

const worldObject = new ThreeParagraphBatch({ paragraphBatch: worldText });
const overlayObject = new ThreeParagraphBatch({ paragraphBatch: overlayText });

scene.add(worldObject, overlayObject);
```

Each paragraph gets a lightweight `Object3D` transform without its own mesh or material:

```ts
const labelObject = worldObject.object(label);

labelObject.position.set(0, 2, 0);
labelObject.rotation.y = Math.PI / 4;
labelObject.scale.setScalar(2);
```

A synchronous frame loop is explicit:

```ts
function frame() {
  scene.updateMatrixWorld();
  runtime.update();
  worldObject.updateInstances();
  overlayObject.updateInstances();
  renderer.render(scene, camera);
}
```

An asynchronous loop renders the last completed revision:

```ts
function frame() {
  scene.updateMatrixWorld();

  if (runtime.hasPendingChanges && !runtime.isPreparing) {
    runtime.updateAsync(handlePreparedRevision);
  }

  worldObject.updateInstances();
  overlayObject.updateInstances();
  renderer.render(scene, camera);
}
```

## Render with your engine

Core has already shaped, sorted, partitioned, allocated, and packed every glyph. One paragraph batch exposes homogeneous
glyph buffers and the order in which their ranges must be submitted:

```ts
interface PreparedParagraphBatchRevision<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];
  readonly submissions: readonly GlyphSubmission[];
}
```

Upload only dirty ranges:

```ts
for (const batch of revision.glyphBatches) {
  const gpu = target.ensureBatch({
    key: batch.key,
    technique: batch.technique,
    font: batch.font,
    capacity: batch.capacity,
    storage: batch.storage,
  });

  gpu.upload(batch.dirtyRanges);
  gpu.setCount(batch.instanceCount);
}
```

Submit exactly the plan core produced:

```ts
for (const submission of revision.submissions) {
  target.draw(submission.batch, submission.start, submission.count);
}
```

Core retains canonical CPU instance arrays and reports their dirty ranges. An integration may copy those ranges directly
into matching engine buffers or map the technique fields into a different interleaved or engine-specific layout. It never
needs to reshape, sort, partition, or inspect glyphs to rediscover draw order.

Your engine still owns transforms, visibility, scene composition, GPU objects, render-pass placement, command encoding,
frame publication, fences, and retirement. It may map canonical fields into its buffer layout, but it does not reshape,
regroup, sort, or recompute batch membership and submission order.

## Move glyphs without reshaping

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

runtime.update();
```

Return to shaped positions later:

```ts
label.clearGlyphOriginOverrides();
runtime.update();
```

## Dispose

```ts
worldObject.dispose();
overlayObject.dispose();
worldText.dispose();
overlayText.dispose();
runtime.dispose();
```

Read the [full core API and rationale](docs/planning/core-api.md), the exact
[engine integration contract](docs/planning/engine-integration-contract.md), and the
[implementation plan](docs/planning/engine-integration-boundary.md).

The next implementation change must prove the same core output through Three.js, raw TypeGPU, and Wayfare before this API
is considered complete.

```sh
mise install
pnpm install
pnpm dev
```

`@pmndrs/text` is ESM-only and MIT licensed.
