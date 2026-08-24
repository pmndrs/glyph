import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileRasterFont,
  defineTechniqueSchema,
  registerRasterPlanProgram,
  resolveRasterPlanProgram,
} from '../../dist/core.js';
import { RenderWireIdentityRegistry } from '../../dist/core/render-policy.js';
import { indexedQuadGeometry, instancedQuadGeometry } from '../support/portable-geometry.mjs';

const body = () => ({ inputs: [], operations: [], f32InputCount: 0, u32InputCount: 0 });
const ATLAS_KEY = 'test/resource/atlas';
const MESH_KEY = 'test/resource/mesh';
const TINT_KEY = 'test/resource/tint';

function atlasPayload() {
  return { kind: 'texture', format: 'r8unorm', width: 4, height: 4, bytes: new Uint8Array(16) };
}

function declaredSchema(technique, overrides = {}) {
  const defaults = {
    resources: {
      atlas: { kind: 'texture' },
      mesh: { kind: 'geometry' },
      tint: { kind: 'example-tint' },
    },
  };
  return defineTechniqueSchema({
    technique,
    scope: 'resource',
    binding: {},
    buffers: {},
    ...overrides,
    resources: overrides.resources ?? defaults.resources,
  });
}

/** A minimal portable program that compiles one binding and retains the declared resources. */
function retentionProgram(id, schema, retain, onCompile) {
  return {
    technique: { id },
    schema,
    policyBody: body,
    compileFont(compiler) {
      const keys = retain(compiler);
      const { resources } = compiler.resources(keys);
      const compiled = compiler.compile({
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
      onCompile?.(compiled, compiler);
    },
  };
}

test('registers and resolves one portable raster plan by technique id', () => {
  const technique = { id: 'test.core-raster-plan-resolution' };
  const program = { technique, schema: declaredSchema(technique.id), policyBody: body, compileFont() {} };

  registerRasterPlanProgram(program);
  const resolved = resolveRasterPlanProgram(technique.id);
  assert.notEqual(resolved, program);
  assert.equal(resolved.technique.id, technique.id);
  assert.equal(resolved.compileFont, program.compileFont);
  assert.doesNotThrow(() => registerRasterPlanProgram(program));
  assert.throws(
    () => registerRasterPlanProgram({ ...program, policyBody: body }),
    (error) => error instanceof TypeError && error.message.includes(technique.id),
  );
  assert.throws(
    () => registerRasterPlanProgram({ ...program, schema: { ...program.schema } }),
    (error) => error instanceof TypeError && error.message.includes('defineTechniqueSchema'),
  );
  assert.throws(
    () => registerRasterPlanProgram({ ...program, schema: declaredSchema('test.core-raster-plan-other-id') }),
    (error) => error instanceof TypeError && error.message.includes('schema names technique'),
  );
  assert.throws(
    () => registerRasterPlanProgram({ ...program, policyBody: undefined }),
    (error) => error instanceof TypeError && error.message.includes('needs policyBody and compileFont callbacks'),
  );
});

test('registration snapshots callbacks before the source object can change', () => {
  const id = 'test.core-raster-plan-registration-snapshot';
  let compileCalls = 0;
  const program = retentionProgram(
    id,
    declaredSchema(id),
    () => [],
    () => {
      compileCalls += 1;
    },
  );
  registerRasterPlanProgram(program);
  program.compileFont = () => {
    throw new Error('mutated callback must not be used');
  };
  compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  assert.equal(compileCalls, 1);
});

test('rejects a portable compiler that retains a duplicate resource or omits its binding', () => {
  const duplicateId = 'test.core-raster-plan-duplicate-resource';
  const duplicateProgram = retentionProgram(duplicateId, declaredSchema(duplicateId), (compiler) => {
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
  const missingProgram = {
    technique: { id: missingId },
    schema: declaredSchema(missingId),
    policyBody: body,
    compileFont() {},
  };
  registerRasterPlanProgram(missingProgram);
  assert.throws(
    () => compileRasterFont({ technique: missingProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof Error && error.message.includes('no binding'),
  );
});

test('rejects a portable compiler that repeats a declared name or retains an undeclared name', () => {
  const repeatId = 'test.core-raster-plan-duplicate-name';
  const repeatProgram = retentionProgram(repeatId, declaredSchema(repeatId), (compiler) => {
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
  const undeclaredProgram = retentionProgram(undeclaredId, declaredSchema(undeclaredId), (compiler) => {
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

  const prototypeId = 'test.core-raster-plan-prototype-name';
  const prototypeProgram = retentionProgram(prototypeId, declaredSchema(prototypeId), (compiler) => {
    compiler.retain('constructor', ATLAS_KEY, atlasPayload());
    return [];
  });
  registerRasterPlanProgram(prototypeProgram);
  assert.throws(
    () => compileRasterFont({ technique: prototypeProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof TypeError && error.message.includes('undeclared resource name "constructor"'),
  );

  const unnamedId = 'test.core-raster-plan-unnamed-resource';
  const unnamedProgram = retentionProgram(unnamedId, declaredSchema(unnamedId), (compiler) => {
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
  const program = retentionProgram(id, declaredSchema(id), (compiler) => {
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

test('normalizes a payload from one owned snapshot before validating it', () => {
  const id = 'test.core-raster-plan-normalizer-snapshot';
  const source = indexedQuadGeometry();
  const honestAccessors = source.accessors;
  let reads = 0;
  Object.defineProperty(source, 'accessors', {
    get() {
      reads += 1;
      return reads === 1 ? honestAccessors : [{ ...honestAccessors[0], count: 1 }];
    },
  });
  const program = retentionProgram(id, declaredSchema(id), (compiler) => {
    compiler.retain('mesh', MESH_KEY, source);
    return [MESH_KEY];
  });
  registerRasterPlanProgram(program);
  const compiled = compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  assert.equal(reads, 1);
  assert.equal(compiled.resources.get(MESH_KEY).accessors[0].count, 4);
});

test('compiled binding bytes stay owned after the compiler callback returns', () => {
  const id = 'test.core-raster-plan-binding-ownership';
  let escaped;
  const program = retentionProgram(
    id,
    declaredSchema(id),
    () => [],
    (value) => {
      escaped = value;
    },
  );
  registerRasterPlanProgram(program);
  const compiled = compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  escaped[0] = 255;
  assert.notEqual(compiled.binding[0], 255);
});

test('the compiler facade is revoked after compilation and result maps are read-only views', () => {
  const id = 'test.core-raster-plan-compiler-lifetime';
  let escaped;
  const program = retentionProgram(id, declaredSchema(id), (compiler) => {
    escaped = compiler;
    compiler.retain('atlas', ATLAS_KEY, atlasPayload());
    return [ATLAS_KEY];
  });
  registerRasterPlanProgram(program);
  const compiled = compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  assert.throws(() => escaped.emptyTable(1), /no longer active/);
  assert.throws(() => escaped.retain('tint', TINT_KEY, {}), /no longer active/);
  assert.equal(typeof compiled.resources.set, 'undefined');
  assert.equal(typeof compiled.declaredResources.set, 'undefined');
});

test('retention rejects malformed instance discriminants at the call site', () => {
  const id = 'test.core-raster-plan-invalid-instance-source';
  const payload = instancedQuadGeometry();
  payload.instances = { source: 'records-plus' };
  const program = retentionProgram(id, declaredSchema(id), (compiler) => {
    compiler.retain('mesh', MESH_KEY, payload);
    return [MESH_KEY];
  });
  registerRasterPlanProgram(program);
  assert.throws(
    () => compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof TypeError && error.message.includes('records or fixed source'),
  );
});

test('retained payloads must match their declared reserved kind before any device is touched', () => {
  for (const [name, payload] of [
    ['atlas', indexedQuadGeometry()],
    ['mesh', atlasPayload()],
  ]) {
    const id = `test.core-raster-plan-kind-mismatch-${name}`;
    const program = retentionProgram(id, declaredSchema(id), (compiler) => {
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

test('retention rejects byte coercion before any reserved payload is copied', () => {
  const cases = [
    {
      id: 'test.core-raster-plan-byte-type-buffer',
      name: 'table',
      schema: (id) => declaredSchema(id, { resources: { table: { kind: 'buffer' } } }),
      payload: { kind: 'buffer', bytes: [1, 2, 3] },
    },
    {
      id: 'test.core-raster-plan-byte-type-texture',
      name: 'atlas',
      schema: (id) => declaredSchema(id),
      payload: { ...atlasPayload(), bytes: new ArrayBuffer(16) },
    },
    {
      id: 'test.core-raster-plan-byte-type-geometry',
      name: 'mesh',
      schema: (id) => declaredSchema(id),
      payload: { ...indexedQuadGeometry(), bytes: new Float32Array(19) },
    },
  ];
  for (const entry of cases) {
    const program = retentionProgram(entry.id, entry.schema(entry.id), (compiler) => {
      compiler.retain(entry.name, `${entry.id}/resource`, entry.payload);
      return [];
    });
    registerRasterPlanProgram(program);
    assert.throws(
      () => compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry()),
      (error) => error instanceof TypeError && error.message.includes('Uint8Array bytes'),
    );
  }
});

test('retained resource keys are validated at the retention call', () => {
  const id = 'test.core-raster-plan-invalid-key';
  const program = retentionProgram(id, declaredSchema(id), (compiler) => {
    compiler.retain('atlas', {}, atlasPayload());
    return [];
  });
  registerRasterPlanProgram(program);
  assert.throws(
    () => compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof TypeError && error.message.includes('without a nonempty key'),
  );
});

test('retained texture formats and required geometry resources follow the schema contract', () => {
  const formatId = 'test.core-raster-plan-format-contract';
  const formatProgram = retentionProgram(
    formatId,
    declaredSchema(formatId, { resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } } }),
    (compiler) => {
      compiler.retain('atlas', ATLAS_KEY, atlasPayload());
      return [ATLAS_KEY];
    },
  );
  registerRasterPlanProgram(formatProgram);
  assert.throws(
    () => compileRasterFont({ technique: formatProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof TypeError && error.message.includes('does not match declared format'),
  );

  const geometryId = 'test.core-raster-plan-required-geometry';
  const geometryProgram = retentionProgram(
    geometryId,
    declaredSchema(geometryId, {
      render: { geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
    }),
    (compiler) => {
      compiler.retain('atlas', ATLAS_KEY, atlasPayload());
      return [ATLAS_KEY];
    },
  );
  registerRasterPlanProgram(geometryProgram);
  assert.throws(
    () => compileRasterFont({ technique: geometryProgram.technique }, new RenderWireIdentityRegistry()),
    (error) => error instanceof Error && error.message.includes('did not retain declared geometry resource "mesh"'),
  );
});

test('resource identity stays stable across independent compiler calls', () => {
  const id = 'test.core-raster-plan-stable-identity';
  const program = retentionProgram(id, declaredSchema(id), (compiler) => {
    compiler.retain('atlas', ATLAS_KEY, atlasPayload());
    compiler.retain('mesh', MESH_KEY, indexedQuadGeometry());
    compiler.retain('tint', TINT_KEY, {});
    return [ATLAS_KEY, MESH_KEY, TINT_KEY];
  });
  registerRasterPlanProgram(program);
  const first = compileRasterFont({ technique: program.technique }, new RenderWireIdentityRegistry());
  const secondIdentities = new RenderWireIdentityRegistry();
  secondIdentities.resolve('test/other-technique');
  const second = compileRasterFont({ technique: program.technique }, secondIdentities);
  assert.deepEqual(second.binding, first.binding);
  assert.deepEqual([...second.declaredResources], [...first.declaredResources]);
});
