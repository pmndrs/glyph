import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Scene } from 'three/webgpu';

import { FontLoadError, glyph } from '@pmndrs/glyph';
import { id } from '@pmndrs/glyph/config/codec';
import { defineGlyphConfig, defineGlyphSchema, resourceLease } from '@pmndrs/glyph/config/glyph';
import { createRasterCodecProgram } from '@pmndrs/glyph/config/raster';
import { defineCodecBuffers } from '@pmndrs/glyph/config/schema';
import { bitmap as portableBitmap, bitmapPlanProgram } from '@pmndrs/glyph/raster/bitmap';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import { defineThreeConfig, ThreeConfig } from '@pmndrs/glyph/three';
import '../support/browser-globals.mjs';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const bytes = await readFile(fontUrl);
const multiFormatBytes = await readFile(
  new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
);
const portableCapabilities = Object.freeze({
  capabilities: Object.freeze(['storage-buffers', 'alias-vec2', 'alias-vec4', 'ordered-direct']),
  maxBufferBytes: 1024 * 1024,
  updateAlignment: 4,
  coalesceGapBytes: 64,
  rangeCallPenaltyBytes: 128,
  maxBuffersPerDraw: 4,
  maxResourcesPerDraw: 4,
  maxIndirectDraws: 0,
  fragmentationBudget: 4,
  wholeBufferThresholdBasisPoints: 7_500,
});
const portableSystemBuffers = defineCodecBuffers({
  stableGlyphId: {
    id: id.buffer('test.font-face-portable-config/stable-glyph'),
    scalar: 'u32',
    lanes: ['stableGlyphId'],
  },
});
await glyph.init();

function defineFontAwareConfig() {
  const schema = defineGlyphSchema({
    drawRoot: () => undefined,
    program: () => ({}),
    buffer: () => ({}),
    material: () => ({}),
    transform: () => ({}),
    batch: () => ({}),
    instance: () => ({}),
    instanceSpan: () => ({}),
  });
  return defineGlyphConfig({
    schema,
    fonts: { default: 'bitmap', formats: { bitmap: portableBitmap } },
    encode: ({ ids }) => ({
      descriptor: {
        capabilitySets: [portableCapabilities],
        programs: [
          createRasterCodecProgram(bitmapPlanProgram, {
            namespace: 'font-face-test',
            system: portableSystemBuffers,
            capabilitySet: portableCapabilities,
            transformMode: 'direct',
            allocationMode: 'ordered',
            ids,
          }),
        ],
      },
    }),
    resolve: ({ payload }) => resourceLease({ payload }, () => undefined),
    renderer: () => ({
      decode: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
      syncTransforms: () => undefined,
      dispose: () => undefined,
    }),
    root: {
      create: (context) => {
        assert.ok(context.fonts, 'a config with font formats receives its runtime-owned font store');
        return context.create(
          { acquireFont: (selection) => context.fonts.acquire(selection) },
          { boundary: undefined },
        );
      },
    },
  });
}

test('FontFace rejects legacy loader and unowned source/config forms at its public boundary', () => {
  assert.throws(
    () => glyph.fontFace({ baked: '/fonts/legacy.font.glb' }),
    /FontFace source must be a URL, Blob, or SerializedFontFace/,
  );
  assert.throws(
    () => glyph.fontFace(new Request('https://glyph.invalid/legacy.font.glb')),
    /FontFace source must be a URL, Blob, or SerializedFontFace/,
  );
  assert.throws(() => glyph.fontFace(new ArrayBuffer(0)), /FontFace source must be a URL, Blob, or SerializedFontFace/);
  assert.throws(
    () => glyph.fontFace('/fonts/config.font.glb', { src: '/fonts/other.font.glb' }),
    /FontFace config only accepts family and format/,
  );
  assert.throws(
    () => glyph.fontFace('/fonts/no-formats.font.glb', { format: [] }),
    /FontFace format array must not be empty/,
  );
});

