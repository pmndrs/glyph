import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { validateFontArtifact } from '@pmndrs/text-font-baker/validate';

import { validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { validateMsdfArtifact } from '../../dist/bakers/msdf-validator.js';
import { validateSlugArtifact } from '../../dist/bakers/slug-validator.js';
import { firstPartyFontBindingBytes } from '../../dist/internal/font-binding-wire.js';
import { bitmap, bitmapDescriptor } from '../../dist/raster/bitmap-technique.js';
import { msdf, msdfDescriptor } from '../../dist/raster/msdf.js';
import { slug, slugDescriptor } from '../../dist/raster/slug-technique.js';
import { defineRasterResourceId } from '../../dist/raster-technique.js';
import { techniqueProof } from '../../scripts/support/render-technique-proof.mjs';

const fixtureRoot = new URL('../../../../apps/benchmarks/fixtures/rendering/', import.meta.url);
const abiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url);

test('production first-party bindings preserve every proven field-major raster lane', async () => {
  const abi = JSON.parse(await readFile(abiUrl, 'utf8'));
  for (const name of ['bitmap', 'mtsdf', 'slug']) {
    const { core, raster, loaded } = await fixture(name);
    const actual = firstPartyFontBindingBytes(loaded);
    const expected = techniqueProof(abi, name, raster).bindingBytes;
    const strikeRows = core.glyphCount * (name === 'bitmap' ? raster.strikes.length : 1);
    for (const [table, rows] of [
      ['glyphF32', core.glyphCount],
      ['glyphU32', core.glyphCount],
      ['strikeF32', strikeRows],
      ['strikeU32', strikeRows],
      ['resourceF32', resourceCount(actual, abi)],
      ['resourceU32', resourceCount(actual, abi)],
    ]) {
      assert.deepEqual(
        tableBytes(actual, abi, table, rows),
        tableBytes(expected, abi, table, rows),
        `${name} ${table}`,
      );
    }
  }
});

async function fixture(name) {
  const files = {
    bitmap: ['inter-bitmap-16.font.glb', false],
    mtsdf: ['inter-mtsdf.font.glb.gz', true],
    slug: ['inter-slug.font.glb.gz', true],
  };
  const [file, compressed] = files[name];
  const stored = await readFile(new URL(file, fixtureRoot));
  const bytes = compressed ? gunzipSync(stored) : stored;
  const core = await validateFontArtifact(bytes);
  const identity = core.document.extensions.PMNDRS_font.rasters[0];
  const context = {
    rasterKey: identity.rasterKey,
    shapingHash: core.shapingHash,
    glyphCount: core.glyphCount,
    glyphIdWidth: 16,
  };
  if (name === 'bitmap') {
    const raster = await validateBitmapArtifact(bytes, { ...context, descriptor: bitmapDescriptor({ strikes: [16] }) });
    const data = {
      strikes: raster.strikes.map((strike, strikeIndex) => ({
        ...strike,
        pages: strike.pages.map((page, pageIndex) => ({
          ...page,
          format: 'r8unorm',
          resource: defineRasterResourceId(`test.bitmap.${strikeIndex}.${pageIndex}`),
        })),
        bindings: [],
      })),
    };
    return { core, raster, loaded: { font: core, technique: bitmap, data } };
  }
  if (name === 'mtsdf') {
    const raster = await validateMsdfArtifact(bytes, { ...context, descriptor: msdfDescriptor() });
    const extension = raster.document.extensions.PMNDRS_font_distance_field;
    const data = {
      resource: defineRasterResourceId('test.mtsdf'),
      binding: {
        width: Math.max(...raster.pages.map((page) => page.width)),
        height: Math.max(...raster.pages.map((page) => page.height)),
        layers: raster.pages.length,
      },
      emSize: extension.emSize,
      pixelRange: extension.pixelRange,
      planeUnitsPerEm: extension.planeUnitsPerEm,
      records: raster.records,
      pages: raster.pages,
    };
    return { core, raster, loaded: { font: core, technique: msdf, data } };
  }
  const raster = await validateSlugArtifact(bytes, { ...context, descriptor: slugDescriptor() });
  const extension = raster.document.extensions.PMNDRS_font_slug;
  const data = {
    planeUnitsPerEm: extension.planeUnitsPerEm,
    records: raster.records,
    pages: raster.pages.map((page, pageIndex) => ({
      ...page,
      resource: defineRasterResourceId(`test.slug.${pageIndex}`),
    })),
    bindings: [],
  };
  return { core, raster, loaded: { font: core, technique: slug, data } };
}

function resourceCount(bytes, abi) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    abi.layouts.fontBindingRequest.resourceCount,
    true,
  );
}

function tableBytes(bytes, abi, name, rows) {
  const request = abi.layouts.fontBindingRequest;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint8(request[`${name}FieldCount`]);
  const offset = view.getUint32(request[`${name}Offset`], true);
  return offset === 0 ? new Uint8Array() : bytes.slice(offset, offset + count * rows * 4);
}
