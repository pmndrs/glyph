import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { bakeFont } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';

import { paragraphCjkCoverageText } from '../src/benchmark/paragraph-contract-corpus.ts';

const output = resolve('fixtures/rendering/noto-sans-cjk-contract-bitmap-16.font.glb');
const args = process.argv.slice(2);
const check = args.includes('--check');
if (args.some((argument) => argument !== '--check') || args.length > 1) {
  throw new Error('usage: generate-paragraph-conformance-font.mts [--check]');
}
const temporaryDirectory = check ? await mkdtemp(join(tmpdir(), 'pmndrs-glyph-cjk-contract-')) : undefined;
const generated = temporaryDirectory === undefined ? output : join(temporaryDirectory, 'font.glb');
try {
  await bakeFont({
    input: resolve('fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf'),
    output: generated,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'embedded' },
        options: { strikes: [16], coverage: { text: paragraphCjkCoverageText } },
      },
    ],
  });
  if (check) {
    const [actual, expected] = await Promise.all([readFile(generated), readFile(output)]);
    if (!actual.equals(expected)) throw new Error('paragraph CJK conformance font is stale');
  }
} finally {
  if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true });
}

/* @workflow { "name": "fixture:paragraph-conformance-font:generate", "summary": "Generate the sparse Bitmap font used by public Rust paragraph conformance.", "requirements": "Built runtime packages and authenticated Noto Sans CJK source font.", "writes": "Checked-in sparse paragraph conformance font asset." } */
/* @workflow { "name": "fixture:paragraph-conformance-font:check", "summary": "Verify the sparse Bitmap font used by public Rust paragraph conformance.", "requirements": "Built runtime packages and authenticated Noto Sans CJK source font.", "writes": "Nothing.", "args": ["--check"] } */
