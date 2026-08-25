/**
 * When a Three raster plan program may still be registered.
 *
 * The registry is one module-global `Map`, and a `TextRuntime`'s Three coordinator reads it exactly
 * once, at construction. Nothing re-reads it. A registration after that point was a perfectly legal
 * call that applied to nothing: the technique was in the map, invisible to every runtime already
 * built, and the loss surfaced far away and much later as a missing technique when a font using it
 * was bound. A doc comment saying "register early" is not enforcement.
 *
 * The rule this pins: a technique no live runtime could ever see is refused AT the registration,
 * naming itself, and becomes registrable again once no runtime holds a snapshot.
 *
 * This file owns its own runtime and coordinator because the assertions are about the module-global
 * registry's lifecycle, and it leaves a program in that registry -- which is safe only because the
 * test runner gives each file its own process.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import '../support/browser-globals.mjs';
import { createTextRuntime, defineRasterTechnique, FontRegistry } from '@pmndrs/glyph';
import { registerThreeRasterPlanProgram } from '@pmndrs/glyph/three';
import {
  defineTechniqueGeometryKind,
  defineTechniqueSchema,
  f32,
  registerRasterPlanProgram,
  techniqueProgram,
  textRuntimeShaper,
  u32,
} from '@pmndrs/glyph/core';

import { shaperWasmUrl } from '../support/text-mutation-lanes.mjs';
// The coordinator is what takes the snapshot, so the lifecycle is asserted against it directly
// rather than through a mounted scene that would only reach it incidentally.
import { ThreeTextEngineCoordinator, threeTextEngineCoordinator } from '../../dist/three/engine-runtime.js';

const portablePrograms = new Map();
const planProgram = (id, declaration = {}) => {
  let portable = portablePrograms.get(id);
  if (portable === undefined) {
    const technique = defineRasterTechnique({
      id,
      kind: 'test',
      extension: 'TEST_raster',
      version: 0,
      descriptor: () => ({}),
      async decode() {
        return {};
      },
      dispose() {},
    });
    const schema = defineTechniqueSchema({
      technique: id,
      scope: 'glyph',
      binding: {},
      buffers: {},
      resources: { payload: { kind: 'buffer' } },
      ...declaration,
    });
    portable = { technique, schema };
    registerRasterPlanProgram({
      technique,
      schema,
      policyBody(system) {
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
    portablePrograms.set(id, portable);
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
    technique: portable.technique,
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

test('variant registration rejects incompatible capabilities before a runtime exists', () => {
  const missingOutputs = planProgram('test-missing-outputs');
  delete missingOutputs.variant.outputs;
  assert.throws(() => registerThreeRasterPlanProgram(missingOutputs), /needs named shader outputs/);

  const unknownBuffer = planProgram('test-unknown-buffer');
  unknownBuffer.variant.buffers = { foreign: { scalar: 'f32', vectorWidth: 1 } };
  assert.throws(() => registerThreeRasterPlanProgram(unknownBuffer), /unknown buffer "foreign"/);

  const unknownResource = planProgram('test-unknown-resource');
  unknownResource.variant.resources = {
    ...unknownResource.variant.resources,
    foreign: { kind: 'buffer' },
  };
  assert.throws(() => registerThreeRasterPlanProgram(unknownResource), /unknown resource "foreign"/);

  const wrongGeometry = planProgram('test-wrong-geometry');
  wrongGeometry.variant.geometry = { kind: 'quad', resource: 'foreign', coordinates: 'unit-square' };
  assert.throws(() => registerThreeRasterPlanProgram(wrongGeometry), /declares incompatible geometry/);

  const extraGeometryField = planProgram('test-extra-geometry-field');
  extraGeometryField.variant.geometry = { kind: 'synthetic-quad', name: 'not-part-of-this-shape' };
  assert.throws(() => registerThreeRasterPlanProgram(extraGeometryField), /declares incompatible geometry/);

  const customGeometryName = defineTechniqueGeometryKind('test-custom-shape');
  const wrongCustomGeometryName = planProgram('test-wrong-custom-geometry-name', {
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
  assert.throws(() => registerThreeRasterPlanProgram(wrongCustomGeometryName), /declares incompatible geometry/);

  const wrongScalar = planProgram('test-wrong-scalar', {
    buffers: { rect: { id: 1, scalar: 'f32', lanes: ['x', 'y'] } },
  });
  wrongScalar.variant.buffers.rect.scalar = 'u32';
  assert.throws(() => registerThreeRasterPlanProgram(wrongScalar), /buffer "rect" must consume f32x2/);

  const missingBuffer = planProgram('test-missing-buffer', {
    buffers: { rect: { id: 1, scalar: 'f32', lanes: ['x', 'y'] } },
  });
  delete missingBuffer.variant.buffers.rect;
  assert.throws(() => registerThreeRasterPlanProgram(missingBuffer), /omits buffer "rect"/);

  const wrongFormat = planProgram('test-wrong-format', {
    resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } },
  });
  wrongFormat.variant.resources.atlas.format = 'r8unorm';
  assert.throws(() => registerThreeRasterPlanProgram(wrongFormat), /resource "atlas" must consume texture:rgba8unorm/);

  const missingResource = planProgram('test-missing-resource', {
    resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } },
  });
  delete missingResource.variant.resources.atlas;
  assert.throws(() => registerThreeRasterPlanProgram(missingResource), /omits resource "atlas"/);

  const witnessed = planProgram('test-wrong-schema-witness');
  witnessed.schema = defineTechniqueSchema({
    technique: witnessed.technique.id,
    scope: 'glyph',
    binding: {},
    buffers: {},
  });
  assert.throws(() => registerThreeRasterPlanProgram(witnessed), /needs its registered portable schema/);

  assert.throws(
    () =>
      registerThreeRasterPlanProgram({
        ...planProgram('test-portable-registration-anchor'),
        technique: { id: 'test-no-portable', kind: 'test', extension: 'TEST_raster', version: 0 },
      }),
    /no portable raster plan program is registered/,
  );
});

test('registration selects one renderer variant per technique before runtime construction', async () => {
  const primary = planProgram('test-variant-selection');
  const unsupported = planProgram('test-portable-without-three').technique;
  const secondary = {
    technique: primary.technique,
    schema: primary.schema,
    variant: { ...primary.variant, id: 'second' },
  };
  registerThreeRasterPlanProgram(primary);
  assert.throws(
    () => registerThreeRasterPlanProgram(secondary),
    /already selected raster variant "test" for technique "test-variant-selection"/,
  );
  const runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  const coordinator = new ThreeTextEngineCoordinator(textRuntimeShaper(runtime));
  assert.throws(
    () => coordinator.acquireFontStack([{ disposed: false, technique: unsupported, font: {} }]),
    /no registered renderer variant for portable technique "test-portable-without-three"/,
  );
  coordinator.dispose();
  runtime.dispose();
});

test('a technique registered after a runtime exists is refused, not silently dropped', async () => {
  const runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  threeTextEngineCoordinator(runtime);

  const late = planProgram('test-late-technique');
  assert.throws(
    () => registerThreeRasterPlanProgram(late),
    (error) =>
      error instanceof Error &&
      error.message.includes('test-late-technique') &&
      /registered after 1 text runtime\(s\)/.test(error.message),
    'a technique no live runtime can see must name itself at the registration',
  );

  // Once nothing holds a snapshot there is nothing a registration could miss, so it is legal again.
  // Without this, one disposed runtime would poison the module-global registry for the process.
  runtime.dispose();
  assert.doesNotThrow(() => registerThreeRasterPlanProgram(late));
  // Re-registering the IDENTICAL program stays a no-op, so a module evaluated twice is not an error.
  assert.doesNotThrow(() => registerThreeRasterPlanProgram(late));
  // A different program claiming the same technique is still the pre-existing collision.
  assert.throws(
    () => registerThreeRasterPlanProgram(planProgram('test-late-technique')),
    TypeError,
    'two different programs must not claim one technique id',
  );
});

test('runtime construction rejects a portable body compiled for different system lanes', async () => {
  const technique = defineRasterTechnique({
    id: 'test-wrong-system-lanes',
    kind: 'test',
    extension: 'TEST_raster',
    version: 0,
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
  });
  const portable = registerRasterPlanProgram({
    technique,
    schema,
    policyBody() {
      const authoring = techniqueProgram(schema, {
        system: {
          stableGlyphId: { id: 14, scalar: 'u32', lanes: ['stableGlyphId'] },
          transformIndex: { id: 13, scalar: 'u32', lanes: ['transformIndex'] },
        },
      });
      return authoring.compile({});
    },
    compileFont() {},
  });
  registerThreeRasterPlanProgram({
    technique: portable.technique,
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

  const runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  assert.throws(
    () => new ThreeTextEngineCoordinator(textRuntimeShaper(runtime)),
    /policy body does not use the requested system buffers/,
  );
  runtime.dispose();
});
