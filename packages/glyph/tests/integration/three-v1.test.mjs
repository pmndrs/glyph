import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { createFontLibrary, createFontStack, loadFont } from '@pmndrs/glyph';
import { GlyphBackend } from '@pmndrs/glyph/core';
import { PlanTransport } from '../../dist/core/backend.js';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import { defineTextMaterial, FontLoader, Text, TextGroup } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { bitmapSchema } from '../../dist/raster/bitmap-technique.js';
import { msdfSchema } from '../../dist/raster/msdf.js';
import { slugSchema } from '../../dist/raster/slug-technique.js';
import { threeEngineDomainReport } from '../../dist/three/engine-domain.js';
import { threeSystemBuffers } from '../../dist/three/render-policy.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const densityFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16-32.font.glb',
  import.meta.url,
);
const amiriFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/amiri-bitmap-16.font.glb',
  import.meta.url,
);
const iconSlugFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/font-awesome-free-6.7.2-slug.font.glb.gz',
  import.meta.url,
);
const multiTechniqueFontUrl = new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url);
const MULTI_TECHNIQUE_MSDF = Object.freeze({
  planeUnitsPerEm: 64,
  pixelRange: 8,
  atlasWidth: 1003,
  atlasHeight: 514,
});
const glyphAttribute = (bufferId) => `_pmndrsGlyph_${bufferId}`;

test('one portable request returns typed resources for every declared technique', async () => {
  const [bitmapFont, msdfFont, slugFont] = await loadFont({ baked: { bytes: await readFile(multiTechniqueFontUrl) } }, [
    { technique: bitmap, options: { strikes: [32] } },
    { technique: msdf },
    { technique: slug },
  ]);
  assert.equal(bitmapFont.font, msdfFont.font);
  assert.equal(msdfFont.font, slugFont.font);
  assert.equal(bitmapFont.technique, bitmap);
  assert.equal(msdfFont.technique, msdf);
  assert.equal(slugFont.technique, slug);
  bitmapFont.dispose();
  msdfFont.dispose();
  slugFont.dispose();
});

test('Three carries supported text effects into MSDF lanes and rejects them for unsupported techniques', async () => {
  const bytes = await readFile(multiTechniqueFontUrl);
  const loader = new FontLoader();
  const [bitmapFont, msdfFont, slugFont] = await loader.loadFontsAsync({ baked: dataUrl(bytes) }, [
    { technique: bitmap, options: { strikes: [32] } },
    { technique: msdf },
    { technique: slug },
  ]);
  const effectStyle = {
    fontSize: 32,
    color: '#00ff00',
    opacity: 0.5,
    outline: { color: '#ff000080', width: 2 },
    shadow: { color: '#0000ff80', offset: [3, 4] },
  };
  assert.throws(() => new Text({ font: bitmapFont, text: 'A', style: effectStyle }), /pmndrs\.bitmap.*outline/);
  assert.throws(() => new Text({ font: slugFont, text: 'A', style: effectStyle }), /pmndrs\.slug.*outline/);

  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
    font: msdfFont,
    text: { text: 'A', spans: [{ start: 0, end: 1, style: { fontSize: 24 } }] },
    style: effectStyle,
  });
  try {
    group.add(label);
    scene.add(group);
    scene.updateMatrixWorld(true);
    assert.equal(label.error, undefined);
    const draw = group.children.find((child) => child.isMesh);
    assert.ok(draw, 'MSDF effect text must publish a draw');
    const effects = draw.geometry.getAttribute(glyphAttribute(msdfSchema.buffers.effectColor.id)).array;
    const page = draw.geometry.getAttribute(glyphAttribute(msdfSchema.buffers.page.id)).array;
    const color = draw.geometry.getAttribute(glyphAttribute(msdfSchema.buffers.color.id)).array;
    assert.deepEqual([...color.slice(0, 3)], [0, 1, 0], 'a typography-only span must inherit foreground');
    assert.deepEqual([...effects.slice(0, 2)], [0x400000ff, 0x40ff0000]);
    const effectFontSize = 24;
    const expectedEffects = [3 / effectFontSize, 4 / effectFontSize, 2 / effectFontSize];
    for (let lane = 0; lane < expectedEffects.length; lane += 1) {
      assert.ok(
        Math.abs(page[lane] - expectedEffects[lane]) < 1e-6,
        `MSDF effect lane ${lane} must retain its em-relative value`,
      );
    }
    label.style = {
      ...effectStyle,
      outline: { color: '#00ffff80', width: 2 },
    };
    scene.updateMatrixWorld(true);
    assert.deepEqual(
      [...effects.slice(0, 2)],
      [0x40ffff00, 0x40ff0000],
      'a retained color-only edit must rewrite the packed effect buffer',
    );
  } finally {
    group.dispose();
    label.dispose();
    bitmapFont.dispose();
    msdfFont.dispose();
    slugFont.dispose();
    loader.dispose();
  }
});

test('Three font loading rejects malformed arguments before starting LoadingManager work', async () => {
  const manager = new THREE.LoadingManager();
  let starts = 0;
  manager.onStart = () => {
    starts += 1;
  };
  const loader = new FontLoader(manager);
  const input = { baked: 'data:model/gltf-binary;base64,' };

  assert.throws(
    () => loader.load({ input, raster: { technique: msdf }, retry: true }, () => {}),
    /only accepts input, raster, and signal/,
  );
  await assert.rejects(loader.loadAsync({ input, raster: { technique: bitmap } }), /options/);
  await assert.rejects(loader.loadFontsAsync(input, []), /at least one raster technique/);
  await assert.rejects(loader.loadFontsAsync(input, [{ technique: msdf }], { retry: true }), /only accept signal/);
  assert.equal(starts, 0);
  loader.dispose();
});

