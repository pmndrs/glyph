import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { bakeFont } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { msdfBaker } from '@pmndrs/glyph/bakers/msdf';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';
import { MSDF_EM_SIZE, MSDF_PIXEL_RANGE } from '@pmndrs/glyph/core';
import { exactBaseTextureArrayBytes } from '../src/benchmark/texture-memory.ts';

/**
 * Inter baked with `outlines: true` in each raster format, for workloads that read glyph outlines (`outlineAt()`).
 * The showcase fixtures stay outline-free, so every other workload keeps its established artifact bytes.
 */
const outputDirectory = resolve('fixtures/rendering');
const manifestOutput = resolve(outputDirectory, 'outline-fixtures-v0.json');
const check = process.argv.includes('--check');
const input = resolve('fixtures/fonts/inter-v4.1/Inter-Regular.ttf');
const bitmapStrikes = [16, 32] as [number, ...number[]];
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-outline-fixture-'));

const font = { fontFaceIndex: 0, outlines: true } as const;

/** Runs one bake into the temporary directory and returns the artifact bytes beside the bake's report. */
async function baked<Report>(name: string, run: (output: string) => Promise<Report>) {
  const output = join(temporaryDirectory, `${name}.font.glb`);
  const report = await run(output);
  return { bytes: await readFile(output), report };
}

try {
  const packaging = { artifact: 'embedded' } as const;
  const bitmap = await baked('inter-outlines-bitmap-16-32', (output) =>
    bakeFont({
      input,
      output,
      font,
      rasters: [{ baker: bitmapBaker, packaging, options: { strikes: bitmapStrikes } }],
    }),
  );
  const mtsdf = await baked('inter-outlines-mtsdf', (output) =>
    bakeFont({ input, output, font, rasters: [{ baker: msdfBaker, packaging, options: undefined }] }),
  );
  const slug = await baked('inter-outlines-slug', (output) =>
    bakeFont({ input, output, font, rasters: [{ baker: slugBaker, packaging, options: undefined }] }),
  );
  const bitmapReport = bitmap.report.rasters.find(({ kind }) => kind === 'bitmap');
  const mtsdfReport = mtsdf.report.rasters.find(({ kind }) => kind === 'msdf');
  const slugReport = slug.report.rasters.find(({ kind }) => kind === 'slug');
  if (bitmapReport === undefined || mtsdfReport === undefined || slugReport === undefined) {
    throw new Error('an outlined bake omitted its raster report');
  }
  const textureWidth = Math.max(...mtsdfReport.pages.map(({ width }) => width));
  const textureHeight = Math.max(...mtsdfReport.pages.map(({ height }) => height));
  const gzipped = (bytes: Uint8Array) => gzipSync(bytes, { level: 9 });
  const mtsdfCompressed = gzipped(mtsdf.bytes);
  const slugCompressed = gzipped(slug.bytes);
  const artifacts = {
    bitmap: {
      file: 'inter-outlines-bitmap-16-32.font.glb',
      bytes: bitmap.bytes.byteLength,
      sha256: sha256(bitmap.bytes),
      decodedGpuBytes: bitmapReport.gpuBytes,
    },
    mtsdf: {
      file: 'inter-outlines-mtsdf.font.glb.gz',
      configuration: { emSize: MSDF_EM_SIZE, pixelRange: MSDF_PIXEL_RANGE },
      uncompressed: { bytes: mtsdf.bytes.byteLength, sha256: sha256(mtsdf.bytes) },
      compressed: { bytes: mtsdfCompressed.byteLength, sha256: sha256(mtsdfCompressed) },
      basePaddedGpuBytes: exactBaseTextureArrayBytes(textureWidth, textureHeight, mtsdfReport.pages.length, 4),
    },
    slug: {
      file: 'inter-outlines-slug.font.glb.gz',
      uncompressed: { bytes: slug.bytes.byteLength, sha256: sha256(slug.bytes) },
      compressed: { bytes: slugCompressed.byteLength, sha256: sha256(slugCompressed) },
      decodedGpuBytes: slugReport.gpuBytes,
    },
  };
  const files = [
    [artifacts.bitmap.file, bitmap.bytes],
    [artifacts.mtsdf.file, mtsdfCompressed],
    [artifacts.slug.file, slugCompressed],
  ] as const;
  const manifest = {
    schemaVersion: 0,
    fontFixture: 'inter',
    outlines: true,
    bitmapStrikePpems: bitmapStrikes,
    artifacts,
  };
  if (check) {
    for (const [file, bytes] of files) {
      const checkedIn = await readFile(resolve(outputDirectory, file));
      if (!Buffer.from(bytes).equals(checkedIn))
        throw new Error(`${file} is not byte-identical to a fresh package-owned bake`);
    }
    const expected = JSON.parse(await readFile(manifestOutput, 'utf8'));
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) {
      throw new Error('fresh outlined fixtures do not match their canonical manifest');
    }
  } else {
    await mkdir(outputDirectory, { recursive: true });
    for (const [file, bytes] of files) await writeFile(resolve(outputDirectory, file), bytes);
    await writeFile(manifestOutput, `${JSON.stringify(manifest, undefined, 2)}\n`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
/* @workflow { "name": "fixture:glyph-outlines:generate", "summary": "Regenerate the outlined Inter fixtures used by Glyph Physics.", "requirements": "Built runtime packages and authenticated Inter.", "writes": "Checked-in outlined Inter fixtures." } */
/* @workflow { "name": "fixture:glyph-outlines:check", "summary": "Verify the outlined Inter fixtures used by Glyph Physics.", "requirements": "Built runtime packages and authenticated Inter.", "writes": "Nothing.", "args": ["--check"] } */
