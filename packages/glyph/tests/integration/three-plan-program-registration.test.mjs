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
import { defineTechniqueSchema, registerRasterPlanProgram } from '@pmndrs/glyph/core';

import { shaperWasmUrl } from '../support/text-mutation-lanes.mjs';
// The coordinator is what takes the snapshot, so the lifecycle is asserted against it directly
// rather than through a mounted scene that would only reach it incidentally.
import { threeTextEngineCoordinator } from '../../dist/three/engine-runtime.js';

const portableIds = new Set();
const planProgram = (id) => {
  const technique = { id, kind: 'test', extension: 'TEST_raster', version: 0 };
  if (!portableIds.has(id)) {
    registerRasterPlanProgram({
      technique,
      schema: defineTechniqueSchema({ technique: id, scope: 'glyph', binding: {}, buffers: {} }),
      policyBody: () => ({ inputs: [], operations: [], f32InputCount: 0, u32InputCount: 0 }),
      compileFont() {},
    });
    portableIds.add(id);
  }
  return {
    technique,
    policy: { programs: [] },
    compileFont() {
      throw new Error('unreachable: this program is never bound to a font');
    },
    createMaterial() {
      throw new Error('unreachable: this program is never realized');
    },
  };
};

test('a technique registered after a runtime exists is refused, not silently dropped', async () => {
  const runtime = await createTextRuntime({ registry: new FontRegistry(), wasm: await readFile(shaperWasmUrl) });
  const coordinator = threeTextEngineCoordinator(runtime);

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
  coordinator.dispose();
  assert.doesNotThrow(() => registerThreeRasterPlanProgram(late));
  // Re-registering the IDENTICAL program stays a no-op, so a module evaluated twice is not an error.
  assert.doesNotThrow(() => registerThreeRasterPlanProgram(late));
  // A different program claiming the same technique is still the pre-existing collision.
  assert.throws(
    () => registerThreeRasterPlanProgram(planProgram('test-late-technique')),
    TypeError,
    'two different programs must not claim one technique id',
  );

  runtime.dispose();
});