test('Three domain ownership follows immutable variants across loaders and user-font disposal', async () => {
  const library = createFontLibrary();
  const firstLoader = new FontLoader(undefined, { library });
  const secondLoader = new FontLoader(undefined, { library });
  const request = {
    input: { baked: { bytes: await readFile(fontUrl) } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  };
  const [first, second] = await Promise.all([firstLoader.loadAsync(request), secondLoader.loadAsync(request)]);
  assert.notEqual(first, second, 'each caller owns an independent Font lease');
  assert.deepEqual(threeEngineDomainReport(), { active: true, loaders: 2, fonts: 1, leases: 0 });

  const label = new Text({ font: second, text: 'retained' });
  first.dispose();
  firstLoader.dispose();
  secondLoader.dispose();
  second.dispose();
  assert.ok(label.measure().glyphCount > 0, 'a live Text retains everything needed after loader and Font disposal');
  assert.deepEqual(threeEngineDomainReport(), { active: true, loaders: 0, fonts: 1, leases: 2 });

  label.dispose();
  library.dispose();
  assert.deepEqual(threeEngineDomainReport(), { active: false, loaders: 0, fonts: 0, leases: 0 });
});

test('Three Text and TextGroup late-bind, synchronize, reparent, and dispose through the scene graph', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const emptyScene = new THREE.Scene();
  const initiallyEmpty = new Text({ font, text: '' });
  emptyScene.add(initiallyEmpty);
  emptyScene.updateMatrixWorld(true);
  assert.equal(initiallyEmpty.error, undefined, 'an empty paragraph must publish without a no-op text mutation');
  initiallyEmpty.text = 'A';
  emptyScene.updateMatrixWorld(true);
  assert.equal(initiallyEmpty.error, undefined, 'an initially empty paragraph must accept its first text edit');
  assert.equal(initiallyEmpty.measure().glyphCount, 1);
  initiallyEmpty.dispose();

  const editedSpans = new Text({
    font,
    text: 'ABCD',
    spans: [
      { start: 0, end: 2, style: { color: '#ff0000' } },
      { start: 2, end: 4, style: { color: '#00ff00' } },
    ],
  });
  // Text and its spans are authored together. A caller that changes the string states the ranges
  // that string has, and `set` still derives the narrow engine edit from the two strings.
  editedSpans.set({
    text: 'AXBYCD',
    spans: [
      { start: 0, end: 3, style: { color: '#ff0000' } },
      { start: 4, end: 6, style: { color: '#00ff00' } },
    ],
  });
  assert.deepEqual(
    editedSpans.spans.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 3 },
      { start: 4, end: 6 },
    ],
    'authored ranges are stored as authored when every boundary is already a cluster boundary',
  );
  editedSpans.set({
    text: 'ACD',
    spans: [
      { start: 0, end: 1, style: { color: '#ff0000' } },
      { start: 1, end: 3, style: { color: '#00ff00' } },
    ],
  });
  assert.equal(editedSpans.text, 'ACD');
  assert.deepEqual(
    editedSpans.spans.map(({ start, end }) => ({ start, end })),
    [
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ],
  );
  // Stating `text` without `spans` clears them: replacement text carries its own formatting, and
  // retaining the previous ranges would reinterpret them against unrelated text.
  editedSpans.text = 'ACD!';
  assert.deepEqual(editedSpans.spans, []);
  editedSpans.dispose();

  const scene = new THREE.Scene();
  const group = new TextGroup({ renderOrder: 12 });
  const container = new THREE.Object3D();
  const label = new Text({ font, text: 'First frame' });
  container.add(label);
  group.add(container);
  scene.add(group);

  assert.equal(label.bound, false, 'construction and add must not shape eagerly');
  scene.updateMatrixWorld();
  assert.equal(label.bound, true);
  assert.equal(label.textGroup, group);
  assert.equal(group.textCount, 1);
  assert.equal(group.error, undefined);
  const firstDraws = group.children.filter((child) => child.isMesh);
  assert.ok(firstDraws.length > 0);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'the GPU plan omits the non-rendering space glyph');
  assert.equal(firstDraws[0].renderOrder, 12);
  const measurement = label.measure();
  assert.ok(measurement, 'layout measurement must be available through an explicit Rust query');
  assert.equal(measurement.width, measurement.contentWidth);
  assert.equal(measurement.height, measurement.contentHeight);
  assert.ok(measurement.firstBaseline > 0);
  assert.equal(measurement.firstBaseline, measurement.lastBaseline);
  assert.equal(measurement.overflowed, false);
  assert.equal(measurement.glyphCount, 11, 'layout summary retains the non-rendering space glyph');
  assert.equal(measurement.lineCount, 1);
  assert.equal(measurement.missingGlyphCount, 0);
  assert.equal(label.measure(), measurement, 'an unchanged committed layout must reuse its queried measurement');
  const inspection = label.glyphs();
  assert.ok(inspection, 'per-glyph layout must be available only through an explicit Rust inspection query');
  assert.equal(inspection.glyphIds.length, measurement.glyphCount);
  assert.equal(inspection.glyphStableIds.length, inspection.glyphIds.length);
  assert.equal(inspection.lineGlyphCounts.length, measurement.lineCount);
  const expectedFirstX = inspection.x[0];
  inspection.x.fill(-12345);
  const repeatedInspection = label.glyphs();
  assert.notEqual(repeatedInspection, inspection, 'each inspection owns the mutable columns it exposes');
  assert.equal(repeatedInspection.x[0], expectedFirstX, 'caller mutation cannot corrupt the retained inspection');
  assert.equal(group.children.filter((child) => child.isMesh)[0], firstDraws[0]);

  const placements = label.snapshotGlyphs();
  assert.notEqual(placements.layout, repeatedInspection);
  assert.deepEqual(placements.layout.x, repeatedInspection.x);
  assert.equal(placements.space, 'paragraph');
  // A glyph the GPU plan omits — the non-rendering space here — has no retained record, so its
  // drawn position cannot be read. That is reported, not substituted, and the count is pinned
  // against the plan's own instance count rather than restated.
  assert.equal(
    placements.incomplete.length,
    measurement.glyphCount - firstDraws[0].geometry.instanceCount,
    'incomplete must name exactly the glyphs the render plan does not draw',
  );
  assert.equal(inspection.glyphIds[placements.incomplete[0]], inspection.glyphIds[5]);
  for (const glyph of placements.glyphs) {
    assert.equal(glyph.x, glyph.shapedX, 'a freshly committed paragraph draws where it shaped');
    assert.equal(glyph.y, glyph.shapedY, 'a freshly committed paragraph draws where it shaped');
  }
  const shapedX = placements.glyphs.map((glyph) => glyph.shapedX);
  placements.glyphs[0].x += 3;
  const application = label.applyGlyphs(placements);
  // A write that cannot reach a glyph says so. The unreachable set is exactly the unreadable one,
  // because both are the glyphs the plan never gave a record.
  assert.equal(application.requested, measurement.glyphCount);
  assert.equal(application.applied, application.requested - placements.incomplete.length);
  assert.deepEqual([...application.unapplied], [...placements.incomplete]);
  const presented = label.snapshotGlyphs();
  assert.equal(presented.glyphs[0].shapedX, shapedX[0], 'presentation must not mutate authoritative layout');
  assert.equal(presented.glyphs[0].x, shapedX[0] + 3);
  label.restoreGlyphs();
  assert.deepEqual(
    label.snapshotGlyphs().glyphs.map((glyph) => glyph.x),
    shapedX,
  );

  // The units a caller animates, and the extents that make them addressable at all.
  assert.ok(placements.lines.length >= 1);
  assert.ok(placements.words.length >= 1);
  assert.equal(placements.lines[0].ascent + placements.lines[0].descent, placements.lines[0].lineHeight);
  assert.ok(placements.glyphs[0].advance > 0, 'a shaped glyph must report the advance the pen moved by');
  assert.ok(placements.lines[0].bounds.width > 0);

  group.renderOrder = 20;
  scene.updateMatrixWorld();
  assert.equal(firstDraws[0].renderOrder, 20, 'group render order must update existing draw proxies');

  label.renderOrder = 7;
  scene.updateMatrixWorld();
  assert.equal(group.children.filter((child) => child.isMesh)[0].renderOrder, 20);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'render-order-only updates must preserve the Rust plan');

  label.text = 'Only the final desired value';
  label.text = 'Updated';
  scene.updateMatrixWorld();
  assert.ok(group.children.some((child) => child.isMesh));
  assert.equal(group.children.filter((child) => child.isMesh)[0], firstDraws[0]);
  assert.equal(
    firstDraws[0].geometry.instanceCount,
    7,
    'compatible revisions must retain draws and resize live counts',
  );
  assert.notEqual(label.measure(), measurement, 'a semantic update must invalidate the measurement cache');
  assert.notEqual(label.glyphs(), inspection, 'a semantic update must invalidate the inspection cache');

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.textGroup, undefined);
  assert.equal(label.bound, true, 'a directly attached Text must own an implicit batch');
  assert.equal(group.textCount, 0);

  group.add(label);
  scene.updateMatrixWorld();
  group.dispose();
  assert.equal(group.disposed, true);
  assert.equal(label.disposed, false);
  assert.equal(label.bound, false);
  assert.equal(label.textGroup, undefined);

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.bound, true, 'text retained by a disposed group can bind elsewhere');

  // Typography tier: first-line indent shifts the pen and the measured width;
  // paragraph spacing shifts the first baseline and carries in the block extent.
  const plainShort = new Text({ font, text: 'Whisper' });
  const indented = new Text({ font, text: 'Whisper', layout: { firstLineIndent: 30 } });
  const spaced = new Text({ font, text: 'Whisper', layout: { spaceBefore: 8, spaceAfter: 6 } });
  for (const paragraph of [plainShort, indented, spaced]) scene.add(paragraph);
  scene.updateMatrixWorld();
  const plainMeasure = plainShort.measure();
  const indentedMeasure = indented.measure();
  const spacedMeasure = spaced.measure();
  assert.equal(plainMeasure.lineCount, 1);
  assert.equal(indentedMeasure.lineCount, 1);
  assert.equal(indentedMeasure.contentWidth, plainMeasure.contentWidth + 30);
  assert.equal(indented.glyphs().x[0], plainShort.glyphs().x[0] + 30);
  assert.equal(spacedMeasure.firstBaseline, plainMeasure.firstBaseline + 8);
  assert.equal(spacedMeasure.contentHeight, plainMeasure.contentHeight + 8 + 6);
  for (const paragraph of [plainShort, indented, spaced]) {
    paragraph.removeFromParent();
    paragraph.dispose();
  }

  // Justification controls: an unbounded justified last line fills the exact
  // box; capping word growth at its natural width and bounding letter gaps
  // leaves the line short by design.
  const justifyLayout = (justify, lastLine) => ({
    align: 'justify',
    ...(justify === undefined ? {} : { justify }),
    lastLine,
  });
  const justifyConstraints = { width: { mode: 'exact', size: 300 } };
  const natural = new Text({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout(undefined, 'auto'),
  });
  const filled = new Text({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout(undefined, 'justify'),
  });
  const capped = new Text({
    font,
    text: 'pack my box',
    constraints: justifyConstraints,
    layout: justifyLayout({ maxWordSpaceRatio: 1, letterSpaceExpansion: 0.5 }, 'justify'),
  });
  for (const paragraph of [natural, filled, capped]) scene.add(paragraph);
  scene.updateMatrixWorld();
  const naturalMeasure = natural.measure();
  const filledMeasure = filled.measure();
  const cappedMeasure = capped.measure();
  assert.equal(naturalMeasure.lineCount, 1);
  assert.ok(naturalMeasure.contentWidth < 300, 'auto last line keeps its natural advance');
  assert.equal(filledMeasure.contentWidth, 300, 'justified last line fills the exact box');
  const cappedGaps = cappedMeasure.glyphCount - 1;
  assert.equal(
    cappedMeasure.contentWidth,
    naturalMeasure.contentWidth + cappedGaps * 0.5,
    'capped word spaces spill into bounded letter gaps',
  );
  for (const paragraph of [natural, filled, capped]) {
    paragraph.removeFromParent();
    paragraph.dispose();
  }

  // Column flow: one paragraph fills side-by-side ordered regions without
  // balancing. The column height is the flow signal, so the reference layout is
  // one column at the exact column measure; halving its height (plus a line of
  // slack) must push the tail of the text into the second column.
  const columnText = 'the quick brown fox jumps over the lazy dog and keeps running until the column turns';
  const columnMeasureWidth = (420 - 20) / 2;
  const reference = new Text({
    font,
    text: columnText,
    constraints: { width: { mode: 'exact', size: columnMeasureWidth } },
  });
  scene.add(reference);
  scene.updateMatrixWorld();
  const referenceMeasure = reference.measure();
  assert.ok(referenceMeasure.lineCount >= 4, 'the fixture text must wrap well past two lines at the column measure');
  const columnHeight = Math.ceil(referenceMeasure.contentHeight * 0.6);
  const twoColumns = new Text({
    font,
    text: columnText,
    constraints: { width: { mode: 'exact', size: 420 }, height: { mode: 'exact', size: columnHeight } },
    layout: { columns: { count: 2, gap: 20 } },
  });
  scene.add(twoColumns);
  scene.updateMatrixWorld();
  const doubleMeasure = twoColumns.measure();
  assert.equal(doubleMeasure.overflowed, false, 'two columns at 60% height must hold the whole text');
  assert.ok(
    doubleMeasure.contentHeight <= columnHeight,
    'the columned block extent must stay inside the column height',
  );
  const columnStarts = twoColumns.glyphs().x;
  const secondColumnStart = columnMeasureWidth + 20;
  assert.ok(
    Array.from(columnStarts).some((x) => x >= secondColumnStart),
    'glyphs must flow into the second column',
  );
  assert.throws(
    () => new Text({ font, text: columnText, layout: { columns: { count: 2 } } }),
    /columns/,
    'columns without an exact width must be rejected',
  );
  assert.throws(
    () =>
      new Text({
        font,
        text: columnText,
        constraints: { width: { mode: 'exact', size: 420 } },
        layout: { columns: { count: 2 } },
      }),
    /columns/,
    'columns without a bounded height must be rejected',
  );
  for (const paragraph of [reference, twoColumns]) {
    paragraph.removeFromParent();
    paragraph.dispose();
  }

  label.removeFromParent();
  label.dispose();
  font.dispose();
  loader.dispose();
});

