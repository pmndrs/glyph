// Preparation cannot take a root down: a failure is one paragraph's, a trap replaces the engine and
// every owner restates itself, and a failed frame is retried by the next one.
import {
  crossingsOf,
  lastCallArguments,
  refuseSynchronousInstances,
  shaperInstanceCount,
  trapCallsWhen,
  trapNextCall,
} from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig, ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';
import { createFontCache, timeout } from '../support/text-mutation-lanes.mjs';
import { renderScene } from '../support/three-render.mjs';

const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap({ strikes: [16] }) } });
const run = promisify(execFile);
const scenario = fileURLToPath(new URL('../support/capped-memory-scenario.mjs', import.meta.url));
let nextHandle = 1;

test.after(() => fonts.dispose());

async function createScene(t, config = ThreeConfig) {
  const font = await fonts.load('inter');
  const handle = glyph.handle(`three:containment:${String(nextHandle++)}`, config);
  t.after(() => handle.dispose());
  const scene = new THREE.Scene();
  const add = (properties) => {
    const text = handle.createText({ font, ...properties });
    scene.add(text);
    return text;
  };
  return { add, scene, frame: () => scene.updateMatrixWorld(true), render: () => renderScene(scene) };
}

const layoutOf = (text) => {
  const glyphs = text.glyphs();
  return { width: text.measure().width, glyphIds: [...glyphs.glyphIds], x: [...glyphs.x], y: [...glyphs.y] };
};

for (const recovery of ['shrink', 'dispose']) {
  for (const maxPages of [300, 500, 700, 1_000, 4_000]) {
    test(
      `at ${String(maxPages)} pages of memory the sibling works and the victim can ${recovery}`,
      { timeout },
      async () => {
        const { stdout } = await run(process.execPath, [scenario, String(maxPages), recovery]);
        const report = JSON.parse(stdout.trim().split('\n').at(-1));
        assert.ok(report.failure !== undefined, 'the paragraph grew until the engine refused it');
        assert.equal(report.failure.where, 'frame', 'a setter never fails for a layout reason');
        assert.equal(report.victimKeptItsValue, true);
        assert.deepEqual(report.siblingRead, { value: true }, 'the sibling still measures what it measured');
        assert.equal(report.recovery.threw, undefined, `recovery threw: ${String(report.recovery.threw)}`);
        assert.equal(report.recovery.value.sibling, 'committed');
        if (recovery === 'shrink') {
          assert.equal(report.recovery.value.victim, 'committed');
          assert.equal(report.recovery.value.error, undefined);
          assert.equal(report.recovery.value.glyphs, 'small again'.length);
        }
        assert.deepEqual(report.siblingAfter, { value: { status: 'committed', error: true } });
        // A paragraph refused at its own preparation never reaches its sibling. A publication that no
        // longer fits, the 300-page case, fails that one frame for the root; the paragraph that does not
        // fit is then withheld, so the sibling publishes from the next frame on while the victim stays failed.
        if (/prepare text failed/.test(report.failure.error)) assert.equal(report.siblingErrorAtFailure, undefined);
        assert.deepEqual(report.siblingSet, { value: 'committed' });
        assert.deepEqual(report.victimWhileSiblingPublishes, { value: { status: 'failed', reportsItsError: true } });
      },
    );
  }
}

test('a text longer than maxTextUnits is refused by its setter', { timeout }, async (t) => {
  const { add, frame } = await createScene(t, defineThreeConfig({ maxTextUnits: 100 }));
  const text = add({ text: 'short' });
  frame();
  assert.throws(() => {
    text.text = 'x'.repeat(101);
  }, /101 UTF-16 units; one text accepts at most 100/u);
  assert.equal(text.text, 'short', 'the previous value stays');
  assert.throws(() => add({ text: 'y'.repeat(101) }), /at most 100/u);
  text.text = 'z'.repeat(100);
  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.equal(text.commitState().status, 'committed');
});

test('a read that traps restarts the engine and answers', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add({ text: 'before the trap' });
  const sibling = add({ text: 'sibling' });
  frame();
  const instances = shaperInstanceCount();
  text.text = 'after the trap';
  trapNextCall(/engine_measure_paragraph/);
  const width = text.measure().width;
  assert.equal(shaperInstanceCount(), instances + 1, 'the engine instance was replaced');
  const cold = await createScene(t);
  assert.deepEqual(layoutOf(text), layoutOf(cold.add({ text: 'after the trap' })));
  assert.equal(width, text.measure().width);
  frame();
  assert.equal(text.commitState().status, 'committed');
  assert.equal(sibling.commitState().status, 'committed');
  assert.deepEqual(layoutOf(sibling), layoutOf(cold.add({ text: 'sibling' })));
});

