// The frame is two steps: prepare (with layout callbacks) at the front of the traversal, publish at
// its end. These tests pin what each integration adds around that: which text a mid-traversal setter
// holds back, what a nested render does, how a canvas is asked for a frame, and where errors surface.
import { crossingsOf, lastCallArguments, trapCallsWhen } from '../support/wasm-crossings.mjs';
import { mountTres, nextTick } from '../support/vue-tres-host.mjs';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { h, shallowRef } from 'vue';
import { bitmap, glyph, GlyphInputError, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { Text as VueText } from '@pmndrs/glyph/vue';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';
import { adapterFont } from '../support/adapter-behavior.mjs';
import { recordingHost } from '../support/typegpu-recording-host.mjs';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const msdfFontBytes = await readFile(
  new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
);
await glyph.init();
const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
let nextHandle = 1;

function threeScene(t) {
  const handle = glyph.handle(`three:frame-layout-phase:${String(nextHandle++)}`, ThreeConfig);
  t.after(() => handle.dispose());
  const scene = new THREE.Scene();
  // The handle is its anonymous root. Attached, the preparation object is first from the first frame, as it
  // is under React and Vue.
  handle.attach(scene);
  const add = (text) => {
    const object = handle.createText({ font, text });
    scene.add(object);
    return object;
  };
  return { handle, scene, add, frame: () => scene.updateMatrixWorld(true) };
}

/** A sibling whose matrix update runs `write` once: a setter issued in the middle of a traversal. */
function writerDuringTraversal(write) {
  const writer = new THREE.Object3D();
  let armed = false;
  const update = writer.updateMatrixWorld.bind(writer);
  writer.updateMatrixWorld = (force) => {
    if (armed) {
      armed = false;
      write();
    }
    update(force);
  };
  return {
    writer,
    arm: () => {
      armed = true;
    },
  };
}

/** Every draw's attribute bytes, the transform table among them: what the renderer would upload. */
function rendererBytes(scene) {
  const draws = [];
  scene.traverse((object) => {
    if (!object.isMesh || object.geometry?.attributes === undefined) return;
    draws.push(
      Object.entries(object.geometry.attributes)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, attribute]) => [
          name,
          Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength).toString('hex'),
        ]),
    );
  });
  return draws;
}

for (const attached of [true, false]) {
  test(`Three: a layout callback positions the first frame exactly ${attached ? 'with' : 'without'} attach()`, async (t) => {
    const build = (place) => {
      const handle = glyph.handle(`three:frame-layout-phase:${String(nextHandle++)}`, ThreeConfig);
      t.after(() => handle.dispose());
      const scene = new THREE.Scene();
      if (attached) handle.attach(scene);
      // The panel precedes the label and the label sits in a group: both are visited before the label.
      const panel = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
      const group = new THREE.Group();
      const label = handle.createText({ font, text: 'centred on its own width' });
      const sibling = handle.createText({ font, text: 'sibling' });
      scene.add(panel, group, sibling);
      group.add(label);
      place({ panel, group, label });
      return { scene, panel, group, label };
    };
    const reference = build(({ panel, group, label }) => {
      const layout = label.measure();
      label.position.x = -layout.width / 2;
      group.position.y = layout.height;
      panel.scale.set(layout.width, layout.height, 1);
    });
    const subject = build(({ panel, group, label }) => {
      label.onLayout = (text, layout) => {
        text.position.x = -layout.width / 2;
        group.position.y = layout.height;
        panel.scale.set(layout.width, layout.height, 1);
      };
    });
    reference.scene.updateMatrixWorld(true);
    subject.scene.updateMatrixWorld(true);
    const width = subject.label.measure().width;
    assert.ok(width > 0);
    assert.equal(subject.label.matrixWorld.elements[12], -width / 2);
    assert.equal(subject.panel.matrixWorld.elements[0], width, 'an object visited before the label is current too');
    assert.equal(subject.label.matrixWorld.elements[13], subject.label.measure().height, 'and so is its parent');
    assert.equal(subject.label.commitState().status, 'committed');
    assert.deepEqual(rendererBytes(subject.scene), rendererBytes(reference.scene), 'frame 1 draws the placed text');
    const first = rendererBytes(subject.scene);
    subject.scene.updateMatrixWorld(true);
    assert.deepEqual(rendererBytes(subject.scene), first, 'frame 2 has nothing to correct');
  });
}