test('renderer rejection waits for explicit invalidation and then checkpoints without copied bytes', async (t) => {
  const copyPublication = PlanTransport.prototype.copyPublication;
  let publicationCopies = 0;
  PlanTransport.prototype.copyPublication = function (publication) {
    publicationCopies += 1;
    return copyPublication.call(this, publication);
  };
  t.after(() => {
    PlanTransport.prototype.copyPublication = copyPublication;
  });
  const instrumented = await createInstrumentedEngine();
  const fontDomain = instrumented.fontDomain;
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  let failMaterial = true;
  let label;
  const material = defineTextMaterial((context) => {
    if (failMaterial) {
      assert.throws(() => label.measure(), /cannot reenter Three render-plan application/u);
      throw new Error('deliberate material realization failure');
    }
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const group = new TextGroup();
  label = new Text({ font, material, text: 'Retry me' });
  const errors = [];
  group.onError = (error) => errors.push(error);
  group.add(label);
  scene.add(group);

  scene.updateMatrixWorld();
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.equal(label.error, group.error, 'group-owned failures must remain visible from the child Text');
  assert.equal(instrumented.crossings, 1);
  const rejectedGeneration = instrumented.latestUpdateGeneration;
  assert.equal(group.children.filter((child) => child.isMesh).length, 0);
  assert.equal(errors.length, 1);
  assert.ok(label.measure().glyphCount > 0, 'measurement remains independent of material realization');
  assert.equal(instrumented.crossings, 1, 'measurement must not retry or consume renderer publication');
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.ok(label.glyphs().glyphCount > 0, 'renderer-free positioned inspection survives renderer rejection');
  assert.equal(
    label.snapshotGlyphs(),
    undefined,
    'drawn placement is unavailable while the renderer update is rejected',
  );
  assert.equal(instrumented.crossings, 1, 'inspection must not turn a rejected unchanged frame into a retry');

  failMaterial = false;
  scene.updateMatrixWorld();
  assert.match(String(group.error), /deliberate material realization failure/u);
  assert.equal(instrumented.crossings, 1, 'an unchanged frame must not retry a renderer implementation failure');
  assert.equal(group.children.filter((child) => child.isMesh).length, 0);

  label.material = material;
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 2, 'explicit material invalidation must request a checkpoint from the engine');
  assert.equal(
    instrumented.latestAcknowledgedGeneration,
    rejectedGeneration - 1,
    'measurement must not acknowledge the renderer-rejected publication',
  );
  assert.equal(publicationCopies, 0, 'Three must not copy a borrowed publication for renderer recovery');
  assert.equal(errors.length, 1, 'a successful checkpoint must not repeat the old failure');
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);

  label.text = 'New input after recovery';
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 3, 'new input after recovery must publish normally');
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('a rejected fixed-capacity candidate releases its provisional font-stack lease', async (t) => {
  const registerFontStack = GlyphBackend.prototype.registerFontStack;
  const disposeFontStack = GlyphBackend.prototype.disposeFontStack;
  let registrations = 0;
  let disposals = 0;
  GlyphBackend.prototype.registerFontStack = function (...args) {
    registrations += 1;
    return registerFontStack.apply(this, args);
  };
  GlyphBackend.prototype.disposeFontStack = function (...args) {
    disposals += 1;
    return disposeFontStack.apply(this, args);
  };
  t.after(() => {
    GlyphBackend.prototype.registerFontStack = registerFontStack;
    GlyphBackend.prototype.disposeFontStack = disposeFontStack;
  });

  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const label = new Text({ font, text: 'over budget', capacity: { size: 1, policy: 'fixed' } });
  try {
    scene.add(label);
    scene.updateMatrixWorld();
    assert.deepEqual(label.commitState(), { status: 'pending' });
    label.dispose();
    assert.equal(disposals, registrations, 'a skipped candidate must not retain its compiled font stack');
  } finally {
    label.dispose();
    font.dispose();
    fontDomain.dispose();
  }
});

test('TextGroup drops disposed descendants and reuses their committed transform identities', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const survivor = new Text({ font, text: 'A' });
  group.add(survivor);
  scene.add(group);
  scene.updateMatrixWorld();

  let retainedTransformBytes;
  for (let index = 0; index < 12; index += 1) {
    const transient = new Text({ font, text: 'B' });
    group.add(transient);
    scene.updateMatrixWorld();
    const draw = group.children.find((child) => child.isMesh);
    assert.ok(draw);
    const transformBytes = draw.geometry.getAttribute('_pmndrsGlyphTransforms').array.byteLength;
    retainedTransformBytes ??= transformBytes;
    assert.equal(transformBytes, retainedTransformBytes, 'committed removals must make transform identities reusable');

    transient.dispose();
    assert.doesNotThrow(
      () => scene.updateMatrixWorld(),
      'a disposed child may remain attached until its host removes it',
    );
    assert.equal(group.error, undefined);
    assert.equal(group.textCount, 1);
    transient.removeFromParent();
  }

  const draw = group.children.find((child) => child.isMesh);
  assert.equal(draw.geometry.instanceCount, 1);
  group.dispose();
  survivor.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('Three retires materials bound to a replaced buffer generation', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const materials = [];
  const disposed = new Set();
  const material = defineTextMaterial((context) => {
    const created = context.createDefaultMaterial();
    created.addEventListener('dispose', () => disposed.add(created));
    materials.push(created);
    return created;
  });
  const scene = new THREE.Scene();
  const group = new TextGroup({ capacity: { size: 2, policy: 'grow' } });
  const label = new Text({ font, material, text: 'AB' });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  const initialMaterial = group.children.find((child) => child.isMesh)?.material;
  assert.equal(initialMaterial, materials[0]);

  label.text = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  scene.updateMatrixWorld();
  assert.ok(materials.length > 1, 'growing physical buffers must realize a material for the new generation');
  assert.ok(disposed.has(initialMaterial), 'the material retaining the retired generation must be disposed');

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('one Rust plan partitions a mixed Bitmap to Slug fallback stack', async () => {
  const fontDomain = createThreeFontDomain();
  const [latin, icon] = await Promise.all([
    fontDomain.loadFont({ baked: dataUrl(await readFile(fontUrl)) }, { technique: bitmap, options: { strikes: [16] } }),
    fontDomain.loadFont(
      { baked: dataUrl(gunzipSync(await readFile(iconSlugFontUrl))) },
      { technique: slug, options: {} },
    ),
  ]);
  const realizedTechniques = [];
  const material = defineTextMaterial((context) => {
    realizedTechniques.push(context.technique);
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const label = new Text({
    font: createFontStack(latin, icon),
    material,
    text: 'Hello \uf0ac',
  });
  scene.add(label);
  scene.updateMatrixWorld();

  const draws = label.children.filter((child) => child.isMesh);
  assert.equal(label.error, undefined);
  assert.equal(draws.length, 2, 'Rust must partition fallback glyphs by renderer program and resource');
  assert.equal(
    draws.reduce((count, draw) => count + draw.geometry.instanceCount, 0),
    6,
  );
  assert.deepEqual(realizedTechniques.sort(), [bitmap.id, slug.id].sort());
  assert.deepEqual(
    draws
      .map(
        (draw) =>
          draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.size.id)) ??
          draw.geometry.getAttribute(glyphAttribute(slugSchema.buffers.planeRect.id)),
      )
      .map((attribute) => attribute.itemSize)
      .sort(),
    [2, 4],
    'Bitmap vec2 and Slug vec4 records must coexist without a user technique selector',
  );

  label.dispose();
  latin.dispose();
  icon.dispose();
  fontDomain.dispose();
});

test('TextGroup realizes two public Text objects as one indexed Rust draw', async () => {
  const instrumented = await createInstrumentedEngine();
  const fontDomain = instrumented.fontDomain;
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup({ renderOrder: 3 });
  const left = new Text({ font, text: 'AB' });
  const right = new Text({ font, text: 'CD' });
  left.position.x = 2;
  right.position.x = 5;
  group.add(left, right);
  scene.add(group);
  scene.updateMatrixWorld();

  assert.equal(group.error, undefined);
  const draws = group.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 1, 'compatible paragraphs must batch in Rust before Three sees the plan');
  assert.equal(draws[0].geometry.instanceCount, 4);
  const start = draws[0].userData.pmndrsGlyphRunStart;
  const indices = draws[0].geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id)).array;
  assert.deepEqual(Array.from(indices.subarray(start, start + 4)), [1, 1, 2, 2]);
  const transforms = draws[0].geometry.getAttribute('_pmndrsGlyphTransforms');
  assert.equal(transforms.array[1 * 16 + 12], 2);
  assert.equal(transforms.array[2 * 16 + 12], 5);

  const initialLeftMeasurement = left.measure();
  const initialRightMeasurement = right.measure();
  assert.ok(initialLeftMeasurement);
  assert.ok(initialRightMeasurement);
  instrumented.reset();
  left.set({});
  assert.equal(left.measure(), initialLeftMeasurement, 'an empty update must preserve the cached measurement');
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 0, 'an empty update and cached measurement must not cross into Rust');

  // Assigning `text` states the desired string. Publication derives the narrowest scalar-aligned
  // replacement from the last published string, coalescing intermediate desired states.
  left.text = 'A';
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [{ start: 1, deleteCount: 1, insert: '' }]);
  assert.equal(left.text, 'A');

  left.text = 'AB';
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [{ start: 1, deleteCount: 0, insert: 'B' }]);
  assert.equal(left.text, 'AB');

  left.text = 'AY';
  scene.updateMatrixWorld();
  assert.deepEqual(
    instrumented.latestTextMutations(),
    [{ start: 1, deleteCount: 1, insert: 'Y' }],
    'declarative assignment must serialize its smallest scalar-aligned replacement',
  );

  left.text = 'AZ';
  left.text = 'Z';
  left.text = 'AZ';
  scene.updateMatrixWorld();
  assert.deepEqual(
    instrumented.latestTextMutations(),
    [{ start: 1, deleteCount: 1, insert: 'Z' }],
    'retained authoring coalesces desired state into one minimal edit from the published string',
  );
  assert.equal(left.text, 'AZ');

  // A whole-string assignment cannot address the inside of a scalar, so the replacement derived
  // from it is scalar-aligned by construction rather than by a range check.
  left.text = '🌍';
  scene.updateMatrixWorld();
  assert.deepEqual(instrumented.latestTextMutations(), [{ start: 0, deleteCount: 2, insert: '🌍' }]);
  assert.equal(left.text, '🌍');
  left.text = 'AB';
  scene.updateMatrixWorld();

  instrumented.reset();
  left.constraints = { width: { mode: 'exact', size: 100 } };
  left.layout = { wrap: 'word' };
  const resizedMeasurement = left.measure();
  assert.ok(resizedMeasurement, 'a pending mutation must produce its requested measurement');
  assert.notEqual(resizedMeasurement, initialLeftMeasurement);
  assert.deepEqual(
    right.measure(),
    initialRightMeasurement,
    'one requested semantic publication must populate every retained paragraph',
  );
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 1, 'mutation, render plan, and demanded measurement must share one text_update');

  const leftOrigins = left.snapshotGlyphs();
  const rightOrigins = right.snapshotGlyphs();
  assert.equal(leftOrigins.glyphs.length, 2);
  assert.equal(rightOrigins.glyphs.length, 2);
  const leftShapedX = leftOrigins.glyphs.map((glyph) => glyph.shapedX);
  const rightShapedX = rightOrigins.glyphs.map((glyph) => glyph.shapedX);
  leftOrigins.glyphs[0].x += 2;
  rightOrigins.glyphs[0].x += 4;
  const originsAttribute = draws[0].geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id));
  const canonicalOrigins = originsAttribute.array;
  const pboUploadOrigins = new Float32Array(canonicalOrigins.length + 4);
  pboUploadOrigins.set(canonicalOrigins);
  originsAttribute.array = pboUploadOrigins;
  originsAttribute.clearUpdateRanges();
  left.applyGlyphs(leftOrigins);
  const leftUploadRanges = originsAttribute.updateRanges.map((range) => ({ ...range }));
  right.applyGlyphs(rightOrigins);
  assert.ok(
    leftUploadRanges.every(({ start: rangeStart, count }) =>
      originsAttribute.updateRanges.some(
        (range) => range.start <= rangeStart && range.start + range.count >= rangeStart + count,
      ),
    ),
    'separate presentation edits may coalesce but must retain every earlier upload range',
  );
  assert.equal(left.snapshotGlyphs().glyphs[0].x, leftShapedX[0] + 2);
  assert.equal(right.snapshotGlyphs().glyphs[0].x, rightShapedX[0] + 4);
  assert.deepEqual(
    pboUploadOrigins.subarray(0, canonicalOrigins.length),
    canonicalOrigins,
    'WebGL2 PBO replacement storage must receive the same dirty ranges as canonical plan storage',
  );
  assert.deepEqual(pboUploadOrigins.subarray(canonicalOrigins.length), new Float32Array(4));

  const version = transforms.version;
  let forcedTextWorldUpdates = 0;
  const updateRightWorldMatrix = right.updateWorldMatrix.bind(right);
  right.updateWorldMatrix = (...arguments_) => {
    forcedTextWorldUpdates += 1;
    return updateRightWorldMatrix(...arguments_);
  };
  group.position.x = 11;
  scene.updateMatrixWorld();
  assert.equal(transforms.version, version, 'moving the shared root must not upload unchanged relative transforms');
  assert.equal(forcedTextWorldUpdates, 0, 'moving the shared root must not force each Text world matrix a second time');

  right.position.x = 7;
  scene.updateMatrixWorld();
  assert.equal(group.children.filter((child) => child.isMesh)[0], draws[0]);
  assert.equal(transforms.version, version + 1);
  assert.equal(transforms.array[2 * 16 + 12], 7);
  assert.equal(forcedTextWorldUpdates, 0, 'the normal Three traversal supplies current matrices to transform patches');

  const nestedParent = new THREE.Group();
  group.add(nestedParent);
  nestedParent.add(right);
  nestedParent.position.x = 3;
  scene.updateMatrixWorld();
  assert.equal(transforms.array[2 * 16 + 12], 10, 'nested parent motion patches only the affected transform path');
  nestedParent.visible = false;
  scene.updateMatrixWorld();
  assert.deepEqual(
    Array.from(transforms.array.subarray(2 * 16, 3 * 16)),
    Array(16).fill(0),
    'nested parent visibility suppresses instances whose draw proxy lives at the shared root',
  );
  nestedParent.visible = true;
  scene.updateMatrixWorld();
  assert.equal(
    right.snapshotGlyphs().glyphs[0].x,
    rightShapedX[0] + 4,
    'transform-only updates must not cross into Rust or discard presentation overrides',
  );

  originsAttribute.clearUpdateRanges();
  left.restoreGlyphs();
  const clearedOriginRanges = originsAttribute.updateRanges.map((range) => ({ ...range }));
  assert.ok(clearedOriginRanges.length > 0);
  right.style = { ...right.style, color: '#00ff00' };
  scene.updateMatrixWorld();
  assert.ok(
    clearedOriginRanges.every(({ start: rangeStart, count }) =>
      originsAttribute.updateRanges.some(
        (range) => range.start <= rangeStart && range.start + range.count >= rangeStart + count,
      ),
    ),
    'a second plan before rendering must retain every earlier pending upload range',
  );

  right.style = { ...right.style, fontSize: 20 };
  scene.updateMatrixWorld();
  const resizedOrigins = right.snapshotGlyphs();
  assert.notEqual(resizedOrigins.layout, rightOrigins.layout);
  assert.deepEqual(
    resizedOrigins.glyphs.map((glyph) => glyph.x),
    resizedOrigins.glyphs.map((glyph) => glyph.shapedX),
    'an authoritative command-buffer update must retire the previous presentation override',
  );

  instrumented.reset();
  left.text = 'ABC';
  const replacedMeasurement = left.measure();
  assert.equal(replacedMeasurement?.glyphCount, 3);
  scene.updateMatrixWorld();
  assert.equal(instrumented.crossings, 1, 'text replacement and demanded measurement must share one text_update');
  const replacedDraws = group.children.filter((child) => child.isMesh);
  assert.equal(replacedDraws.length, 1);
  assert.equal(replacedDraws[0].geometry.instanceCount, 5, 'the published command buffer must include the new glyph');

  group.dispose();
  left.dispose();
  right.dispose();
  font.dispose();
  fontDomain.dispose();
});

