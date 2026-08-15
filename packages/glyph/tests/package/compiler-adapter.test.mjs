import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { version as compilerVersion } from 'typescript';

import { supportedTypeScriptVersion } from '../../dist/compiler-adapter.js';

test('pins the compiler version guarded by the discovery adapter', () => {
  assert.equal(compilerVersion, '7.0.2');
  assert.equal(supportedTypeScriptVersion, compilerVersion);
});

test('keeps every unstable TypeScript import inside the compiler adapter', async () => {
  const sourceRoot = new URL('../../src/', import.meta.url);
  const sourceFiles = (await readdir(sourceRoot)).filter((name) => name.endsWith('.ts'));
  const violations = [];
  for (const name of sourceFiles) {
    if (name === 'compiler-adapter.ts') continue;
    const source = await readFile(new URL(name, sourceRoot), 'utf8');
    if (source.includes('typescript/unstable/')) violations.push(name);
  }
  assert.deepEqual(violations, []);
});
