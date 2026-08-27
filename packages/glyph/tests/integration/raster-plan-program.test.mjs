import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId, defineRasterTechnique } from '../../dist/index.js';
import {
  compileRasterFont,
  defineTechniqueSchema,
  registerRasterPlanProgram,
  resolveRasterPlanProgram,
  textShaperAbi,
} from '../../dist/core.js';
import { RenderWireIdentityRegistry } from '../../dist/core/render-policy.js';
import { indexedQuadGeometry } from '../support/portable-geometry.mjs';
import { immutableTestFont } from '../support/immutable-font.mjs';

const COLORS = defineRasterResourceId('test/colors');
const MESH = defineRasterResourceId('test/mesh');
const OTHER = defineRasterResourceId('test/other');
const body = () => ({ inputs: [], operations: [], f32InputCount: 0, u32InputCount: 0 });

function technique(id) {
  return defineRasterTechnique({
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
}

function schemaFor(value) {
  return defineTechniqueSchema({
    technique: value.id,
    scope: 'glyph',
    binding: { f32: ['opacity'], u32: ['page'] },
    buffers: {},
    resources: {
      colors: { kind: 'buffer' },
      mesh: {
        kind: 'geometry',
        attributes: [
          { semantic: 'position', componentType: 'f32', components: 3 },
          { semantic: 'uv', componentType: 'f32', components: 2 },
        ],
      },
    },
    render: { resource: 'colors', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
  });
}

function loaded(value, glyphCount = 2) {
  return immutableTestFont(value, {}, glyphCount);
}

function validCompile(compiler, colorBytes = new Uint8Array([1, 2, 3, 4])) {
  compiler.retain('colors', COLORS, { kind: 'buffer', bytes: colorBytes, stride: 4 });
  compiler.retain('mesh', MESH, indexedQuadGeometry());
  return compiler.compile({
    strikes: [0],
    resource: () => COLORS,
    f32: { opacity: () => 0.5 },
    u32: { page: () => 0 },
  });
}

test('registration preserves authenticated technique and schema witnesses', () => {
  const value = technique('test.plan-registration');
  const schema = schemaFor(value);
  const source = { technique: value, schema, policyBody: body, compileFont: validCompile };
  const registered = registerRasterPlanProgram(source);

  assert.equal(registered.technique, value);
  assert.equal(registered.schema, schema);
  assert.equal(resolveRasterPlanProgram(value.id), registered);
  assert.equal(registerRasterPlanProgram(source), registered);
  assert.equal(registerRasterPlanProgram(registered), registered);
  assert.throws(() => registerRasterPlanProgram({ ...source }), /different raster plan program/);
  assert.throws(
    () => registerRasterPlanProgram({ ...source, schema: { ...schema } }),
    /needs a schema from defineTechniqueSchema/,
  );
});

test('registration rejects structural techniques and reserved Glyph identities', () => {
  const structural = { id: 'test.structural', kind: 'test', extension: 'TEST_raster', version: 0 };
  assert.throws(
    () =>
      registerRasterPlanProgram({
        technique: structural,
        schema: defineTechniqueSchema({ technique: structural.id, scope: 'glyph', binding: {}, buffers: {} }),
        policyBody: body,
        compileFont() {},
      }),
    /need a technique/,
  );

  const reserved = technique('pmndrs.test-plan');
  assert.throws(
    () =>
      registerRasterPlanProgram({
        technique: reserved,
        schema: schemaFor(reserved),
        policyBody: body,
        compileFont: validCompile,
      }),
    /reserved for Glyph-owned techniques/,
  );
});

test('registration rejects a resource-free schema before it can become an unusable font compiler', () => {
  const value = technique('test.plan-resource-free');
  const schema = defineTechniqueSchema({
    technique: value.id,
    scope: 'glyph',
    binding: {},
    buffers: {},
  });
  assert.throws(
    () =>
      registerRasterPlanProgram({
        technique: value,
        schema,
        policyBody: body,
        compileFont() {},
      }),
    /needs at least one declared resource/,
  );
});

test('the same string ID cannot substitute a different technique data witness', () => {
  const first = technique('test.plan-witness');
  const second = technique('test.plan-witness');
  registerRasterPlanProgram({
    technique: first,
    schema: schemaFor(first),
    policyBody: body,
    compileFont: validCompile,
  });
  assert.throws(
    () => compileRasterFont(loaded(second), new RenderWireIdentityRegistry()),
    /does not match the registered program/,
  );
});

test('font compilation accepts only live package fonts and exposes a constrained reader', () => {
  const value = technique('test.plan-authentic-font');
  let reader;
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont(compiler) {
      reader = compiler.font;
      assert.deepEqual(Object.keys(reader).sort(), ['data', 'glyphCount', 'technique']);
      assert.equal(reader.technique, value);
      assert.equal(reader.glyphCount, 3);
      return validCompile(compiler);
    },
  });

  assert.throws(
    () => compileRasterFont({ technique: value, disposed: false }, new RenderWireIdentityRegistry()),
    /not created by this package/,
  );
  const font = loaded(value, 3);
  assert.ok(compileRasterFont(font, new RenderWireIdentityRegistry()));
  assert.throws(() => reader.data, /no longer active/);
  font.dispose();
  assert.throws(() => compileRasterFont(font, new RenderWireIdentityRegistry()), /disposed/);
});

test('font compilation owns binding metadata and normalizes retained payloads', () => {
  const value = technique('test.plan-compile');
  const sourceBytes = new Uint8Array([1, 2, 3, 4]);
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont: (compiler) => validCompile(compiler, sourceBytes),
  });
  const compiled = compileRasterFont(loaded(value), new RenderWireIdentityRegistry());
  sourceBytes[0] = 255;

  assert.ok(compiled.binding.byteLength > 0);
  assert.equal(compiled.resources.get(COLORS).bytes[0], 1);
  assert.equal(compiled.resources.get(MESH).kind, 'geometry');
  assert.deepEqual(
    [...compiled.declaredResources],
    [
      ['colors', [COLORS]],
      ['mesh', [MESH]],
    ],
  );
  assert.equal(typeof compiled.resources.set, 'undefined');
  assert.equal(typeof compiled.declaredResources.clear, 'undefined');
});