async function createInstrumentedEngine() {
  const abi = textShaperAbi;
  const originalInstantiate = WebAssembly.instantiate;
  let crossings = 0;
  let measureCrossings = 0;
  let latestRequest;
  let latestUpdateFlags = 0;
  let latestUpdateGeneration = 0;
  WebAssembly.instantiate = async (source, imports) => {
    const instance = await originalInstantiate(source, imports);
    const exports = { ...instance.exports };
    const update = exports[abi.functions.textUpdate];
    assert.equal(typeof update, 'function', 'instrumented shaper must export text_update');
    exports[abi.functions.textUpdate] = (...arguments_) => {
      crossings += 1;
      const [, pointer, length] = arguments_;
      latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
      const resultPointer = update(...arguments_);
      if (resultPointer !== 0) {
        const header = new DataView(exports.memory.buffer, resultPointer, abi.layouts.engineResult.size);
        latestUpdateFlags = header.getUint32(abi.layouts.engineResult.flags, true);
        latestUpdateGeneration = header.getUint32(abi.layouts.engineResult.publicationGeneration, true);
      }
      return resultPointer;
    };
    const measure = exports[abi.functions.measureParagraph];
    if (typeof measure === 'function') {
      exports[abi.functions.measureParagraph] = (...arguments_) => {
        measureCrossings += 1;
        return measure(...arguments_);
      };
    }
    return { exports };
  };
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    WebAssembly.instantiate = originalInstantiate;
  };
  const fontDomain = createThreeFontDomain(async (load) => {
    try {
      return await load();
    } finally {
      restore();
    }
  }, restore);
  return {
    fontDomain,
    get crossings() {
      return crossings;
    },
    get measureCrossings() {
      return measureCrossings;
    },
    get latestUpdateFlags() {
      return latestUpdateFlags;
    },
    get latestUpdateGeneration() {
      return latestUpdateGeneration;
    },
    get latestAcknowledgedGeneration() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      return new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength).getUint32(
        request.acknowledgedPublicationGeneration,
        true,
      );
    },
    reset() {
      crossings = 0;
      measureCrossings = 0;
    },
    latestTextMutations() {
      assert.ok(latestRequest, 'a text update request must have been captured');
      const request = abi.layouts.engineUpdateRequest;
      const mutation = abi.layouts.engineTextMutation;
      const view = new DataView(latestRequest.buffer, latestRequest.byteOffset, latestRequest.byteLength);
      const offset = view.getUint32(request.textMutationsOffset, true);
      const count = view.getUint32(request.textMutationCount, true);
      return Array.from({ length: count }, (_recordValue, index) => {
        const record = offset + index * mutation.size;
        const insertOffset = view.getUint32(record + mutation.insertOffset, true);
        const insertCount = view.getUint32(record + mutation.insertCount, true);
        const insert = String.fromCharCode(
          ...Array.from({ length: insertCount }, (_unitValue, unit) => view.getUint16(insertOffset + unit * 2, true)),
        );
        return {
          start: view.getUint32(record + mutation.textStart, true),
          deleteCount: view.getUint32(record + mutation.deleteCount, true),
          insert,
        };
      });
    },
  };
}

