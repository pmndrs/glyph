import assert from 'node:assert/strict';
import test from 'node:test';

import { compileRasterFont, registerRasterPlanProgram, resolveRasterPlanProgram } from '../../dist/core.js';
import { RenderWireIdentityRegistry } from '../../dist/core/render-policy.js';
import { indexedQuadGeometry, instancedQuadGeometry } from '../support/portable-geometry.mjs';

const body = () => ({ inputs: [], operations: [], f32InputCount: 0, u32InputCount: 0 });
const ATLAS_KEY = 'test/resource/atlas';
const MESH_KEY = 'test/resource/mesh';
const TINT_KEY = 'test/resource/tint';

function atlasPayload() {
  return { kind: 'texture', format: 'r8unorm', width: 4, height: 4, bytes: new Uint8Array(16) };
}

function declaredSchema() {
  return {
    resources: {
      atlas: { kind: 'texture' },
      mesh: { kind: 'geometry' },
      tint: { kind: 'example-tint' },
    },
  };
}

/** A minimal portable program that compiles one binding and retains the declared resources. */
function retentionProgram(id, schema, retain) {
  return {
    technique: { id },
    schema,
    policyBody: body,
    compileFont(compiler) {
      const keys = retain(compiler);
      const { resources } = compiler.resources(keys);
      compiler.compile({
        techniqueId: compiler.techniqueId,
        programVariant: 0,
        glyphCount: 1,
        strikes: [0],
        resources,
        resourceIndex: () => 0,
        glyphF32: compiler.emptyTable(1),
        glyphU32: compiler.emptyTable(1),
        strikeF32: compiler.emptyTable(1),
        strikeU32: compiler.emptyTable(1),
        resourceF32: compiler.emptyTable(resources.length),
        resourceU32: compiler.emptyTable(resources.length),
      });
    },
  };
}

test('registers and resolves one portable raster plan by technique id', () => {
  const technique = { id: 'test.core-raster-plan-resolution' };
  const program = { technique, schema: {}, policyBody: body, compileFont() {} };

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
  const duplicateProgram = retentionProgram(duplicateId, declaredSchema(), (compiler) => {
    compiler.retain('atlas', ATLAS_KEY, atlasPayload());
    compiler.retain('mesh', ATLAS_KEY, indexedQuadGeometry());
    return [ATLAS_KEY];
  });
  registerRasterPlanProgram(duplicateProgram);
  assert.throws(
    () => compileRasterFont({ technique: duplicateProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof TypeError && error.message.includes('duplicate resource'),
  );

  const missingId = 'test.core-raster-plan-missing-binding';
  const missingProgram = { technique: { id: missingId }, schema: {}, policyBody: body, compileFont() {} };
  registerRasterPlanProgram(missingProgram);
  assert.throws(
    () => compileRasterFont({ technique: missingProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof Error && error.message.includes('no binding'),
  );
});

test('rejects a portable compiler that repeats a declared name or retains an undeclared name', () => {
  const repeatId = 'test.core-raster-plan-duplicate-name';
  const repeatProgram = retentionProgram(repeatId, declaredSchema(), (compiler) => {
    compiler.retain('atlas', ATLAS_KEY, atlasPayload());
    compiler.retain('atlas', MESH_KEY, indexedQuadGeometry());
    return [ATLAS_KEY];
  });
  registerRasterPlanProgram(repeatProgram);
  assert.throws(
    () => compileRasterFont({ technique: repeatProgram.technique }, new RenderWireIdentityRegistry()),
    (error) =>
      error instanceof TypeError && error.message.includes(`retained declared resource "atlas" more than once`),
  );

  const undeclaredId = 'test.core-raster-plan-undeclared-name';
  const undeclaredProgram = retentionProgram(undeclaredId, declaredSchema(), (compiler) => {
    compiler.retain('ghost', ATLAS_KEY, atlasPayload());
    return [];
  });
  registerRasterPlanProgram(undeclaredProgram);
  assert.throws(
    () => compileRasterFont({ technique: undeclaredProgram.technique }, new RenderWireIdentityRegistry()),
    (error) =>
      error instanceof TypeError &&
      error.message.includes('undeclared resource name "ghost"') &&
      error.message.includes(ATLAS_KEY),
  );

  const unnamedId = 'test.core-raster-plan-unnamed-resource';
  const unnamedProgram = retentionProgram(unnamedId, {}, (compiler) => {
    compiler.retain('', ATLAS_KEY, atlasPayload());
    return [];
  });
  registerRasterPlanProgram(unnamedProgram);
  assert.throws(
    () => compileRasterFont({ technique: unnamedProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof TypeError && error.message.includes('without a declared name'),
  );
});

test('links every retained payload to its declared schema name and validates it against the reserved kinds', () => {
  const id = 'test.core-raster-plan-declared-resources';
  let tintPayload;
  const program = retentionProgram(id, declaredSchema(), (compiler) => {
    tintPayload = { rows: 4 };
    compiler.retain('atlas', ATLAS_KEY, atlasPayload());
    compiler.retain('mesh', MESH_KEY, instancedQuadGeometry());
    compiler.retain('tint', TINT_KEY, tintPayload);
    return [ATLAS_KEY, MESH_KEY, TINT_KEY];
  });
  registerRasterPlanProgram(program);
  const compiled = compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  assert.deepEqual(
    [...compiled.declaredResources],
    [
      ['atlas', ATLAS_KEY],
      ['mesh', MESH_KEY],
      ['tint', TINT_KEY],
    ],
  );
  assert.deepEqual(compiled.resources.get(ATLAS_KEY), atlasPayload());
  assert.equal(compiled.resources.get(MESH_KEY).topology, 'triangle-list');
  // Technique-private kinds keep their opaque payloads.
  assert.equal(compiled.resources.get(TINT_KEY), tintPayload);
});

test('retained payloads must match their declared reserved kind before any device is touched', () => {
  for (const [name, payload] of [
    ['atlas', indexedQuadGeometry()],
    ['mesh', atlasPayload()],
  ]) {
    const id = `test.core-raster-plan-kind-mismatch-${name}`;
    const program = retentionProgram(id, declaredSchema(), (compiler) => {
      compiler.retain(name, ATLAS_KEY, payload);
      return [];
    });
    registerRasterPlanProgram(program);
    assert.throws(
      () => compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry()),
      (error) => error instanceof TypeError && error.message.includes(`"${name}"`),
    );
  }
});

test('resource identity stays stable across independent compiler calls', () => {
  const id = 'test.core-raster-plan-stable-identity';
  const program = retentionProgram(id, declaredSchema(), (compiler) => {
    compiler.retain('atlas', ATLAS_KEY, atlasPayload());
    compiler.retain('mesh', MESH_KEY, indexedQuadGeometry());
    compiler.retain('tint', TINT_KEY, {});
    return [ATLAS_KEY, MESH_KEY, TINT_KEY];
  });
  registerRasterPlanProgram(program);
  const first = compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  const second = compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  assert.deepEqual(second.binding, first.binding);
  assert.deepEqual([...second.declaredResources], [...first.declaredResources]);
});
