// Seeded interleavings of everything an application can do between frames: setters, reads, frames,
// explicit preparation, mounting and unmounting, reparenting, layout callbacks, and fonts disposed
// right after the setter that named them. The model has no engine failure for any of these, so the
// assertion is absolute: no engine crossing returns a status other than OK, no read or frame throws,
// no text reports an error, the engine is never replaced, and every frame leaves every mounted text
// committed with the layout a cold text of the same value has. The one caller error in the mix is
// stated: a text whose font was disposed keeps drawing and reading, and its next setter that does not
// name a live font throws `GlyphInputError` at `['font']`.
import { recordNonOkCrossings, shaperInstanceCount } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { assertCommitted } from '../support/three-render.mjs';

const fixtures = new URL('../../../../benches/fixtures/rendering/', import.meta.url);
const fontBytes = {
  inter: await readFile(new URL('inter-bitmap-16.font.glb', fixtures)),
  amiri: await readFile(new URL('amiri-bitmap-16.font.glb', fixtures)),
};
const load = (name) => loadFont({ baked: { bytes: fontBytes[name] } }, bitmap({ strikes: [16] }));
await glyph.init();
const nonOk = recordNonOkCrossings(textShaperAbi.layouts.engineUpdateBatchEntry);

const corpus = [
  '',
  'a',
  'label',
  'The quick brown fox jumps over the lazy dog.',
  'two lines\nof text',
  'wrap '.repeat(40),
  'مرحبا بالعالم',
  'mixed مرحبا and latin 123',
  'emoji \u{1F600} and a lone \ud83d surrogate',
  'é combining and fi ligature office',
  '   leading and trailing   ',
  'tabs\tand spaces',
];
const widths = [undefined, 40, 120, 300];
const sizes = [8, 16, 23.5, 48];
const colors = ['#ffffff', '#ff0000', '#00ff0080'];