test('Text.measure answers attached first-frame state without traversing matrices or realizing draws', async () => {
  const instrumented = await createInstrumentedEngine();
  const font = await instrumented.fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const first = new Text({
    font,
    text: 'measure me before the frame',
    constraints: { width: { mode: 'exact', size: 180 } },
  });
  const second = new Text({ font, text: 'and me too' });
  first.position.set(12, 34, 0);
  second.position.set(56, 78, 0);

  assert.ok(first.measure().glyphCount > 0, 'detached Text measurement needs no matrix or render attachment');
  assert.deepEqual(first.commitState(), { status: 'unbound' });
  group.add(first, second);
  scene.add(group);
  const matricesBefore = [first, second, group, scene].map((object) => Array.from(object.matrix.elements));
  instrumented.reset();

  const firstMeasurement = first.measure();
  const secondMeasurement = second.measure();
  assert.ok(firstMeasurement.lineCount > 0);
  assert.ok(secondMeasurement.glyphCount > 0);
  assert.equal(firstMeasurement.inkBounds, undefined, 'the fast measurement path does not position glyph ink');
  assert.equal(instrumented.crossings, 0, 'measurement must not publish a full engine frame');
  assert.equal(instrumented.measureCrossings, 2, 'each new paragraph uses one scoped query');
  assert.equal(group.gpuBytes, 0, 'measurement must not realize renderer buffers');
  assert.equal(group.children.length, 2, 'measurement must not add renderer draw objects');
  for (const [index, object] of [first, second, group, scene].entries()) {
    assert.deepEqual(object.matrix.elements, matricesBefore[index], 'measurement must not update local matrices');
  }
  assert.deepEqual(first.commitState(), { status: 'pending' });
  assert.deepEqual(second.commitState(), { status: 'pending' });

  scene.updateMatrixWorld(true);
  assert.equal(group.error, undefined);
  assert.equal(instrumented.crossings, 1, 'the first traversal publishes exactly one full frame');
  assert.equal(
    instrumented.latestUpdateFlags & textShaperAbi.engine.resultFlags.checkpoint,
    textShaperAbi.engine.resultFlags.checkpoint,
    "the planner's first render plan is necessarily its initial checkpoint",
  );
  assert.equal(instrumented.measureCrossings, 2, 'publication must not repeat the host measurement query');
  assert.equal(first.commitState().status, 'committed');
  assert.equal(second.commitState().status, 'committed');
  assert.equal(first.boundingBox.isEmpty(), false, 'the first positioned publication must install ink bounds');
  assert.ok(first.boundingBox.max.x > first.boundingBox.min.x);
  assert.ok(first.boundingBox.max.y > first.boundingBox.min.y);
  assert.equal(
    instrumented.measureCrossings,
    2,
    'reading first-frame bounds must reuse the measurement published beside the render plan',
  );

  group.dispose();
  first.dispose();
  second.dispose();
  font.dispose();
  instrumented.fontDomain.dispose();
});

