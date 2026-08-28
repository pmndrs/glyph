import assert from 'node:assert/strict';
import test from 'node:test';

import { f32, id, policyProgram } from '../../dist/core.js';

const OPTIONS = { scope: 'glyph', bindingF32: ['bearingX'] };
const BUFFER = { id: id('buffer', 'test.policy-provenance/position'), scalar: 'f32', lanes: ['x', 'y'] };

/**
 * A value loaded from one program's input table means nothing inside another
 * program: the input index it carries would silently read a different field.
 * Only scope-free constants may cross builders.
 */
test('storing another scope’s value throws instead of misreading inputs', () => {
  const first = policyProgram(OPTIONS);
  const second = policyProgram(OPTIONS);
  assert.throws(() => second.store(BUFFER, [first.semantics.inlineOrigin, second.semantics.blockOrigin]), /scope/);
});

test('derived values carry their scope across combinators', () => {
  const first = policyProgram(OPTIONS);
  const second = policyProgram(OPTIONS);
  const derived = f32.mul(first.binding.bearingX, f32.const(2));
  assert.throws(() => second.store(BUFFER, [derived, second.semantics.blockOrigin]), /scope/);
});

test('combinators reject cross-scope operands at construction', () => {
  const first = policyProgram(OPTIONS);
  const second = policyProgram(OPTIONS);
  assert.throws(() => f32.mul(first.semantics.fontSize, second.semantics.fontSize), /scope/);
});

test('deep shared expression DAGs stay cheap to store', () => {
  const program = policyProgram(OPTIONS);
  let node = f32.add(program.semantics.inlineOrigin, program.binding.bearingX);
  for (let depth = 0; depth < 24; depth += 1) node = f32.add(node, node);
  const start = performance.now();
  program.store(BUFFER, [node, program.semantics.blockOrigin]);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 50, `store took ${elapsed}ms over a shared DAG`);
});

test('constants are scope-free and same-scope programs still compile', () => {
  const program = policyProgram(OPTIONS);
  const scale = f32.const(0.5);
  program.store(BUFFER, [
    f32.add(program.semantics.inlineOrigin, f32.mul(program.binding.bearingX, scale)),
    f32.mul(program.semantics.blockOrigin, scale),
  ]);
  const other = policyProgram(OPTIONS);
  other.store(BUFFER, [f32.mul(other.semantics.inlineOrigin, scale), scale]);
  assert.equal(program.compile().operations.length > 0, true);
  assert.equal(other.compile().operations.length > 0, true);
});
