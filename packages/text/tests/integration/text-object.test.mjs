import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFontBaker } from '@pmndrs/text-font-baker';
import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';
import { bitmapBakerFromCore, createBitmapBaker } from '@pmndrs/text/bakers/bitmap';
import { FontLoader, FontRegistry, RasterRuntime, Text, defineRaster } from '../../dist/index.js';
import {
  bitmap,
  bitmapDescriptor,
  bitmapRasterKey,
  captureBitmapGlyphPositions,
  createBitmapGlyphPositionTransition,
} from '../../dist/raster/bitmap.js';
import { composeFontBake } from '../../dist/internal/compose-bake.js';

const fixtureUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const shaperUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);

test('Text commits layout and draw generations atomically', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const layouts = [];
  const text = new Text({
    text: 'office AVATAR',
    spans: [{ start: 0, end: 6, color: 0xff0000 }],
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    onLayout: (layout) => layouts.push(layout),
  });
  try {
    assert.equal(text.children.length, 0);
    await text.ready;
    assert.equal(text.children.length, 1);
    assert.equal(text.layout, layouts[0]);
    assert.ok((text.layout?.glyphIds.length ?? 0) > 0);

    const initialLayout = text.layout;
    const initialBatch = text.children[0];
    text.setProperties({ opacity: 0.5 });
    await text.ready;
    assert.equal(text.layout, initialLayout, 'paint-only updates retain the committed layout');
    assert.equal(text.children[0], initialBatch, 'paint-only updates retain the draw batch');

    text.setProperties({
      text: 'office AVATAR',
      spans: [{ start: 0, end: 6, color: 0x0000ff }],
    });
    await text.ready;
    assert.equal(text.layout, initialLayout, 'span-color updates retain the committed layout');
    assert.equal(text.children[0], initialBatch, 'span-color updates retain the draw batch');

    text.setProperties({ width: 72 });
    await text.ready;
    assert.notEqual(text.layout, initialLayout, 'constraint updates commit a new layout');
    assert.equal(text.children.length, 1);
    assert.equal(text.children[0], initialBatch, 'compatible bitmap reflow retains the draw batch');

    const narrowLayout = text.layout;
    text.setProperties({ fontSize: 18 });
    await text.ready;
    assert.notEqual(text.layout, narrowLayout, 'font-size updates reshape and commit a new layout');
    assert.equal(text.children[0], initialBatch, 'same-strike bitmap font-size updates retain the draw batch');

    text.setProperties({ text: 'first update' });
    const supersededReady = text.ready;
    text.setProperties({ text: 'second update' });
    await assert.rejects(supersededReady, { name: 'AbortError' });
    await text.ready;
    assert.equal(text.layout?.glyphIds.length, 13);

    const committedLayout = text.layout;
    assert.throws(() => text.setProperties({ spans: [] }), /requires text/);
    assert.equal(text.layout, committedLayout, 'invalid patches cannot mutate committed state');
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
  assert.equal(text.children.length, 0);
  await assert.rejects(text.ready, { name: 'AbortError' });
  assert.throws(() => text.setProperties({ opacity: 1 }), /disposed/);
});