test('disposing a pending FontFace aborts its load and immediately releases its family alias', async () => {
  const originalFetch = globalThis.fetch;
  const started = Promise.withResolvers();
  let requestSignal;
  globalThis.fetch = async (_input, init) => {
    requestSignal = init?.signal;
    started.resolve();
    return new Promise((_resolve, reject) => {
      requestSignal.addEventListener('abort', () => reject(requestSignal.reason), { once: true });
    });
  };
  const source = new URL('https://glyph.invalid/pending-font-face.font.glb');
  const face = glyph.fontFace(source, {
    family: 'PendingFontFace',
    format: bitmap({ strikes: [16] }),
  });
  try {
    const pending = face.bitmap.load();
    await started.promise;
    face.dispose();
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(pending, (error) => error instanceof DOMException && error.name === 'AbortError');
    const replacement = glyph.fontFace(source, {
      family: 'PendingFontFace',
      format: bitmap({ strikes: [16] }),
    });
    replacement.dispose();
  } finally {
    face.dispose();
    globalThis.fetch = originalFetch;
  }
});

test('a failed exact-format load is evicted so a later call receives a fresh Promise', async () => {
  const originalFetch = globalThis.fetch;
  const source = new URL('https://glyph.invalid/retry-font-face.font.glb');
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(requests === 1 ? new Uint8Array([0, 1, 2, 3]) : bytes);
  };
  const face = glyph.fontFace(source, {
    family: 'RetryFontFace',
    format: bitmap({ strikes: [16] }),
  });
  try {
    const failed = face.bitmap.load();
    assert.equal(face.bitmap.load(), failed);
    await assert.rejects(failed);
    const retry = face.bitmap.load();
    assert.notEqual(retry, failed);
    assert.equal(await retry, face.bitmap);
    assert.equal(face.bitmap.load(), retry);
    assert.equal(requests, 2);
  } finally {
    face.dispose();
    globalThis.fetch = originalFetch;
  }
});

test('Glyph owns FontFace loading for a non-Three configured handle', async () => {
  const handle = glyph.handle('font-face:portable-config', defineFontAwareConfig());
  const face = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'FontFacePortableConfig',
    format: portableBitmap({ strikes: [16] }),
  });
  try {
    const load = face.load();
    assert.equal(face.load(), load);
    await load;
    const font = handle.acquireFont(face);
    assert.equal(font.raster, portableBitmap);
    font.dispose();
  } finally {
    face.dispose();
    handle.dispose();
  }
});

test('a packaged config factory honors spread overrides and releases a handle created before failure', () => {
  const base = defineFontAwareConfig();
  let releases = 0;
  const failing = {
    ...base,
    root: {
      create(context) {
        context.create({}, { boundary: undefined, dispose: () => (releases += 1) });
        throw new Error('intentional config factory failure');
      },
    },
  };

  assert.throws(() => glyph.handle('font-face:factory-failure', failing), /intentional config factory failure/);
  assert.equal(releases, 1, 'the root operation releases partially constructed handle state exactly once');

  const reused = glyph.handle('font-face:factory-failure', base);
  reused.dispose();
});

test('a loaded FontFace constructs an imperative Three Text and owns its hidden Font lease', async () => {
  const handle = glyph.handle('three:font-face-imperative', ThreeConfig);
  const face = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceImperative',
    format: bitmap({ strikes: [16] }),
  });
  try {
    assert.equal(face.default, face);
    assert.notEqual(face.bitmap, face, 'the aggregate face and exact format selection have distinct load scopes');
    assert.equal(face.bitmap, face.bitmap, 'declared format members have stable identity');
    assert.equal(face.isLoaded(), false);
    assert.equal(face.bitmap.isLoaded(), false);
    assert.throws(
      () => handle.createText({ font: face, text: 'too early' }),
      (error) => error instanceof FontLoadError && error.code === 'FONT_FACE_FORMAT_NOT_LOADED',
    );

    const load = face.load();
    assert.equal(face.load(), load, 'concurrent callers share one FontFace load operation');
    assert.equal(await load, face);
    assert.equal(face.load(), load, 'a loaded FontFace keeps the same settled promise');
    assert.equal(face.isLoaded(), true);
    assert.equal(face.bitmap.isLoaded(), true);
    const text = handle.createText({ font: face, text: 'loaded' });
    const mountedFont = text.font;
    const scene = new Scene();
    scene.add(text);
    assert.equal(text.parent, scene);
    assert.equal(mountedFont.raster, bitmap);

    face.dispose();
    assert.equal(mountedFont.disposed, false, 'Text retains its independent mounted Font lease');
    text.dispose();
    assert.equal(mountedFont.disposed, true);
  } finally {
    face.dispose();
    handle.dispose();
  }
});

