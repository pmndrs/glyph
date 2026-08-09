import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { FontRegistry } from '@pmndrs/text';

const arguments_ = process.argv.slice(2);
if (arguments_.length !== 0) throw new Error('usage: check-paragraph-contract-fixtures.mts');

const fixtures = new URL('../fixtures/', import.meta.url);
const bidiUrl = new URL('contracts/paragraph-bidi-layout-v0.json', fixtures);
const cjkUrl = new URL('contracts/paragraph-cjk-layout-v0.json', fixtures);
const [bidi, cjk] = await Promise.all([readJsonRecord(bidiUrl), readJsonRecord(cjkUrl)]);

assertEqual(bidi.schemaVersion, 0, 'paragraph bidi schemaVersion');
assertEqual(cjk.schemaVersion, 0, 'paragraph CJK schemaVersion');

const bidiFonts = record(bidi.fonts, 'paragraph bidi fonts');
const amiri = record(bidiFonts.amiri, 'paragraph bidi Amiri font');
const inter = record(bidiFonts.inter, 'paragraph bidi Inter font');
const cjkFont = record(cjk.font, 'paragraph CJK font');

await Promise.all([
  authenticateSource(amiri, new URL('fonts/amiri-1.002/Amiri-Regular.ttf', fixtures), 'Amiri'),
  authenticateSource(inter, new URL('fonts/inter-v4.1/Inter-Regular.ttf', fixtures), 'Inter'),
  authenticateSource(cjkFont, new URL('fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf', fixtures), 'CJK'),
  authenticateOracles(amiri, bidiUrl, 'Amiri'),
  authenticateOracles(cjkFont, cjkUrl, 'CJK'),
  authenticateShaping(amiri, new URL('rendering/amiri-bitmap-16.font.glb', fixtures), 'Amiri'),
  authenticateShaping(inter, new URL('rendering/inter-bitmap-16.font.glb', fixtures), 'Inter'),
  authenticateShaping(cjkFont, new URL('rendering/noto-sans-cjk-contract-bitmap-16.font.glb', fixtures), 'CJK'),
]);

async function authenticateSource(metadata: Readonly<Record<string, unknown>>, url: URL, label: string): Promise<void> {
  const expected = string(metadata.sourceSha256, `${label} sourceSha256`);
  const actual = createHash('sha256')
    .update(await readFile(url))
    .digest('hex');
  assertEqual(actual, expected, `${label} source SHA-256`);
}

async function authenticateShaping(
  metadata: Readonly<Record<string, unknown>>,
  url: URL,
  label: string,
): Promise<void> {
  const expected = string(metadata.shapingHash, `${label} shapingHash`);
  const registry = new FontRegistry();
  const font = await registry.registerAsset(await readFile(url));
  try {
    assertEqual(font.shapingHash, expected, `${label} registered shaping hash`);
  } finally {
    font.dispose();
  }
}

async function authenticateOracles(
  metadata: Readonly<Record<string, unknown>>,
  contractUrl: URL,
  label: string,
): Promise<void> {
  const source = await readJsonRecord(new URL(string(metadata.sourceOracle, `${label} sourceOracle`), contractUrl));
  const independent = await readJsonRecord(
    new URL(string(metadata.independentOracle, `${label} independentOracle`), contractUrl),
  );
  assertEqual(record(source.engine, `${label} source oracle engine`).name, 'HarfRust', `${label} source oracle`);
  assertEqual(
    record(independent.engine, `${label} independent oracle engine`).name,
    'HarfBuzz',
    `${label} independent oracle`,
  );
}

async function readJsonRecord(url: URL): Promise<Readonly<Record<string, unknown>>> {
  return record(JSON.parse(await readFile(url, 'utf8')) as unknown, url.pathname);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${label} is not an object`);
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is not a nonempty string`);
  return value;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${label}: ${String(actual)} !== ${String(expected)}`);
}

/* @workflow
{
  "name": "fixture:paragraph-contracts:check",
  "summary": "Authenticate retained paragraph contracts, their source fonts, shaping payloads, and independent oracles.",
  "requirements": "Built runtime packages plus checked-in paragraph fonts, contracts, and shaping oracles.",
  "writes": "Nothing. Behavioral equivalence is checked by the public paragraph-contracts browser target.",
  "args": []
}
*/
