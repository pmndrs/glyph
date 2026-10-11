import assert from 'node:assert/strict';
import test from 'node:test';
import { captureCommand } from '../../scripts/support/capture-command.mjs';
import { resolve } from 'node:path';
import { diagnosticRustcArguments } from '../../scripts/support/named-shaper-rustc.mjs';
import { assertDiagnosticOutputOutsideDist } from '../../scripts/support/shaper-build.mjs';
import {
  attachOptimizerFunctionNames,
  authenticateNamedShaper,
  deriveNamedShaper,
  wasmSections,
} from '../../scripts/support/named-shaper.mjs';

// Independently encoded valid module: one () -> () function, empty body.
const release = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 4, 1, 2, 0, 11]);
const name = Buffer.from([0, 16, 4, 110, 97, 109, 101, 1, 9, 1, 0, 6, 115, 104, 97, 112, 101, 114]);
const named = Buffer.concat([release, name]);

test('optimizer final indexes restore source identities and label generated functions honestly', () => {
  const two = Buffer.from([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 3, 2, 0, 0, 10, 7, 2, 2, 0, 11, 2, 0, 11,
  ]);
  const names = Buffer.from([
    0, 22, 4, 110, 97, 109, 101, 1, 15, 2, 0, 5, 97, 108, 112, 104, 97, 1, 5, 98, 114, 97, 118, 111,
  ]);
  const result = attachOptimizerFunctionNames(Buffer.concat([two, names]), two, '0:1\n1:0\n');
  assert.throws(() => attachOptimizerFunctionNames(Buffer.concat([two, names]), two, '0:0\n'), /Incomplete/);
  assert.deepEqual(authenticateNamedShaper(two, result).functions, [
    { functionIndex: 0, name: 'bravo' },
    { functionIndex: 1, name: 'alpha' },
  ]);
  const generated = attachOptimizerFunctionNames(named, release, '0:byn$mgfn-shared$0\n');
  assert.equal(authenticateNamedShaper(release, generated).functions[0].name, 'binaryen:byn$mgfn-shared$0');
  for (const invalid of ['', 'bad', '0:1', '0:0\n0:0', '4294967296:0']) {
    assert.throws(() => attachOptimizerFunctionNames(named, release, invalid));
  }
});

test('diagnostic wrapper changes only the final shaper stripping option, preserving Cargo metadata', () => {
  const arguments_ = ['--crate-name', 'pmndrs_glyph_shaper', '-C', 'metadata=release-id', '-C', 'strip=symbols'];
  assert.deepEqual(diagnosticRustcArguments(arguments_), [...arguments_, '-C', 'strip=none']);
  assert.deepEqual(arguments_.slice(-2), ['-C', 'strip=symbols']);
  const dependency = ['--crate-name', 'harfrust', '-C', 'metadata=release-dependency'];
  assert.equal(diagnosticRustcArguments(dependency), dependency);
  assert.equal(diagnosticRustcArguments([]).length, 0);
});

test('optimizer defined identities account for imported function indexes', () => {
  const imported = Buffer.concat([
    release.subarray(0, 14),
    Buffer.from([2, 7, 1, 1, 109, 1, 102, 0, 0]),
    release.subarray(14),
  ]);
  const definedName = Buffer.from(name);
  definedName[10] = 1;
  const result = attachOptimizerFunctionNames(Buffer.concat([imported, definedName]), imported, '0:fimport$0\n1:0\n');
  assert.deepEqual(authenticateNamedShaper(imported, result).functions, [
    { functionIndex: 0, name: 'binaryen:fimport$0' },
    { functionIndex: 1, name: 'shaper' },
  ]);
  assert.throws(
    () => attachOptimizerFunctionNames(Buffer.concat([imported, definedName]), imported, '1:0\n'),
    /Incomplete/,
  );
});

test('named diagnostics retain the exact release bytes and authenticate final function indexes', () => {
  const custom = Buffer.from([0, 3, 1, 120, 42]);
  const original = Buffer.concat([release, custom]);
  const result = deriveNamedShaper(original, named);
  assert.deepEqual(result.bytes, Buffer.concat([original, name]));
  assert.deepEqual(result.proof.functions, [{ functionIndex: 0, name: 'shaper' }]);
  assert.equal(authenticateNamedShaper(release, result.bytes).executableSha256, result.proof.executableSha256);
  assert.equal(wasmSections(result.bytes).at(-1).name, 'name');
});

test('authentication rejects a changed valid function body or any other executable section', () => {
  const changedCode = Buffer.concat([release.subarray(0, 18), Buffer.from([10, 5, 1, 3, 0, 1, 11]), name]);
  assert(new WebAssembly.Module(changedCode));
  assert.throws(() => authenticateNamedShaper(release, changedCode), /executable sections differ/);
  const changedType = Buffer.from(named);
  changedType[13] = 1;
  assert.throws(() => authenticateNamedShaper(release, changedType), /executable sections differ/);
});

test('authentication fails closed for missing, duplicated, empty or out-of-range names', () => {
  assert.throws(() => authenticateNamedShaper(release, release), /exactly one name section/);
  assert.throws(() => authenticateNamedShaper(release, Buffer.concat([named, name])), /exactly one name section/);
  const empty = Buffer.from([0, 8, 4, 110, 97, 109, 101, 1, 1, 0]);
  assert.throws(() => authenticateNamedShaper(release, Buffer.concat([release, empty])), /no function names/);
  const outside = Buffer.from(name);
  outside[10] = 1;
  assert.throws(() => authenticateNamedShaper(release, Buffer.concat([release, outside])), /index out of range/);
});

test('section and name framing reject truncation, overflow and invalid UTF-8', () => {
  for (let length = 0; length < named.length; length++) {
    assert.throws(() => authenticateNamedShaper(release, named.subarray(0, length)));
  }
  assert.throws(
    () => wasmSections(Buffer.concat([release, Buffer.from([0, 255, 255, 255, 255, 31])])),
    /Invalid Wasm u32/,
  );
  const invalid = Buffer.from(name);
  invalid[12] = 255;
  assert.throws(() => authenticateNamedShaper(release, Buffer.concat([release, invalid])));
  const trailing = Buffer.from(name);
  trailing[8] = 8;
  assert.throws(() => authenticateNamedShaper(release, Buffer.concat([release, trailing])));
});

test('diagnostic output cannot enter dist, including a dot-prefixed child', () => {
  const dist = resolve('package/dist');
  for (const output of [dist, resolve(dist, 'profile'), resolve(dist, '..profile')]) {
    assert.throws(() => assertDiagnosticOutputOutsideDist(dist, output), /outside the shipped dist/);
  }
  for (const output of [resolve(dist, '..'), resolve(dist, '../.cache/profile')]) {
    assert.doesNotThrow(() => assertDiagnosticOutputOutsideDist(dist, output));
  }
});

test('captured commands consume the supplied byte snapshot without reopening an artifact path', async () => {
  const snapshot = Buffer.from([0, 1, 127, 128, 255]);
  const result = await captureCommand(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
    input: snapshot,
  });
  assert.deepEqual(result, snapshot);
});
