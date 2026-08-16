import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { bakeFont } from '@pmndrs/glyph/bake';

const outputDirectory = resolve('fixtures/rendering');
await mkdir(outputDirectory, { recursive: true });
const check = process.argv.includes('--check');
const requestedFixture = process.argv.find((argument) => argument.startsWith('--fixture='))?.slice('--fixture='.length);
const temporaryDirectory = check ? await mkdtemp(join(tmpdir(), 'pmndrs-glyph-showcase-')) : undefined;

const fixtures = [
  {
    fontFixture: 'inter',
    input: resolve('fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
    outputStem: 'inter',
  },
  {
    fontFixture: 'amiri',
    input: resolve('fixtures/fonts/amiri-1.002/Amiri-Regular.ttf'),
    outputStem: 'amiri',
  },
  {
    fontFixture: 'noto-sans-devanagari',
    input: resolve('fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf'),
    outputStem: 'noto-sans-devanagari',
  },
  {
    fontFixture: 'dot-gothic-16',
    input: resolve('fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf'),
    outputStem: 'dot-gothic-16',
  },
  {
    fontFixture: 'font-awesome-free-6.7.2',
    input: resolve('fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf'),
    outputStem: 'font-awesome-free-6.7.2',
  },
  {
    fontFixture: 'noto-sans-cjk-showcase',
    input: resolve('fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf'),
    outputStem: 'noto-sans-cjk-showcase',
  },
  {
    fontFixture: 'source-serif-4',
    input: resolve('fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf'),
    outputStem: 'source-serif-4',
  },
  {
    fontFixture: 'dancing-script',
    input: resolve('fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf'),
    outputStem: 'dancing-script',
  },
] as const;

const selectedFixtures =
  requestedFixture === undefined ? fixtures : fixtures.filter(({ fontFixture }) => fontFixture === requestedFixture);
if (selectedFixtures.length === 0) {
  throw new TypeError(`Unknown bitmap fixture: ${String(requestedFixture)}`);
}
if (check && requestedFixture !== undefined) {
  throw new TypeError('--fixture cannot weaken the complete bitmap fixture check');
}

const configurations = [
  {
    strikes: [16] as const,
    fileSuffix: 'bitmap-16.font.glb',
    manifestFile: 'showcase-raster-fixtures-v0.json',
  },
  {
    strikes: [16, 32] as const,
    fileSuffix: 'bitmap-16-32.font.glb',
    manifestFile: 'showcase-bitmap-density-fixtures-v0.json',
  },
] as const;

try {
  for (const configuration of configurations) {
    const manifestOutput = resolve(outputDirectory, configuration.manifestFile);
    const previousManifest = JSON.parse(await readFile(manifestOutput, 'utf8')) as {
      readonly artifacts: Array<{
        readonly fontFixture: string;
        readonly [key: string]: unknown;
      }>;
    };
    const artifacts: Array<{
      readonly fontFixture: string;
      readonly [key: string]: unknown;
    }> =
      requestedFixture === undefined
        ? []
        : previousManifest.artifacts.filter(({ fontFixture }) => fontFixture !== requestedFixture);
    for (const fixture of selectedFixtures) {
      const file = `${fixture.outputStem}-${configuration.fileSuffix}`;
      const output = resolve(temporaryDirectory ?? outputDirectory, file);
      const report = await bakeFont({
        input: fixture.input,
        output,
        font: { fontFaceIndex: 0 },
        rasters: [
          {
            baker: bitmapBaker,
            packaging: { artifact: 'embedded', pages: 'embedded' },
            options: { strikes: [...configuration.strikes] },
          },
        ],
      });
      const raster = report.rasters.find(({ kind }) => kind === 'bitmap');
      if (raster === undefined) throw new Error(`${fixture.fontFixture} bake omitted its bitmap report`);
      const generated = await readFile(output);
      const hash = createHash('sha256').update(generated).digest('hex');
      artifacts.push({
        fontFixture: fixture.fontFixture,
        file,
        bytes: generated.byteLength,
        sha256: hash,
        raster: {
          decodedGpuBytes: raster.gpuBytes,
          pages: raster.pages.map((page, index) => ({
            index,
            width: page.width,
            height: page.height,
            encodedBytes: page.encodedBytes,
            decodedGpuBytes: page.gpuBytes,
          })),
        },
      });
      if (check) {
        const checkedIn = await readFile(resolve(outputDirectory, file));
        if (!generated.equals(checkedIn)) {
          throw new Error(`${file} is not byte-identical to a fresh package-owned bake`);
        }
      }
    }
    artifacts.sort(
      (left, right) =>
        fixtures.findIndex(({ fontFixture }) => fontFixture === left.fontFixture) -
        fixtures.findIndex(({ fontFixture }) => fontFixture === right.fontFixture),
    );
    const generatedManifest = {
      schemaVersion: 0,
      strikePpems: configuration.strikes,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      artifacts,
    };
    if (check) {
      const canonicalManifest = JSON.parse(await readFile(manifestOutput, 'utf8'));
      if (JSON.stringify(generatedManifest) !== JSON.stringify(canonicalManifest)) {
        throw new Error(`fresh showcase bitmap fixtures do not match ${configuration.manifestFile}`);
      }
    } else {
      await writeFile(manifestOutput, `${JSON.stringify(generatedManifest, undefined, 2)}\n`);
    }
  }
} finally {
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
/* @workflow
{
  "name": "fixture:showcase-rasters:generate",
  "summary": "Regenerate canonical showcase raster artifacts.",
  "requirements": "Built runtime packages and authenticated source fonts.",
  "writes": "Checked-in showcase raster fixtures."
}
*/
/* @workflow
{
  "name": "fixture:showcase-rasters:check",
  "summary": "Verify canonical showcase raster artifacts.",
  "requirements": "Built runtime packages and authenticated source fonts.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
