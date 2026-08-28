import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import type { ParagraphStyle } from '@pmndrs/glyph';
import { createFontBaker } from '@pmndrs/glyph/bake';

import { paragraphLayoutContract } from '../src/benchmark/paragraph-layout-digest.ts';
import {
  createContractText,
  createParagraphContractRuntime,
  preserveEquivalentLegacyNumbers,
  type LegacyConstraints,
} from './support/paragraph-contract-runtime.mts';

const output = new URL('../fixtures/contracts/paragraph-cjk-layout-v0.json', import.meta.url);
const cliArguments = process.argv.slice(2);
if (cliArguments.some((argument) => argument !== '--check') || cliArguments.length > 1) {
  throw new Error('usage: generate-paragraph-cjk-contract.mts [--check]');
}
const check = cliArguments[0] === '--check';
const retained = JSON.parse(await readFile(output, 'utf8')) as {
  readonly cases: Readonly<Record<string, { readonly text: string }>>;
};
const coverage = Object.values(retained.cases)
  .map(({ text }) => text)
  .join('')
  .replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu, '');
const [source, bakerWasm] = await Promise.all([
  readFile(new URL('../fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf', import.meta.url)),
  readFile(new URL('../../../packages/glyph/dist/font-baker.wasm', import.meta.url)),
]);
const baker = await createFontBaker(bakerWasm);
const artifact = baker.bake({ source, descriptor: { formatVersion: 0, fontFaceIndex: 0 } }).artifacts[0];
if (artifact === undefined) throw new Error('font baker returned no CJK artifact');
const runtime = await createParagraphContractRuntime();
const font = await runtime.loadFont(
  new URL('../fixtures/rendering/noto-sans-cjk-contract-bitmap-16.font.glb', import.meta.url),
  coverage,
);

try {
  const constraints = {
    natural: { width: { mode: 'unconstrained' }, wrap: 'word' },
    wide: { width: { mode: 'exactly', size: 480 }, wrap: 'word' },
    narrow: { width: { mode: 'exactly', size: 260 }, wrap: 'word' },
  } as const satisfies Record<string, LegacyConstraints>;
  const inputs = {
    simplified: {
      text: '简体中文段落没有空格，需要在合法边界换行，并保持（标点）与𠀋、禰󠄀完整。',
      style: { fontSize: 32, lineHeight: 1.25, direction: 'ltr', language: 'zh-hans' },
    },
    japanese: {
      text: '日本語の文章は空白なしで改行し、句読点「。、」と𠀋、禰󠄀を安全に扱います。',
      style: { fontSize: 32, lineHeight: 1.25, direction: 'ltr', language: 'ja' },
    },
    korean: {
      text: '한글 문장과 자모, 漢字를 함께 안전하게 배치합니다.',
      style: { fontSize: 32, lineHeight: 1.25, direction: 'ltr', language: 'ko' },
    },
    mixed: {
      text: 'pmndrs glyph：骨かな한글ABC、𠀋、禰󠄀',
      style: { fontSize: 32, lineHeight: 1.25, direction: 'ltr', language: 'ja' },
    },
  } as const satisfies Record<string, { readonly text: string; readonly style: ParagraphStyle }>;
  const cases: Record<string, unknown> = {};
  for (const [id, input] of Object.entries(inputs)) {
    const paragraph = createContractText(font.font, input.text, input.style);
    const layouts: Record<string, unknown> = {};
    try {
      for (const [constraintId, value] of Object.entries(constraints)) {
        layouts[constraintId] = paragraphLayoutContract(paragraph.inspect(value));
      }
    } finally {
      paragraph.dispose();
    }
    cases[id] = { ...input, layouts, calls: { shape: 1, reshape: 0 } };
  }
  const document = {
    schemaVersion: 0,
    generatedBy: 'apps/benchmarks/scripts/generate-paragraph-cjk-contract.mts',
    font: {
      fixture: 'noto-sans-cjk-jp-regular-v0',
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      artifactSha256: artifact.sha256,
      shapingHash: font.shapingHash,
      sourceOracle: '../shaping/noto-sans-cjk/harfrust.json',
      independentOracle: '../shaping/noto-sans-cjk/harfbuzz.json',
    },
    constraints,
    cases,
  };
  const preserved = preserveEquivalentLegacyNumbers(document, retained);
  if (check) {
    const expected = JSON.stringify(retained);
    const actual = JSON.stringify(preserved);
    if (expected !== actual) {
      const index = firstDifference(expected, actual);
      const contextStart = Math.max(0, index - 120);
      throw new Error(
        `paragraph CJK contract is stale at JSON byte ${index}: ${expected.slice(contextStart, index + 80)} !== ${actual.slice(contextStart, index + 80)}`,
      );
    }
  } else {
    await writeFile(output, `${JSON.stringify(preserved, undefined, 2)}\n`);
  }
} finally {
  font.dispose();
  runtime.dispose();
}

function firstDifference(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return index;
  return length;
}

/* @workflow
{
  "name": "fixture:paragraph-cjk:generate",
  "summary": "Regenerate the public Rust paragraph CJK contract fixture.",
  "requirements": "Built runtime packages, the core baker, and authenticated checked-in fonts.",
  "writes": "Checked-in paragraph CJK contract."
}
*/
/* @workflow
{
  "name": "fixture:paragraph-cjk:check",
  "summary": "Verify the public Rust paragraph CJK contract fixture by deterministic regeneration.",
  "requirements": "Built runtime packages, the core baker, and authenticated checked-in fonts.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