test('resource selection receives explicit glyph and strike coordinates', () => {
  const value = technique('test.plan-resource-coordinates');
  const calls = [];
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont(compiler) {
      compiler.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) });
      compiler.retain('mesh', MESH, indexedQuadGeometry());
      return compiler.compile({
        strikes: [12, 24],
        resource(glyphIndex, strikeIndex) {
          calls.push([glyphIndex, strikeIndex]);
          return COLORS;
        },
        f32: { opacity: () => 0.5 },
        u32: { page: () => 0 },
      });
    },
  });
  const identities = new RenderWireIdentityRegistry();
  const compiled = compileRasterFont(loaded(value, 3), identities);

  assert.deepEqual(calls, [
    [0, 0],
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]);
  const resourceIds = bindingResourceIds(compiled.binding);
  const selected = bindingResourceIndices(compiled.binding);
  assert.deepEqual(
    selected.map((index) => resourceIds[index]),
    Array.from({ length: 6 }, () => identities.resourceId(COLORS)),
  );
});

test('authored resource identities remain stable across independent compiler calls', () => {
  const value = technique('test.plan-stable-resource-identity');
  let invocation = 0;
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont(compiler) {
      invocation += 1;
      return validCompile(compiler, new Uint8Array([invocation, 2, 3, 4]));
    },
  });
  const identities = new RenderWireIdentityRegistry();
  const first = compileRasterFont(loaded(value), identities);
  const second = compileRasterFont(loaded(value), identities);

  assert.deepEqual(first.declaredResources.get('colors'), [COLORS]);
  assert.deepEqual(second.declaredResources.get('colors'), [COLORS]);
  assert.deepEqual(bindingResourceIds(first.binding), bindingResourceIds(second.binding));
  assert.ok(bindingResourceIds(first.binding).includes(identities.resourceId(COLORS)));
  assert.equal(first.resources.get(COLORS).bytes[0], 1);
  assert.equal(second.resources.get(COLORS).bytes[0], 2);
});