test('standalone Text.measure creates only its implicit measurement batch before traversal', async () => {
  const instrumented = await createInstrumentedEngine();
  const font = await instrumented.fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const label = new Text({ font, text: 'standalone first-frame measurement' });
  label.position.set(19, 23, 0);
  scene.add(label);
  const matricesBefore = [label, scene].map((object) => Array.from(object.matrix.elements));
  instrumented.reset();

  assert.ok(label.measure().glyphCount > 0);
  assert.equal(instrumented.crossings, 0);
  assert.equal(instrumented.measureCrossings, 1);
  const inspection = label.glyphs();
  assert.ok(inspection.inkBounds, 'explicit positioned inspection provides pre-frame ink bounds');
  assert.equal(instrumented.measureCrossings, 2);
  assert.equal(label.boundingBox.isEmpty(), false);
  assert.equal(instrumented.measureCrossings, 2, 'the Three box reuses the positioned inspection');
  assert.equal(label.gpuBytes, 0);
  assert.equal(label.children.length, 0);
  for (const [index, object] of [label, scene].entries()) {
    assert.deepEqual(object.matrix.elements, matricesBefore[index], 'measurement must not update local matrices');
  }
  assert.deepEqual(label.commitState(), { status: 'pending' });

  scene.updateMatrixWorld(true);
  assert.equal(instrumented.crossings, 1);
  assert.equal(instrumented.measureCrossings, 2, 'publication adopts the explicit queries instead of repeating them');
  assert.equal(label.commitState().status, 'committed');

  label.dispose();
  font.dispose();
  instrumented.fontDomain.dispose();
});

