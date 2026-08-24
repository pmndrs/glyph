import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRasterFont, registerRasterPlanProgram, resolveRasterPlanProgram } from '../../dist/core.js';
import { RenderWireIdentityRegistry } from '../../dist/core/render-policy.js';

const schema = {};
const body = () => ({ inputs: [], operations: [], f32InputCount: 0, u32InputCount: 0 });

test('registers and resolves one portable raster plan by technique id', () => {
  const technique = { id: 'test.core-raster-plan-resolution' };
  const program = { technique, schema, policyBody: body, compileFont() {} };

  registerRasterPlanProgram(program);
  assert.equal(resolveRasterPlanProgram(technique.id), program);
  assert.doesNotThrow(() => registerRasterPlanProgram(program));
  assert.throws(
    () => registerRasterPlanProgram({ ...program, policyBody: body }),
    (error) => error instanceof TypeError && error.message.includes(technique.id),
  );
});

test('rejects a portable compiler that retains a duplicate resource or omits its binding', () => {
  const duplicateId = 'test.core-raster-plan-duplicate-resource';
  const duplicateProgram = {
    technique: { id: duplicateId },
    schema,
    policyBody: body,
    compileFont(compiler) {
      compiler.retain('test/resource', 1);
      compiler.retain('test/resource', 2);
    },
  };
  registerRasterPlanProgram(duplicateProgram);
  assert.throws(
    () => compileRasterFont({ technique: duplicateProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof TypeError && error.message.includes('duplicate resource'),
  );

  const missingId = 'test.core-raster-plan-missing-binding';
  const missingProgram = { technique: { id: missingId }, schema, policyBody: body, compileFont() {} };
  registerRasterPlanProgram(missingProgram);
  assert.throws(
    () => compileRasterFont({ technique: missingProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof Error && error.message.includes('no binding'),
  );
});