test('one loaded font reuses its immutable compilation across engine identity registries', () => {
  const value = technique('test.plan-compile-once');
  let calls = 0;
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont(compiler) {
      calls += 1;
      return validCompile(compiler);
    },
  });
  const font = loaded(value);
  const first = compileRasterFont(font, new RenderWireIdentityRegistry());
  const second = compileRasterFont(font, new RenderWireIdentityRegistry());

  assert.equal(first, second);
  assert.equal(calls, 1);
});

test('retention rejects undeclared, duplicate, missing, and wrong-kind resources', () => {
  const cases = [
    [
      'test.plan-undeclared',
      (compiler) => compiler.retain('foreign', OTHER, { kind: 'buffer', bytes: new Uint8Array(4) }),
      /undeclared resource name "foreign"/,
    ],
    [
      'test.plan-duplicate-name',
      (compiler) => {
        compiler.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) });
        compiler.retain('colors', OTHER, { kind: 'buffer', bytes: new Uint8Array(4) });
      },
      /more than once/,
    ],
    [
      'test.plan-duplicate-key',
      (compiler) => {
        compiler.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) });
        compiler.retain('mesh', COLORS, indexedQuadGeometry());
      },
      /duplicate resource/,
    ],
    [
      'test.plan-wrong-kind',
      (compiler) => compiler.retain('mesh', MESH, { kind: 'buffer', bytes: new Uint8Array(4) }),
      /wrong payload kind/,
    ],
    [
      'test.plan-wrong-vertex-input',
      (compiler) => {
        const geometry = indexedQuadGeometry();
        compiler.retain('mesh', MESH, {
          ...geometry,
          accessors: [{ ...geometry.accessors[0], components: 2 }, ...geometry.accessors.slice(1)],
        });
      },
      /vertex input "position" needs f32x3/,
    ],
    [
      'test.plan-missing-resource',
      (compiler) => {
        compiler.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) });
        return compiler.compile({
          strikes: [0],
          resource: () => COLORS,
          f32: { opacity: () => 1 },
          u32: { page: () => 0 },
        });
      },
      /did not retain declared resource "mesh"/,
    ],
  ];

  for (const [id, act, expected] of cases) {
    const value = technique(id);
    registerRasterPlanProgram({
      technique: value,
      schema: schemaFor(value),
      policyBody: body,
      compileFont(compiler) {
        const result = act(compiler);
        return result ?? validCompile(compiler);
      },
    });
    assert.throws(() => compileRasterFont(loaded(value), new RenderWireIdentityRegistry()), expected);
  }
});

test('binding readers and selected resources reject at compiler.compile', () => {
  const missingReader = technique('test.plan-missing-reader');
  registerRasterPlanProgram({
    technique: missingReader,
    schema: schemaFor(missingReader),
    policyBody: body,
    compileFont(compiler) {
      compiler.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) });
      compiler.retain('mesh', MESH, indexedQuadGeometry());
      return compiler.compile({ strikes: [0], resource: () => COLORS, f32: {}, u32: { page: () => 0 } });
    },
  });
  assert.throws(
    () => compileRasterFont(loaded(missingReader), new RenderWireIdentityRegistry()),
    /needs f32 reader "opacity"/,
  );

  const unknownResource = technique('test.plan-unknown-selected-resource');
  registerRasterPlanProgram({
    technique: unknownResource,
    schema: schemaFor(unknownResource),
    policyBody: body,
    compileFont(compiler) {
      compiler.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) });
      compiler.retain('mesh', MESH, indexedQuadGeometry());
      return compiler.compile({
        strikes: [0],
        resource: () => OTHER,
        f32: { opacity: () => 1 },
        u32: { page: () => 0 },
      });
    },
  });
  assert.throws(
    () => compileRasterFont(loaded(unknownResource), new RenderWireIdentityRegistry()),
    /outside render role "colors"/,
  );
});