/** mulberry32: a small seeded generator, so a failing seed replays exactly. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const seeds = Number(process.env.GLYPH_INTERLEAVING_SEEDS ?? 64);
const steps = Number(process.env.GLYPH_INTERLEAVING_STEPS ?? 200);

for (let seed = 1; seed <= seeds; seed += 1) {
  test(`interleaving seed ${String(seed)}: ${String(steps)} steps never leave the OK path`, async () => {
    const next = random(seed);
    const pick = (values) => values[Math.floor(next() * values.length)];
    const fonts = { inter: await load('inter'), amiri: await load('amiri') };
    const handle = glyph.handle(`three:interleaving:${String(seed)}`, ThreeConfig);
    const cold = glyph.handle(`three:interleaving:cold:${String(seed)}`, ThreeConfig);
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    scene.add(group);
    if (next() < 0.5) handle.attach(scene);
    const texts = [];
    const disposedFont = new Set();
    /** Runs one setter. A text whose font was disposed refuses it at `['font']` and is then given a live font. */
    const write = (setter) => {
      const text = pick(texts);
      if (!disposedFont.has(text)) return setter(text);
      assert.throws(() => setter(text), { name: 'GlyphInputError', code: 'invalid-input', path: ['font'] });
      text.font = fonts[pick(['inter', 'amiri'])];
      disposedFont.delete(text);
      return setter(text);
    };
    const trace = [];
    const instances = shaperInstanceCount();
    const layoutCalls = new Map();
    const mount = () => {
      const text = handle.createText({ font: fonts[pick(['inter', 'amiri'])], text: pick(corpus) });
      (next() < 0.5 ? scene : group).add(text);
      if (next() < 0.3) {
        text.onLayout = (target, layout) => {
          layoutCalls.set(target, (layoutCalls.get(target) ?? 0) + 1);
          target.position.x = -layout.width / 2;
        };
      }
      texts.push(text);
    };
    const operations = {
      mount,
      unmount: () => {
        if (texts.length <= 1) return;
        const [text] = texts.splice(Math.floor(next() * texts.length), 1);
        disposedFont.delete(text);
        text.removeFromParent();
        text.dispose();
      },
      // A plain string replaces the content alone and restates nothing else, a disposed font included.
      text: () => {
        pick(texts).text = pick(corpus);
      },
      size: () =>
        write((text) => {
          text.style = { ...text.style, fontSize: pick(sizes) };
        }),
      paint: () =>
        write((text) => {
          text.style = { ...text.style, color: pick(colors) };
        }),
      constraints: () =>
        write((text) => {
          const width = pick(widths);
          text.constraints = width === undefined ? {} : { width: { mode: 'exact', size: width } };
        }),
      anchor: () =>
        write((text) => {
          text.constraints = { ...text.constraints, anchor: { x: pick(['left', 'center', 'right']), y: 'middle' } };
        }),
      layout: () =>
        write((text) => {
          text.layout = { align: pick(['start', 'center', 'end']), wrap: pick(['word', 'none']) };
        }),
      several: () =>
        write((text) => text.set({ text: pick(corpus), style: { fontSize: pick(sizes) }, layout: { wrap: 'word' } })),
      move: () => {
        pick(texts).position.set(next() * 100, next() * 100, 0);
      },
      reparent: () => {
        (next() < 0.5 ? scene : group).add(pick(texts));
      },
      measure: () => {
        pick(texts).measure();
      },
      glyphs: () => {
        pick(texts).glyphs();
      },
      box: () => {
        pick(texts).computeBoundingBox();
      },
      prepare: () => glyph.prepare(),
      // The text takes its own lease in the setter, so the caller's lease may end before any frame.
      transientFont: async () => {
        const transient = await load(pick(['inter', 'amiri']));
        const text = pick(texts);
        text.font = transient;
        transient.dispose();
        disposedFont.add(text);
      },
      frame: () => {
        scene.updateMatrixWorld(true);
        for (const text of texts) {
          assertCommitted(text);
          assert.equal(text.commitState().status, 'committed');
        }
      },
    };
    const names = Object.keys(operations);
    try {
      mount();
      mount();
      for (let step = 0; step < steps; step += 1) {
        // Frames are a third of the steps, so runs of setters and reads of every length occur between them.
        const name = next() < 0.33 ? 'frame' : pick(names);
        trace.push(name);
        try {
          await operations[name]();
        } catch (error) {
          error.message = `seed ${String(seed)} step ${String(step)} (${trace.slice(-12).join(', ')}): ${error.message}`;
          throw error;
        }
        assert.deepEqual(nonOk, [], `seed ${String(seed)} step ${String(step)} (${trace.slice(-12).join(', ')})`);
      }
      operations.frame();
      assert.deepEqual(nonOk, []);
      assert.equal(shaperInstanceCount(), instances, 'the engine was never replaced');
      // Whatever the history, a text lays out as a cold text of the same value does.
      for (const text of texts) {
        if (disposedFont.has(text)) continue;
        const reference = cold.createText({
          font: text.font,
          text: text.text,
          style: text.style,
          layout: text.layout,
          constraints: text.constraints,
        });
        const [actual, expected] = [text.glyphs(), reference.glyphs()];
        assert.deepEqual([...actual.glyphIds], [...expected.glyphIds], JSON.stringify(text.text));
        assert.deepEqual([...actual.x], [...expected.x], JSON.stringify(text.text));
        assert.deepEqual([...actual.y], [...expected.y], JSON.stringify(text.text));
        const [summary, coldSummary] = [text.measure(), reference.measure()];
        assert.deepEqual(
          [summary.width, summary.height, summary.lineCount],
          [coldSummary.width, coldSummary.height, coldSummary.lineCount],
        );
        reference.dispose();
      }
    } finally {
      nonOk.length = 0;
      handle.dispose();
      cold.dispose();
      fonts.inter.dispose();
      fonts.amiri.dispose();
    }
  });
}
