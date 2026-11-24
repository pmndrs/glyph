import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { bitmap, glyph, msdf, slug } from '@pmndrs/glyph';
import { defineTextMaterial, defineThreeConfig } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';

import { loadFont } from '../../dist/loader.js';

const bitmapFontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const slugFontUrl = new URL('../../../../benches/fixtures/rendering/inter-slug.font.glb.gz', import.meta.url);
const multiTechniqueFontUrl = new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url);
let nextHandle = 1;

async function cullingHandle(t, transformMode) {
  await glyph.init();
  const handle = glyph.handle(
    `three:frustum-culling:${String(nextHandle++)}`,
    defineThreeConfig({ transformMode, capacity: { size: 4_096, policy: 'grow' } }),
  );
  t.after(() => handle.dispose());
  return handle;
}

/** A 200 x 100 view of the z = 0 plane, centred on the origin. */
function viewCamera() {
  const camera = new THREE.OrthographicCamera(-100, 100, 50, -50, 0.1, 10);
  camera.position.z = 1;
  camera.updateMatrixWorld();
  return camera;
}

/** The meshes Three's renderer would submit: what `Renderer._projectObject` keeps for a visible tree. */
function submittedDraws(scene, camera) {
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    camera.coordinateSystem,
  );
  const submitted = [];
  const visit = (object) => {
    if (!object.visible) return;
    if (object.isMesh && (!object.frustumCulled || frustum.intersectsObject(object))) submitted.push(object);
    for (const child of object.children) visit(child);
  };
  visit(scene);
  return submitted;
}

function glyphDraws(scene) {
  const draws = [];
  scene.traverse((object) => {
    if (object.isMesh && object.userData.pmndrsGlyphPrimitiveKind !== undefined) draws.push(object);
  });
  return draws;
}

/** Every corner of each label's world ink box lies inside the world bound of some submitted draw. */
function assertInkSubmitted(submitted, labels, stage) {
  const spheres = submitted.map((draw) => draw.boundingSphere.clone().applyMatrix4(draw.matrixWorld));
  const corner = new THREE.Vector3();
  for (const label of labels) {
    const ink = label.computeBoundingBox();
    assert.ok(!ink.isEmpty(), `${stage}: the label has ink`);
    for (let index = 0; index < 4; index += 1) {
      corner
        .set(index & 1 ? ink.max.x : ink.min.x, index & 2 ? ink.max.y : ink.min.y, 0)
        .applyMatrix4(label.matrixWorld);
      assert.ok(
        spheres.some((sphere) => sphere.distanceToPoint(corner) <= 1e-4),
        `${stage}: ink corner ${String(index)} of "${label.text}" is outside every submitted draw bound`,
      );
    }
  }
}

