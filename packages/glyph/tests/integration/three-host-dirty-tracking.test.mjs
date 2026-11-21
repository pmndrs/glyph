import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { loadFont } from '../../dist/loader.js';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
let nextHandle = 1;

async function createRoot(t) {
  await glyph.init();
  const handle = glyph.handle(`three:host-dirty:${String(nextHandle++)}`, ThreeConfig);
  t.after(() => handle.dispose());
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  return { handle, font };
}

function createLabels(handle, font, count) {
  return Array.from({ length: count }, (_, index) => {
    const label = handle.createText({ font, text: `label ${String(index)}` });
    label.position.set(index * 10, 0, 0);
    return label;
  });
}

function rootDraws(scene) {
  return scene.getObjectByName('@pmndrs/glyph:anonymous')?.children.filter((child) => child.isMesh) ?? [];
}

function transformTable(scene) {
  const table = rootDraws(scene)[0]?.geometry.getAttribute('_pmndrsGlyphTransforms');
  assert.ok(table !== undefined, 'the root draws through an indexed transform table');
  return table;
}

/** Counts reads of one own data property without changing the value Three observes. */
function countReads(object, key) {
  let value = object[key];
  const counter = { reads: 0 };
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    get() {
      counter.reads += 1;
      return value;
    },
    set(next) {
      value = next;
    },
  });
  return counter;
}

function translationRows(table) {
  const rows = [];
  for (let offset = 0; offset < table.array.length; offset += 16) rows.push(table.array[offset + 12]);
  return rows;
}

test('an unchanged frame reads no presentation and walks no Text ancestry', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const group = handle.createTextGroup();
  const labels = createLabels(handle, font, 24);
  group.add(...labels);
  scene.add(group);
  t.after(() => labels.forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  assert.ok(labels.every((label) => label.commitState().status === 'committed'));

  const table = transformTable(scene);
  const version = table.version;
  const materialReads = countReads(group, 'material');
  const sceneVisibleReads = countReads(scene, 'visible');
  const groupVisibleReads = countReads(group, 'visible');
  for (let frame = 0; frame < 3; frame += 1) scene.updateMatrixWorld();

  assert.equal(materialReads.reads, 0, 'an unchanged frame resolves no Text presentation');
  assert.ok(
    sceneVisibleReads.reads <= 6 && groupVisibleReads.reads <= 6,
    `ancestor visibility is read per ancestor and per group, not once per Text (scene ${sceneVisibleReads.reads}, group ${groupVisibleReads.reads})`,
  );
  assert.equal(table.version, version, 'an unchanged frame uploads no transform');
});

test('moving one Text synchronizes that transform and leaves the others unread', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const labels = createLabels(handle, font, 16);
  scene.add(...labels);
  t.after(() => labels.forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();

  const table = transformTable(scene);
  const before = translationRows(table);
  const sceneVisibleReads = countReads(scene, 'visible');
  labels[5].position.x = 1234;
  scene.updateMatrixWorld();

  const after = translationRows(table);
  const changed = after.flatMap((value, index) => (value === before[index] ? [] : [index]));
  assert.equal(changed.length, 1, 'exactly one transform row changes');
  assert.equal(after[changed[0]], 1234, 'the moved Text is synchronized in the frame that moved it');
  assert.ok(
    sceneVisibleReads.reads <= 3,
    `only the moved Text resolves its visibility (scene.visible read ${sceneVisibleReads.reads} times)`,
  );

  const version = table.version;
  scene.updateMatrixWorld();
  assert.equal(table.version, version, 'the following unchanged frame uploads nothing');
});

test('plain-property visibility on a Text or any ancestor still reaches the transform table', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  const labels = createLabels(handle, font, 4);
  const [inner, ...outer] = labels;
  inner.position.x = 7;
  holder.add(inner);
  scene.add(holder, ...outer);
  t.after(() => labels.forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();

  const table = transformTable(scene);
  const visibleRows = () => {
    const rows = [];
    for (let offset = 0; offset < table.array.length; offset += 16) rows.push(table.array[offset + 15] !== 0);
    return rows;
  };
  const allVisible = visibleRows();
  assert.equal(allVisible.filter(Boolean).length, 4);

  holder.visible = false;
  scene.updateMatrixWorld();
  assert.equal(visibleRows().filter(Boolean).length, 3, 'an ancestor hidden through its plain property hides its Text');

  holder.visible = true;
  outer[0].visible = false;
  scene.updateMatrixWorld();
  assert.equal(visibleRows().filter(Boolean).length, 3, 'a Text hidden through its own plain property is hidden');
  assert.notDeepEqual(visibleRows(), allVisible);

  outer[0].visible = true;
  scene.updateMatrixWorld();
  assert.deepEqual(visibleRows(), allVisible, 'restoring visibility restores every transform');

  scene.visible = false;
  scene.updateMatrixWorld();
  assert.equal(visibleRows().filter(Boolean).length, 0, 'a hidden Scene hides every member');
  scene.visible = true;
  scene.updateMatrixWorld();
  assert.deepEqual(visibleRows(), allVisible);
});

