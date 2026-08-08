import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MSDF_MAX_EM_SIZE,
  MSDF_MAX_PIXEL_RANGE,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  msdfRasterKey,
} from '@pmndrs/text/raster/msdf';

test('preserves the legacy MSDF identity while authenticating custom quality', async () => {
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
  assert.equal(
    await msdfDescriptorRasterKey(legacy),
    'e944ba8d2856314856289466e82e471e0adc0775a7c9c3affec7c59bfdd8fe93',
  );
  assert.equal(
    await msdfDescriptorRasterKey(rangeFour),
    '9c8825cc24b9549e9cc923a17a32665770a4ec05be48e7439a0d5ac89f05afa1',
  );
  assert.equal(
    await msdfDescriptorRasterKey(rangeSix),
    'fa8f5c03367db3652abb41659835618f989ad00c0dc0c39fac8dcf3e21ee16a8',
  );
  assert.equal(await msdfRasterKey({ emSize: 32, pixelRange: 4 }), await msdfDescriptorRasterKey(rangeFour));
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
