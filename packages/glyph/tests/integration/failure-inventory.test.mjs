// Every way the text pipeline can fail, scripted once each, with the disposition the model gives it:
// where it is thrown, what state remains, and how it recovers. A frame here is a render: a failure found
// while rendering is thrown from that render, once. The table in
// `.agents/docs/planning/failure-inventory.md` names each row by its `id` here.
import { shaperInstanceCount, trapCallsWhen, trapNextCall, lastCallArguments } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig, ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';
import { renderScene } from '../support/three-render.mjs';

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
  return { handle, scene, add, frame: () => renderScene(scene) };
}

const inputError = (path) => ({ name: 'GlyphInputError', code: 'invalid-input', path });
const committed = (...texts) =>
  texts.every((text) => text.commitState().status === 'committed' && text.error === undefined);

const inventory = [
  {
    id: 'input-invalid-value',
    run(t) {
      const { add, frame } = mount(t);
      const label = add('kept');
      frame();
      const style = label.style;
      assert.throws(() => (label.style = { fontSize: Number.NaN }), inputError(['style']));
      assert.throws(() => (label.constraints = { width: { mode: 'exact', size: -1 } }), inputError(['constraints']));
      assert.throws(() => label.set({ text: 'both', layout: { maxLines: 0 } }), inputError(['layout']));
      assert.equal(label.style, style);
      assert.equal(label.text, 'kept', 'a refused update changes nothing, even its valid properties');
      assert.doesNotThrow(frame, "an input error is the caller's: the render does not throw it again");
      assert.ok(committed(label));
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
      const { add, frame } = mount(t);
      const [label, other] = [add('label'), add('other')];
      let refusal;
      label.onLayout = () => {
        try {
          other.text = 'written during the layout phase';
        } catch (error) {
          refusal = error;
        }
      };
      assert.doesNotThrow(frame, 'the refusal was thrown to the callback, which caught it');
      assert.equal(refusal?.code, 'layout-phase');
      assert.equal(other.text, 'other');
      assert.ok(committed(label, other));
    },
  },
  {
    id: 'layout-callback-throws',
    run(t) {
      const { add, frame } = mount(t);
      const [label, other] = [add('label'), add('other')];
      const failure = new Error('callback failed');
      label.onLayout = () => {
        throw failure;
      };
      let otherCalls = 0;
      other.onLayout = () => {
        otherCalls += 1;
      };
      assert.throws(frame, (error) => error === failure, 'the render throws the exception after drawing');
      assert.equal(otherCalls, 1, 'the other callback still ran');
      assert.ok(committed(label, other), 'the frame publishes; a callback exception is not a text error');
      assert.doesNotThrow(frame, 'the same summary is not handed over again');
    },
  },
  {
    id: 'engine-trap-in-read',
    run(t) {
      const { add, frame } = mount(t);
      const [label, other] = [add('label'), add('other')];
      frame();
      const instances = shaperInstanceCount();
      label.text = 'read through a trap';
      trapNextCall(/engine_measure_paragraph/);
      assert.equal(label.measure().glyphCount, 'readthroughatrap'.length + 3);
      assert.equal(shaperInstanceCount(), instances + 1, 'the engine was replaced and the read answered');
      assert.doesNotThrow(frame, 'a read that answers leaves nothing for the render to throw');
      assert.ok(committed(label, other));
    },
  },
  {
    id: 'engine-trap-in-frame',
    run(t) {
      const { add, frame } = mount(t);
      const [label, other] = [add('label'), add('other')];
      frame();
      label.text = 'changed';
      trapNextCall(/engine_prepare_batch/);
      assert.throws(frame, /trapped and was restarted/u);
      assert.equal(label.commitState().status, 'failed');
      assert.doesNotThrow(frame, 'the restart is thrown once');
      assert.ok(committed(label, other), 'the next frame restates every text; no setter was needed');
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
      // The first frame's batch traps and restarts the engine; the next one isolates and refuses the culprit.
      assert.throws(frame, /trapped and was restarted/u);
      assert.throws(frame, (error) => error === culprit.error);
      assert.ok(committed(texts[0], texts[2]), 'siblings publish');
      assert.equal(culprit.commitState().status, 'failed');
      assert.equal(culprit.text, 'b changed', 'the refused text keeps its value');
      assert.doesNotThrow(frame, 'a standing refusal is thrown once');
      dirty = false;
      culprit.text = 'harmless';
      assert.doesNotThrow(frame);
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
