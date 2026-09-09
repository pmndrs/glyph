import { bitmapBaker } from '../../src/bakers/bitmap.js';
import { bakeFont, bakeProject, type NodeFontBakeReport } from '../../src/node/bake.js';

const explicit = bakeFont({
  input: new URL('file:///tmp/Inter.ttf'),
  output: '/tmp/Inter.font.glb',
  font: { fontFaceIndex: 0 },
  rasters: [
    {
      baker: bitmapBaker,
      packaging: { artifact: 'embedded' },
      options: { strikes: [16, 32] },
    },
  ],
});

const project = bakeProject({
  entries: ['src/main.ts'],
  assetRoots: ['public'],
  outputRoot: 'generated',
});

declare const report: NodeFontBakeReport;
const elapsed: number = report.execution.timingsMs.total;
const outputHash: string | undefined = report.execution.outputs[0]?.fingerprint;
void explicit;
void project;
void elapsed;
void outputHash;

void bakeFont({
  input: '/tmp/Inter.ttf',
  output: '/tmp/Inter.font.glb',
  font: { fontFaceIndex: 0 },
  rasters: [
    {
      baker: bitmapBaker,
      packaging: { artifact: 'embedded' },
      // @ts-expect-error Bitmap bake options retain their package-owned static tuple contract.
      options: { strikes: [] },
    },
  ],
});

void bakeFont({
  input: '/tmp/Inter.ttf',
  output: '/tmp/Inter.font.glb',
  font: { fontFaceIndex: 0 },
  rasters: [
    {
      baker: bitmapBaker,
      // @ts-expect-error The Node host accepts only explicit supported packaging modes.
      packaging: { artifact: 'inline' },
      options: { strikes: [16] },
    },
  ],
});
