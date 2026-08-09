import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { bitmapBaker } from '@pmndrs/text/bakers/bitmap';
import { msdfBaker } from '@pmndrs/text/bakers/msdf';
import { slugBaker } from '@pmndrs/text/bakers/slug';
import { bakeFont } from '@pmndrs/text/bake';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');
const ASSETS = resolve(import.meta.dirname, '../assets');
const HARFBUZZ_VERSION = '14.2.0';
const BASIC_LATIN = 'U+0020-007E';
const WORLD_ICONS = ['U+E47B', 'U+F0AC', 'U+F57C', 'U+F57D', 'U+F57E', 'U+F7A2'];
const check = process.argv.includes('--check');

const sources = [
  {
    input: resolve(ROOT, 'apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
    name: 'inter-latin',
    unicodes: BASIC_LATIN,
  },
  {
    input: resolve(ROOT, 'apps/benchmarks/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf'),
    name: 'font-awesome-world',
    unicodes: WORLD_ICONS.join(','),
  },
] as const;

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pmndrs-text-r3f-example-'));
try {
  await assertHarfBuzzVersion();
  const generatedAssets = check ? join(temporaryDirectory, 'assets') : ASSETS;
  await mkdir(generatedAssets, { recursive: true });
  const manifest = [];
  for (const source of sources) {
    const subset = join(temporaryDirectory, `${source.name}.ttf`);
    await run('hb-subset', [source.input, `--unicodes=${source.unicodes}`, `--output-file=${subset}`]);
    const asset = `${source.name}.font.glb`;
    const output = resolve(generatedAssets, asset);
    const report = await bakeFont({
      input: subset,
      output,
      font: { fontFaceIndex: 0 },
      rasters: [
        {
          baker: bitmapBaker,
          packaging: { artifact: 'embedded', pages: 'embedded' },
          options: { strikes: [32] },
        },
        {
          baker: msdfBaker,
          packaging: { artifact: 'embedded', pages: 'embedded' },
        },
        {
          baker: slugBaker,
          packaging: { artifact: 'embedded', pages: 'embedded' },
        },
      ],
    });
    const bytes = await readFile(output);
    manifest.push({
      asset,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      source: source.input.slice(ROOT.length + 1),
      unicodes: source.unicodes,
      outputs: report.execution.outputs.map(({ role, bytes: outputBytes, sha256 }) => ({
        role,
        bytes: outputBytes,
        sha256,
      })),
    });
    if (check && !(await readFile(resolve(ASSETS, asset))).equals(bytes)) {
      throw new Error(`${asset} is not byte-identical to a fresh authenticated subset bake`);
    }
  }
  const manifestText = `${JSON.stringify(
    { schemaVersion: 0, harfBuzzVersion: HARFBUZZ_VERSION, assets: manifest },
    undefined,
    2,
  )}\n`;
  if (check) {
    if ((await readFile(resolve(ASSETS, 'manifest.json'), 'utf8')) !== manifestText) {
      throw new Error('R3F example font manifest is stale');
    }
  } else {
    await writeFile(resolve(ASSETS, 'manifest.json'), manifestText);
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}

async function assertHarfBuzzVersion(): Promise<void> {
  const { stdout } = await run('hb-subset', ['--version']);
  const version = stdout.trim().match(/\d+\.\d+\.\d+$/u)?.[0];
  if (version !== HARFBUZZ_VERSION) {
    throw new Error(`R3F example assets require hb-subset ${HARFBUZZ_VERSION}; received ${String(version)}`);
  }
}