test('binding compilation snapshots reader accessors before serialization', () => {
  const value = technique('test.plan-reader-snapshot');
  let resourceReads = 0;
  let opacityReads = 0;
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont(compiler) {
      compiler.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) });
      compiler.retain('mesh', MESH, indexedQuadGeometry());
      const binding = {
        strikes: [0],
        get resource() {
          resourceReads += 1;
          return resourceReads === 1 ? () => COLORS : undefined;
        },
        f32: {
          get opacity() {
            opacityReads += 1;
            return opacityReads === 1 ? () => 0.5 : undefined;
          },
        },
        u32: { page: () => 0 },
      };
      return compiler.compile(binding);
    },
  });

  assert.doesNotThrow(() => compileRasterFont(loaded(value), new RenderWireIdentityRegistry()));
  assert.equal(resourceReads, 1);
  assert.equal(opacityReads, 1);
});

test('a caught compiler input failure is terminal for that callback', () => {
  const value = technique('test.plan-latched-failure');
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont(compiler) {
      try {
        compiler.retain('foreign', OTHER, { kind: 'buffer', bytes: new Uint8Array(4) });
      } catch {}
      try {
        validCompile(compiler);
      } catch {}
      return {};
    },
  });
  assert.throws(
    () => compileRasterFont(loaded(value), new RenderWireIdentityRegistry()),
    /undeclared resource name "foreign"/,
  );
});

test('compileFont must synchronously return this compiler invocation result', () => {
  const asynchronous = technique('test.plan-async');
  registerRasterPlanProgram({
    technique: asynchronous,
    schema: schemaFor(asynchronous),
    policyBody: body,
    async compileFont(compiler) {
      return validCompile(compiler);
    },
  });
  assert.throws(
    () => compileRasterFont(loaded(asynchronous), new RenderWireIdentityRegistry()),
    /must return synchronously/,
  );

  const counterfeit = technique('test.plan-counterfeit');
  registerRasterPlanProgram({
    technique: counterfeit,
    schema: schemaFor(counterfeit),
    policyBody: body,
    compileFont(compiler) {
      validCompile(compiler);
      return { binding: new Uint8Array(), resources: new Map(), declaredResources: new Map() };
    },
  });
  assert.throws(
    () => compileRasterFont(loaded(counterfeit), new RenderWireIdentityRegistry()),
    /must return the result of compiler.compile/,
  );
});

test('the compiler is revoked after its callback returns', () => {
  const value = technique('test.plan-revoked');
  let escaped;
  registerRasterPlanProgram({
    technique: value,
    schema: schemaFor(value),
    policyBody: body,
    compileFont(compiler) {
      escaped = compiler;
      return validCompile(compiler);
    },
  });
  compileRasterFont(loaded(value), new RenderWireIdentityRegistry());
  assert.throws(() => escaped.font, /no longer active/);
  assert.throws(
    () => escaped.retain('colors', COLORS, { kind: 'buffer', bytes: new Uint8Array(4) }),
    /no longer active/,
  );
  assert.throws(
    () =>
      escaped.compile({
        strikes: [0],
        resource: () => COLORS,
        f32: { opacity: () => 1 },
        u32: { page: () => 0 },
      }),
    /no longer active/,
  );
});

function bindingResourceIds(bytes) {
  const request = textShaperAbi.layouts.fontBindingRequest;
  const resource = textShaperAbi.layouts.fontBindingResource;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const resourcesOffset = view.getUint32(request.resourcesOffset, true);
  return Array.from({ length: view.getUint32(request.resourceCount, true) }, (_, index) =>
    view.getUint32(resourcesOffset + index * resource.size + resource.id, true),
  );
}

function bindingResourceIndices(bytes) {
  const request = textShaperAbi.layouts.fontBindingRequest;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const glyphCount = view.getUint32(request.glyphCount, true);
  const strikeCount = view.getUint32(request.strikeCount, true);
  const offset = view.getUint32(request.resourceIndicesOffset, true);
  return Array.from({ length: glyphCount * strikeCount }, (_, index) => view.getUint32(offset + index * 4, true));
}
