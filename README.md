# @pmndrs/text

Portable font baking, Unicode shaping, paragraph layout, and batched text rendering for every Canvas.

## Render text with React Three Fiber

```tsx
import { Text, TextGroup, useFont } from '@pmndrs/text/react';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

function Labels() {
  const inter = useFont({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: mtsdf },
  });

  return (
    <TextGroup technique={mtsdf}>
      <Text font={inter}>Hello, world!</Text>
    </TextGroup>
  );
}
```

## Render text with Three.js

```ts
import { FontLoader, Text, TextGroup } from '@pmndrs/text/three';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const loader = new FontLoader();
const inter = await loader.loadAsync({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: mtsdf },
});

const labels = new TextGroup({ technique: mtsdf });
labels.add(new Text({ font: inter, text: 'Hello, world!' }));

scene.add(labels);
```

Both integrations load fonts explicitly and add one same-technique text batch to the scene. Three.js owns shaping and buffer synchronization inside its normal render lifecycle.

## Batch text with `TextGroup`

```ts
import { createFontStack } from '@pmndrs/text';
import { FontLoader, Text, TextGroup, span, txt } from '@pmndrs/text/three';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const loader = new FontLoader();
const loadMtsdf = (baked: string) =>
  loader.loadAsync({
    input: { baked },
    raster: { technique: mtsdf },
  });

const [inter, noto, iconFont] = await Promise.all([
  loadMtsdf('/fonts/Inter.font.glb'),
  loadMtsdf('/fonts/NotoSans.font.glb'),
  loadMtsdf('/fonts/Icons.font.glb'),
]);

const bodyFont = createFontStack(inter, noto);

const labels = new TextGroup({
  technique: mtsdf,
  capacity: {
    texts: 1_000,
    glyphs: 20_000,
    overflow: 'chunk',
  },
});

scene.add(labels);
```

Allocate from the batch:

```ts
const body = labels.allocate({
  font: bodyFont,
  text: 'This paragraph uses Noto when Inter is missing a glyph.',
  contentBox: {
    width: { mode: 'at-most', size: 480 },
    wrap: 'word',
  },
});
```

Or add a retained `Text` through the ordinary Three scene graph:

```ts
const score = new Text({ font: inter, text: 'Player 1' });

labels.add(score);

score.position.set(0, 2, 0);
score.rotation.y = Math.PI / 4;
```

Compose typed spans without managing UTF-16 ranges by hand:

```ts
score.text = txt`
  Player ${span({ font: noto })`Two`}
`;
```

The Three entry point re-exports the renderer-neutral `txt` and `span` helpers from `@pmndrs/text`. A plain string remains
valid anywhere a formatted text literal is accepted.

An unattached `Text` stores desired state without shaping. When it is added, the nearest `TextGroup` allocates it before the
first shape and render. Moving it to another group removes its old paragraph allocation and adds a new allocation while
retaining the same `Text` object, properties, and transform.

```ts
score.text = 'First value';
score.text = 'Second value';
score.text = 'Player 2';

renderer.render(scene, camera); // shapes only "Player 2"
```

One `TextGroup` is one intentional text render phase. Create separate groups for separate scenes, renderer lifetimes, or
places where non-text draws must appear between text draws. Every `Text` owns its `Font` or `FontStack`; every effective
font must use the group's rendering technique.

## Control batch render order

A `TextGroup` is an `Object3D`, so its draw submissions naturally retain the nearest parent Three `Group` order:

```ts
const hud = new THREE.Group();
hud.renderOrder = 100;

const labels = new TextGroup({ technique: mtsdf });

hud.add(labels); // submissions use groupOrder 100
scene.add(hud);
```

Set the batch's secondary render-order base through the ordinary Three property:

```ts
labels.renderOrder = 10;
```

Core sorts each `Text.renderOrder` inside the batch. The integration assigns the ordered physical submissions consecutive Three render orders beginning at `TextGroup.renderOrder`. Use separate `TextGroup`s when unrelated Three draws must appear between text submissions.

## Integrate core into another engine

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

### Load, shape, and render

```ts
import { createFontStack, createTextRuntime } from '@pmndrs/text';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const runtime = await createTextRuntime({
  async: {
    createWorker: () => new Worker(new URL('./text-worker.js', import.meta.url)),
  },
});

const inter = await runtime.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: mtsdf },
});
const noto = await runtime.loadFont({
  input: { baked: '/fonts/NotoSans.font.glb' },
  raster: { technique: mtsdf },
});

const uiFont = createFontStack(inter, noto);

const paragraphs = runtime.createParagraphBatch({
  technique: mtsdf,
  capacity: { paragraphs: 1_000, glyphs: 20_000, overflow: 'chunk' },
});

const label = paragraphs.add({
  font: uiFont,
  text: 'Player 1',
});
```

Change desired state, then choose the synchronization boundary explicitly:

```ts
label.text = 'Player 2';

const revision = runtime.update();
// or: const outcome = await runtime.updateAsync();
```

Core returns technique-specific canonical CPU storage, exact dirty ranges, and ordered submissions. An integration maps
those ranges into its own buffers but never reshapes, re-sorts, or rediscovers physical batch membership.

```ts
for (const batch of revision.paragraphBatches) {
  for (const glyphBatch of batch.glyphBatches) {
    target.upload(glyphBatch.storage, glyphBatch.dirtyRanges);
  }

  for (const submission of batch.submissions) {
    target.draw(submission.batch, submission.start, submission.count);
  }
}
```

## How Three.js maps to core

Three.js owns the portable objects; applications using the Three surface never touch them:

```ts
FontLoader
  -> lazily initializes and caches core shaping
  -> loads core font + one technique

TextGroup
  -> owns one core ParagraphBatch
  -> owns renderer-specific physical targets

Text
  -> owns desired paragraph state
  -> binds one core Paragraph when attached
  -> remains the transform-bearing Object3D

renderer.render(scene, camera)
  -> reconciles Text membership
  -> synchronizes dirty paragraphs
  -> uploads dirty glyph ranges
  -> submits the core-authored draw order
```

This is the same boundary another engine implements: core shapes, sorts, partitions, allocates, and packs; the integration
owns scene membership, transforms, GPU buffers, render phases, submission, and retirement.

Read the complete [Three.js API](docs/planning/three-api.md), [core API](docs/planning/core-api.md),
[engine integration contract](docs/planning/engine-integration-contract.md), and
[implementation plan](docs/planning/engine-integration-boundary.md).

```sh
mise install
pnpm install
pnpm dev
```

`@pmndrs/text` is ESM-only and MIT licensed.