test('Bitmap strike changes fully initialize a replacement indexed batch', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(densityFontUrl)) },
    { technique: bitmap, options: { strikes: [16, 32] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
    font,
    rasterPixelRatio: 2,
    text: 'AB',
    style: { fontSize: 8 },
    constraints: { width: { mode: 'exact', size: 80 } },
    layout: { wrap: 'word' },
  });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  const initialDraw = group.children.find((child) => child.isMesh);
  assert.ok(initialDraw);
  const initialStart = initialDraw.userData.pmndrsGlyphRunStart;
  const initialOrigins = initialDraw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id)).array;
  const initialAdvance = initialOrigins[(initialStart + 1) * 2] - initialOrigins[initialStart * 2];

  label.style = { ...label.style, fontSize: 16 };
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'crossing from the 16 ppem strike to 32 ppem must publish successfully');
  const draw = group.children.find((child) => child.isMesh);
  assert.ok(draw);
  const start = draw.userData.pmndrsGlyphRunStart;
  const transforms = draw.geometry.getAttribute(glyphAttribute(threeSystemBuffers.transformIndex.id)).array;
  assert.deepEqual(Array.from(transforms.subarray(start, start + draw.geometry.instanceCount)), [1, 1]);
  const scaledOrigins = draw.geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.origin.id)).array;
  const scaledAdvance = scaledOrigins[(start + 1) * 2] - scaledOrigins[start * 2];
  assert.ok(
    Math.abs(scaledAdvance - initialAdvance * 2) < 1e-5,
    'a metric-only font-size mutation must rebuild advances without reshaping',
  );

  label.constraints = { ...label.constraints, width: { mode: 'exact', size: 40 } };
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'width-only reflow must retain the initialized transform stream');

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('multi-page Bitmap strikes remain one ordered texture-array draw', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(densityFontUrl)) },
    { technique: bitmap, options: { strikes: [16, 32] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup();
  const label = new Text({
    font,
    rasterPixelRatio: 2,
    text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 !?.,;:'.repeat(24),
    style: { fontSize: 16 },
    constraints: { width: { mode: 'exact', size: 480 } },
    layout: { wrap: 'word' },
  });
  group.add(label);
  scene.add(group);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  const draws = group.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 1, 'atlas page changes must select texture-array layers without fragmenting draws');
  assert.ok(
    draws[0].geometry.getAttribute(glyphAttribute(bitmapSchema.buffers.page.id)),
    'the Bitmap plan must publish a page-layer stream',
  );

  group.dispose();
  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('Rust ellipsis reshapes only the narrowed unsafe line boundary', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(amiriFontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const text = 'مرحبا بالعالم';

  const scene = new THREE.Scene();
  const label = new Text({
    font,
    text,
    style: { fontSize: 16 },
    constraints: { width: { mode: 'exact', size: 37 } },
    layout: { maxLines: 1, wrap: 'none', overflow: 'ellipsis' },
  });
  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.error, undefined);
  const inspection = label.glyphs();
  assert.ok(inspection);
  assert.equal(inspection.lineTextEnds[0], 3, 'the fixed width must preserve the unsafe-boundary fixture');
  assert.equal(inspection.clusters.at(-1), 3, 'the ellipsis is anchored at the truncation boundary');
  assert.deepEqual([...inspection.glyphIds], [61, 2613, 2598, 6597]);
  assert.deepEqual([...inspection.clusters], [2, 1, 0, 3]);
  // Re-pinned under the F26.6 layout-unit contract (integer-units slice 2b): the
  // RTL line's alignment offset derives from the quantized line advance, shifting
  // every glyph by one uniform sub-unit amount (+0.0134 px < 1/64). Deterministic
  // exactness holds under the new contract; the full-corpus re-derivation is the
  // plan's slice 5.
  assert.deepEqual([...inspection.x], [0.24537500739097595, 10.821374893188477, 18.389375686645508, 23.92537498474121]);

  label.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('TextGroup atomically replaces child paragraphs without multiplying retained text capacity', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup({ capacity: { size: 4_096, policy: 'grow' } });
  const first = [new Text({ font, text: 'A' }), new Text({ font, text: 'B' })];
  group.add(...first);
  scene.add(group);
  scene.updateMatrixWorld();

  const second = ['C', 'D', 'E'].map((text) => new Text({ font, text }));
  group.remove(...first);
  group.add(...second);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined);
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);
  assert.equal(group.children.find((child) => child.isMesh).geometry.instanceCount, 3);

  const third = ['Y', 'Z'].map((text) => new Text({ font, text }));
  group.remove(...second);
  group.add(...third);
  scene.updateMatrixWorld();
  assert.equal(group.error, undefined, 'a recycled Rust paragraph must not retain its previous semantic contents');
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);
  assert.equal(group.children.find((child) => child.isMesh).geometry.instanceCount, 2);

  group.dispose();
  for (const text of [...first, ...second, ...third]) text.dispose();
  font.dispose();
  fontDomain.dispose();
});

