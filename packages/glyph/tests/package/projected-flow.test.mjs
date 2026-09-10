import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import { projectTextFlowBounds, projectTextFlowSilhouette } from '../../dist/three.js';

test('perspective projection clips a camera-side bound onto paragraph flow', () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.position.z = 10;
  const textObject = new THREE.Object3D();
  const object = new THREE.Object3D();
  const exclusion = projectTextFlowBounds({
    key: 'moving-object',
    camera,
    text: textObject,
    object,
    bounds: new THREE.Box3(new THREE.Vector3(-1, -1, 1), new THREE.Vector3(1, 1, 2)),
    flowBounds: [-5, -5, 5, 5],
    projectionError: 0.25,
    marginInline: 0.5,
    wrapSide: 'largest',
  });

  assert.ok(exclusion);
  assert.equal(exclusion.key, 'moving-object');
  assert.equal(exclusion.wrapSide, 'largest');
  assert.equal(exclusion.marginInline, 0.5);
  assert.equal(exclusion.shape.kind, 'polygon');
  assert.deepEqual(polygonBounds(exclusion.shape.vertices), [-1.5, -1.5, 1.5, 1.5]);
  assert.ok(Object.isFrozen(exclusion));
  assert.ok(Object.isFrozen(exclusion.shape.vertices));

  object.position.x = 1e-10;
  assert.deepEqual(
    projectTextFlowBounds({
      key: 'moving-object',
      camera,
      text: textObject,
      object,
      bounds: new THREE.Box3(new THREE.Vector3(-1, -1, 1), new THREE.Vector3(1, 1, 2)),
      flowBounds: [-5, -5, 5, 5],
      projectionError: 0.25,
      marginInline: 0.5,
      wrapSide: 'largest',
    }),
    exclusion,
    'sub-f32 projection movement must normalize to an unchanged exclusion',
  );
});

test('orthographic projection preserves plane coordinates and clips to authored flow bounds', () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 10;
  const exclusion = projectTextFlowBounds({
    key: 'orthographic-object',
    camera,
    text: new THREE.Object3D(),
    object: new THREE.Object3D(),
    bounds: new THREE.Box3(new THREE.Vector3(-2, -3, 1), new THREE.Vector3(2, 3, 2)),
    flowBounds: [-1, -2, 1, 2],
  });

  assert.ok(exclusion);
  assert.equal(exclusion.shape.kind, 'polygon');
  assert.deepEqual(polygonBounds(exclusion.shape.vertices), [-1, -2, 1, 2]);
});

test('a bound enclosing the complete frustum conservatively excludes the complete flow rectangle', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 10;
  const exclusion = projectTextFlowBounds({
    key: 'enclosing-object',
    camera,
    text: new THREE.Object3D(),
    object: new THREE.Object3D(),
    bounds: new THREE.Box3(new THREE.Vector3(-1_000, -1_000, 0.1), new THREE.Vector3(1_000, 1_000, 20)),
    flowBounds: [-4, -3, 4, 3],
  });

  assert.ok(exclusion);
  assert.equal(exclusion.shape.kind, 'polygon');
  assert.deepEqual(polygonBounds(exclusion.shape.vertices), [-4, -3, 4, 3]);
});

test('projection omits behind-plane bounds and rejects degenerate projection state', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 10;
  const textObject = new THREE.Object3D();
  const object = new THREE.Object3D();
  assert.equal(
    projectTextFlowBounds({
      key: 'behind-text',
      camera,
      text: textObject,
      object,
      bounds: new THREE.Box3(new THREE.Vector3(-1, -1, -2), new THREE.Vector3(1, 1, -1)),
      flowBounds: [-5, -5, 5, 5],
    }),
    undefined,
  );
  const crossing = projectTextFlowBounds({
    key: 'crossing-text',
    camera,
    text: textObject,
    object,
    bounds: new THREE.Box3(new THREE.Vector3(-1, -1, -2), new THREE.Vector3(1, 1, 2)),
    flowBounds: [-5, -5, 5, 5],
  });
  assert.ok(crossing);
  assert.equal(crossing.shape.kind, 'polygon');
  assert.ok(crossing.shape.vertices.flat().every(Number.isFinite));

  camera.position.z = 0;
  assert.throws(
    () =>
      projectTextFlowBounds({
        key: 'camera-on-plane',
        camera,
        text: textObject,
        object,
        bounds: new THREE.Box3(new THREE.Vector3(-1, -1, 1), new THREE.Vector3(1, 1, 2)),
        flowBounds: [-5, -5, 5, 5],
      }),
    /camera must not lie on the text plane/,
  );

  camera.position.z = 10;
  textObject.scale.z = 0;
  assert.throws(
    () =>
      projectTextFlowBounds({
        key: 'degenerate-text-plane',
        camera,
        text: textObject,
        object,
        bounds: new THREE.Box3(new THREE.Vector3(-1, -1, 1), new THREE.Vector3(1, 1, 2)),
        flowBounds: [-5, -5, 5, 5],
      }),
    /text matrixWorld must be finite and invertible/,
  );

  textObject.scale.z = 1;
  textObject.position.x = 1;
  textObject.rotation.y = Math.PI / 2;
  const edgeOnCamera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  edgeOnCamera.position.z = 10;
  assert.throws(
    () =>
      projectTextFlowBounds({
        key: 'edge-on-text-plane',
        camera: edgeOnCamera,
        text: textObject,
        object,
        bounds: new THREE.Box3(new THREE.Vector3(-1, -1, 1), new THREE.Vector3(1, 1, 2)),
        flowBounds: [-5, -5, 5, 5],
      }),
    /text flow plane projection must not be edge-on or degenerate/,
  );
});