for (const transformMode of ['indexed', 'direct']) {
  test(`${transformMode} draws outside the frustum are culled after moves, edits, hiding and removal`, async (t) => {
    const three = await cullingHandle(t, transformMode);
    const font = await loadFont({ baked: { bytes: await readFile(bitmapFontUrl) } }, bitmap({ strikes: [16] }));
    t.after(() => font.dispose());
    const scene = new THREE.Scene();
    const camera = viewCamera();
    const group = three.createTextGroup({ batching: 'group' });
    const near = three.createText({ font, text: 'Hello', style: { fontSize: 16 } });
    const far = three.createText({ font, text: 'World', style: { fontSize: 16 } });
    near.position.set(-20, 0, 0);
    far.position.set(400, 0, 0);
    group.add(near, far);
    scene.add(group);

    let submitted = submittedDraws(scene, camera);
    assert.ok(glyphDraws(scene).length > 0, 'the labels publish draws');
    assert.ok(
      glyphDraws(scene).every((draw) => draw.frustumCulled),
      'every default-material draw is frustum culled',
    );
    assertInkSubmitted(submitted, [near], 'one on-screen label');
    if (transformMode === 'direct') {
      assert.equal(submitted.length, 1, 'only the on-screen label draw is submitted');
    }

    // A batched draw is culled as one unit, so both members leave on the same side.
    near.position.x = 600;
    assert.equal(submittedDraws(scene, camera).length, 0, 'moving the last on-screen label off culls its draw');

    near.position.x = 90;
    submitted = submittedDraws(scene, camera);
    assertInkSubmitted(submitted, [near], 'a label crossing the right edge');

    near.position.x = -400;
    far.position.x = -400 - 120;
    far.text = `${'World '.repeat(59)}World`;
    submitted = submittedDraws(scene, camera);
    assertInkSubmitted(submitted, [far], 'an off-screen label edited until it spans the view');

    far.text = 'World';
    assert.equal(submittedDraws(scene, camera).length, 0, 'shortening it again culls it');

    near.position.x = -20;
    assertInkSubmitted(submittedDraws(scene, camera), [near], 'the label returns');
    near.visible = false;
    assert.equal(submittedDraws(scene, camera).length, 0, 'a hidden label contributes no bound');
    near.visible = true;
    assertInkSubmitted(submittedDraws(scene, camera), [near], 'the label is shown again');

    near.dispose();
    assert.equal(submittedDraws(scene, camera).length, 0, 'removing the on-screen member culls the off-screen rest');
    far.dispose();
    group.dispose();
  });

  test(`${transformMode} batched bounds follow ancestor transforms and every camera`, async (t) => {
    const three = await cullingHandle(t, transformMode);
    const font = await loadFont({ baked: { bytes: await readFile(bitmapFontUrl) } }, bitmap({ strikes: [16] }));
    t.after(() => font.dispose());
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    const group = three.createTextGroup({ batching: 'group' });
    const labels = Array.from({ length: 8 }, (_, index) => {
      const label = three.createText({ font, text: `Label ${String(index)}`, style: { fontSize: 16 } });
      label.position.set(index * 70 - 280, index % 2 === 0 ? 20 : -20, 0);
      label.rotation.z = index * 0.2;
      group.add(label);
      return label;
    });
    parent.add(group);
    scene.add(parent);
    parent.rotation.z = 0.3;
    parent.scale.set(1.5, 0.75, 1);
    const front = viewCamera();
    const onScreen = (camera) =>
      labels.filter((label) => {
        const ink = label.computeBoundingBox().clone().applyMatrix4(label.matrixWorld);
        const view = new THREE.Box3(
          new THREE.Vector3(camera.position.x - 100, camera.position.y - 50, -1),
          new THREE.Vector3(camera.position.x + 100, camera.position.y + 50, 1),
        );
        return ink.intersectsBox(view);
      });
    for (const offset of [0, 150, -150, 1_000]) {
      front.position.x = offset;
      front.updateMatrixWorld();
      const submitted = submittedDraws(scene, front);
      scene.updateMatrixWorld(true);
      const expected = onScreen(front);
      assertInkSubmitted(submitted, expected, `camera at x=${String(offset)}`);
      if (expected.length === 0) assert.equal(submitted.length, 0, 'a camera that sees no label submits no draw');
    }
    // A second pass with another camera, as a shadow or reflection pass would, reads the same retained bound.
    const side = new THREE.PerspectiveCamera(60, 2, 0.1, 2_000);
    side.position.set(0, 0, 400);
    side.lookAt(0, 0, 0);
    const [draw] = glyphDraws(scene);
    const clone = draw.clone();
    assert.ok(clone.frustumCulled, 'a cloned draw stays culled');
    assert.ok(clone.boundingSphere.equals(draw.boundingSphere), 'and reads the bound of the records it shares');
    const wide = submittedDraws(scene, side);
    assert.equal(wide.length, glyphDraws(scene).length, 'a camera that sees every label submits every draw');
    side.position.set(5_000, 0, 400);
    side.lookAt(5_000, 0, 0);
    assert.equal(submittedDraws(scene, side).length, 0, 'a camera looking elsewhere submits none');
  });
}

test('MSDF effects and Slug fringes are inside the bound of a draw crossing the view edge', async (t) => {
  const three = await cullingHandle(t, 'indexed');
  const [msdfFont] = await loadFont({ baked: { bytes: await readFile(multiTechniqueFontUrl) } }, [msdf]);
  const slugFont = await loadFont({ baked: { bytes: gunzipSync(await readFile(slugFontUrl)) } }, slug);
  t.after(() => {
    msdfFont.dispose();
    slugFont.dispose();
  });
  const scene = new THREE.Scene();
  const camera = viewCamera();
  const effects = three.createText({
    font: msdfFont,
    text: 'Shadowed',
    style: { fontSize: 24, outline: { color: '#ff0000', width: 3 }, shadow: { color: '#0000ff', offset: [6, 6] } },
  });
  const fringe = three.createText({ font: slugFont, text: 'Fringe', style: { fontSize: 24 } });
  scene.add(effects, fringe);
  for (const x of [90, -150, 400]) {
    effects.position.set(x, 20, 0);
    fringe.position.set(x, -20, 0);
    const submitted = submittedDraws(scene, camera);
    const visible = [effects, fringe].filter((label) => {
      const ink = label.computeBoundingBox().clone().applyMatrix4(label.matrixWorld);
      return ink.max.x > -100 && ink.min.x < 100;
    });
    assertInkSubmitted(submitted, visible, `labels at x=${String(x)}`);
    if (visible.length === 0) assert.equal(submitted.length, 0, 'labels far off-screen submit no draw');
  }
  const [msdfDraw] = glyphDraws(scene).filter((draw) => draw.material.isNodeMaterial);
  assert.ok(msdfDraw.frustumCulled, 'built-in MSDF and Slug draws are culled');
  effects.dispose();
  fringe.dispose();
});

