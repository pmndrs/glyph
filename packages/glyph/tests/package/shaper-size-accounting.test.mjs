import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { accountShaper } from '../../scripts/support/shaper-size-accounting.mjs';

// Hand-encoded modules keep the expected section and body lengths independent of the accounting code.
const header = [0, 97, 115, 109, 1, 0, 0, 0];
const oneType = [1, 4, 1, 96, 0, 0];
const twoTypes = [1, 8, 2, 96, 0, 0, 96, 1, 127, 0];
const twoBodies = [10, 7, 2, 2, 0, 11, 2, 0, 11];

function names(release, entries) {
  const map = [entries.length];
  for (const [index, text] of entries) {
    const encoded = Buffer.from(text);
    map.push(index, encoded.length, ...encoded);
  }
  const subsection = [1, map.length, ...map];
  const payload = [4, 110, 97, 109, 101, ...subsection];
  return Buffer.concat([release, Buffer.from([0, payload.length, ...payload])]);
}

test('exact body and section accounting reconciles an imported function index', () => {
  const release = Buffer.from([...header, ...oneType, 2, 7, 1, 1, 109, 1, 102, 0, 0, 3, 3, 2, 0, 0, ...twoBodies]);
  const result = accountShaper(
    release,
    names(release, [
      [0, 'import'],
      [1, 'first'],
      [2, 'second'],
    ]),
  );
  assert.equal(result.importedFunctionCount, 1);
  assert.deepEqual(
    result.functions.map((fn) => fn.functionIndex),
    [1, 2],
  );
  assert.deepEqual(
    result.functions.map((fn) => fn.declaredTypeIndex),
    [0, 0],
  );
  assert.deepEqual(
    result.functions.map((fn) => fn.rawBodyBytes),
    [2, 2],
  );
  assert.deepEqual(result.codeSection, {
    rawBytes: 9,
    bodyBytes: 4,
    bodyLengthPrefixBytes: 2,
    countPrefixBytes: 1,
    sectionFramingBytes: 2,
  });
  assert.equal(8 + result.sections.reduce((sum, section) => sum + section.rawBytes, 0), release.length);
  assert.deepEqual(
    result.exactDuplicateCandidates.map((group) => group.functionIndexes),
    [[1, 2]],
  );
});

test('identical body bytes with different declared type indexes are not duplicate candidates', () => {
  const release = Buffer.from([...header, ...twoTypes, 3, 3, 2, 0, 1, ...twoBodies]);
  const result = accountShaper(
    release,
    names(release, [
      [0, 'a'],
      [1, 'b'],
    ]),
  );
  assert.deepEqual(
    result.functions.map((fn) => fn.declaredTypeIndex),
    [0, 1],
  );
  assert.deepEqual(result.exactDuplicateCandidates, []);
});

test('a valid but tampered named executable is rejected before accounting', () => {
  const release = Buffer.from([...header, ...oneType, 3, 2, 1, 0, 10, 4, 1, 2, 0, 11]);
  const tampered = Buffer.from([...header, ...oneType, 3, 2, 1, 0, 10, 5, 1, 3, 0, 1, 11]);
  assert(new WebAssembly.Module(tampered));
  assert.throws(() => accountShaper(release, names(tampered, [[0, 'shaper']])), /executable sections differ/);
});

test('CLI accepts a frozen unnamed archive and reports measured sections without name attribution', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'glyph-shaper-size-'));
  try {
    const packageDist = join(temporary, 'package', 'dist');
    await mkdir(packageDist, { recursive: true });
    const release = Buffer.from([...header, ...oneType, 3, 2, 1, 0, 10, 4, 1, 2, 0, 11]);
    await writeFile(join(packageDist, 'text-shaper.wasm'), release);
    const archive = join(temporary, 'release.tgz');
    execFileSync('tar', ['-czf', archive, '-C', temporary, 'package']);
    const baselineRoot = join(temporary, 'baseline');
    const baselineDist = join(baselineRoot, 'package', 'dist');
    await mkdir(baselineDist, { recursive: true });
    const baseline = Buffer.from([...header, ...oneType]);
    await writeFile(join(baselineDist, 'text-shaper.wasm'), baseline);
    const baselineArchive = join(temporary, 'baseline.tgz');
    execFileSync('tar', ['-czf', baselineArchive, '-C', baselineRoot, 'package']);
    const output = join(temporary, 'report');
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../../scripts/shaper-size-accounting.mjs', import.meta.url)),
      '--artifact',
      archive,
      '--baseline',
      baselineArchive,
      '--output',
      output,
    ]);

    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    const markdown = await readFile(join(output, 'report.md'), 'utf8');
    assert.equal(report.mode, 'summary');
    assert.equal(report.inputs.named, null);
    assert.equal(report.release.rawBytes, release.length);
    assert.equal(report.definedFunctionCount, 1);
    assert.equal(report.importedFunctionCount, 0);
    assert.equal(report.baselineDelta.rawBytes, release.length - baseline.length);
    assert.equal(report.baselineDelta.definedFunctionCount, 1);
    assert.equal(report.baselineDelta.sections[0].sameOrdinalDeltaBytes, 0);
    assert.equal(report.baselineDelta.sections[1].sameOrdinalDeltaBytes, null);
    assert.equal(8 + report.sections.reduce((sum, section) => sum + section.rawBytes, 0), release.length);
    for (const key of [
      'symbolClasses',
      'nonexclusiveOwnerHints',
      'genericNameHints',
      'functions',
      'exactDuplicateCandidates',
    ]) {
      assert.equal(report[key], null);
    }
    assert.match(markdown, /Mode: summary/);
    assert.match(markdown, /unavailable without an authenticated named artifact/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
