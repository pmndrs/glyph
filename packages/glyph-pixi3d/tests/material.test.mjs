import assert from 'node:assert/strict';
import test from 'node:test';

import { FlatMaterial, Material3D } from '@pixi/3d';

import {
  attachPixi3DTextMaterial,
  createPixi3DTextMaterial,
  detachPixi3DTextMaterial,
  Pixi3DTextMaterial,
} from '../dist/material.js';

const pulseBit = {
  name: 'glyphPixi3DTestPulse',
  bindings: {
    material: {
      uPulse: 'f32',
      uTint: 'vec3<f32>',
    },
  },
};

test('text material data follows every attached Pixi3D material', () => {
  const extension = new Pixi3DTextMaterial({
    extraBits: [pulseBit],
    data: { uPulse: 0.25, uTint: [1, 0.5, 0.25] },
  });
  const first = new FlatMaterial({ extraBits: [pulseBit] });
  const second = new FlatMaterial({ extraBits: [pulseBit] });
  attachPixi3DTextMaterial(extension, first);
  attachPixi3DTextMaterial(extension, second);

  extension.update({ uPulse: 0.75, uTint: [0, 1, 0.5] });
  assert.equal(first.data.uPulse, 0.75);
  assert.equal(second.data.uPulse, 0.75);
  assert.deepEqual([...first.data.uTint], [0, 1, 0.5]);
  assert.deepEqual([...second.data.uTint], [0, 1, 0.5]);

  detachPixi3DTextMaterial(first);
  extension.update({ uPulse: 1 });
  assert.equal(first.data.uPulse, 0.75);
  assert.equal(second.data.uPulse, 1);
  first.destroy();
  detachPixi3DTextMaterial(second);
  second.destroy();
});

test('text material data names and values are checked at the caller boundary', () => {
  assert.throws(
    () => new Pixi3DTextMaterial({ extraBits: [pulseBit], data: { missing: 1 } }),
    /no declared field named missing/,
  );
  assert.throws(
    () => new Pixi3DTextMaterial({ extraBits: [pulseBit], data: { uTint: [1, 0] } }),
    /must contain 3 finite numbers/,
  );
});

test('native record capability defaults preserve custom factories', () => {
  assert.equal(new Pixi3DTextMaterial({}).nativeRecords, true);
  assert.equal(
    new Pixi3DTextMaterial({ create: ({ createDefaultMaterial }) => createDefaultMaterial() }).nativeRecords,
    false,
  );
  assert.equal(
    new Pixi3DTextMaterial({ nativeRecords: true, create: ({ createDefaultMaterial }) => createDefaultMaterial() })
      .nativeRecords,
    true,
  );
  assert.equal(new Pixi3DTextMaterial({ nativeRecords: false }).nativeRecords, false);
  assert.throws(
    () => new Pixi3DTextMaterial({ nativeRecords: 'yes' }),
    /nativeRecords material option must be a boolean/,
  );
});

test('text meshes use a lit PBR material by default', () => {
  const material = createPixi3DTextMaterial(undefined, 'pmndrs.slug', [pulseBit], {});
  assert.ok(material instanceof Material3D);
  assert.equal(material.alphaMode, 'blend');
  assert.equal(material.doubleSided, true);
  assert.equal(material.fog, false);
  material.destroy();
});

test('a text material factory can replace PBR while retaining Glyph bits and data', () => {
  const contexts = [];
  const extension = new Pixi3DTextMaterial({
    extraBits: [pulseBit],
    data: { uPulse: 0.4, uTint: [0.5, 0.75, 1] },
    create: (context) => {
      contexts.push(context);
      return new FlatMaterial({
        alphaMode: 'blend',
        doubleSided: true,
        fog: false,
        extraBits: context.bits,
      });
    },
  });
  const material = createPixi3DTextMaterial(extension, 'pmndrs.msdf', [pulseBit], {});
  assert.ok(material instanceof FlatMaterial);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].format, 'pmndrs.msdf');
  assert.deepEqual(contexts[0].bits, [pulseBit]);
  assert.equal(material.data.uPulse, Math.fround(0.4));
  detachPixi3DTextMaterial(material);
  material.destroy();
});

test('a text material factory must return a fresh renderer-owned material', () => {
  const shared = new FlatMaterial({ extraBits: [pulseBit] });
  const extension = new Pixi3DTextMaterial({ extraBits: [pulseBit], create: () => shared });
  assert.equal(createPixi3DTextMaterial(extension, 'pmndrs.bitmap', [pulseBit], {}), shared);
  assert.throws(() => createPixi3DTextMaterial(extension, 'pmndrs.bitmap', [pulseBit], {}), /fresh unowned material/);
  detachPixi3DTextMaterial(shared);
  shared.destroy();
});
