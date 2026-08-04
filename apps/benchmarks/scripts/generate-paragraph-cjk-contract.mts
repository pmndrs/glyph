import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import {
  createParagraphEngine,
  createRuntimeShaper,
  FontRegistry,
  type ParagraphConstraints,
  type ParagraphStyle,
  type RuntimeShaper,
} from '@pmndrs/text';
import { createFontBaker } from '@pmndrs/text-font-baker';

import { paragraphLayoutContract } from '../src/benchmark/paragraph-layout-digest.ts';

const output = new URL('../fixtures/contracts/paragraph-cjk-layout-v0.json', import.meta.url);
const cliArguments = process.argv.slice(2);
if (cliArguments.some((argument) => argument !== '--check') || cliArguments.length > 1) {
  throw new Error('usage: generate-paragraph-cjk-contract.mts [--check]');
}
const check = cliArguments[0] === '--check';
const root = new URL('../', import.meta.url);
const [source, bakerWasm, shaperWasm] = await Promise.all([
  readFile(new URL('../fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf', import.meta.url)),
  readFile(new URL('../../packages/font-baker/dist/font_baker.wasm', root)),
  readFile(new URL('../../packages/text/dist/text_shaper.wasm', root)),
]);
const baker = await createFontBaker(bakerWasm);
const baked = baker.bake({ source, descriptor: { formatVersion: 0, fontFaceIndex: 0 } });
const artifact = baked.artifacts[0];
if (artifact === undefined) throw new Error('font baker returned no CJK artifact');
const registry = new FontRegistry();
const font = await registry.registerAsset(artifact.bytes);
const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm });
const calls = { shape: 0, reshape: 0 };
const observed = observeShaper(shaper, calls);
const engine = createParagraphEngine({ shaper: observed });

const constraints = {
  natural: { width: { mode: 'unconstrained' }, wrap: 'word' },
  wide: { width: { mode: 'exactly', size: 480 }, wrap: 'word' },
  narrow: { width: { mode: 'exactly', size: 260 }, wrap: 'word' },
} as const satisfies Record<string, ParagraphConstraints>;
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
    text: 'pmndrs text：骨かな한글ABC、𠀋、禰󠄀',
    style: { fontSize: 32, lineHeight: 1.25, direction: 'ltr', language: 'ja' },
  },
} as const satisfies Record<string, { readonly text: string; readonly style: ParagraphStyle }>;

const cases: Record<string, unknown> = {};
for (const [id, input] of Object.entries(inputs)) {
  const before = { ...calls };
  const paragraph = engine.create({ ...input, font: font.handle });
  const layouts: Record<string, unknown> = {};
  for (const [constraintId, value] of Object.entries(constraints)) {
    const measured = paragraph.measure(value);
    const layout = paragraph.layout(value);
    if (paragraph.measure(value) !== measured || paragraph.layout(value) !== layout) {
      throw new Error(`${id}.${constraintId} did not reuse its retained result`);
    }
    layouts[constraintId] = paragraphLayoutContract(layout);
  }
  cases[id] = {
    ...input,
    layouts,
    calls: { shape: calls.shape - before.shape, reshape: calls.reshape - before.reshape },
  };
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
const serialized = `${JSON.stringify(document, undefined, 2)}\n`;
if (check) {
  const committed = JSON.parse(await readFile(output, 'utf8')) as unknown;
  if (JSON.stringify(committed) !== JSON.stringify(document)) {
    throw new Error(
      'paragraph CJK contract is stale; run pnpm generate:paragraph-cjk-contract and review the exact diff',
    );
  }
} else {
  await writeFile(output, serialized);
}

shaper.dispose();
font.dispose();

function observeShaper(runtime: RuntimeShaper, counts: { shape: number; reshape: number }): RuntimeShaper {
  return {
    registry: runtime.registry,
    registerFont: (registered) => runtime.registerFont(registered),
    disposeFont: (registered) => runtime.disposeFont(registered),
    analyzeBidi: (text, direction) => runtime.analyzeBidi(text, direction),
    shapeBatch: (request) => {
      counts.shape += 1;
      return runtime.shapeBatch(request);
    },
    reshapeRanges: (request) => {
      counts.reshape += 1;
      return runtime.reshapeRanges(request);
    },
    memoryReport: () => runtime.memoryReport(),
    dispose: () => runtime.dispose(),
  };
}
/* @workflow
{
  "name": "fixture:paragraph-cjk:generate",
  "summary": "Regenerate the public paragraph CJK contract fixture.",
  "requirements": "Built runtime packages and authenticated CJK font.",
  "writes": "Checked-in paragraph CJK contract."
}
*/
/* @workflow
{
  "name": "fixture:paragraph-cjk:check",
  "summary": "Verify the public paragraph CJK contract fixture.",
  "requirements": "Built runtime packages and authenticated CJK font.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