test('an undeclared FontFace load discovers every authoritative format for different handle defaults', async () => {
  const msdfHandle = glyph.handle('three:font-face-default-msdf', ThreeConfig);
  const slugHandle = glyph.handle('three:font-face-default-slug', defineThreeConfig({ defaultFontFormat: 'slug' }));
  const face = glyph.fontFace(new Blob([multiFormatBytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceHandleDefaults',
  });
  let msdfText;
  let slugText;
  try {
    assert.equal(face.isLoaded(), false);
    const load = face.load();
    assert.equal(face.load(), load);
    assert.equal(await load, face);
    assert.equal(face.isLoaded(), true);
    msdfText = msdfHandle.createText({ font: face, text: 'MSDF default' });
    slugText = slugHandle.createText({ font: face, text: 'Slug default' });
    assert.equal(msdfText.font.raster, msdf);
    assert.equal(slugText.font.raster, slug);
  } finally {
    msdfText?.dispose();
    slugText?.dispose();
    face.dispose();
    msdfHandle.dispose();
    slugHandle.dispose();
  }
});

test('formats() preserves its successful Promise and reports authoritative format order', async () => {
  const face = glyph.fontFace(new Blob([multiFormatBytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceFormatInspection',
  });
  try {
    const operation = face.formats();
    assert.equal(face.formats(), operation);
    const formats = await operation;
    assert.deepEqual(formats, ['bitmap', 'msdf', 'slug']);
    assert.equal(Object.isFrozen(formats), true);
    assert.equal(await face.formats(), formats);
    assert.equal(face.formats(), operation);
  } finally {
    face.dispose();
  }
});

test('formats() retries after failed main-font inspection', async () => {
  const originalFetch = globalThis.fetch;
  const source = new URL(`https://glyph.invalid/font-face-formats-${Date.now()}.font.glb`);
  let requests = 0;
  globalThis.fetch = async (input) => {
    assert.equal(new URL(input instanceof Request ? input.url : input).href, source.href);
    requests += 1;
    return new Response(requests === 1 ? new Uint8Array([0, 1, 2, 3]) : multiFormatBytes);
  };
  const face = glyph.fontFace(source, { family: 'FontFaceFormatInspectionRetry' });
  try {
    const failed = face.formats();
    assert.equal(face.formats(), failed);
    await assert.rejects(failed);
    const retry = face.formats();
    assert.notEqual(retry, failed);
    const formats = await retry;
    assert.deepEqual(formats, ['bitmap', 'msdf', 'slug']);
    assert.equal(face.formats(), retry);
    assert.equal(await face.formats(), formats);
    assert.equal(requests, 2);
  } finally {
    face.dispose();
    globalThis.fetch = originalFetch;
  }
});

test('FontFace family aliases reject collisions and Blob declarations load through the shared library', async () => {
  const handle = glyph.handle('three:font-face-blob', ThreeConfig);
  const first = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceBlob',
    format: bitmap({ strikes: [16] }),
  });
  try {
    assert.throws(() => glyph.fontFace('/other.font.glb', { family: 'FontFaceBlob' }), /already exists/);
    await first.load();
    const text = handle.createText({ font: 'FontFaceBlob', text: 'blob' });
    assert.equal(text.font.raster, bitmap);
    text.dispose();
  } finally {
    first.dispose();
    handle.dispose();
  }
});