for (const transformMode of ['indexed', 'direct']) {
  test(`${transformMode} caller materials are culled by their declared padding or opt out`, async (t) => {
    const three = await cullingHandle(t, transformMode);
    const font = await loadFont({ baked: { bytes: await readFile(bitmapFontUrl) } }, bitmap({ strikes: [16] }));
    t.after(() => font.dispose());
    const scene = new THREE.Scene();
    const camera = viewCamera();
    const shift = (options) =>
      defineTextMaterial((context) => {
        const material = context.createDefaultMaterial();
        material.positionNode = context.position.add(vec3(-900, 0, 0));
        return material;
      }, options);
    const label = three.createText({ font, text: 'Displaced', style: { fontSize: 16 }, material: shift() });
    label.position.x = 900;
    scene.add(label);
    const undeclared = submittedDraws(scene, camera);
    assert.ok(glyphDraws(scene).length > 0);
    assert.ok(
      glyphDraws(scene).every((draw) => draw.frustumCulled),
      'a caller material is culled by default',
    );
    assert.equal(undeclared.length, 0, 'an undeclared displacement is culled with its source');

    label.material = shift({ boundsPadding: 900 });
    assert.equal(
      submittedDraws(scene, camera).length,
      glyphDraws(scene).length,
      'a declared padding keeps the displaced label submitted',
    );
    label.position.x = 900 + 3_000;
    assert.equal(submittedDraws(scene, camera).length, 0, 'and still culls it once the padded bound (a sphere) leaves');

    label.material = shift({ frustumCulled: false });
    const neverCulled = submittedDraws(scene, camera);
    assert.ok(
      glyphDraws(scene).every((draw) => !draw.frustumCulled),
      'a material declared frustumCulled: false is never culled',
    );
    assert.equal(neverCulled.length, glyphDraws(scene).length);

    label.material = undefined;
    assert.equal(submittedDraws(scene, camera).length, 0, 'restoring the default material culls it again');
    assert.throws(() => defineTextMaterial(() => undefined, { boundsPadding: -1 }), RangeError);
    assert.throws(() => defineTextMaterial(() => undefined, { boundsPadding: Infinity }), RangeError);
    assert.throws(() => defineTextMaterial(() => undefined, { frustumCulled: 0 }), TypeError);
    label.dispose();
  });

  test(`${transformMode} a Text, Glyphs or TextGroup with frustumCulled = false is drawn off-screen`, async (t) => {
    const three = await cullingHandle(t, transformMode);
    const font = await loadFont({ baked: { bytes: await readFile(bitmapFontUrl) } }, bitmap({ strikes: [16] }));
    t.after(() => font.dispose());
    const scene = new THREE.Scene();
    const camera = viewCamera();
    const group = three.createTextGroup({ batching: 'group' });
    const member = three.createText({ font, text: 'Member', style: { fontSize: 16 } });
    const other = three.createText({ font, text: 'Other', style: { fontSize: 16 } });
    member.position.x = 600;
    other.position.x = 700;
    group.add(member, other);
    scene.add(group);
    assert.equal(submittedDraws(scene, camera).length, 0, 'both members are culled off-screen');

    member.frustumCulled = false;
    const kept = submittedDraws(scene, camera);
    assert.ok(kept.length > 0, 'an opted-out member is submitted from off-screen');
    if (transformMode === 'indexed') {
      assert.equal(kept.length, glyphDraws(scene).length, 'and keeps its whole batch drawn');
    }
    member.frustumCulled = true;
    assert.equal(submittedDraws(scene, camera).length, 0, 'opting back in culls it again');
    // Records that change while opted out must leave a current bound for when it opts back in.
    member.position.x = -4_000;
    member.frustumCulled = false;
    member.text = `${'Member '.repeat(80)}Member`;
    submittedDraws(scene, camera);
    member.frustumCulled = true;
    assertInkSubmitted(submittedDraws(scene, camera), [member], 'a member edited into view while opted out');
    member.text = 'Member';
    member.position.x = 600;
    assert.equal(submittedDraws(scene, camera).length, 0);

    group.frustumCulled = false;
    assert.equal(submittedDraws(scene, camera).length, glyphDraws(scene).length, 'an opted-out group keeps all');
    group.frustumCulled = true;
    assert.equal(submittedDraws(scene, camera).length, 0);

    const loose = three.createText({ font, text: 'Loose', style: { fontSize: 16 } });
    loose.position.x = 800;
    scene.add(loose);
    group.frustumCulled = false;
    loose.removeFromParent();
    group.add(loose);
    scene.updateMatrixWorld(true);
    assert.equal(submittedDraws(scene, camera).length, glyphDraws(scene).length, 'a Text moved into it opts out');

    group.frustumCulled = true;
    scene.updateMatrixWorld(true);
    const [glyphs] = member.split();
    scene.add(glyphs);
    glyphs.position.x = 1_000;
    member.visible = false;
    const glyphDrawsOf = () => glyphDraws(glyphs);
    assert.ok(glyphDrawsOf().length > 0, 'the detached copy publishes draws');
    assert.equal(submittedDraws(scene, camera).length, 0, 'the detached copy is culled');
    glyphs.frustumCulled = false;
    const submitted = submittedDraws(scene, camera);
    assert.ok(
      glyphDrawsOf().every((draw) => submitted.includes(draw)),
      'an opted-out Glyphs is drawn',
    );
    glyphs.dispose();
    loose.dispose();
    member.dispose();
    other.dispose();
    group.dispose();
  });
}

