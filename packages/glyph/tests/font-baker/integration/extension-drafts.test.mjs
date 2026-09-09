import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { before } from 'node:test';

import Ajv from 'ajv';
import draft04Schema from 'ajv/lib/refs/json-schema-draft-04.json' with { type: 'json' };

const extensionRoot = new URL('../../../../../.agents/docs/planning/extensions/', import.meta.url);
let validateDistanceField;
let validateSlug;

before(async () => {
  const [distanceField, slug, resourceSource, texturePages, textureResourceSchema, binaryResource] = await Promise.all([
    readSchema('PMNDRS_font_distance_field/schema/glTF.PMNDRS_font_distance_field.schema.json'),
    readSchema('PMNDRS_font_slug/schema/glTF.PMNDRS_font_slug.schema.json'),
    readSchema('schema/resourceSource.PMNDRS_font.schema.json'),
    readSchema('schema/texturePages.PMNDRS_font.schema.json'),
    readSchema('schema/textureResource.PMNDRS_font.schema.json'),
    readSchema('schema/binaryResource.PMNDRS_font.schema.json'),
  ]);
  const ajv = new Ajv({ allErrors: true, schemaId: 'auto' });
  ajv.addMetaSchema(draft04Schema);
  ajv.addSchema({ id: 'glTFProperty.schema.json', type: 'object' });
  for (const [id, schema] of [
    ['schema/resourceSource.PMNDRS_font.schema.json', resourceSource],
    ['schema/texturePages.PMNDRS_font.schema.json', texturePages],
    ['schema/textureResource.PMNDRS_font.schema.json', textureResourceSchema],
    ['schema/binaryResource.PMNDRS_font.schema.json', binaryResource],
  ]) {
    ajv.addSchema({ ...schema, id });
  }
  validateDistanceField = ajv.compile(distanceField);
  validateSlug = ajv.compile(slug);
});

test('compiles and accepts the canonical MTSDF V0 extension shape', () => {
  const specimen = distanceFieldSpecimen();
  assertValid(validateDistanceField, specimen);
  assertRequiredFields(validateDistanceField, specimen, [
    'version',
    'rasterKey',
    'fingerprint',
    'encoding',
    'emSize',
    'pixelRange',
    'planeUnitsPerEm',
    'recordBufferView',
    'recordStride',
    'pages',
  ]);
  assertInvalid(validateDistanceField, { ...specimen, encoding: 'msdf' });
  assertInvalid(validateDistanceField, { ...specimen, recordStride: 16 });
  assertInvalid(validateDistanceField, { ...specimen, pixelRange: 0 });
  assertInvalid(validateDistanceField, {
    ...specimen,
    pages: [{ ...specimen.pages[0], colorSpace: 'srgb' }],
  });
});

test('compiles and accepts the canonical Slug V0 extension shape', () => {
  const specimen = slugSpecimen();
  assertValid(validateSlug, specimen);
  assertRequiredFields(validateSlug, specimen, [
    'version',
    'rasterKey',
    'fingerprint',
    'planeUnitsPerEm',
    'recordBufferView',
    'recordStride',
    'pages',
  ]);
  const page = specimen.pages[0];
  for (const field of [
    'curve',
    'headerCount',
    'headerWidth',
    'headerHeight',
    'headerResource',
    'referenceCount',
    'referenceWidth',
    'referenceHeight',
    'referenceResource',
  ]) {
    const changedPage = structuredClone(page);
    delete changedPage[field];
    assertInvalid(validateSlug, { ...specimen, pages: [changedPage] });
  }
  assertInvalid(validateSlug, { ...specimen, recordStride: 20 });
  assertInvalid(validateSlug, { ...specimen, pages: [] });
  assertInvalid(validateSlug, {
    ...specimen,
    pages: [{ ...page, curve: textureResource('rgba8unorm') }],
  });
  assertInvalid(validateSlug, {
    ...specimen,
    pages: [{ ...page, curve: { ...page.curve, colorSpace: 'srgb' } }],
  });
});

async function readSchema(path) {
  return JSON.parse(await readFile(new URL(path, extensionRoot), 'utf8'));
}

function distanceFieldSpecimen() {
  return {
    version: 0,
    rasterKey: '1'.repeat(32),
    fingerprint: '2'.repeat(32),
    encoding: 'mtsdf',
    emSize: 48,
    pixelRange: 4,
    planeUnitsPerEm: 2048,
    recordBufferView: 0,
    recordStride: 20,
    pages: [textureResource('rgba8unorm')],
  };
}

function slugSpecimen() {
  return {
    version: 0,
    rasterKey: '3'.repeat(32),
    fingerprint: '2'.repeat(32),
    planeUnitsPerEm: 2048,
    recordBufferView: 0,
    recordStride: 40,
    pages: [
      {
        curve: textureResource('rgba16float'),
        headerCount: 32,
        headerWidth: 8,
        headerHeight: 4,
        headerResource: { source: { type: 'bufferView', bufferView: 2 } },
        referenceCount: 64,
        referenceWidth: 8,
        referenceHeight: 8,
        referenceResource: { source: { type: 'bufferView', bufferView: 3 } },
      },
    ],
  };
}

function textureResource(gpuFormat) {
  return {
    width: 1024,
    height: 1024,
    mipLevelCount: 1,
    colorSpace: 'linear',
    variants: [
      {
        source: { type: 'bufferView', bufferView: 1 },
        container: 'ktx2',
        gpuFormat,
        quality: 'lossless',
      },
    ],
  };
}

function assertRequiredFields(validate, specimen, fields) {
  for (const field of fields) {
    const changed = structuredClone(specimen);
    delete changed[field];
    assertInvalid(validate, changed);
  }
}

function assertValid(validate, value) {
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
}

function assertInvalid(validate, value) {
  assert.equal(validate(value), false, 'mutation unexpectedly passed its canonical schema');
  assert.ok(validate.errors?.length > 0);
}