test('Text no-op updates preserve one pending initial generation', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const request = bitmap({ strikes: [16] });
  const decodeStarted = Promise.withResolvers();
  const releaseDecode = Promise.withResolvers();
  let decodeCount = 0;
  let decodeSignal;
  const raster = defineRaster({
    ...request.module,
    async decode(...arguments_) {
      decodeCount += 1;
      decodeSignal = arguments_[2];
      decodeStarted.resolve();
      await releaseDecode.promise;
      decodeSignal?.throwIfAborted();
      return request.module.decode(...arguments_);
    },
  });
  const text = new Text({
    text: 'one cold generation',
    font,
    raster: { module: raster, options: request.options },
    fontSize: 16,
    opacity: 0.5,
  });
  try {
    const initialReady = text.ready;
    await decodeStarted.promise;
    text.setProperties({});
    text.setProperties({ opacity: 0.5 });

    assert.equal(text.ready, initialReady, 'semantic no-ops retain the original readiness observation');
    assert.equal(decodeCount, 1, 'semantic no-ops do not restart raster decoding');
    assert.equal(decodeSignal?.aborted, false, 'semantic no-ops do not abort the pending generation');

    releaseDecode.resolve();
    await initialReady;
    assert.equal(text.children.length, 1);
    assert.equal(decodeCount, 1);
  } finally {
    releaseDecode.resolve();
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('bitmap glyph-position transitions preserve authoritative layouts and pixel-snap inputs', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const text = new Text({
    text: 'AVATAR office wraps across lines',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    width: 280,
  });
  try {
    await text.ready;
    const wideObject = text.children[0];
    assert.ok(wideObject);
    const wideOrigins = bitmapOrigins(wideObject);
    const wideSnapshot = captureBitmapGlyphPositions(wideObject);

    text.setProperties({ width: 104 });
    await text.ready;
    const narrowObject = text.children[0];
    const narrowLayout = text.layout;
    assert.ok(narrowObject);
    assert.ok(narrowLayout);
    const targetOrigins = bitmapOrigins(narrowObject);
    const targetX = narrowLayout.x.slice();
    const targetY = narrowLayout.y.slice();
    const transition = createBitmapGlyphPositionTransition(narrowObject, wideSnapshot);
    assert.equal(transition.targetGlyphs, targetOrigins.length / 2);
    assert.equal(transition.matchedGlyphs, transition.targetGlyphs);

    transition.setProgress(0);
    assert.deepEqual(bitmapOrigins(narrowObject), wideOrigins);
    transition.setProgress(0.5);
    assert.deepEqual(bitmapOrigins(narrowObject), lerpedOrigins(wideOrigins, targetOrigins, 0.5));
    assert.deepEqual(narrowLayout.x, targetX);
    assert.deepEqual(narrowLayout.y, targetY);
    assert.throws(() => transition.setProgress(Number.NaN), /progress must be in \[0, 1\]/);

    const midpointOrigins = bitmapOrigins(narrowObject);
    const midpointSnapshot = captureBitmapGlyphPositions(narrowObject);
    transition.dispose();
    text.setProperties({ width: 156 });
    await text.ready;
    const finalObject = text.children[0];
    assert.ok(finalObject);
    const finalTargetOrigins = bitmapOrigins(finalObject);
    const continued = createBitmapGlyphPositionTransition(finalObject, midpointSnapshot);
    continued.setProgress(0);
    assert.deepEqual(bitmapOrigins(finalObject), midpointOrigins);
    continued.finish();
    continued.finish();
    assert.deepEqual(bitmapOrigins(finalObject), finalTargetOrigins);

    const liveSnapshot = captureBitmapGlyphPositions(finalObject);
    const stale = createBitmapGlyphPositionTransition(finalObject, liveSnapshot);
    text.dispose();
    assert.throws(() => stale.setProgress(0.5), { name: 'AbortError' });
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('bitmap glyph-position transitions leave unmatched target glyphs authoritative', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const text = new Text({
    text: 'A',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
  });
  try {
    await text.ready;
    const sourceObject = text.children[0];
    assert.ok(sourceObject);
    const sourceSnapshot = captureBitmapGlyphPositions(sourceObject);
    assert.equal(sourceSnapshot.glyphCount, 1);

    text.setProperties({ text: 'office' });
    await text.ready;
    const targetObject = text.children[0];
    assert.ok(targetObject);
    const targetOrigins = bitmapOrigins(targetObject);
    const transition = createBitmapGlyphPositionTransition(targetObject, sourceSnapshot);
    assert.equal(transition.matchedGlyphs, 0);
    assert.ok(transition.targetGlyphs > 0);
    transition.setProgress(0);
    assert.deepEqual(bitmapOrigins(targetObject), targetOrigins);
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('disposing Text rejects both pending and subsequent ready observations', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const text = new Text({
    text: 'cancel a paragraph-reusing constraint update',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
  });
  try {
    await text.ready;
    text.setProperties({ width: 120 });
    const pending = text.ready;
    text.dispose();
    await assert.rejects(pending, { name: 'AbortError' });
    await assert.rejects(text.ready, { name: 'AbortError' });
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('a cancelled reflow does not claim ownership of its committed paragraph', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const bitmapRequest = bitmap({ strikes: [16] });
  let disposeFontAfterBuild = false;
  const raster = defineRaster({
    ...bitmapRequest.module,
    stageBatchUpdate: undefined,
    buildBatches(...arguments_) {
      const batch = bitmapRequest.module.buildBatches(...arguments_);
      if (disposeFontAfterBuild) {
        disposeFontAfterBuild = false;
        queueMicrotask(() => font.dispose());
      }
      return batch;
    },
  });
  const text = new Text({
    text: 'reuse one committed paragraph',
    font,
    raster: { module: raster, options: bitmapRequest.options },
    fontSize: 16,
  });
  try {
    await text.ready;
    disposeFontAfterBuild = true;
    text.setProperties({ width: 120 });
    const cancelled = text.ready;
    await assert.rejects(cancelled, /font used by this text was disposed/i);
    await assert.rejects(text.ready, /font used by this text was disposed/i);
    assert.equal(text.children.length, 0);
    assert.equal(text.layout, undefined);
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('Text releases the superseded font-disposal listener after every committed reflow', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const subscribe = registry._onFontDispose.bind(registry);
  let activeSubscriptions = 0;
  registry._onFontDispose = (listener) => {
    activeSubscriptions += 1;
    const release = subscribe(listener);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeSubscriptions -= 1;
      release();
    };
  };
  const text = new Text({
    text: 'continuous reflow keeps one live generation listener',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
  });
  try {
    await text.ready;
    const stableSubscriptions = activeSubscriptions;
    assert.ok(stableSubscriptions > 0);
    for (let width = 120; width < 140; width += 1) {
      text.setProperties({ width });
      await text.ready;
      assert.equal(activeSubscriptions, stableSubscriptions);
    }
    text.dispose();
    assert.equal(activeSubscriptions, stableSubscriptions - 1);
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('Text validates feature ranges with text updates and treats global empty features as no-ops', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const text = new Text({
    text: 'feature bounds',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    features: [{ tag: 'liga', start: 0, end: 14 }],
  });
  const empty = new Text({
    text: '',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    features: [{ tag: 'liga' }],
  });
  try {
    await Promise.all([text.ready, empty.ready]);
    const committed = text.layout;
    assert.throws(() => text.setProperties({ text: 'ab' }), /feature 0 ends after/);
    assert.equal(text.layout, committed);
    assert.equal(empty.layout?.glyphIds.length, 0);
  } finally {
    text.dispose();
    empty.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('Text skips semantic no-op paint uploads and bitmap rejects unsupported effects', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const bitmapRequest = bitmap({ strikes: [16] });
  let validatedPaint;
  let updatedPaint;
  const raster = defineRaster({
    ...bitmapRequest.module,
    validatePaint(paint) {
      bitmapRequest.module.validatePaint?.(paint);
      validatedPaint = paint;
    },
    updatePaint(batch, paint, fontSlot) {
      updatedPaint = paint;
      bitmapRequest.module.updatePaint(batch, paint, fontSlot);
    },
  });
  const text = new Text({
    text: 'office',
    font,
    raster: { module: raster, options: bitmapRequest.options },
    fontSize: 16,
    features: [{ tag: 'liga' }],
  });
  try {
    await text.ready;
    const batch = text.children[0];
    const mesh = batch?.children[0];
    const colors = mesh?.geometry?.getAttribute('bitmapColor');
    assert.ok(colors);
    const initialVersion = colors.version;
    text.setProperties({ features: [{ tag: 'liga' }], onLayout: () => undefined });
    await text.ready;
    assert.equal(colors.version, initialVersion);
    text.setProperties({ opacity: 0.5 });
    await text.ready;
    assert.equal(updatedPaint, validatedPaint, 'paint validation and upload reuse one resolved glyph-paint value');
    const retainedPaintIndices = updatedPaint.paintIndices;
    text.setProperties({ opacity: 0.75 });
    await text.ready;
    assert.equal(
      updatedPaint.paintIndices,
      retainedPaintIndices,
      'same-range paint updates retain glyph paint indices',
    );
    const versionBeforeRejectedOutline = colors.version;
    assert.throws(
      () => text.setProperties({ outline: { color: '#fff', width: 1 } }),
      /bitmap raster does not support outline or shadow/,
    );
    assert.equal(colors.version, versionBeforeRejectedOutline);
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('disposing a registered font invalidates live Text batches before raster release', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const text = new Text({
    text: 'font lifecycle',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
  });
  try {
    await text.ready;
    assert.equal(text.children.length, 1);
    text.visible = false;
    font.dispose();
    assert.equal(text.children.length, 0);
    assert.equal(text.layout, undefined);
    assert.equal(text.visible, false, 'font lifecycle does not override caller visibility');
    await assert.rejects(text.ready, /font used by this text was disposed/i);
  } finally {
    text.dispose();
    restoreFetch();
  }
});

test('Text rejects a raster batch without the required Three.js lifecycle surface', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const invalidBatchModule = {
    kind: 'bitmap',
    extension: 'PMNDRS_font_bitmap',
    version: 0,
    descriptor() {
      return { generatorVersion: '0.0.0', strikes: [16] };
    },
    async decode() {
      return {};
    },
    async prepare() {},
    buildBatches() {
      return {};
    },
    updatePaint() {},
    dispose() {},
  };
  const text = new Text({
    text: 'invalid batch',
    font,
    raster: { module: invalidBatchModule },
    fontSize: 16,
  });
  try {
    await assert.rejects(text.ready, /invalid draw batch/);
    assert.equal(text.children.length, 0);
  } finally {
    text.dispose();
    font.dispose();
    restoreFetch();
  }
});

test('Text resolves independent raster resources for two fonts in one paragraph', async () => {
  const restoreFetch = installFileFetch();
  const registry = new FontRegistry();
  const [inter, amiriBytes] = await Promise.all([
    registry.registerAsset(await readFile(fixtureUrl)),
    bakeBitmapFont(
      new URL('../../../../apps/benchmarks/fixtures/fonts/amiri-1.002/Amiri-Regular.ttf', import.meta.url),
    ),
  ]);
  const amiri = await registry.registerAsset(amiriBytes);
  const content = 'Latin العربية';
  const text = new Text({
    text: content,
    font: inter,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    spans: [
      {
        start: 6,
        end: content.length,
        font: amiri,
        language: 'ar',
        direction: 'rtl',
      },
    ],
  });
  try {
    await text.ready;
    assert.equal(text.layout?.fontHandles.length, 2);
    assert.equal(text.children.length, 2);
  } finally {
    text.dispose();
    inter.dispose();
    amiri.dispose();
    restoreFetch();
  }
});

test('RasterRuntime authenticates and attaches a raster generated from a source-only font', async () => {
  const sourceUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
  const [source, fontWasm, bitmapWasm] = await Promise.all([
    readFile(sourceUrl),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
    readFile(new URL('../../dist/bitmap_baker.wasm', import.meta.url)),
  ]);
  const core = (await createFontBaker(fontWasm)).bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  });
  const coreBytes = core.artifacts[0].bytes;
  const baker = bitmapBakerFromCore(await createBitmapBaker(bitmapWasm));
  const requestedRaster = bitmap({ strikes: [16] });
  const runtimeRaster = defineRaster({
    ...requestedRaster.module,
    runtimeBaker: async () => ({
      kind: 'bitmap',
      async bake(request) {
        return baker.bake({
          font: {
            source: request.source,
            fontFaceIndex: request.fontFaceIndex,
            glyphCount: request.font.glyphCount,
            shapingHash: request.font.shapingHash,
          },
          rasterKey: request.rasterKey,
          packaging: { artifact: 'embedded', pages: 'embedded' },
          descriptor: bitmapDescriptor(request.options),
          signal: request.signal,
        });
      },
    }),
  });
  const loader = new FontLoader({
    async fetch(input) {
      assert.equal(String(input), sourceUrl.href);
      return new Response(source);
    },
    async runtimeBake() {
      return coreBytes;
    },
  });
  const font = await loader.load({ source: sourceUrl, baked: null });
  const runtime = new RasterRuntime();

  try {
    assert.equal(font.rasterReferences.length, 0);
    const loaded = await runtime.load(font, {
      module: runtimeRaster,
      options: requestedRaster.options,
    });
    assert.equal(loaded.artifact.kind, 'bitmap');
    assert.equal(font.rasterReferences.length, 1);
    assert.equal(font.getRaster(loaded.artifact.rasterKey), loaded.artifact);
  } finally {
    runtime.dispose();
    font.dispose();
  }
});

test('RasterRuntime caches one decoded resource per font and disposes it with its owner', async () => {
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const runtime = new RasterRuntime();
  let decodeCount = 0;
  let disposeCount = 0;
  const module = defineRaster({
    kind: 'bitmap',
    extension: 'PMNDRS_font_bitmap',
    version: 0,
    descriptor() {
      return { generatorVersion: '0.0.0', strikes: [16] };
    },
    async decode() {
      decodeCount += 1;
      return { decodeCount };
    },
    async prepare() {},
    buildBatches() {
      throw new Error('not used by the raster-runtime cache test');
    },
    updatePaint() {},
    dispose() {
      disposeCount += 1;
    },
  });

  const [left, right] = await Promise.all([runtime.load(font, { module }), runtime.load(font, { module })]);
  assert.equal(left.resource, right.resource);
  assert.equal(decodeCount, 1);

  font.dispose();
  await Promise.resolve();
  assert.equal(disposeCount, 1);
  runtime.dispose();
});

test('RasterRuntime rejects and disposes a decode completed after runtime disposal', async () => {
  await assertPendingRasterInvalidation((runtime) => runtime.dispose());
});

test('RasterRuntime rejects and disposes a decode completed after font disposal', async () => {
  await assertPendingRasterInvalidation((_runtime, font) => font.dispose());
});

test('RasterRuntime aborts cooperative pending work when it is disposed', async () => {
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const runtime = new RasterRuntime();
  const decodeStarted = Promise.withResolvers();
  const releaseDecode = Promise.withResolvers();
  const module = rasterRuntimeTestModule({
    async decode(_font, _raster, signal) {
      decodeStarted.resolve(signal);
      await releaseDecode.promise;
      signal?.throwIfAborted();
      return { decoded: true };
    },
  });

  const pending = runtime.load(font, { module });
  const decodeSignal = await decodeStarted.promise;
  runtime.dispose();
  releaseDecode.resolve();

  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(decodeSignal);
  assert.equal(decodeSignal.aborted, true);
  font.dispose();
});

test('RasterRuntime keeps shared work alive when one consumer aborts', async (context) => {
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const runtime = new RasterRuntime();
  const decodeStarted = Promise.withResolvers();
  const releaseDecode = Promise.withResolvers();
  const firstConsumer = new AbortController();
  const retainedConsumer = new AbortController();
  const retainedConsumerAttached = Promise.withResolvers();
  const addEventListener = retainedConsumer.signal.addEventListener;
  context.mock.method(retainedConsumer.signal, 'addEventListener', function (type, listener, options) {
    if (type === 'abort') retainedConsumerAttached.resolve();
    return addEventListener.call(this, type, listener, options);
  });
  let decodeCount = 0;
  const module = rasterRuntimeTestModule({
    async decode(_font, _raster, signal) {
      decodeCount += 1;
      decodeStarted.resolve(signal);
      await releaseDecode.promise;
      signal?.throwIfAborted();
      return { decoded: true };
    },
  });

  const cancelled = runtime.load(font, { module }, { signal: firstConsumer.signal });
  await decodeStarted.promise;
  const retained = runtime.load(font, { module }, { signal: retainedConsumer.signal });
  await retainedConsumerAttached.promise;
  firstConsumer.abort(new DOMException('consumer cancelled', 'AbortError'));
  await assert.rejects(cancelled, { name: 'AbortError' });
  releaseDecode.resolve();

  assert.deepEqual(await retained, await runtime.load(font, { module }));
  assert.equal(decodeCount, 1);
  runtime.dispose();
  font.dispose();
});

test('RasterRuntime aborts shared work after its final consumer detaches', async () => {
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const runtime = new RasterRuntime();
  const decodeStarted = Promise.withResolvers();
  const releaseFirstDecode = Promise.withResolvers();
  const firstDecodeFinished = Promise.withResolvers();
  const consumer = new AbortController();
  let decodeCount = 0;
  const module = rasterRuntimeTestModule({
    async decode(_font, _raster, signal) {
      decodeCount += 1;
      if (decodeCount === 1) {
        decodeStarted.resolve(signal);
        try {
          await releaseFirstDecode.promise;
          signal?.throwIfAborted();
        } finally {
          firstDecodeFinished.resolve();
        }
      }
      return { generation: decodeCount };
    },
  });

  const cancelled = runtime.load(font, { module }, { signal: consumer.signal });
  const sharedSignal = await decodeStarted.promise;
  consumer.abort(new DOMException('consumer cancelled', 'AbortError'));
  await assert.rejects(cancelled, { name: 'AbortError' });

  assert.ok(sharedSignal);
  assert.equal(sharedSignal.aborted, true);
  releaseFirstDecode.resolve();
  await firstDecodeFinished.promise;
  const retained = await runtime.load(font, { module });
  assert.equal(retained.resource.generation, 2);
  assert.equal(decodeCount, 2);
  runtime.dispose();
  font.dispose();
});

test('RasterRuntime replaces a cached resource whose public artifact became stale', async () => {
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const runtime = new RasterRuntime();
  let decodeCount = 0;
  let disposeCount = 0;
  const module = rasterRuntimeTestModule({
    async decode() {
      decodeCount += 1;
      return { generation: decodeCount };
    },
    dispose() {
      disposeCount += 1;
    },
  });

  const first = await runtime.load(font, { module });
  first.artifact.dispose();
  const [second, concurrent] = await Promise.all([runtime.load(font, { module }), runtime.load(font, { module })]);

  assert.notEqual(second.artifact.handle, first.artifact.handle);
  assert.equal(concurrent.resource, second.resource);
  assert.equal(second.resource.generation, 2);
  assert.equal(disposeCount, 1);
  runtime.dispose();
  await Promise.resolve();
  assert.equal(disposeCount, 2);
  font.dispose();
});

async function assertPendingRasterInvalidation(invalidate) {
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(fixtureUrl));
  const runtime = new RasterRuntime();
  const decodeStarted = Promise.withResolvers();
  const releaseDecode = Promise.withResolvers();
  let disposeCount = 0;
  const module = defineRaster({
    kind: 'bitmap',
    extension: 'PMNDRS_font_bitmap',
    version: 0,
    descriptor() {
      return { generatorVersion: '0.0.0', strikes: [16] };
    },
    async decode() {
      decodeStarted.resolve();
      await releaseDecode.promise;
      return { decoded: true };
    },
    async prepare() {},
    buildBatches() {
      throw new Error('not used by the raster-runtime disposal test');
    },
    updatePaint() {},
    dispose() {
      disposeCount += 1;
    },
  });

  const pending = runtime.load(font, { module });
  await decodeStarted.promise;
  invalidate(runtime, font);
  releaseDecode.resolve();

  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(disposeCount, 1);
  runtime.dispose();
  font.dispose();
}

function rasterRuntimeTestModule({ decode, dispose = () => undefined }) {
  return defineRaster({
    kind: 'bitmap',
    extension: 'PMNDRS_font_bitmap',
    version: 0,
    descriptor() {
      return { generatorVersion: '0.0.0', strikes: [16] };
    },
    decode,
    async prepare() {},
    buildBatches() {
      throw new Error('not used by RasterRuntime lifecycle tests');
    },
    updatePaint() {},
    dispose,
  });
}

function bitmapOrigins(object) {
  const values = [];
  for (const mesh of object.children) {
    const attribute = mesh.geometry?.getAttribute('bitmapOrigin');
    assert.ok(attribute);
    values.push(...attribute.array);
  }
  return Float32Array.from(values);
}

function lerpedOrigins(from, to, progress) {
  assert.equal(from.length, to.length);
  return Float32Array.from(from, (value, index) => Math.fround(value + (to[index] - value) * progress));
}

function installFileFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === shaperUrl.href) {
      init?.signal?.throwIfAborted();
      return new Response(await readFile(shaperUrl), { status: 200 });
    }
    return original(input, init);
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function bakeBitmapFont(sourceUrl) {
  const [source, fontWasm, bitmapWasm] = await Promise.all([
    readFile(sourceUrl),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
    readFile(new URL('../../dist/bitmap_baker.wasm', import.meta.url)),
  ]);
  const fontBaker = await createFontBaker(fontWasm);
  const core = fontBaker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  });
  const validation = await validateFontArtifact(core.artifacts[0].bytes);
  const descriptor = bitmapDescriptor({ strikes: [16] });
  const rasterKey = await bitmapRasterKey({ strikes: [16] });
  const bitmapBaker = bitmapBakerFromCore(await createBitmapBaker(bitmapWasm));
  const raster = await bitmapBaker.bake({
    font: {
      source,
      fontFaceIndex: 0,
      glyphCount: validation.glyphCount,
      shapingHash: validation.shapingHash,
    },
    rasterKey,
    packaging: { artifact: 'embedded', pages: 'embedded' },
    descriptor,
  });
  const composed = await composeFontBake(core, [{ raster, packaging: { artifact: 'embedded', pages: 'embedded' } }]);
  return composed.artifacts[0].bytes;
}
