import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) throw new Error('GLYPH_LABS_PACKAGE_ROOT must identify an installed package');

const { createFontBaker, fontBakerWasmUrl } = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/node/bake.js')).href
)) as typeof import('@pmndrs/glyph/bake');
const source = await readFile(new URL('../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url));
assert.equal(source.byteLength, 411_640);
assert.equal(
  createHash('sha256').update(source).digest('hex'),
  '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82',
);
const baker = await createFontBaker(await readFile(new URL(fontBakerWasmUrl)));
const selection = {
  formatVersion: 0,
  fontFaceIndex: 0,
  unicodeRanges: [{ start: 0x20, end: 0x7e }],
} as const;

group('portable font preparation @cold @api', () => {
  bench('prepare Inter ASCII Unicode subset', function* () {
    const prepared = yield () => baker.prepare({ source, selection });
    assert(prepared.bytes.byteLength < source.byteLength, 'ASCII preparation must reduce the authenticated source');
    assert.equal(prepared.report.sourceBytes, source.byteLength);
    assert.equal(prepared.report.preparedBytes, prepared.bytes.byteLength);
    assert(prepared.report.glyphCount < 200, 'ASCII preparation must retain fewer than 200 glyphs');
    const inspected = baker.inspect({ source: prepared.bytes, descriptor: { formatVersion: 0, fontFaceIndex: 0 } });
    assert(
      inspected.glyphs.some(({ codePoint }) => codePoint === 0x41),
      'prepared face must map A',
    );
    assert(!inspected.glyphs.some(({ codePoint }) => codePoint === 0xe9), 'prepared face must omit é');
  });
});
