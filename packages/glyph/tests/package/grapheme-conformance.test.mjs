import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { findGraphemeBoundaries } from '../../dist/internal/graphemes.js';
import { findNativeGraphemeBoundaries, hasNativeGraphemeSegmenter } from '../../dist/internal/native-graphemes.js';

const fixture = new URL('../fixtures/unicode-17.0.0/GraphemeBreakTest.txt.gz', import.meta.url);
const nativeImplementation = new URL('../../dist/internal/native-graphemes.js', import.meta.url);

test('the span compiler passes every official Unicode 17 extended-grapheme vector', async () => {
  const cases = await conformanceCases();
  assert.equal(cases.length, 766);
  for (const entry of cases) {
    assert.deepEqual([...findGraphemeBoundaries(entry.text)], entry.boundaries, `GraphemeBreakTest line ${entry.line}`);
  }
  assert.throws(() => findGraphemeBoundaries('\ud800'), /well-formed UTF-16/);
});

test('the native micro lane passes every Unicode 17 extended-grapheme vector on the pinned host', async () => {
  assert.equal(hasNativeGraphemeSegmenter(), true);
  const cases = await conformanceCases();
  assert.equal(cases.length, 766);
  for (const entry of cases) {
    assert.deepEqual(
      [...findNativeGraphemeBoundaries(entry.text)],
      entry.boundaries,
      `GraphemeBreakTest line ${entry.line}`,
    );
  }
  assert.throws(() => findNativeGraphemeBoundaries('\ud800'), /well-formed UTF-16/);
});

test('the native micro lane rejects an unsupported host synchronously', () => {
  const source = `
    Intl.Segmenter = undefined;
    const { findNativeGraphemeBoundaries } = await import(${JSON.stringify(nativeImplementation.href)});
    assert.throws(
      () => findNativeGraphemeBoundaries('Glyph'),
      /requires Intl\\.Segmenter/,
    );
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `import assert from 'node:assert/strict';${source}`],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('the native spike stays out of the production root entry', async () => {
  const rootEntry = await readFile(new URL('../../dist/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(rootEntry, /Intl\.Segmenter/u);
});

async function conformanceCases() {
  const compressed = await readFile(fixture);
  const contents = gunzipSync(compressed).toString('utf8');
  const cases = [];
  for (const [index, source] of contents.split(/\r?\n/u).entries()) {
    const body = source.split('#', 1)[0]?.trim();
    if (!body) continue;
    const tokens = body.split(/\s+/u);
    const codePoints = [];
    const boundaries = [];
    let utf16Offset = 0;
    for (let cursor = 0; cursor < tokens.length; cursor += 2) {
      const marker = tokens[cursor];
      if (marker === '÷') boundaries.push(utf16Offset);
      const hexadecimal = tokens[cursor + 1];
      if (hexadecimal === undefined) break;
      const codePoint = Number.parseInt(hexadecimal, 16);
      codePoints.push(codePoint);
      utf16Offset += codePoint > 0xffff ? 2 : 1;
    }
    cases.push({ line: index + 1, text: String.fromCodePoint(...codePoints), boundaries });
  }
  return cases;
}