test('Three: a setter issued mid-traversal holds only the text that has a layout callback', async (t) => {
  const handle = glyph.handle(`three:frame-layout-phase:${String(nextHandle++)}`, ThreeConfig);
  t.after(() => handle.dispose());
  const scene = new THREE.Scene();
  const frame = () => scene.updateMatrixWorld(true);
  const add = (text) => {
    const object = handle.createText({ font, text });
    scene.add(object);
    return object;
  };
  const observed = add('observed');
  const plain = add('plain');
  const reference = add('observed, and longer');
  const seen = [];
  observed.onLayout = (_text, layout) => seen.push(layout.width);
  const { writer, arm } = writerDuringTraversal(() => {
    observed.text = 'observed, and longer';
    plain.text = 'plain, and longer';
  });
  scene.add(writer);
  // The root discovers its Scene here, so its publication object follows the writer: the write lands between
  // this frame's layout phase and its publication. The second frame moves the preparation object to the front.
  frame();
  frame();
  assert.equal(scene.children[0].name, '@pmndrs/glyph-prepare');
  assert.ok(
    scene.children.indexOf(writer) < scene.children.findIndex((child) => child.name.startsWith('@pmndrs/glyph:')),
  );
  assert.equal(seen.length, 1);
  assert.equal(observed.commitState().status, 'committed');

  arm();
  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.equal(plain.commitState().status, 'committed', 'text nobody observes is drawn by the frame that changed it');
  assert.equal(observed.commitState().status, 'pending', 'the observed text keeps its published revision');
  assert.equal(seen.length, 1, 'its callback has not seen the new layout, so the frame does not draw it');

  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.deepEqual(seen, [seen[0], reference.measure().width]);
  assert.equal(observed.commitState().status, 'committed');
  assert.deepEqual(crossingsOf(frame), {}, 'a settled scene costs no engine call');
});

test('Three: a nested render synchronizes transforms and neither prepares nor publishes', async (t) => {
  const { scene, add, frame } = threeScene(t);
  const label = add('label');
  let calls = 0;
  label.onLayout = () => {
    calls += 1;
  };
  frame();
  assert.equal(calls, 1);

  // A renderer traverses the Scene, calls onBeforeRender, runs shadow and pass renders, then onAfterRender.
  scene.onBeforeRender();
  label.text = 'changed during the render';
  label.position.x = 25;
  assert.deepEqual(crossingsOf(frame), {}, 'a shadow or pass traversal makes no engine call');
  assert.equal(calls, 1);
  assert.equal(label.commitState().status, 'pending');
  assert.equal(label.matrixWorld.elements[12], 25, 'the nested traversal still updates matrices');
  scene.onAfterRender();

  assert.deepEqual(crossingsOf(frame), { engine_prepare_batch: 1, engine_update_batch: 1 });
  assert.equal(calls, 2);
  assert.equal(label.commitState().status, 'committed');
});

test('Three: the preparation object stays first without disturbing a traversal in progress', async (t) => {
  const handle = glyph.handle(`three:frame-layout-phase:${String(nextHandle++)}`, ThreeConfig);
  t.after(() => handle.dispose());
  const scene = new THREE.Scene();
  const visited = [];
  const texts = ['a', 'b', 'c'].map((text) => {
    const object = handle.createText({ font, text });
    const update = object.updateMatrixWorld.bind(object);
    object.updateMatrixWorld = (force) => {
      visited.push(text);
      update(force);
    };
    scene.add(object);
    return object;
  });
  // No attach(): the root discovers its Scene during this traversal and may only append to it.
  scene.updateMatrixWorld(true);
  assert.deepEqual(visited, ['a', 'b', 'c'], 'every child is visited exactly once by the discovering traversal');
  assert.equal(scene.children.at(-1).name, '@pmndrs/glyph-prepare', 'both private objects were appended');
  // The second traversal reaches the publication object first, so that object prepares and publishes; the
  // preparation object then moves to the front while it is the child being visited, which shifts nothing ahead.
  for (const expectedFront of ['@pmndrs/glyph-prepare', '@pmndrs/glyph-prepare']) {
    visited.length = 0;
    texts[0].text = `${texts[0].text}!`;
    assert.deepEqual(
      crossingsOf(() => scene.updateMatrixWorld(true)),
      { engine_prepare_batch: 1, engine_update_batch: 1 },
    );
    assert.deepEqual(visited, ['a', 'b', 'c']);
    assert.equal(scene.children[0].name, expectedFront);
    assert.ok(texts.every((object) => object.commitState().status === 'committed'));
  }
});

test('Three: a root reports invalidation, and a callback installed late hears the current layout', async (t) => {
  const { handle: root, add, frame } = threeScene(t);
  let invalidations = 0;
  root.onInvalidate = () => {
    invalidations += 1;
  };
  const label = add('label');
  frame();
  const before = invalidations;
  label.text = 'changed';
  assert.ok(invalidations > before, 'a setter asks the host for a frame');
  frame();

  const seen = [];
  label.onLayout = (text, layout) => seen.push([text, layout.glyphCount]);
  frame();
  assert.deepEqual(seen, [[label, label.measure().glyphCount]]);
  frame();
  assert.equal(seen.length, 1);

  const rootErrors = [];
  root.onError = (error) => rootErrors.push(error);
  const failure = new Error('callback failed');
  label.onLayout = () => {
    throw failure;
  };
  label.text = 'changed again';
  assert.doesNotThrow(frame);
  assert.deepEqual(rootErrors, [failure], 'a callback exception reaches the root handler');
  assert.equal(label.commitState().status, 'committed');
});

