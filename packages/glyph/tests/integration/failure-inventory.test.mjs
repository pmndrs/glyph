// Every way the text pipeline can fail, scripted once each, with the disposition the model gives it:
// who is told, what state remains, and how it recovers. The table in
// `.agents/docs/planning/failure-inventory.md` names each row by its `id` here.
import { shaperInstanceCount, trapCallsWhen, trapNextCall, lastCallArguments } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig, ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';

const bytes = await readFile(
  new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url),
);
const load = () => loadFont({ baked: { bytes } }, bitmap({ strikes: [16] }));
await glyph.init();
const font = await load();
let nextHandle = 1;

function mount(t, config = ThreeConfig) {
  const handle = glyph.handle(`three:failure-inventory:${String(nextHandle++)}`, config);
  t.after(() => {
    trapCallsWhen(undefined);
    handle.dispose();
  });
  const scene = new THREE.Scene();
  const add = (text, options = {}) => {
    const object = handle.createText({ font, text, ...options });
    scene.add(object);
    return object;
  };
  const reports = { root: [] };
  handle.onError = (error) => reports.root.push(error);
  return { handle, scene, add, reports, frame: () => scene.updateMatrixWorld(true) };
}

const inputError = (path) => ({ name: 'GlyphInputError', code: 'invalid-input', path });
const committed = (...texts) =>
  texts.every((text) => text.commitState().status === 'committed' && text.error === undefined);

const inventory = [
  {
    id: 'input-invalid-value',
    run(t) {
      const { add, frame, reports } = mount(t);
      const label = add('kept');
      frame();
      const style = label.style;
      assert.throws(() => (label.style = { fontSize: Number.NaN }), inputError(['style']));
      assert.throws(() => (label.constraints = { width: { mode: 'exact', size: -1 } }), inputError(['constraints']));
      assert.throws(() => label.set({ text: 'both', layout: { maxLines: 0 } }), inputError(['layout']));
      assert.equal(label.style, style);
      assert.equal(label.text, 'kept', 'a refused update changes nothing, even its valid properties');
      frame();
      assert.ok(committed(label));
      assert.deepEqual(reports.root, [], "an input error is the caller's: nothing is reported elsewhere");
    },
  },
  {
    id: 'input-text-too-long',
    run(t) {
      const { add, frame } = mount(t, defineThreeConfig({ maxTextUnits: 64 }));
      const label = add('short');
      assert.throws(() => (label.text = 'x'.repeat(65)), inputError(['text']));
      assert.throws(() => add('y'.repeat(65)), inputError(['text']));
      assert.equal(label.text, 'short');
      frame();
      assert.ok(committed(label));
    },
  },
  {
    id: 'input-disposed-font',
    async run(t) {
      const { add, frame } = mount(t);
      const label = add('before');
      const transient = await load();
      label.set({ font: transient, text: 'drawn with a font disposed right after' });
      transient.dispose();
      frame();
      assert.ok(committed(label), 'the text holds its own lease, so the frame and reads are unaffected');
      assert.equal(label.measure().glyphCount, label.text.length);
      label.text = 'a plain string restates nothing else';
      assert.throws(() => (label.style = { fontSize: 20 }), inputError(['font']));
      label.set({ font, style: { fontSize: 20 } });
      frame();
      assert.ok(committed(label));
    },
  },
  {
    id: 'layout-phase-write',
    run(t) {
      const { add, frame, reports } = mount(t);
      const [label, other] = [add('label'), add('other')];
      let refusal;
      label.onLayout = () => {
        try {
          other.text = 'written during the layout phase';
        } catch (error) {
          refusal = error;
        }
      };
      frame();
      assert.equal(refusal?.code, 'layout-phase');
      assert.equal(other.text, 'other');
      assert.ok(committed(label, other));
      assert.deepEqual(reports.root, []);
    },
  },
  {
    id: 'layout-callback-throws',
    run(t) {
      const { add, frame, reports } = mount(t);
      const [label, other] = [add('label'), add('other')];
      const failure = new Error('callback failed');
      const text = [];
      label.onError = (error) => text.push(error);
      label.onLayout = () => {
        throw failure;
      };
      let otherCalls = 0;
      other.onLayout = () => {
        otherCalls += 1;
      };
      assert.doesNotThrow(frame);
      assert.deepEqual([text, reports.root, otherCalls], [[failure], [failure], 1]);
      assert.ok(committed(label, other), 'the frame publishes; a callback exception is not a text error');
    },
  },
  {
    id: 'engine-trap-in-read',
    run(t) {
      const { add, frame, reports } = mount(t);
      const [label, other] = [add('label'), add('other')];
      frame();
      const instances = shaperInstanceCount();
      label.text = 'read through a trap';
      trapNextCall(/engine_measure_paragraph/);
      assert.equal(label.measure().glyphCount, 'readthroughatrap'.length + 3);
      assert.equal(shaperInstanceCount(), instances + 1, 'the engine was replaced and the read answered');
      frame();
      assert.ok(committed(label, other));
      assert.deepEqual(reports.root, [], 'a read that answers reports nothing');
    },
  },
  {
    id: 'engine-trap-in-frame',
    run(t) {
      const { add, frame, reports } = mount(t);
      const [label, other] = [add('label'), add('other')];
      frame();
      label.text = 'changed';
      trapNextCall(/engine_prepare_batch/);
      assert.doesNotThrow(frame);
      assert.equal(label.commitState().status, 'failed');
      assert.equal(reports.root.length, 1);
      assert.match(String(reports.root[0].message), /trapped and was restarted/u);
      frame();
      assert.ok(committed(label, other), 'the next frame restates every text; no setter was needed');
      assert.equal(reports.root.length, 1);
    },
  },
  {
    id: 'engine-refuses-one-paragraph',
    run(t) {
      const { add, frame } = mount(t);
      const texts = ['a', 'b', 'c'].map((text) => add(text));
      frame();
      const culprit = texts[1];
      culprit.measure();
      const paragraph = lastCallArguments('engine_measure_paragraph')[3];
      for (const text of texts) text.text = `${text.text} changed`;
      let dirty = true;
      trapCallsWhen(
        (name, args) =>
          dirty && (name === 'engine_prepare_batch' || (name === 'engine_measure_paragraph' && args[3] === paragraph)),
      );
      frame();
      frame();
      assert.ok(committed(texts[0], texts[2]), 'siblings publish');
      assert.equal(culprit.commitState().status, 'failed');
      assert.equal(culprit.text, 'b changed', 'the refused text keeps its value');
      dirty = false;
      culprit.text = 'harmless';
      frame();
      assert.ok(committed(...texts), 'new input is a new chance');
    },
  },
  {
    id: 'use-after-dispose',
    run(t) {
      const { add, frame } = mount(t);
      const [label, other] = [add('label'), add('other')];
      frame();
      label.dispose();
      assert.throws(() => (label.text = 'late'), /disposed/u);
      assert.throws(() => label.measure(), /disposed/u);
      label.removeFromParent();
      frame();
      assert.ok(committed(other));
    },
  },
];

for (const { id, run } of inventory) test(`failure inventory: ${id}`, (t) => run(t));