test('TextGroup grows aggregate glyph storage without reserving one aggregate-sized paragraph', async () => {
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup({ capacity: { size: 4_096, policy: 'chunk' } });
  const labels = Array.from({ length: 684 }, (_, index) => new Text({ font, text: `icon-${String(index)}` }));
  group.add(...labels);
  scene.add(group);
  scene.updateMatrixWorld();

  assert.equal(group.error, undefined);
  assert.equal(group.textCount, labels.length);
  assert.equal(group.children.filter((child) => child.isMesh).length, 1);

  for (let cycle = 0; cycle < 200; cycle += 1) {
    for (let offset = 0; offset < 48; offset += 1) {
      const index = (cycle * 23 + offset) % labels.length;
      labels[index].text = `recycled-${String(cycle)}-${String(index)}`;
    }
    scene.updateMatrixWorld();
    assert.equal(group.error, undefined, `recycling cycle ${String(cycle)} must remain publishable`);
  }

  group.dispose();
  for (const label of labels) label.dispose();
  font.dispose();
  fontDomain.dispose();
});

/**
 * Roadmap 11.17 layer 4: layout under a geometry-only change routes to the
 * paragraph-scoped synchronous engine query — no full planner updates, no
 * publication flips, no revision burn — and the following ordinary frame adopts the
 * speculative work without a checkpoint rebuild.
 */
test('repeated layout under changing constraints stays on the paragraph query path', async () => {
  const abi = textShaperAbi;
  const instrumented = await createInstrumentedEngine();
  const font = await instrumented.fontDomain.loadFont(
    { baked: dataUrl(await readFile(fontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const label = new Text({
    font,
    text: 'alpha beta gamma delta',
    constraints: { width: { mode: 'exact', size: 300 } },
  });
  scene.add(label);
  scene.updateMatrixWorld(true);
  assert.equal(label.error, undefined);
  const committedGeneration = instrumented.latestUpdateGeneration;
  instrumented.reset();

  const widths = [90, 150, 90, 240];
  for (const width of widths) {
    label.set({
      constraints: { width: { mode: 'exact', size: width } },
    });
    const measurement = label.measure();
    assert.ok(measurement, `width ${width} measures synchronously`);
    assert.ok(
      measurement.contentWidth <= width + 1e-3,
      `content width ${measurement.contentWidth} respects the queried width ${width}`,
    );
    assert.ok(measurement.lineCount >= 1, 'layout reports laid-out lines');
  }
  assert.equal(instrumented.crossings, 0, 'measurement never drives a full engine update');
  assert.equal(instrumented.measureCrossings, widths.length, 'each constraint change measures through one query');
  assert.equal(
    instrumented.latestUpdateGeneration,
    committedGeneration,
    'queries never flip the publication generation',
  );

  scene.updateMatrixWorld(true);
  assert.equal(label.error, undefined);
  assert.equal(instrumented.crossings, 1, 'one ordinary frame commits the final constraint');
  assert.equal(
    instrumented.latestUpdateFlags & abi.engine.resultFlags.checkpoint,
    0,
    'the committing frame proceeds from pre-layout revisions without a checkpoint rebuild',
  );
  assert.equal(label.measure().contentWidth <= 240 + 1e-3, true);
  label.dispose();
  font.dispose();
  instrumented.fontDomain.dispose();
});

test('a standard ligature that absorbs a grapheme publishes and keeps typing', async () => {
  // A ligature reports one glyph at the first grapheme of the pair, so the trailing
  // grapheme's cluster owns no glyph. It still belongs to the shaped run and positioning
  // still derives a scale for it, so the cluster arena must record the owning font's
  // units-per-em for it as well. Amiri applies `liga` to Latin f-pairs; Inter as baked
  // does not, which is why every existing Latin fixture missed this.
  const fontDomain = createThreeFontDomain();
  const font = await fontDomain.loadFont(
    { baked: dataUrl(await readFile(amiriFontUrl)) },
    { technique: bitmap, options: { strikes: [16] } },
  );
  const scene = new THREE.Scene();
  const group = new TextGroup({ batching: 'group' });
  scene.add(group);
  const text = new Text({
    font,
    text: '',
    style: { fontSize: 20, lineHeight: 1.25 },
    constraints: { width: { mode: 'exact', size: 600 } },
    layout: { wrap: 'word' },
  });
  group.add(text);

  const typed = 'meet office';
  for (let length = 1; length <= typed.length; length += 1) {
    text.text = typed.slice(0, length);
    scene.updateMatrixWorld(true);
    assert.equal(text.error, undefined, `typing "${typed.slice(0, length)}" must publish`);
  }
  const ligated = text.measure();
  assert.equal(ligated?.missingGlyphCount, 0, 'the ligature resolves to a real glyph');

  // The ligature genuinely absorbs graphemes: with `liga` off the same text needs more
  // glyphs, which is what makes the glyph-less trailing cluster reachable at all.
  text.style = { fontSize: 20, lineHeight: 1.25, features: [{ tag: 'liga', value: 0 }] };
  scene.updateMatrixWorld(true);
  assert.equal(text.error, undefined);
  const unligated = text.measure();
  assert.ok(
    unligated !== undefined && ligated !== undefined && unligated.glyphCount > ligated.glyphCount,
    `disabling liga must add glyphs (ligated ${ligated?.glyphCount}, unligated ${unligated?.glyphCount})`,
  );

  group.dispose();
  text.dispose();
  font.dispose();
  fontDomain.dispose();
});

function createThreeFontDomain(firstLoad, onDispose = () => {}) {
  const loader = new FontLoader();
  let initial = true;
  return {
    loadFont(input, raster) {
      const load = () =>
        Array.isArray(raster) ? loader.loadFontsAsync(input, raster) : loader.loadAsync({ input, raster });
      if (!initial || firstLoad === undefined) return load();
      initial = false;
      return firstLoad(load);
    },
    dispose() {
      onDispose();
      loader.dispose();
    },
  };
}

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
