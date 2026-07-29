import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';

const check = process.argv.includes('--check');
const fixtures = [
  {
    file: 'GraphemeBreakTest.txt.gz',
    sha256: 'e2d134d2c52919bace503ebb6a551c1855fe1a1faec18478c78fff254a1793ec',
    url: 'https://www.unicode.org/Public/17.0.0/ucd/auxiliary/GraphemeBreakTest.txt',
  },
  {
    file: 'LineBreakTest.txt.gz',
    sha256: 'e69884e0dde6a8724873f885d68c52dc14518abf9ae4ca9e2283b8773db3b752',
    url: 'https://www.unicode.org/Public/17.0.0/ucd/auxiliary/LineBreakTest.txt',
  },
  {
    file: 'BidiTest.txt.gz',
    sha256: '888bdfc8090652272d1f859cdb00ae659e2dc6c26740be61ef1d03998a687620',
    url: 'https://www.unicode.org/Public/17.0.0/ucd/BidiTest.txt',
  },
  {
    file: 'BidiCharacterTest.txt.gz',
    sha256: 'a3e6e905ab5afbe318a96df5401d0372a04cd73ef139ab5e3cf0ae241c255488',
    url: 'https://www.unicode.org/Public/17.0.0/ucd/BidiCharacterTest.txt',
  },
  {
    file: 'DerivedBidiClass.txt.gz',
    sha256: '4867b4b7f0731ed1bfcd34cc6251211ff1542541fce0734b6fbda139ee80b3a4',
    url: 'https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt',
  },
];
const directory = new URL('../tests/fixtures/unicode-17.0.0/', import.meta.url);

if (!check) await mkdir(directory, { recursive: true });
for (const fixture of fixtures) {
  const target = new URL(fixture.file, directory);
  const bytes = check
    ? gunzipSync(await readFile(target))
    : new Uint8Array(await (await fetch(fixture.url)).arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== fixture.sha256) {
    throw new Error(`${fixture.file} SHA-256 ${actual} does not match ${fixture.sha256}`);
  }
  if (!check) await writeFile(target, gzipSync(bytes, { level: 9 }));
}