test('Three: an invalid value names the property the caller wrote', async (t) => {
  const { add } = threeScene(t);
  const label = add('label');
  const cases = [
    [() => (label.style = { fontSize: Number.NaN }), ['style']],
    [() => (label.constraints = { width: { mode: 'exact', size: Number.NaN } }), ['constraints']],
    [() => (label.layout = { maxLines: 0 }), ['layout']],
    [() => (label.rasterPixelRatio = 0), ['rasterPixelRatio']],
    [() => label.set({ text: 'both', style: { opacity: 2 } }), ['style']],
    [() => (label.text = 7), ['text']],
  ];
  for (const [write, path] of cases) {
    assert.throws(write, (error) => {
      assert.ok(error instanceof GlyphInputError);
      assert.equal(error.code, 'invalid-input');
      assert.deepEqual(error.path, path);
      assert.ok(error.cause instanceof TypeError || error.cause instanceof RangeError || error.cause === undefined);
      return true;
    });
  }
  assert.equal(label.text, 'label');
});

test('Vue: layout is an event, observed only when listened to, and an invalid prop is an error event', async () => {
  const adapter = await adapterFont();
  const components = [];
  const layouts = [];
  const errors = [];
  const style = shallowRef({ fontSize: 16 });
  const host = await mountTres(() => [
    h(
      VueText,
      {
        key: 'observed',
        font: adapter.face,
        textStyle: style.value,
        ref: (value) => {
          if (value !== null) components[0] = value;
        },
        onLayout: (text, layout) => layouts.push([text, layout.glyphCount]),
        onError: (error) => errors.push(error),
      },
      () => 'observed',
    ),
    h(
      VueText,
      {
        key: 'plain',
        font: adapter.face,
        ref: (value) => {
          if (value !== null) components[1] = value;
        },
      },
      () => 'plain',
    ),
  ]);
  try {
    const [observed, plain] = components.map((component) => component.instance);
    assert.equal(typeof observed.onLayout, 'function');
    assert.equal(plain.onLayout, undefined, 'a text nobody listens to is neither measured nor held');
    host.scene.updateMatrixWorld(true);
    assert.deepEqual(layouts, [[observed, observed.measure().glyphCount]]);

    const accepted = observed.style;
    style.value = { fontSize: Number.NaN };
    await nextTick();
    assert.equal(errors.length, 1, 'the component says why its prop was not applied');
    assert.ok(errors[0] instanceof GlyphInputError);
    assert.deepEqual(errors[0].path, ['style']);
    assert.deepEqual(host.errors, [errors[0]], 'and the same error reaches Vue error handling');
    assert.equal(observed.style, accepted, 'the text keeps its previous value');
    assert.equal(observed.disposed, false);
  } finally {
    await host.unmount();
    adapter.dispose();
  }
});

test('TypeGPU: a refused text exposes its error, reports it once, and recovers with new input', async (t) => {
  const host = recordingHost();
  const handle = glyph.handle(`typegpu:frame-layout-phase:${String(nextHandle++)}`, host.config);
  const face = glyph.fontFace(new Blob([msdfFontBytes]), { format: msdf });
  await face.load();
  t.after(() => {
    trapCallsWhen(undefined);
    handle.dispose();
    face.dispose();
  });
  const texts = Array.from({ length: 4 }, (_, index) =>
    handle.createText({ font: face, text: `label ${String(index)}`, position: [0, index * 40] }),
  );
  glyph.shape();
  const culprit = texts[1];
  culprit.measure();
  const reports = [];
  culprit.onError = (error) => reports.push(error);
  const laidOut = [];
  culprit.onLayout = () => laidOut.push('culprit');
  texts[2].onLayout = () => laidOut.push('sibling');
  glyph.shape();
  laidOut.length = 0;
  culprit.update({ text: 'value 1' });
  culprit.measure();
  const culpritParagraph = lastCallArguments('engine_measure_paragraph')[3];
  for (const [index, text] of texts.entries()) text.update({ text: `changed ${String(index)}` });
  let culpritDirty = true;
  trapCallsWhen(
    (name, args) =>
      (name === 'engine_prepare_batch' && culpritDirty) ||
      (name === 'engine_measure_paragraph' && args[3] === culpritParagraph && culpritDirty),
  );
  for (let frame = 0; frame < 3; frame += 1) {
    try {
      glyph.shape();
    } catch {
      // A trapped frame reports through each root; the next frame restates every text.
    }
  }
  assert.ok(culprit.error !== undefined, 'the refused text says why it is not drawn');
  assert.equal(reports.length, 1, 'and reports it once');
  assert.equal(reports[0], culprit.error);
  assert.equal(texts[0].error, undefined);
  assert.equal(texts[2].error, undefined);
  assert.deepEqual(laidOut, ['sibling'], 'a refused text has no layout to hand over; its sibling does');
  assert.equal(texts[2].measure().glyphCount, 'changed 2'.length);

  culpritDirty = false;
  culprit.update({ text: 'harmless' });
  glyph.shape();
  assert.equal(culprit.error, undefined);
  assert.deepEqual(laidOut, ['sibling', 'culprit']);
});
