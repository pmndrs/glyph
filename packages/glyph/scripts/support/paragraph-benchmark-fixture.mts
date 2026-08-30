import { readFile } from 'node:fs/promises';

import { FontLoader, Text, TextGroup } from '../../dist/three.js';
import { bitmap } from '../../dist/three/bitmap.js';

export const paragraphBenchmarkSource = [
  'Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs while a responsive panel changes the space around them. The quick visual check is useful, but the benchmark records the cost of shaping, layout, upload, and every rendered frame.',
  'A practical interface mixes prose with 0123456789, prices such as 24.50, ranges from 8-512 px, and punctuation-"quotes", (parentheses), brackets, commas, and semicolons. Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, and ffl candidates.',
  'Scientific copy adds x2+y2~z2, 0<=a<=1, and pi. Arrows point both ways. These symbols expose missing coverage, uneven baselines, bad advances, and atlas placement errors that plain alphabet samples can hide.',
].join('\n');

/**
 * Simplified and Japanese copy carrying the punctuation that drives UAX #14 LB16/LB17 -- fullwidth
 * comma, ideographic full stop, and bracket pairs. Latin prose reaches those rules rarely; CJK reaches
 * them on most characters, which is the only reason the quadratic scan in `class_after_spaces` stayed
 * invisible for so long. Every scalar here is covered by the pinned CJK contract strike.
 */
export const paragraphBenchmarkSourceCjk = [
  '简体中文段落没有空格，需要在合法边界换行，并保持（标点）与、完整。',
  '日本語の段落も空白を使わず、句読点や括弧（例）で行を折り返します。',
].join('\n');

export type BenchmarkCorpus = 'latin' | 'cjk';

const corpusFixtures = {
  latin: { source: paragraphBenchmarkSource, font: 'inter-bitmap-16.font.glb' },
  cjk: { source: paragraphBenchmarkSourceCjk, font: 'noto-sans-cjk-showcase-bitmap-16.font.glb' },
} as const satisfies Record<BenchmarkCorpus, { readonly source: string; readonly font: string }>;

export async function loadParagraphBenchmarkFixture(corpus: BenchmarkCorpus = 'latin') {
  const workspaceRoot = new URL('../../../../', import.meta.url);
  const loader = new FontLoader();
  const bytes = await readFile(
    new URL(`apps/benchmarks/fixtures/rendering/${corpusFixtures[corpus].font}`, workspaceRoot),
  );
  const loaded = await loader.loadAsync({
    input: { baked: `data:application/octet-stream;base64,${bytes.toString('base64')}` },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  return { loader, loaded };
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
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: width } },
  });
  group.add(paragraph);
  return { group, paragraph };
}

export function disposeBenchmarkParagraph(created: ReturnType<typeof createBenchmarkParagraph>): void {
  created.group.dispose();
  created.paragraph.dispose();
}

export function paragraphTextForGlyphs(target: number, corpus: BenchmarkCorpus = 'latin'): string {
  const source = corpusFixtures[corpus].source;
  const perCopy = source.replaceAll(/\s/gu, '').length;
  const copies = Math.max(1, Math.round(target / perCopy));
  return Array.from({ length: copies }, () => source).join('\n');
}