for (const transformMode of ['indexed', 'direct']) {
  test(`${transformMode} a Glyphs follows a deeper ancestor into and out of an opted-out TextGroup`, async (t) => {
    const three = await cullingHandle(t, transformMode);
    const font = await loadFont({ baked: { bytes: await readFile(bitmapFontUrl) } }, bitmap({ strikes: [16] }));
    t.after(() => font.dispose());
    const scene = new THREE.Scene();
    const camera = viewCamera();
    const group = three.createTextGroup({ batching: 'group' });
    group.frustumCulled = false;
    scene.add(group);
    const label = three.createText({ font, text: 'Detached', style: { fontSize: 16 } });
    scene.add(label);
    scene.updateMatrixWorld(true);
    const [glyphs] = label.split();
    label.visible = false;
    // The Glyphs keeps its own parent throughout; only an ancestor two levels up moves.
    const outer = new THREE.Group();
    const inner = new THREE.Group();
    outer.add(inner);
    inner.add(glyphs);
    scene.add(outer);
    glyphs.position.x = 1_000;
    const drawsOfGlyphs = () => glyphDraws(glyphs);
    assert.ok(drawsOfGlyphs().length > 0, 'the detached copy publishes draws');
    assert.equal(submittedDraws(scene, camera).length, 0, 'the detached copy is culled off-screen');

    group.add(outer);
    let submitted = submittedDraws(scene, camera);
    assert.ok(
      drawsOfGlyphs().every((draw) => submitted.includes(draw)),
      'a Glyphs whose ancestor moved into an opted-out group is drawn',
    );
    scene.add(outer);
    assert.equal(submittedDraws(scene, camera).length, 0, 'and is culled again once that ancestor leaves it');
    group.add(outer);
    submitted = submittedDraws(scene, camera);
    assert.ok(drawsOfGlyphs().every((draw) => submitted.includes(draw)));
    glyphs.dispose();
    label.dispose();
    group.dispose();
  });
}

for (const transformMode of ['indexed', 'direct']) {
  test(`${transformMode} detached glyph bounds follow their instance matrices`, async (t) => {
    const three = await cullingHandle(t, transformMode);
    const font = await loadFont({ baked: { bytes: await readFile(bitmapFontUrl) } }, bitmap({ strikes: [16] }));
    t.after(() => font.dispose());
    const scene = new THREE.Scene();
    const camera = viewCamera();
    const label = three.createText({ font, text: 'Split', style: { fontSize: 16 } });
    scene.add(label);
    scene.updateMatrixWorld(true);
    const [glyphs] = label.split();
    label.visible = false;
    scene.add(glyphs);
    glyphs.position.x = 1_000;
    assert.equal(submittedDraws(scene, camera).length, 0, 'the detached copy moved off-screen is culled');
    const matrix = new THREE.Matrix4();
    glyphs.getMatrixAt(0, matrix);
    matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(matrix).add(new THREE.Vector3(-1_000, 0, 0)));
    glyphs.setMatrixAt(0, matrix);
    const submitted = submittedDraws(scene, camera);
    assert.ok(submitted.length > 0, 'one glyph moved back into view submits its draw');
    const world = new THREE.Matrix4();
    glyphs.getWorldMatrixAt(0, world);
    const origin = new THREE.Vector3().setFromMatrixPosition(world);
    assert.ok(
      submitted.some((draw) => draw.boundingSphere.clone().applyMatrix4(draw.matrixWorld).containsPoint(origin)),
      'the moved glyph lies inside its draw bound',
    );
    glyphs.dispose();
    label.dispose();
  });
}
