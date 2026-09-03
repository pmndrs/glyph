/**
 * When a Three raster codec may still be registered.
 *
 * The registry is module-global, and a `GlyphEngine`'s Three coordinator reads it exactly
 * once, at construction. Nothing re-reads it. A registration after that point was a perfectly legal
 * call that applied to nothing: the technique was in the map, invisible to every engine already
 * built, and the loss surfaced far away and much later as a missing technique when a font using it
 * was bound. A doc comment saying "register early" is not enforcement.
 *
 * The rule this pins: a technique no live engine could ever see is refused at registration,
 * naming itself, and becomes registrable again once no engine holds a snapshot.
 *
 * This file owns its own engine and coordinator because the assertions are about the module-global
 * registry's lifecycle, and it leaves a program in that registry -- which is safe only because the
 * test runner gives each file its own process.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { glyph } from '@pmndrs/glyph';
import { registerThreeRasterProgram, ThreeConfig } from '@pmndrs/glyph/three';
import { f32, techniqueProgram, u32 } from '@pmndrs/glyph/config/codec-program';
import { id } from '@pmndrs/glyph/config/codec';
import { defineRasterFormat } from '@pmndrs/glyph/config/raster-format';
import { registerRasterCodec } from '@pmndrs/glyph/config/raster';
import { defineTechniqueGeometryKind, defineTechniqueSchema } from '@pmndrs/glyph/config/schema';
import {
  createImmutableFontBacking,
  createImmutableFontLease,
  createImmutableFontVariant,
} from '../../dist/loaded-font.js';
import { FontRegistry } from '../../dist/loader.js';

const RECT_BUFFER_ID = id.buffer('test.three-plan-program/rect');
const STABLE_GLYPH_BUFFER_ID = id.buffer('test.three-plan-program/system/stable-glyph-id');
const TRANSFORM_BUFFER_ID = id.buffer('test.three-plan-program/system/transform-index');
await glyph.init();

const portablePrograms = new Map();
const rasterProgram = (techniqueIdentity, declaration = {}) => {
  let portable = portablePrograms.get(techniqueIdentity);
  if (portable === undefined) {
    const technique = defineRasterFormat({
      id: techniqueIdentity,
      kind: 'test',
      extension: 'TEST_raster',
      version: 0,
      textEffects: [],
      descriptor: () => ({}),
      async decode() {
        return {};
      },
      dispose() {},
    });
    const resources = declaration.resources ?? { payload: { kind: 'buffer' } };
    const render = {
      resource: Object.keys(resources)[0],
      geometry: { kind: 'synthetic-quad' },
      ...declaration.render,
    };
    const schema = defineTechniqueSchema({
      technique: techniqueIdentity,
      scope: 'glyph',
      binding: {},
      buffers: {},
      ...declaration,
      resources,
      render,
    });
    portable = { raster: technique, schema };
    registerRasterCodec({
      raster: technique,
      schema,
      codecBody(system) {
        const program = techniqueProgram(schema, { system });
        return program.compile(
          Object.fromEntries(
            Object.entries(schema.buffers).map(([name, buffer]) => [
              name,
              Array.from({ length: buffer.lanes.length }, () =>
                buffer.scalar === 'f32' ? f32.const(0) : u32.const(0),
              ),
            ]),
          ),
        );
      },
      compileFont() {},
    });
    portablePrograms.set(techniqueIdentity, portable);
  }
  const buffers = Object.fromEntries(
    Object.entries(portable.schema.buffers).map(([name, buffer]) => [
      name,
      { scalar: buffer.scalar, vectorWidth: buffer.lanes.length },
    ]),
  );
  const resources = Object.fromEntries(
    Object.entries(portable.schema.resources).map(([name, resource]) => [
      name,
      resource.kind === 'texture' || resource.kind === 'texture-array'
        ? { kind: resource.kind, format: resource.format }
        : { kind: resource.kind },
    ]),
  );
  return {
    raster: portable.raster,
    schema: portable.schema,
    variant: {
      id: 'test',
      language: 'test',
      buffers,
      resources,
      outputs: { position: 'vec3' },
      geometry: structuredClone(portable.schema.render.geometry),
      createMaterial() {
        throw new Error('unreachable: this program is never realized');
      },
    },
  };
};

test('variant registration rejects incompatible capabilities before an engine exists', () => {
  const missingOutputs = rasterProgram('test-missing-outputs');
  delete missingOutputs.variant.outputs;
  assert.throws(() => registerThreeRasterProgram(missingOutputs), /needs named shader outputs/);

  const unknownBuffer = rasterProgram('test-unknown-buffer');
  unknownBuffer.variant.buffers = { foreign: { scalar: 'f32', vectorWidth: 1 } };
  assert.throws(() => registerThreeRasterProgram(unknownBuffer), /unknown buffer "foreign"/);

  const unknownResource = rasterProgram('test-unknown-resource');
  unknownResource.variant.resources = {
    ...unknownResource.variant.resources,
    foreign: { kind: 'buffer' },
  };
  assert.throws(() => registerThreeRasterProgram(unknownResource), /unknown resource "foreign"/);

  const wrongGeometry = rasterProgram('test-wrong-geometry');
  wrongGeometry.variant.geometry = { kind: 'quad', resource: 'foreign', coordinates: 'unit-square' };
  assert.throws(() => registerThreeRasterProgram(wrongGeometry), /declares incompatible geometry/);

  const extraGeometryField = rasterProgram('test-extra-geometry-field');
  extraGeometryField.variant.geometry = { kind: 'synthetic-quad', name: 'not-part-of-this-shape' };
  assert.throws(() => registerThreeRasterProgram(extraGeometryField), /declares incompatible geometry/);

  const wrongPositionWidth = rasterProgram('test-wrong-position-width', {
    resources: {
      mesh: {
        kind: 'geometry',
        attributes: [{ semantic: 'position', componentType: 'f32', components: 2 }],
      },
    },
    render: { geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
  });
  assert.throws(
    () => registerThreeRasterProgram(wrongPositionWidth),
    /geometry attribute "position" needs 3 components; got 2/,
  );

  const inheritedSemanticName = rasterProgram('test-inherited-semantic-name', {
    resources: {
      mesh: {
        kind: 'geometry',
        attributes: [{ semantic: 'valueOf', componentType: 'f32', components: 2 }],
      },
    },
    render: { geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
  });
  assert.doesNotThrow(() => registerThreeRasterProgram(inheritedSemanticName));

  const customGeometryName = defineTechniqueGeometryKind('test-custom-shape');
  const wrongCustomGeometryName = rasterProgram('test-wrong-custom-geometry-name', {
    resources: {
      mesh: {
        kind: 'geometry',
        attributes: [{ semantic: 'position', componentType: 'f32', components: 2 }],
      },
    },
    render: {
      geometry: { kind: 'custom', name: customGeometryName, resource: 'mesh', coordinates: 'em' },
    },
  });
  wrongCustomGeometryName.variant.geometry.name = defineTechniqueGeometryKind('test-other-custom-shape');
  assert.throws(() => registerThreeRasterProgram(wrongCustomGeometryName), /declares incompatible geometry/);

  const wrongScalar = rasterProgram('test-wrong-scalar', {
    buffers: { rect: { id: RECT_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
  });
  wrongScalar.variant.buffers.rect.scalar = 'u32';
  assert.throws(() => registerThreeRasterProgram(wrongScalar), /buffer "rect" must consume f32x2/);

  const missingBuffer = rasterProgram('test-missing-buffer', {
    buffers: { rect: { id: RECT_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
  });
  delete missingBuffer.variant.buffers.rect;
  assert.throws(() => registerThreeRasterProgram(missingBuffer), /omits buffer "rect"/);

  const wrongFormat = rasterProgram('test-wrong-format', {
    resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } },
  });
  wrongFormat.variant.resources.atlas.format = 'r8unorm';
  assert.throws(() => registerThreeRasterProgram(wrongFormat), /resource "atlas" must consume texture:rgba8unorm/);

  const missingResource = rasterProgram('test-missing-resource', {
    resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } },
  });
  delete missingResource.variant.resources.atlas;
  assert.throws(() => registerThreeRasterProgram(missingResource), /omits resource "atlas"/);

  const witnessed = rasterProgram('test-wrong-schema-witness');
  witnessed.schema = defineTechniqueSchema({
    technique: witnessed.raster.id,
    scope: 'glyph',
    binding: {},
    buffers: {},
  });
  assert.throws(() => registerThreeRasterProgram(witnessed), /needs its registered portable schema/);

  const copiedRaster = rasterProgram('test-copied-raster-format');
  copiedRaster.raster = Object.assign(() => ({}), copiedRaster.raster);
  assert.throws(
    () => registerThreeRasterProgram(copiedRaster),
    /needs its registered RasterFormat/,
    'a structural copy must not impersonate the package-owned RasterFormat',
  );

  assert.throws(() => {
    const anchor = rasterProgram('test-portable-registration-anchor');
    const unregisteredTechnique = defineRasterFormat({
      id: 'test-no-portable',
      kind: 'test',
      extension: 'TEST_raster',
      version: 0,
      textEffects: [],
      descriptor: () => ({}),
      async decode() {
        return {};
      },
      dispose() {},
    });
    registerThreeRasterProgram({
      ...anchor,
      raster: unregisteredTechnique,
    });
  }, /no portable raster codec is registered/);
});

test('registration selects one renderer variant per technique before engine construction', async () => {
  const primary = rasterProgram('test-variant-selection');
  const unsupported = rasterProgram('test-portable-without-three').raster;
  const secondary = {
    raster: primary.raster,
    schema: primary.schema,
    variant: { ...primary.variant, id: 'second' },
  };
  registerThreeRasterProgram(primary);
  assert.throws(
    () => registerThreeRasterProgram(secondary),
    /already selected raster variant "test" for technique "test-variant-selection"/,
  );
  const handle = glyph.handle('three:program-registration:selection', ThreeConfig);
  const font = await fontForTechnique(unsupported);
  assert.throws(
    () => handle.createText({ font, text: 'unsupported' }),
    /no installed codec for "test-portable-without-three"/,
  );
  font.dispose();
  handle.dispose();
});

test('a technique registered after an engine exists is refused, not silently dropped', async () => {
  const handle = glyph.handle('three:program-registration:late', ThreeConfig);

  const late = rasterProgram('test-late-technique');
  assert.throws(
    () => registerThreeRasterProgram(late),
    (error) =>
      error instanceof Error &&
      error.message.includes('test-late-technique') &&
      /registered after 1 glyph engine\(s\)/.test(error.message),
    'a technique no live engine can see must name itself at the registration',
  );

  // Once nothing holds a snapshot there is nothing a registration could miss, so it is legal again.
  // Without this, one disposed engine would poison the module-global registry for the process.
  handle.dispose();
  assert.doesNotThrow(() => registerThreeRasterProgram(late));
  // Re-registering the IDENTICAL program stays a no-op, so a module evaluated twice is not an error.
  assert.doesNotThrow(() => registerThreeRasterProgram(late));
  // A different program claiming the same technique is still the pre-existing collision.
  assert.throws(
    () => registerThreeRasterProgram(rasterProgram('test-late-technique')),
    TypeError,
    'two different programs must not claim one technique id',
  );
});

test('engine construction rejects a portable body compiled for different system lanes', async () => {
  const technique = defineRasterFormat({
    id: 'test-wrong-system-lanes',
    kind: 'test',
    extension: 'TEST_raster',
    version: 0,
    textEffects: [],
    descriptor: () => ({}),
    async decode() {
      return {};
    },
    dispose() {},
  });
  const schema = defineTechniqueSchema({
    technique: technique.id,
    scope: 'glyph',
    binding: {},
    buffers: {},
    resources: { payload: { kind: 'buffer' } },
    render: { resource: 'payload', geometry: { kind: 'synthetic-quad' } },
  });
  const portable = registerRasterCodec({
    raster: technique,
    schema,
    codecBody() {
      const authoring = techniqueProgram(schema, {
        system: {
          stableGlyphId: { id: STABLE_GLYPH_BUFFER_ID, scalar: 'u32', lanes: ['stableGlyphId'] },
          transformIndex: { id: TRANSFORM_BUFFER_ID, scalar: 'u32', lanes: ['transformIndex'] },
        },
      });
      return authoring.compile({});
    },
    compileFont() {},
  });
  registerThreeRasterProgram({
    raster: portable.raster,
    schema: portable.schema,
    variant: {
      id: 'test',
      language: 'test',
      buffers: {},
      resources: { payload: { kind: 'buffer' } },
      outputs: { position: 'vec3' },
      geometry: portable.schema.render.geometry,
      createMaterial() {
        throw new Error('unreachable: this program is never realized');
      },
    },
  });

  assert.throws(
    () => glyph.handle('three:program-registration:wrong-system', ThreeConfig),
    /codec body does not use the requested system buffers/,
  );
});

async function fontForTechnique(technique) {
  const registry = new FontRegistry();
  const registered = await registry.registerAsset(
    await readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
  );
  const variant = createImmutableFontVariant({
    backing: createImmutableFontBacking(registered),
    format: technique,
    raster: { dispose() {} },
    data: {},
  });
  return createImmutableFontLease(variant);
}
