import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  createFontStack,
  createRuntimeShaper,
  createTextRuntime,
  FontRegistry,
  span,
  SpanNestingError,
  txt,
} from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { mtsdf } from '@pmndrs/text/three/mtsdf';
import { Text, TextGroup } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

const interUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const interMtsdfUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/inter-mtsdf.font.glb.gz',
  import.meta.url,
);
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

test('a span keeps every surrounding paint property it does not state', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadMtsdfInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: mtsdf });

  // Each span states exactly one paint property, so the three it omits must
  // survive from the paragraph. "d" carries no span and fixes the inherited
  // values the other three are measured against.
  const paragraph = batch.add({
    font: inter,
    text: 'abcd',
    paint: {
      color: '#ff0000',
      opacity: 0.5,
      outline: { color: '#00ff00', width: 1 },
      shadow: { color: '#0000ff', offset: [1, 2] },
    },
    spans: [
      { start: 0, end: 1, paint: { color: '#ffffff' } },
      { start: 1, end: 2, paint: { opacity: 1 } },
      { start: 2, end: 3, paint: { outline: { color: '#ffffff', width: 1 } } },
    ],
  });
  runtime.update();
  assert.equal(batch.preparationError, undefined);

  const painted = mtsdfGlyphPaint(batch, runFor(batch, paragraph));
  assert.equal(painted.length, 4);
  assert.deepEqual(painted[3], { fill: [1, 0, 0, 0.5], outline: [0, 1, 0, 0.5], shadow: [0, 0, 1, 0.5] });
  assert.deepEqual(
    painted[0],
    { fill: [1, 1, 1, 0.5], outline: [0, 1, 0, 0.5], shadow: [0, 0, 1, 0.5] },
    'a colour-only span must keep the surrounding opacity, outline, and shadow',
  );
  assert.deepEqual(
    painted[1],
    { fill: [1, 0, 0, 1], outline: [0, 1, 0, 1], shadow: [0, 0, 1, 1] },
    'an opacity-only span must keep the surrounding colour, outline, and shadow and re-apply its own opacity to each',
  );
  assert.deepEqual(
    painted[2],
    { fill: [1, 0, 0, 0.5], outline: [1, 1, 1, 0.5], shadow: [0, 0, 1, 0.5] },
    'an outline-only span must keep the surrounding colour, opacity, and shadow',
  );

  // A dropped outline or shadow would leave a zero width and a zero offset, so
  // the geometric parts are asserted as well as the colours.
  const physical = batchFor(batch, runFor(batch, paragraph));
  const first = runFor(batch, paragraph).start;
  const widths = [...physical.storage.outlineWidths.slice(first, first + 4)];
  assert.equal(
    widths.every((value) => value === widths[0] && value > 0),
    true,
    `outline widths were ${widths}`,
  );
  const offsets = [...physical.storage.shadowOffsets.slice(first * 2, (first + 4) * 2)];
  assert.deepEqual(offsets, [
    offsets[0],
    offsets[1],
    offsets[0],
    offsets[1],
    offsets[0],
    offsets[1],
    offsets[0],
    offsets[1],
  ]);
  assert.equal(offsets[0] > 0 && offsets[1] > 0, true, `shadow offsets were ${offsets}`);

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('nested spans merge paint per property from the outermost inward', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  const outer = span({ color: '#00ff00' });
  const inner = span({ opacity: 0.25 });
  const literal = txt`a${outer`b${inner`c`}d`}e`;
  assert.deepEqual(literal.spans, [
    { start: 1, end: 4, paint: { color: '#00ff00' } },
    { start: 2, end: 3, paint: { opacity: 0.25 } },
  ]);

  const paragraph = batch.add({ font: inter, text: literal, paint: { color: '#ff0000', opacity: 0.5 } });
  runtime.update();
  assert.equal(batch.preparationError, undefined);
  assert.deepEqual(
    glyphColors(batch, runFor(batch, paragraph)),
    [
      [1, 0, 0, 0.5],
      [0, 1, 0, 0.5],
      [0, 1, 0, 0.25],
      [0, 1, 0, 0.5],
      [1, 0, 0, 0.5],
    ],
    'the innermost span states only opacity, so it must inherit the colour of the span enclosing it',
  );

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('spans that overlap without nesting are rejected, and nesting order is not load-bearing', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  assert.throws(
    () =>
      batch.add({
        font: inter,
        text: 'abcdef',
        spans: [
          { start: 0, end: 4, paint: { color: '#ff0000' } },
          { start: 2, end: 6, paint: { color: '#00ff00' } },
        ],
      }),
    (error) => {
      assert.equal(error instanceof SpanNestingError, true, `expected a SpanNestingError, received ${error}`);
      assert.equal(error.name, 'SpanNestingError');
      assert.deepEqual(error.enclosing, { index: 0, start: 0, end: 4 });
      assert.deepEqual(error.overlapping, { index: 1, start: 2, end: 6 });
      assert.equal(
        error.message,
        'paragraph spans must be disjoint or nested: span 0 [0, 4) partially overlaps span 1 [2, 6)',
      );
      return true;
    },
  );

  // Precedence follows containment, so a producer that emits a contained span
  // before the span enclosing it still resolves innermost-first.
  const reversed = batch.add({
    font: inter,
    text: 'abcdef',
    spans: [
      { start: 2, end: 4, paint: { color: '#00ff00' } },
      { start: 0, end: 6, paint: { color: '#ff0000' } },
    ],
  });
  runtime.update();
  assert.equal(batch.preparationError, undefined);
  assert.deepEqual(glyphColors(batch, runFor(batch, reversed)), [RED, RED, GREEN, GREEN, RED, RED]);

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('a span font size re-shapes advances and moves where a line wraps', async () => {
  const runtime = await createBitmapRuntime();
  const inter = await loadInter(runtime);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  const contentBox = { width: { mode: 'at-most', size: 120 }, wrap: 'word' };
  const plain = batch.add({ font: inter, text: 'wide wide wide', contentBox });
  const emphasis = span({ fontSize: 32 });
  const styled = batch.add({ font: inter, text: txt`${emphasis`wide`} wide wide`, contentBox });
  runtime.update();
  assert.equal(batch.preparationError, undefined);

  const plainLayout = plain.committed.layout;
  const styledLayout = styled.committed.layout;
  assert.deepEqual([...plainLayout.lineGlyphCounts], [14], 'the unformatted paragraph must fit on one line');
  assert.deepEqual(
    [...styledLayout.lineGlyphCounts],
    [10, 4],
    'a span font size must change line breaking, not only glyph scale',
  );
  assert.deepEqual([...plainLayout.lineAdvances], [117.28125]);
  assert.deepEqual([...styledLayout.lineAdvances], [117.28125, 36.09375]);

  // Shaped advances inside the span double with its font size, and the text
  // after the span moves by the difference rather than staying put.
  assert.deepEqual([...plainLayout.x.slice(0, 4)], [0, 13.09375, 16.96875, 26.765625]);
  assert.deepEqual([...styledLayout.x.slice(0, 4)], [0, 26.1875, 33.9375, 53.53125]);
  assert.equal(plainLayout.x[4], 36.09375);
  assert.equal(styledLayout.x[4], 72.1875, 'the glyph after the span must shift by the re-shaped advance');
  assert.deepEqual([...styledLayout.glyphFontSizes.slice(0, 5)], [32, 32, 32, 32, 16]);

  batch.dispose();
  inter.dispose();
  runtime.dispose();
});

test('a nested style-only span shapes with the font its enclosing span selected', async () => {
  const runtime = await createBitmapRuntime();
  const [inter, devanagari] = await Promise.all([loadInter(runtime), loadDevanagari(runtime)]);
  const batch = runtime.createParagraphBatch({ technique: bitmap });

  const script = span(devanagari);
  const emphasis = span({ fontSize: 24 });
  const literal = txt`Alert ${script`दे${emphasis`व`}`}!`;
  assert.equal(literal.text, 'Alert देव!');
  assert.deepEqual(literal.spans, [
    { start: 6, end: 9, font: devanagari },
    { start: 8, end: 9, style: { fontSize: 24 } },
  ]);

  const paragraph = batch.add({ font: inter, text: literal });
  runtime.update();
  assert.equal(batch.preparationError, undefined);

  const layout = paragraph.committed.layout;
  assert.deepEqual([...layout.fontHandles], [inter.font.handle, devanagari.font.handle]);
  assert.deepEqual(
    [...layout.glyphFontSlots],
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 0],
    'the inner span states no font, so it must shape from the font its enclosing span selected',
  );
  assert.deepEqual([...layout.glyphFontSizes], [16, 16, 16, 16, 16, 16, 16, 16, 24, 16]);
  assert.deepEqual([...layout.clusters], [0, 1, 2, 3, 4, 5, 6, 6, 8, 9]);
  assert.equal(layout.glyphIds.includes(0), false, 'the inherited span font must resolve every glyph');

  batch.dispose();
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

async function loadMtsdfInter(runtime) {
  return runtime.loadFont({
    input: { baked: dataUrl(gunzipSync(await readFile(interMtsdfUrl))) },
    raster: { technique: mtsdf },
  });
}

function runFor(batch, paragraph) {
  const run = batch.current.glyphRuns.find((entry) => entry.paragraph === paragraph.id);
  if (run === undefined) throw new Error('the published revision has no run for the paragraph');
  return run;
}

function batchFor(batch, run) {
  const physical = batch.current.glyphBatches.find((entry) => entry.key === run.batch);
  if (physical === undefined) throw new Error('the published revision has no physical batch for the run');
  return physical;
}

function glyphColors(batch, run) {
  const physical = batchFor(batch, run);
  const colors = [];
  for (let index = 0; index < run.count; index += 1) {
    colors.push([...physical.storage.colors.slice((run.start + index) * 4, (run.start + index + 1) * 4)]);
  }
  return colors;
}

function mtsdfGlyphPaint(batch, run) {
  const physical = batchFor(batch, run);
  const painted = [];
  for (let index = 0; index < run.count; index += 1) {
    const start = (run.start + index) * 4;
    painted.push({
      fill: [...physical.storage.fillColors.slice(start, start + 4)],
      outline: [...physical.storage.outlineColors.slice(start, start + 4)],
      shadow: [...physical.storage.shadowColors.slice(start, start + 4)],
    });
  }
  return painted;
}

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
