import assert from 'node:assert/strict';
import test from 'node:test';

import { addF32, constantF32, multiplyF32, policyProgram } from '@pmndrs/text/core';

const OPTIONS = { scope: 'glyph', bindingF32: ['bearingX'] };
const BUFFER = { id: 1, scalar: 'f32', lanes: ['x', 'y'] };

/**
 * A value loaded from one program's input table means nothing inside another
 * program: the input index it carries would silently read a different field.
 * Only session-free constants may cross builders.
 */
test('storing another session’s value throws instead of misreading inputs', () => {
  const first = policyProgram(OPTIONS);
  const second = policyProgram(OPTIONS);
  assert.throws(() => second.store(BUFFER, [first.semantics.inlineOrigin, second.semantics.blockOrigin]), /session/);
});

test('derived values carry their session across combinators', () => {
  const first = policyProgram(OPTIONS);
  const second = policyProgram(OPTIONS);
  const derived = multiplyF32(first.binding.bearingX, constantF32(2));
  assert.throws(() => second.store(BUFFER, [derived, second.semantics.blockOrigin]), /session/);
});

test('combinators reject cross-session operands at construction', () => {
  const first = policyProgram(OPTIONS);
  const second = policyProgram(OPTIONS);
  assert.throws(() => multiplyF32(first.semantics.fontSize, second.semantics.fontSize), /session/);
});

test('deep shared expression DAGs stay cheap to store', () => {
  const program = policyProgram(OPTIONS);
  let node = addF32(program.semantics.inlineOrigin, program.binding.bearingX);
  for (let depth = 0; depth < 24; depth += 1) node = addF32(node, node);
  const start = performance.now();
  program.store(BUFFER, [node, program.semantics.blockOrigin]);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 50, `store took ${elapsed}ms over a shared DAG`);
});

test('constants are session-free and same-session programs still compile', () => {
  const program = policyProgram(OPTIONS);
  const scale = constantF32(0.5);
  program.store(BUFFER, [
    addF32(program.semantics.inlineOrigin, multiplyF32(program.binding.bearingX, scale)),
    multiplyF32(program.semantics.blockOrigin, scale),
  ]);
  const other = policyProgram(OPTIONS);
  other.store(BUFFER, [multiplyF32(other.semantics.inlineOrigin, scale), scale]);
  assert.equal(program.compile().operations.length > 0, true);
  assert.equal(other.compile().operations.length > 0, true);
});