test('an explicit silhouette preserves a projected concavity without inflation', () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 10;
  const exclusion = projectTextFlowSilhouette({
    key: 'concave-object',
    camera,
    text: new THREE.Object3D(),
    object: new THREE.Object3D(),
    silhouette: [
      new THREE.Vector3(-2, -2, 1),
      new THREE.Vector3(2, -2, 1),
      new THREE.Vector3(2, 2, 1),
      new THREE.Vector3(0, 0.5, 1),
      new THREE.Vector3(-2, 2, 1),
    ],
    flowBounds: [-5, -5, 5, 5],
  });

  assert.ok(exclusion);
  assert.equal(exclusion.shape.kind, 'polygon');
  assert.equal(exclusion.shape.vertices.length, 5);
  assert.deepEqual(polygonBounds(exclusion.shape.vertices), [-2, -2, 2, 2]);
  assert.ok(hasReflexVertex(exclusion.shape.vertices));
});

test('explicit silhouettes clip camera-side geometry and omit fully hidden rings', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 10;
  const common = {
    camera,
    text: new THREE.Object3D(),
    object: new THREE.Object3D(),
    flowBounds: [-5, -5, 5, 5],
  };
  assert.equal(
    projectTextFlowSilhouette({
      ...common,
      key: 'behind-silhouette',
      silhouette: [new THREE.Vector3(-1, -1, -2), new THREE.Vector3(1, -1, -2), new THREE.Vector3(0, 1, -2)],
    }),
    undefined,
  );

  const clipped = projectTextFlowSilhouette({
    ...common,
    key: 'crossing-silhouette',
    silhouette: [new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, -1, 1), new THREE.Vector3(0, 1, 1)],
  });
  assert.ok(clipped);
  assert.ok(clipped.shape.vertices.flat().every(Number.isFinite));
});

test('explicit silhouettes reject malformed caller-authored rings', () => {
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.z = 10;
  const common = {
    key: 'invalid-silhouette',
    camera,
    text: new THREE.Object3D(),
    object: new THREE.Object3D(),
    flowBounds: [-5, -5, 5, 5],
  };
  assert.throws(() => projectTextFlowSilhouette({ ...common, silhouette: [] }), /at least three/);
  assert.throws(
    () =>
      projectTextFlowSilhouette({
        ...common,
        silhouette: [new THREE.Vector3(-1, -1, 1), new THREE.Vector3(Number.NaN, -1, 1), new THREE.Vector3(0, 1, 1)],
      }),
    /finite values/,
  );
  assert.throws(
    () =>
      projectTextFlowSilhouette({
        ...common,
        silhouette: [
          new THREE.Vector3(-1, -1, 1),
          new THREE.Vector3(2, 1, 1),
          new THREE.Vector3(-1, 1, 1),
          new THREE.Vector3(1, -1, 1),
        ],
      }),
    /must not self-intersect/,
  );
});

function polygonBounds(points) {
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
  ];
}

function hasReflexVertex(points) {
  const signs = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const after = points[(index + 2) % points.length];
    return Math.sign((next[0] - point[0]) * (after[1] - next[1]) - (next[1] - point[1]) * (after[0] - next[0]));
  });
  return signs.some((sign) => sign > 0) && signs.some((sign) => sign < 0);
}
