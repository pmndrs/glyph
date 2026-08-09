import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';

import { validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { validateMsdfArtifact } from '../../dist/bakers/msdf-validator.js';
import { FontRegistry } from '../../dist/loader.js';
import { bitmap, bitmapDescriptor } from '../../dist/raster/bitmap-technique.js';
import { msdf, msdfDescriptor } from '../../dist/raster/msdf.js';
import { defineRasterResourceId } from '../../dist/raster-technique.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { ThreeTextEngineCoordinator } from '../../dist/three/engine-runtime.js';

const fixtureRoot = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const wasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);

test('Three coordinator shares shaping data across technique bindings and reference-counts stack handles', async () => {
  const [bitmapBytes, compressedMsdf, wasm] = await Promise.all([
    readFile(new URL('inter-bitmap-16.font.glb', fixtureRoot)),
    readFile(new URL('inter-mtsdf.font.glb.gz', fixtureRoot)),
    readFile(wasmUrl),
  ]);
  const msdfBytes = gunzipSync(compressedMsdf);
  const [bitmapCore, msdfCore] = await Promise.all([
    validateFontArtifact(bitmapBytes),
    validateFontArtifact(msdfBytes),
  ]);
  assert.equal(bitmapCore.shapingHash, msdfCore.shapingHash);
  const registry = new FontRegistry();
  const registered = await registry.registerAsset(bitmapBytes);
  const shaper = await createRuntimeShaper({ registry, wasm });
  shaper.registerFont(registered);
  const bitmapRaster = await validateBitmapArtifact(bitmapBytes, {
    descriptor: bitmapDescriptor({ strikes: [16] }),
    rasterKey: bitmapCore.document.extensions.PMNDRS_font.rasters[0].rasterKey,
    shapingHash: bitmapCore.shapingHash,
    glyphCount: bitmapCore.glyphCount,
    glyphIdWidth: 16,
  });
  const msdfRaster = await validateMsdfArtifact(msdfBytes, {
    descriptor: msdfDescriptor(),
    rasterKey: msdfCore.document.extensions.PMNDRS_font.rasters[0].rasterKey,
    shapingHash: msdfCore.shapingHash,
    glyphCount: msdfCore.glyphCount,
    glyphIdWidth: 16,
  });
  const bitmapFont = {
    runtime: undefined,
    font: registered,
    technique: bitmap,
    raster: undefined,
    data: {
      strikes: bitmapRaster.strikes.map((strike, strikeIndex) => ({
        ...strike,
        pages: strike.pages.map((page, pageIndex) => ({
          ...page,
          format: 'r8unorm',
          resource: defineRasterResourceId(`coordinator.bitmap.${strikeIndex}.${pageIndex}`),
        })),
        bindings: [],
      })),
    },
    disposed: false,
  };
  const extension = msdfRaster.document.extensions.PMNDRS_font_distance_field;
  const msdfFont = {
    runtime: undefined,
    font: registered,
    technique: msdf,
    raster: undefined,
    data: {
      resource: defineRasterResourceId('coordinator.mtsdf'),
      binding: {},
      emSize: extension.emSize,
      pixelRange: extension.pixelRange,
      planeUnitsPerEm: extension.planeUnitsPerEm,
      records: msdfRaster.records,
      pages: msdfRaster.pages,
    },
    disposed: false,
  };
  const coordinator = new ThreeTextEngineCoordinator({ shaper });
  const first = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  const shared = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  const reversed = coordinator.acquireFontStack([msdfFont, bitmapFont]);
  assert.equal(shared.handle, first.handle);
  assert.notEqual(reversed.handle, first.handle, 'fallback order is part of stack identity');
  first.release();
  first.release();
  const stillShared = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  assert.equal(stillShared.handle, shared.handle, 'one outstanding lease must retain the stack');
  shared.release();
  stillShared.release();
  const replacement = coordinator.acquireFontStack([bitmapFont, msdfFont]);
  assert.notEqual(replacement.handle, first.handle, 'a retired stack handle is not immediately reused');
  replacement.release();
  reversed.release();
  coordinator.dispose();
  assert.throws(() => coordinator.acquireFontStack([bitmapFont]), /disposed/);
  shaper.dispose();
  registered.dispose();
});
