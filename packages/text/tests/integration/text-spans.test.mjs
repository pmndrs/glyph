import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createFontStack, createRuntimeShaper, createTextRuntime, FontRegistry, span, txt } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';
import { Text, TextGroup } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

const interUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const devanagariUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb',
  import.meta.url,
);

const BLUE = [0, 0, 1, 1];
const RED = [1, 0, 0, 1];
const GREEN = [0, 1, 0, 1];
const WHITE = [1, 1, 1, 1];

test('a style-only span inherits the surrounding font while overriding its own shaping style', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  const emphasis = span({ fontSize: 24 });
  const literal = txt`Score ${emphasis`99`} pts`;
  assert.equal(literal.text, 'Score 99 pts');
  assert.deepEqual(literal.spans, [{ start: 6, end: 8, style: { fontSize: 24 } }]);

  const formatted = batch.add({ font: inter, text: literal, paint: { color: '#0000ff' } });
  const unformatted = batch.add({ font: inter, text: 'Score 99 pts' });
  runtime.update();

  const layout = formatted.committed.layout;
  assert.deepEqual([...layout.fontHandles], [inter.font.handle], 'a style-only span must select no further font');
  assert.deepEqual(
    [...layout.glyphFontSlots],
    Array.from({ length: 12 }, () => 0),
  );
  assert.deepEqual(
    [...layout.glyphIds],
    [...unformatted.committed.layout.glyphIds],
    'the span must shape from the surrounding font, so its glyph ids must match the unformatted paragraph',
  );
  assert.equal(layout.glyphIds.includes(0), false, 'the inherited font must resolve every glyph');
  assert.deepEqual([...layout.glyphFontSizes], [16, 16, 16, 16, 16, 16, 24, 24, 16, 16, 16, 16]);

  const run = runFor(batch, formatted);
  assert.equal(run.count, 10, 'the ten visible glyphs of "Score 99 pts" must become one contiguous run');
  assert.deepEqual(
    glyphColors(batch, run),
    Array.from({ length: 10 }, () => BLUE),
    'a span that states no paint must inherit the paragraph paint instead of resetting it',
  );

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('nested spans compose inner formatting over the enclosing span across exact UTF-16 ranges', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  const outer = span({ fontSize: 24, color: '#ff0000' });
  const inner = span({ fontSize: 12, color: '#00ff00' });
  const literal = txt`a${outer`b${inner`c`}d`}e`;
  assert.equal(literal.text, 'abcde');
  assert.deepEqual(literal.spans, [
    { start: 1, end: 4, style: { fontSize: 24 }, paint: { color: '#ff0000' } },
    { start: 2, end: 3, style: { fontSize: 12 }, paint: { color: '#00ff00' } },
  ]);

  const nested = batch.add({ font: inter, text: literal });
  runtime.update();
  assert.deepEqual(
    [...nested.committed.layout.glyphFontSizes],
    [16, 24, 12, 24, 16],
    'the inner span must override the enclosing span on the range they share',
  );
  assert.deepEqual(glyphColors(batch, runFor(batch, nested)), [WHITE, RED, GREEN, RED, WHITE]);

  // An astral character occupies two UTF-16 code units, so composed ranges are
  // only correct when they count code units rather than code points.
  const astral = txt`🎯${inner`hit`}`;
  assert.equal(astral.text, '🎯hit');
  assert.equal(astral.text.length, 5);
  assert.deepEqual(astral.spans, [{ start: 2, end: 5, style: { fontSize: 12 }, paint: { color: '#00ff00' } }]);

  const surrogate = batch.add({ font: inter, text: astral });
  runtime.update();
  assert.deepEqual([...surrogate.committed.layout.clusters], [0, 2, 3, 4]);
  assert.deepEqual([...surrogate.committed.layout.glyphFontSizes], [16, 12, 12, 12]);

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('a tuple-extended format binds the same span as the direct call', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  const alertStyle = { color: '#ff0000', fontSize: 24 };
  const alertFormat = [inter, alertStyle];
  const spread = span(...alertFormat);
  const direct = span(inter, alertStyle);

  const spreadLiteral = txt`Alert ${spread`now`}`;
  const directLiteral = txt`Alert ${direct`now`}`;
  assert.deepEqual(spreadLiteral, directLiteral);
  assert.deepEqual(spreadLiteral.spans, [
    { start: 6, end: 9, font: inter, style: { fontSize: 24 }, paint: { color: '#ff0000' } },
  ]);

  const spreadParagraph = batch.add({ font: inter, text: spreadLiteral });
  const directParagraph = batch.add({ font: inter, text: directLiteral });
  runtime.update();

  const spreadLayout = spreadParagraph.committed.layout;
  const directLayout = directParagraph.committed.layout;
  assert.deepEqual([...spreadLayout.glyphIds], [...directLayout.glyphIds]);
  assert.deepEqual([...spreadLayout.glyphFontSizes], [16, 16, 16, 16, 16, 16, 24, 24, 24]);
  assert.deepEqual([...spreadLayout.glyphFontSizes], [...directLayout.glyphFontSizes]);
  assert.equal(spreadLayout.width, directLayout.width);
  assert.deepEqual(
    glyphColors(batch, runFor(batch, spreadParagraph)),
    glyphColors(batch, runFor(batch, directParagraph)),
  );

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('a plain string stays valid wherever a formatted literal is accepted', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  const emphasis = span({ fontSize: 24 });
  const interpolated = txt`before ${'middle'} after`;
  assert.equal(interpolated.text, 'before middle after');
  assert.deepEqual(interpolated.spans, [], 'an interpolated string carries no formatting of its own');

  const insideSpan = txt`x${emphasis`plain ${'value'}`}y`;
  assert.equal(insideSpan.text, 'xplain valuey');
  assert.deepEqual(insideSpan.spans, [{ start: 1, end: 12, style: { fontSize: 24 } }]);

  const literalParagraph = batch.add({ font: inter, text: txt`Score ${emphasis`99`} pts` });
  const stringParagraph = batch.add({ font: inter, text: 'Score 99 pts' });
  runtime.update();
  assert.deepEqual(
    [...stringParagraph.committed.layout.glyphFontSizes],
    Array.from({ length: 12 }, () => 16),
  );
  assert.deepEqual([...literalParagraph.committed.layout.glyphIds], [...stringParagraph.committed.layout.glyphIds]);

  // Replacement content owns its formatting, so a plain string must clear the
  // spans of the literal it replaces rather than reinterpret them.
  literalParagraph.text = 'Tally';
  runtime.update();
  assert.deepEqual(literalParagraph.spans, []);
  assert.equal(literalParagraph.committed.layout.glyphIds.length, 5);
  assert.deepEqual([...literalParagraph.committed.layout.glyphFontSizes], [16, 16, 16, 16, 16]);
  assert.equal(batch.preparationError, undefined);

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('Three Text shapes and draws a formatted literal through the real render lifecycle', async () => {
  const runtime = await createBitmapRuntime();
  const [inter, devanagari] = await Promise.all([loadInter(runtime), loadDevanagari(runtime)]);

  const scene = new THREE.Scene();
  const group = new TextGroup({ technique: bitmap });
  const warning = span(devanagari, { color: '#ff00ff', fontSize: 18 });
  const label = new Text({ font: createFontStack(inter, devanagari), text: txt`Alert ${warning`देव`}!` });
  group.add(label);
  scene.add(group);

  assert.equal(label.bound, false, 'constructing a formatted Text must not shape eagerly');
  scene.updateMatrixWorld();
  assert.equal(label.bound, true);
  assert.equal(label.text, 'Alert देव!');
  assert.deepEqual(
    label.spans.map(({ start, end, font, style, paint }) => ({ start, end, font, style, paint })),
    [{ start: 6, end: 9, font: devanagari, style: { fontSize: 18 }, paint: { color: '#ff00ff' } }],
  );

  const layout = label.layout;
  assert.deepEqual([...layout.fontHandles], [inter.font.handle, devanagari.font.handle]);
  assert.deepEqual(
    [...layout.glyphFontSlots],
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 0],
    'only the span range may shape from the span font',
  );
  assert.deepEqual([...layout.glyphFontSizes], [16, 16, 16, 16, 16, 16, 18, 18, 18, 16]);
  assert.deepEqual([...layout.clusters], [0, 1, 2, 3, 4, 5, 6, 6, 8, 9]);
  assert.equal(layout.glyphIds.includes(0), false, 'every span glyph must resolve in its selected font');

  const draws = label.children.filter((child) => child.isMesh);
  assert.deepEqual(
    draws.map((mesh) => [mesh.userData.pmndrsTextRunStart, mesh.geometry.instanceCount]),
    [
      [0, 5],
      [0, 3],
      [5, 1],
    ],
    'the span font must split the drawn glyph ranges around the surrounding font',
  );
  assert.equal(group.error, undefined);

  // A plain string replaces the literal and its spans through the same setter.
  label.text = 'Alert';
  scene.updateMatrixWorld();
  assert.deepEqual(label.spans, []);
  assert.deepEqual([...label.layout.fontHandles], [inter.font.handle]);
  assert.equal(label.layout.glyphIds.length, 5);
  assert.equal(group.error, undefined);
  assert.deepEqual(
    label.children.filter((child) => child.isMesh).map((mesh) => mesh.geometry.instanceCount),
    [5],
  );

  group.dispose();
  label.removeFromParent();
  label.dispose();
  inter.dispose();
  devanagari.dispose();
  runtime.dispose();
});

async function createBitmapRuntime() {
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  return createTextRuntime({ registry, shaper });
}

function loadInter(runtime) {
  return loadBitmapFont(runtime, interUrl);
}

function loadDevanagari(runtime) {
  return loadBitmapFont(runtime, devanagariUrl);
}

async function loadBitmapFont(runtime, url) {
  return runtime.loadFont({
    input: { baked: dataUrl(await readFile(url)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
}

function runFor(batch, paragraph) {
  const run = batch.current.glyphRuns.find((entry) => entry.paragraph === paragraph.id);
  if (run === undefined) throw new Error('the published revision has no run for the paragraph');
  return run;
}

function glyphColors(batch, run) {
  const physical = batch.current.glyphBatches.find((entry) => entry.key === run.batch);
  if (physical === undefined) throw new Error('the published revision has no physical batch for the run');
  const colors = [];
  for (let index = 0; index < run.count; index += 1) {
    colors.push([...physical.storage.colors.slice((run.start + index) * 4, (run.start + index + 1) * 4)]);
  }
  return colors;
}

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