for (const call of ['engine_prepare_batch', 'engine_update_batch']) {
  test(`a frame whose ${call} traps is retried by the next frame`, { timeout }, async (t) => {
    const { add, frame, render } = await createScene(t);
    const texts = Array.from({ length: 20 }, (_, index) => add({ text: `label ${String(index)}` }));
    frame();
    for (const [index, text] of texts.entries()) text.text = `value ${String(index)}`;
    const instances = shaperInstanceCount();
    trapNextCall(new RegExp(call, 'u'));
    assert.doesNotThrow(frame, 'a trap never escapes scene traversal');
    assert.equal(shaperInstanceCount(), instances + 1);
    assert.equal(texts[3].commitState().status, 'failed');
    assert.throws(render, /trapped and was restarted/u, 'the render that follows throws the trap');
    assert.doesNotThrow(render, 'and throws it once');
    // No setter and no read in between: the next frame restates every text on the new instance.
    frame();
    const cold = await createScene(t);
    for (const [index, text] of texts.entries()) {
      assert.equal(text.commitState().status, 'committed', `label ${String(index)}`);
      assert.equal(text.error, undefined);
    }
    assert.deepEqual(layoutOf(texts[7]), layoutOf(cold.add({ text: 'value 7' })));
    texts[0].text = 'still editable';
    assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  });
}

test('a paragraph whose input always traps is refused alone', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const texts = Array.from({ length: 6 }, (_, index) => add({ text: `label ${String(index)}` }));
  frame();
  const culprit = texts[2];
  culprit.measure();
  const culpritParagraph = lastCallArguments('engine_measure_paragraph')[3];
  for (const [index, text] of texts.entries()) text.text = `value ${String(index)}`;
  // Whatever holds the culprit's input traps: every batch while it is dirty, and its own request.
  let culpritDirty = true;
  trapCallsWhen(
    (name, args) =>
      (name === 'engine_prepare_batch' && culpritDirty) ||
      (name === 'engine_measure_paragraph' && args[3] === culpritParagraph && culpritDirty),
  );
  t.after(() => trapCallsWhen(undefined));
  frame();
  frame();
  for (const [index, text] of texts.entries()) {
    if (text === culprit) continue;
    assert.equal(text.commitState().status, 'committed', `label ${String(index)} is unaffected`);
    assert.equal(text.error, undefined);
    assert.equal(text.measure().glyphCount, `value ${String(index)}`.replaceAll(' ', '').length + 1);
  }
  assert.equal(culprit.commitState().status, 'failed');
  assert.match(String(culprit.error.message), /trapped/u);
  assert.equal(culprit.text, 'value 2', 'the culprit keeps the value it was given');
  // New input is a new chance.
  culpritDirty = false;
  culprit.text = 'harmless';
  frame();
  assert.equal(culprit.commitState().status, 'committed');
  assert.equal(culprit.error, undefined);
  const cold = await createScene(t);
  assert.deepEqual(layoutOf(culprit), layoutOf(cold.add({ text: 'harmless' })));
});

test('a font disposed between a setter and the frame cannot fail the preparation', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add({ text: 'leased' });
  frame();
  const bytes = await readFile(
    new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url),
  );
  const transient = await loadFont({ baked: { bytes } }, bitmap({ strikes: [16] }));
  text.set({ font: transient, text: 'set with a font that is then disposed' });
  transient.dispose();
  assert.doesNotThrow(frame);
  assert.equal(text.error, undefined);
  assert.equal(text.commitState().status, 'committed');
  assert.equal(text.measure().glyphCount, 'set with a font that is then disposed'.length);
});

test('where an instance cannot be made synchronously the engine restarts asynchronously', { timeout }, async (t) => {
  const { add, frame } = await createScene(t);
  const text = add({ text: 'before' });
  frame();
  text.text = 'after an asynchronous restart';
  refuseSynchronousInstances(true);
  t.after(() => refuseSynchronousInstances(false));
  const instances = shaperInstanceCount();
  trapNextCall(/engine_measure_paragraph/);
  assert.throws(() => text.measure(), /trapped and is restarting/u);
  assert.equal(text.error, undefined, "a restart is not this text's failure");
  assert.throws(() => text.measure(), /restarting/u, 'reads fail until the new instance lands');
  assert.doesNotThrow(() => {
    text.text = 'setters never enter the engine';
  });
  assert.doesNotThrow(frame, 'a frame during the restart leaves the last draws alone');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shaperInstanceCount(), instances + 1);
  frame();
  assert.equal(text.commitState().status, 'committed');
  const cold = await createScene(t);
  assert.deepEqual(layoutOf(text), layoutOf(cold.add({ text: 'setters never enter the engine' })));
});
