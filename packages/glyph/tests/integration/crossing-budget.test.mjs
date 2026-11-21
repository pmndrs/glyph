// The crossing budget of the preparation model: how many times each operation enters Wasm.
//
// A setter, a read and a frame each have a fixed cost in engine calls. This table is the guard
// against a change that hides layout behind a setter, repeats it in a frame, or makes one read
// prepare its siblings. Change a row only together with the behaviour it describes.
import { crossingsOf } from '../support/wasm-crossings.mjs';

import assert from 'node:assert/strict';
import test from 'node:test';

import { bitmap } from '@pmndrs/glyph';
import * as THREE from 'three/webgpu';
import { createFontCache, mount, timeout, unmount } from '../support/text-mutation-lanes.mjs';

const LABELS = 200;

/** Engine crossings per operation, for a root of `LABELS` labels. */
const BUDGET = {
  'mount: construct and attach N labels, then one frame': { engine_prepare_batch: 1, engine_update_batch: 1 },
  'idle: a traversal with nothing dirty': {},
  'setter: N text setters': {},
  'setter + frame: the frame after N setters': { engine_prepare_batch: 1, engine_update_batch: 1 },
  'read: first measure of a clean label': { engine_measure_paragraph: 1 },
  'read: second measure of the same label': {},
  'setter + read: one read among N dirty siblings': { engine_measure_paragraph: 1 },
  'setter + read: reading every remaining dirty label': { engine_measure_paragraph: LABELS - 1 },
  'frame after reads': { engine_update_batch: 1 },
  'interleaved: N x (set, measure)': { engine_measure_paragraph: LABELS },
  'interleaved: the frame after': { engine_update_batch: 1 },
  'overwrite before publication: 2N setters and one frame': { engine_prepare_batch: 1, engine_update_batch: 1 },
  'restore the published value: two setters and one frame': {},
  'paint-only change: one setter and one frame': { engine_prepare_batch: 1, engine_update_batch: 1 },
  'multi-pass frame: three traversals after N setters': { engine_prepare_batch: 1, engine_update_batch: 1 },
  // Anchoring a published text places it at once from its prepared layout: one summary is serialized, nothing is laid out.
  'anchored text: first anchor on a published label': { engine_measure_paragraph: 1 },
  'anchored text: text setter on an anchored label': {},
  'anchored text: the frame after': { engine_prepare_batch: 1, engine_update_batch: 1 },
  'detached texts: two texts measured alternately, twice': { engine_measure_paragraph: 2 },
  'constructor: createText': {},
};

const fonts = createFontCache({ inter: { file: 'inter-bitmap-16.font.glb', raster: bitmap({ strikes: [16] }) } });
const label = (prefix, index) => ({ properties: { style: { fontSize: 6 }, text: `${prefix} ${String(index)}` } });

test.after(() => fonts.dispose());

test('crossing budget', { timeout }, async (t) => {
  const font = await fonts.load('inter');
  const measured = {};
  const spend = (name, operation) => {
    assert.ok(name in BUDGET, `no budget row named ${name}`);
    measured[name] = crossingsOf(operation);
  };
  let mounted;
  spend('mount: construct and attach N labels, then one frame', () => {
    mounted = mount(
      font,
      Array.from({ length: LABELS }, (_, index) => label('Label', index)),
    );
  });
  t.after(() => unmount(mounted));
  const { nodes, scene, handle } = mounted;
  const frame = () => scene.updateMatrixWorld(true);
  const setAll = (prefix) => {
    for (const [index, node] of nodes.entries()) node.text = `${prefix} ${String(index)}`;
  };

  spend('idle: a traversal with nothing dirty', frame);
  spend('setter: N text setters', () => setAll('Value'));
  spend('setter + frame: the frame after N setters', frame);
  spend('read: first measure of a clean label', () => nodes[0].measure());
  spend('read: second measure of the same label', () => nodes[0].measure());
  setAll('Again');
  spend('setter + read: one read among N dirty siblings', () => nodes[5].measure());
  spend('setter + read: reading every remaining dirty label', () => {
    for (const node of nodes) node.measure();
  });
  spend('frame after reads', frame);
  spend('interleaved: N x (set, measure)', () => {
    for (const [index, node] of nodes.entries()) {
      node.text = `Loop ${String(index)}`;
      node.measure();
    }
  });
  spend('interleaved: the frame after', frame);
  spend('overwrite before publication: 2N setters and one frame', () => {
    setAll('Discarded');
    setAll('Kept');
    frame();
  });
  spend('restore the published value: two setters and one frame', () => {
    nodes[3].text = 'Elsewhere';
    nodes[3].text = 'Kept 3';
    frame();
  });
  spend('paint-only change: one setter and one frame', () => {
    nodes[4].style = { fontSize: 6, color: '#ff0000' };
    frame();
  });
  setAll('Passes');
  spend('multi-pass frame: three traversals after N setters', () => {
    frame();
    frame();
    frame();
  });
  spend('anchored text: first anchor on a published label', () => {
    nodes[1].constraints = { anchor: { x: 'center', y: 'middle' } };
  });
  spend('anchored text: text setter on an anchored label', () => {
    nodes[1].text = 'anchored text edit';
  });
  spend('anchored text: the frame after', frame);
  const first = handle.createText({ font, text: 'detached A' });
  const second = handle.createText({ font, text: 'detached B' });
  spend('detached texts: two texts measured alternately, twice', () => {
    first.measure();
    second.measure();
    first.measure();
    second.measure();
  });
  first.dispose();
  second.dispose();
  let created;
  spend('constructor: createText', () => {
    created = handle.createText({ font, text: 'constructed' });
  });
  created.dispose();

  assert.deepEqual(measured, BUDGET);

  await t.test('a setter issued during traversal is accepted and drawn by a later frame', () => {
    const probe = new THREE.Object3D();
    let outcome;
    probe.updateMatrixWorld = () => {
      if (outcome !== undefined) return;
      try {
        nodes[2].text = 'changed mid-traversal';
        outcome = 'accepted';
      } catch (error) {
        outcome = error;
      }
    };
    scene.add(probe);
    frame();
    assert.equal(outcome, 'accepted');
    frame();
    assert.equal(nodes[2].commitState().status, 'committed');
    assert.equal(nodes[2].text, 'changed mid-traversal');
  });
});
