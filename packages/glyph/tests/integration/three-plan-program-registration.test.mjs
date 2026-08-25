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
import { createTextRuntime, FontRegistry } from '@pmndrs/glyph';
import { registerThreeRasterPlanProgram } from '@pmndrs/glyph/three';
import {
  defineTechniqueSchema,
  registerRasterPlanProgram,
  techniqueProgram,
  textRuntimeShaper,
} from '@pmndrs/glyph/core';

import { shaperWasmUrl } from '../support/text-mutation-lanes.mjs';
// The coordinator is what takes the snapshot, so the lifecycle is asserted against it directly
// rather than through a mounted scene that would only reach it incidentally.
import { ThreeTextEngineCoordinator, threeTextEngineCoordinator } from '../../dist/three/engine-runtime.js';

const portablePrograms = new Map();
const planProgram = (id) => {
  let portable = portablePrograms.get(id);
  if (portable === undefined) {
    const technique = { id, kind: 'test', extension: 'TEST_raster', version: 0 };
    const schema = defineTechniqueSchema({ technique: id, scope: 'glyph', binding: {}, buffers: {} });
    portable = { technique, schema };
    registerRasterPlanProgram({
      technique,
      schema,
      policyBody(system) {
        const program = techniqueProgram(schema);
        program.store(system.stableGlyphId, [program.semantics.stableGlyphId]);
        if (system.transformIndex !== undefined) {
          program.store(system.transformIndex, [program.semantics.transformIndex]);
        }
        return program.compile();
      },
      compileFont() {},
    });
    portablePrograms.set(id, portable);
  }
  return {
    technique: portable.technique,
    variant: {
      id: 'test',
      language: 'test',
      buffers: {},
      resources: {},
      outputs: { position: 'vec3' },
      geometry: { kind: 'synthetic-quad' },
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
  unknownResource.variant.resources = { foreign: { kind: 'buffer' } };
  assert.throws(() => registerThreeRasterPlanProgram(unknownResource), /unknown resource "foreign"/);

  const wrongGeometry = planProgram('test-wrong-geometry');
  wrongGeometry.variant.geometry = { kind: 'quad', resource: 'foreign', coordinates: 'unit-square' };
  assert.throws(() => registerThreeRasterPlanProgram(wrongGeometry), /declares incompatible geometry/);

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