test('a declared format member loads narrowly before the aggregate FontFace', async () => {
  const msdfHandle = glyph.handle('three:font-face-narrow-msdf', ThreeConfig);
  const slugHandle = glyph.handle('three:font-face-narrow-slug', defineThreeConfig({ defaultFontFormat: 'slug' }));
  const face = glyph.fontFace(new Blob([multiFormatBytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceNarrowLoad',
    format: [msdf, slug],
  });
  let slugText;
  let msdfText;
  try {
    const load = face.slug.load();
    assert.equal(face.slug.load(), load, 'a format member keeps one stable successful Promise');
    assert.equal(await load, face.slug);
    assert.equal(face.slug.isLoaded(), true);
    assert.equal(face.msdf.isLoaded(), false);
    assert.equal(face.isLoaded(), false, 'the aggregate is not loaded until every declaration is ready');
    assert.throws(
      () => msdfHandle.createText({ font: face, text: 'default is still unloaded' }),
      (error) => error instanceof FontLoadError && error.code === 'FONT_FACE_FORMAT_NOT_LOADED',
    );
    slugText = slugHandle.createText({ font: face.slug, text: 'exact Slug selection' });
    assert.equal(slugText.font.raster, slug);

    assert.equal(await face.load(), face);
    assert.equal(face.isLoaded(), true);
    assert.equal(face.msdf.isLoaded(), true);
    msdfText = msdfHandle.createText({ font: face, text: 'aggregate default' });
    assert.equal(msdfText.font.raster, msdf);
  } finally {
    msdfText?.dispose();
    slugText?.dispose();
    face.dispose();
    msdfHandle.dispose();
    slugHandle.dispose();
  }
});

test('an explicit FontFace clone transfers one selected format without invalidating its source', async () => {
  const source = glyph.fontFace(new Blob([multiFormatBytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceTransferSource',
    format: [msdf, slug],
  });
  let serialized;
  try {
    const [snapshot, transfer] = await source.slug.clone();
    serialized = structuredClone(snapshot, { transfer });

    assert.equal(source.slug.isLoaded(), true);
    assert.equal(source.msdf.isLoaded(), false, 'an exact clone does not load sibling formats');
    assert.deepEqual(
      snapshot.rasters.map(({ kind }) => kind),
      ['slug'],
    );
    assert.equal(snapshot.data.byteLength, 0, 'posting the copied snapshot detaches only its transfer buffers');
    assert.equal(source.slug.isLoaded(), true, 'transferring the clone leaves the originating FontFace intact');
  } finally {
    source.dispose();
  }

  const receivedMainData = serialized.data;
  const received = glyph.fontFace(serialized, {
    family: 'FontFaceTransferReceiver',
    format: slug,
  });
  const handle = glyph.handle('three:font-face-transfer', defineThreeConfig({ defaultFontFormat: 'slug' }));
  let text;
  try {
    assert.equal(receivedMainData.byteLength, 0, 'glyph.fontFace() claims the received buffers into private ownership');
    assert.equal(await received.slug.load(), received.slug);
    text = handle.createText({ font: received.slug, text: 'transferred' });
    assert.equal(text.font.raster, slug);
  } finally {
    text?.dispose();
    received.dispose();
    handle.dispose();
  }
});

test('a declared format rejects when the authoritative font does not implement it', async () => {
  const face = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceMissingDeclaredTechnique',
    format: slug,
  });
  try {
    await assert.rejects(
      face.slug.load(),
      (error) =>
        error instanceof FontLoadError &&
        error.code === 'FONT_FACE_FORMAT_UNAVAILABLE' &&
        /does not implement the declared/.test(error.message),
    );
    assert.equal(face.slug.isLoaded(), false);
    assert.equal(face.isLoaded(), false);
  } finally {
    face.dispose();
  }
});
