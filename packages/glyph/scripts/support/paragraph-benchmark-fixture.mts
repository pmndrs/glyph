import { readFile } from 'node:fs/promises';

import { createTextRuntime, FontRegistry } from '../../dist/index.js';
import { Text, TextGroup } from '../../dist/three.js';
import { bitmap } from '../../dist/three/bitmap.js';

export const paragraphBenchmarkSource = [
  'Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs while a responsive panel changes the space around them. The quick visual check is useful, but the benchmark records the cost of shaping, layout, upload, and every rendered frame.',
  'A practical interface mixes prose with 0123456789, prices such as 24.50, ranges from 8-512 px, and punctuation-"quotes", (parentheses), brackets, commas, and semicolons. Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, and ffl candidates.',
  'Scientific copy adds x2+y2~z2, 0<=a<=1, and pi. Arrows point both ways. These symbols expose missing coverage, uneven baselines, bad advances, and atlas placement errors that plain alphabet samples can hide.',
].join('\n');

export async function loadParagraphBenchmarkFixture() {
  const workspaceRoot = new URL('../../../../', import.meta.url);
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('packages/glyph/dist/text_shaper.wasm', workspaceRoot)),
  });
  const bytes = await readFile(new URL('apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', workspaceRoot));
  const loaded = await runtime.loadFont({
    input: { baked: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  return { runtime, loaded };
}

export function createBenchmarkParagraph(
  fixture: Awaited<ReturnType<typeof loadParagraphBenchmarkFixture>>,
  text: string,
  width: number,
) {
  const group = new TextGroup({ capacity: { size: Math.max(256, text.length), policy: 'grow' } });
  const paragraph = new Text({
    font: fixture.loaded,
    text,
    contentBox: { width: { mode: 'exact', size: width }, wrap: 'word' },
    style: { fontSize: 24 },
  });
  group.add(paragraph);
  return { group, paragraph };
}

export function disposeBenchmarkParagraph(created: ReturnType<typeof createBenchmarkParagraph>): void {
  created.group.dispose();
  created.paragraph.dispose();
}

export function paragraphTextForGlyphs(target: number): string {
  const perCopy = paragraphBenchmarkSource.replaceAll(/\s/gu, '').length;
  const copies = Math.max(1, Math.round(target / perCopy));
  return Array.from({ length: copies }, () => paragraphBenchmarkSource).join('\n');
}
