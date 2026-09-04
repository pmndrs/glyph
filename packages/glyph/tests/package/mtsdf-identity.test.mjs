import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MSDF_MAX_EM_SIZE,
  MSDF_MAX_PIXEL_RANGE,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  msdfRasterKey,
} from '@pmndrs/glyph/raster/msdf';

test('derives canonical MSDF fingerprints for default and custom quality', async () => {
  const legacy = msdfDescriptor();
  const explicitDefault = msdfDescriptor({ emSize: 64, pixelRange: 8 });
  const rangeFour = msdfDescriptor({ emSize: 32, pixelRange: 4 });
  const rangeSix = msdfDescriptor({ emSize: 32, pixelRange: 6 });

  assert.strictEqual(explicitDefault, legacy);
  assert.deepEqual(legacy, { generatorVersion: '0.0.0' });
  assert.deepEqual(rangeFour, {
    emSize: 32,
    generatorVersion: '0.0.0',
    pixelRange: 4,
  });
  assert.equal(msdfDescriptorRasterKey(legacy), 'c51a74581f4288c40c308436ca120d67');
  assert.equal(msdfDescriptorRasterKey(rangeFour), '18a97f4dfdbf96aade7117a9fbfa0b85');
  assert.equal(msdfDescriptorRasterKey(rangeSix), 'd36b09cea1bfb26bcc16d3e34dc876e8');
  assert.equal(msdfRasterKey({ emSize: 32, pixelRange: 4 }), msdfDescriptorRasterKey(rangeFour));
});

test('validates MSDF quality options at the package boundary', () => {
  assert.deepEqual(msdfDescriptor({ emSize: 32 }), {
    emSize: 32,
    generatorVersion: '0.0.0',
    pixelRange: 8,
  });
  assert.deepEqual(msdfDescriptor({ pixelRange: 5 }), {
    emSize: 64,
    generatorVersion: '0.0.0',
    pixelRange: 5,
  });

  for (const emSize of [0, 1.5, Number.NaN, MSDF_MAX_EM_SIZE + 1]) {
    assert.throws(() => msdfDescriptor({ emSize }), /emSize/);
  }
  for (const pixelRange of [0, 1.5, Number.NaN, MSDF_MAX_PIXEL_RANGE + 1]) {
    assert.throws(() => msdfDescriptor({ pixelRange }), /pixelRange/);
  }
  assert.throws(() => msdfDescriptor({ unknown: 1 }), /unknown property/);
});
