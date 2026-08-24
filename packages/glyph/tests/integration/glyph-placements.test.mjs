/**
 * The animation and measurement surface: units, extents, identity, and hit testing.
 *
 * Each test states an invariant the API is supposed to guarantee, and checks it against something
 * that is not the same code path -- the engine's own line advance, the paragraph's own glyph count,
 * a second paragraph built from scratch -- rather than against a recorded value. A golden here would
 * only prove the implementation reproduces itself.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

import { createTextRuntime, FontRegistry, glyphFlags } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { Text, TextGroup } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16-32.font.glb', import.meta.url);
const shaperWasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const dataUrl = (bytes) => `data:model/gltf-binary;base64,${bytes.toString('base64')}`;

let runtime;
let loaded;

async function loadFont() {
  if (loaded !== undefined) return loaded;
  runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  loaded = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16, 32] } },
  });
  return loaded;
}

after(() => {
  runtime?.dispose();
  runtime = undefined;
  loaded = undefined;
});

function mount(font, text, properties = {}) {
  const scene = new THREE.Scene();
  const group = new TextGroup({});
  scene.add(group);
  const node = new Text({ font, style: { fontSize: 16 }, text, ...properties });
  group.add(node);
  scene.updateMatrixWorld(true);
  return { group, node, scene };
}

function unmount(mounted) {
  mounted.node.dispose();
  mounted.group.dispose();
}

test('glyphs, words, and lines partition the paragraph without the caller deriving membership', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'one two three', {
    contentBox: { width: { mode: 'exact', size: 60 }, wrap: 'word' },
  });
  try {
    const placements = mounted.node.snapshotGlyphs();
    assert.ok(placements.lines.length > 1, 'the fixture must wrap so line membership is not trivial');
    assert.equal(placements.words.length, 3, 'three space-separated runs are three words');

    // Every glyph belongs to exactly the line and word that claim it. A caller never has to check.
    for (const line of placements.lines) {
      for (const glyph of line.glyphs) assert.equal(glyph.line, line.index);
    }
    for (const word of placements.words) {
      for (const glyph of word.glyphs) assert.equal(glyph.word, word.index);
    }
    // Lines cover every glyph; words cover every glyph that is not a separator.
    assert.equal(
      placements.lines.reduce((total, line) => total + line.glyphCount, 0),
      placements.glyphs.length,
    );
    assert.ok(placements.words.every((word) => word.glyphCount > 0));
    const worded = placements.glyphs.filter((glyph) => glyph.word >= 0).length;
    assert.equal(
      worded,
      placements.words.reduce((total, word) => total + word.glyphCount, 0),
    );
    // No word straddles a line, which is what makes a per-word stagger present coherently.
    for (const word of placements.words) {
      assert.equal(new Set(word.glyphs.map((glyph) => glyph.line)).size, 1);
    }
  } finally {
    unmount(mounted);
  }
});

test('advance and ink extents are different numbers, and each agrees with the engine', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'Wavy');
  try {
    const placements = mounted.node.snapshotGlyphs();
    const summary = mounted.node.measure();
    const line = placements.lines[0];

    // The per-glyph advances must sum to the line advance the engine derived independently in f64.
    // Each glyph's advance crosses the wire as f32, so the comparison is relative: the tolerance is
    // accumulated single-precision error over the line, not a fudge factor for a wrong number.
    const advanceSum = line.glyphs.reduce((total, glyph) => total + glyph.advance, 0);
    const lineAdvance = summary.lines[0].advance;
    assert.ok(
      Math.abs(advanceSum - lineAdvance) / lineAdvance < 1e-3,
      `glyph advances summed to ${advanceSum}, but the line advance is ${lineAdvance}`,
    );

    // Ink is not the advance box. Publishing only one of them is what makes visual centring wrong.
    assert.ok(line.ink.width > 0);
    assert.notEqual(line.ink.width, line.bounds.width);
    assert.ok(summary.inkBounds !== undefined, 'a positioned paragraph reports its ink');
    assert.ok(Math.abs(summary.inkBounds.width - line.ink.width) < 1e-3);

    // Ascent and descent decompose the line box exactly, which is what a baseline aligner needs.
    assert.ok(Math.abs(line.ascent + line.descent - line.lineHeight) < 1e-6);
    assert.ok(line.ascent > 0 && line.descent > 0);
    assert.equal(summary.ascent, summary.firstBaseline);

    // Each glyph's ink sits inside its own line box and follows the glyph when it moves.
    const glyph = line.glyphs[0];
    const restInk = glyph.ink;
    glyph.x += 5;
    glyph.y -= 2;
    assert.equal(glyph.ink.x, restInk.x + 5);
    assert.equal(glyph.ink.y, restInk.y - 2);
    assert.equal(glyph.ink.width, restInk.width, 'moving a glyph must not resize its ink');
  } finally {
    unmount(mounted);
  }
});

test('identity survives a reflow that moves glyphs and not one that reshapes them', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'ABCD');
  try {
    const before = mounted.node.snapshotGlyphs();
    const beforeKeys = before.glyphs.map((glyph) => glyph.key);

    // Geometry only: the same glyphs, moved. Every key must survive, which is what makes a
    // transition possible at all.
    mounted.node.style = { fontSize: 32 };
    mounted.scene.updateMatrixWorld(true);
    const resized = mounted.node.snapshotGlyphs();
    assert.deepEqual(
      resized.glyphs.map((glyph) => glyph.key),
      beforeKeys,
      'a size change must not change any glyph identity',
    );
    const moved = resized.adopt(before);
    assert.equal(moved.matched, resized.glyphs.length);
    assert.equal(moved.unmatched, 0);
    assert.equal(moved.dropped, 0);
    // Adoption puts each glyph where it used to be drawn, which is the start of an interpolation.
    for (const [index, glyph] of resized.glyphs.entries()) {
      assert.equal(glyph.x, before.glyphs[index].x, 'adoption must place each glyph where it was drawn');
    }
    // The first glyph sits at the origin at every size, so the reflow is only proved to have moved
    // anything by a glyph that is not pinned there.
    assert.ok(
      resized.glyphs.some((glyph) => glyph.x !== glyph.shapedX),
      'the resized layout must actually have moved the glyphs',
    );

    // Reshaping: the glyph stream is replaced, and the report says so rather than pretending.
    mounted.node.text = 'WXYZ';
    mounted.scene.updateMatrixWorld(true);
    const reshaped = mounted.node.snapshotGlyphs();
    const replaced = reshaped.adopt(resized);
    assert.equal(replaced.matched, 0, 'no glyph of WXYZ is a glyph of ABCD');
    assert.equal(replaced.unmatched, reshaped.glyphs.length);
    assert.equal(replaced.dropped, resized.glyphs.length);
    for (const glyph of reshaped.glyphs) assert.equal(glyph.x, glyph.shapedX);
  } finally {
    unmount(mounted);
  }
});

test('a snapshot is internally consistent and restores without the caller sequencing it', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'reset me');
  try {
    const placements = mounted.node.snapshotGlyphs();
    // The invariant the one real consumer used to hand-check over six public arrays.
    assert.equal(placements.glyphs.length, mounted.node.measure().glyphCount);
    for (const [index, glyph] of placements.glyphs.entries()) assert.equal(glyph.index, index);
    assert.equal(placements.space, 'paragraph');

    placements.lines[0].translate(3, 4);
    for (const glyph of placements.lines[0].glyphs) {
      assert.equal(glyph.x, glyph.shapedX + 3);
      assert.equal(glyph.y, glyph.shapedY + 4);
    }
    placements.reset();
    for (const glyph of placements.glyphs) {
      assert.equal(glyph.x, glyph.shapedX);
      assert.equal(glyph.y, glyph.shapedY);
    }

    // `reset` is snapshot-local; `restoreGlyphs` is what hands the paragraph back to the layout.
    placements.words[0].translate(0, -20);
    mounted.node.applyGlyphs(placements);
    assert.notEqual(mounted.node.snapshotGlyphs().glyphs[0].y, placements.glyphs[0].shapedY);
    mounted.node.restoreGlyphs();
    for (const glyph of mounted.node.snapshotGlyphs().glyphs) assert.equal(glyph.y, glyph.shapedY);
  } finally {
    unmount(mounted);
  }
});

test('caret and selection resolve to clusters and stay inside the line box', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'hi there');
  try {
    const placements = mounted.node.snapshotGlyphs();
    const line = placements.lines[0];

    // A point at the far left resolves to the first cluster's leading edge; the far right to the
    // end. Both carry the line's own height rather than a guessed one.
    const start = placements.caretAt(-1000, line.baseline);
    assert.equal(start.line, 0);
    assert.equal(start.offset, 0);
    assert.equal(start.leading, true);
    assert.equal(start.rect.height, line.lineHeight);
    assert.equal(start.rect.width, 0);
    assert.equal(start.rect.y, line.baseline - line.ascent);

    const end = placements.caretAt(1000, line.baseline);
    assert.equal(end.leading, false);
    assert.ok(end.rect.x > start.rect.x);

    // Every caret the surface can produce lands on a cluster boundary the layout actually has.
    const clusters = new Set(placements.glyphs.map((glyph) => glyph.cluster));
    for (let x = -20; x < 200; x += 7) {
      const caret = placements.caretAt(x, line.baseline);
      assert.ok(
        clusters.has(caret.offset) || caret.offset === line.textEnd,
        `caret offset ${caret.offset} is not a cluster`,
      );
    }

    // A selection over the whole line is one rectangle spanning it; an empty range is none.
    assert.deepEqual(placements.selectionRects(3, 3), []);
    const whole = placements.selectionRects(0, 'hi there'.length);
    assert.equal(whole.length, 1);
    assert.equal(whole[0].height, line.lineHeight);
    assert.equal(whole[0].y, line.baseline - line.ascent);
    const partial = placements.selectionRects(0, 2);
    assert.equal(partial.length, 1);
    assert.ok(partial[0].width < whole[0].width, 'a shorter range must select a narrower rectangle');
    assert.ok(partial[0].width > 0);
  } finally {
    unmount(mounted);
  }
});

test('glyph flags decode through exported names rather than remembered indices', async () => {
  const font = await loadFont();
  const mounted = mount(font, 'flags');
  try {
    const inspection = mounted.node.glyphs();
    assert.equal(inspection.glyphFlags.length, inspection.glyphCount);
    assert.equal(glyphFlags.produced, glyphFlags.unsafeToBreak | glyphFlags.unsafeToConcat);
    // The engine never sets a bit outside the set it publishes a name for, so a consumer testing
    // against `produced` is testing against the whole reachable vocabulary.
    for (const flags of inspection.glyphFlags) assert.equal(flags & ~glyphFlags.produced, 0);
  } finally {
    unmount(mounted);
  }
});

test('a committed paragraph reports its commit state rather than the absence of an error', async () => {
  const font = await loadFont();
  const scene = new THREE.Scene();
  const node = new Text({ font, style: { fontSize: 16 }, text: 'ready' });
  try {
    assert.deepEqual(node.commitState(), { status: 'unbound' }, 'an unparented Text is not merely error-free');
    scene.add(node);
    assert.equal(node.commitState().status, 'pending', 'an added but unsynchronized Text has not committed');
    scene.updateMatrixWorld(true);
    const committed = node.commitState();
    assert.equal(committed.status, 'committed');
    assert.equal(typeof committed.revision, 'number');
    // A change is pending until the next world update, which is the signal a caller needs to know
    // whether a measurement describes what they asked for.
    node.text = 'ready again';
    assert.equal(node.commitState().status, 'pending');
    scene.updateMatrixWorld(true);
    assert.equal(node.commitState().status, 'committed');
    assert.notEqual(node.commitState().revision, committed.revision);
  } finally {
    node.dispose();
  }
});