test('reparenting an ancestor that holds a Text is observed without touching the Text', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  const [held, free] = createLabels(handle, font, 2);
  holder.add(held);
  scene.add(holder, free);
  t.after(() => [held, free].forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  assert.equal(held.commitState().status, 'committed');
  const glyphsWithBoth = rootDraws(scene).reduce((total, draw) => total + draw.geometry.instanceCount, 0);

  scene.remove(holder);
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  const glyphsWithoutHeld = rootDraws(scene).reduce((total, draw) => total + draw.geometry.instanceCount, 0);
  assert.ok(glyphsWithoutHeld < glyphsWithBoth, 'removing the ancestor retires the held Text from publication');
  assert.equal(free.commitState().status, 'committed');

  const other = new THREE.Group();
  other.position.x = 500;
  other.add(holder);
  scene.add(other);
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  assert.equal(
    rootDraws(scene).reduce((total, draw) => total + draw.geometry.instanceCount, 0),
    glyphsWithBoth,
    'attaching a new chain root returns the held Text to publication',
  );
  assert.equal(held.commitState().status, 'committed');
  assert.ok(
    translationRows(transformTable(scene)).includes(500),
    'the returned Text carries its new ancestor transform',
  );
});

test('a Text traversed after the publication object is synchronized in the frame that moved it', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const [early] = createLabels(handle, font, 1);
  scene.add(early);
  scene.updateMatrixWorld();
  const lateBranch = new THREE.Group();
  const late = handle.createText({ font, text: 'late' });
  lateBranch.add(late);
  scene.add(lateBranch);
  t.after(() => [early, late].forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  assert.ok(
    scene.children.indexOf(lateBranch) > scene.children.indexOf(scene.getObjectByName('@pmndrs/glyph:anonymous')),
    'the late branch follows the publication object in traversal order',
  );

  late.position.x = 321;
  scene.updateMatrixWorld();
  assert.ok(translationRows(transformTable(scene)).includes(321), 'the late Text does not lag a frame');
  lateBranch.position.x = 1000;
  scene.updateMatrixWorld();
  assert.ok(translationRows(transformTable(scene)).includes(1321), 'a late ancestor move does not lag a frame');
});

test('an ungrouped Text render order set through the plain property reaches its draw', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const [label] = createLabels(handle, font, 1);
  scene.add(label);
  t.after(() => label.dispose());
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0].renderOrder, 0);

  label.renderOrder = 9;
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0].renderOrder, 9);
});

test('mounting a Text stages only that Text', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const group = handle.createTextGroup();
  scene.add(group);
  const first = createLabels(handle, font, 8);
  group.add(...first);
  t.after(() => first.forEach((label) => label.dispose()));
  const materialReads = countReads(group, 'material');

  const later = createLabels(handle, font, 8);
  t.after(() => later.forEach((label) => label.dispose()));
  assert.equal(materialReads.reads, 0, 'creating a Text does not resolve the presentation of existing members');

  group.add(...later);
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();
  assert.ok([...first, ...later].every((label) => label.commitState().status === 'committed'));
  assert.deepEqual(
    [...first, ...later].map((label) => label.measure().glyphCount),
    [...first, ...later].map((label) => label.text.length),
  );
});

test('a setter on a bound Text publishes without restating untouched members', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const group = handle.createTextGroup();
  const labels = createLabels(handle, font, 12);
  group.add(...labels);
  scene.add(group);
  t.after(() => labels.forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();

  const materialReads = countReads(group, 'material');
  labels[3].text = 'changed';
  scene.updateMatrixWorld();
  assert.equal(labels[3].commitState().status, 'committed');
  assert.ok(
    materialReads.reads <= 2,
    `only the edited Text resolves its presentation (group.material read ${materialReads.reads} times)`,
  );

  group.batching = 'group';
  scene.updateMatrixWorld();
  assert.ok(materialReads.reads >= labels.length, 'a presentation change restates every member');
});

test('a traversal publication recomputes only the transform rows it introduces', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const labels = createLabels(handle, font, 16);
  scene.add(...labels);
  t.after(() => labels.forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();

  const sceneVisibleReads = countReads(scene, 'visible');
  labels[2].text = 'a longer replacement that changes the glyph count';
  labels[9].position.x = 4321;
  scene.updateMatrixWorld();
  assert.equal(labels[2].commitState().status, 'committed');
  assert.ok(
    sceneVisibleReads.reads < labels.length,
    `untouched members keep their committed rows (scene.visible read ${sceneVisibleReads.reads} times)`,
  );
  const rows = translationRows(transformTable(scene)).filter((value, index, all) => all.indexOf(value) === index);
  assert.ok(rows.includes(4321), 'a member moved in the publishing frame is synchronized in that frame');
  for (const label of labels) {
    assert.ok(rows.includes(label.position.x), `row for x=${String(label.position.x)} survives the publication`);
  }
});

test('a manual publication outside a traversal recomputes every transform row', async (t) => {
  const { handle, font } = await createRoot(t);
  const scene = new THREE.Scene();
  const labels = createLabels(handle, font, 4);
  scene.add(...labels);
  t.after(() => labels.forEach((label) => label.dispose()));
  scene.updateMatrixWorld();
  scene.updateMatrixWorld();

  scene.matrixWorldAutoUpdate = false;
  labels[1].position.x = 777;
  labels[3].text = 'a longer replacement that changes the glyph count';
  glyph.shape();
  assert.ok(
    translationRows(transformTable(scene)).includes(777),
    'no traversal will report the move, so the publication reads it',
  );
});
