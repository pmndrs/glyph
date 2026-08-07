import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MTSDF_MAX_EM_SIZE,
  MTSDF_MAX_PIXEL_RANGE,
  mtsdfDescriptor,
  mtsdfDescriptorRasterKey,
  mtsdfRasterKey,
} from '@pmndrs/text/raster/mtsdf';

test('preserves the legacy MTSDF identity while authenticating custom quality', async () => {
  const legacy = mtsdfDescriptor();
  const explicitDefault = mtsdfDescriptor({ emSize: 64, pixelRange: 8 });
  const rangeFour = mtsdfDescriptor({ emSize: 32, pixelRange: 4 });
  const rangeSix = mtsdfDescriptor({ emSize: 32, pixelRange: 6 });

  assert.strictEqual(explicitDefault, legacy);
  assert.deepEqual(legacy, { generatorVersion: '0.0.0' });
  assert.deepEqual(rangeFour, {
    emSize: 32,
    generatorVersion: '0.0.0',
    pixelRange: 4,
  });
  assert.equal(
    await mtsdfDescriptorRasterKey(legacy),
    'e944ba8d2856314856289466e82e471e0adc0775a7c9c3affec7c59bfdd8fe93',
  );
  assert.equal(
    await mtsdfDescriptorRasterKey(rangeFour),
    '9c8825cc24b9549e9cc923a17a32665770a4ec05be48e7439a0d5ac89f05afa1',
  );
  assert.equal(
    await mtsdfDescriptorRasterKey(rangeSix),
    'fa8f5c03367db3652abb41659835618f989ad00c0dc0c39fac8dcf3e21ee16a8',
  );
  assert.equal(await mtsdfRasterKey({ emSize: 32, pixelRange: 4 }), await mtsdfDescriptorRasterKey(rangeFour));
});

test('validates MTSDF quality options at the package boundary', () => {
  assert.deepEqual(mtsdfDescriptor({ emSize: 32 }), {
    emSize: 32,
    generatorVersion: '0.0.0',
    pixelRange: 8,
  });
  assert.deepEqual(mtsdfDescriptor({ pixelRange: 5 }), {
    emSize: 64,
    generatorVersion: '0.0.0',
    pixelRange: 5,
  });

  for (const emSize of [0, 1.5, Number.NaN, MTSDF_MAX_EM_SIZE + 1]) {
    assert.throws(() => mtsdfDescriptor({ emSize }), /emSize/);
  }
  for (const pixelRange of [0, 1.5, Number.NaN, MTSDF_MAX_PIXEL_RANGE + 1]) {
    assert.throws(() => mtsdfDescriptor({ pixelRange }), /pixelRange/);
  }
  assert.throws(() => mtsdfDescriptor({ unknown: 1 }), /unknown property/);
});
