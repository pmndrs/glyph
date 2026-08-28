import { readFile, writeFile } from 'node:fs/promises';

import { createParagraph, type ParagraphStyle } from '@pmndrs/glyph';

import { paragraphLayoutContract } from '../src/benchmark/paragraph-layout-digest.ts';
import { createUikitLayoutFixture, YogaMeasureMode } from '../src/benchmark/uikit-layout-fixture.ts';
import {
  createContractText,
  createParagraphContractRuntime,
  policyOnly,
  preserveEquivalentLegacyNumbers,
  type LegacyConstraints,
} from './support/paragraph-contract-runtime.mts';

const output = new URL('../fixtures/contracts/paragraph-bidi-layout-v0.json', import.meta.url);
const cliArguments = process.argv.slice(2);
if (cliArguments.some((argument) => argument !== '--check') || cliArguments.length > 1) {
  throw new Error('usage: generate-paragraph-bidi-contract.mts [--check]');
}
const check = cliArguments[0] === '--check';
const retained = JSON.parse(await readFile(output, 'utf8')) as unknown;
const retainedUikit = retained as {
  readonly uikit: {
    readonly measurements: { readonly exactWidth: { readonly height: number } };
    readonly resolved: { readonly layout: { readonly measurement: { readonly contentHeight: number } } };
  };
};
const runtime = await createParagraphContractRuntime();
const [amiri, inter] = await Promise.all([
  runtime.loadFont(new URL('../fixtures/rendering/amiri-bitmap-16.font.glb', import.meta.url)),
  runtime.loadFont(new URL('../fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
]);

try {
  const bidiStyle = {
    fontSize: 40,
    lineHeight: 1.25,
    direction: 'auto',
    language: 'ar',
  } as const satisfies ParagraphStyle;
  const bidiConstraints = {
    width: { mode: 'exactly', size: 300 },
    wrap: 'word',
    align: 'start',
  } as const satisfies LegacyConstraints;
  const bidi: Record<string, unknown> = {};
  for (const [id, value] of [
    ['ltr', 'ABC مرحبا 123 DEF'],
    ['rtl', 'مرحبا ABC 123 عالم'],
  ] as const) {
    const paragraph = createContractText(amiri.font, value, bidiStyle);
    try {
      bidi[id] = {
        text: value,
        style: bidiStyle,
        constraints: bidiConstraints,
        layout: paragraphLayoutContract(paragraph.inspect(bidiConstraints)),
      };
    } finally {
      paragraph.dispose();
    }
  }

  const policyText = 'one two three four five six seven';
  const policyStyle = {
    fontSize: 32,
    lineHeight: 1.25,
    direction: 'ltr',
    language: 'en',
  } as const satisfies ParagraphStyle;
  const policyInputs = {
    start: { width: { mode: 'exactly', size: 180 }, align: 'start' },
    center: { width: { mode: 'exactly', size: 180 }, align: 'center' },
    end: { width: { mode: 'exactly', size: 180 }, align: 'end' },
    justify: { width: { mode: 'exactly', size: 180 }, align: 'justify' },
    clip: { width: { mode: 'exactly', size: 180 }, height: { mode: 'exactly', size: 60 }, overflow: 'clip' },
    maxLines: { width: { mode: 'exactly', size: 180 }, maxLines: 2, overflow: 'clip' },
    ellipsisOne: { width: { mode: 'exactly', size: 180 }, maxLines: 1, overflow: 'ellipsis' },
    ellipsisHeightOne: {
      width: { mode: 'exactly', size: 180 },
      height: { mode: 'exactly', size: 40 },
      overflow: 'ellipsis',
    },
    ellipsisHeightTwo: {
      width: { mode: 'exactly', size: 180 },
      height: { mode: 'exactly', size: 80 },
      overflow: 'ellipsis',
    },
  } as const satisfies Record<string, LegacyConstraints>;
  const policyParagraph = createContractText(inter.font, policyText, policyStyle);
  const policyCases: Record<string, unknown> = {};
  try {
    for (const [id, constraints] of Object.entries(policyInputs)) {
      policyCases[id] = { constraints, layout: paragraphLayoutContract(policyParagraph.inspect(constraints), false) };
    }
  } finally {
    policyParagraph.dispose();
  }

  const uikitInput = {
    text: 'office AVATAR café — ffi, kerning, marks, and wrapping.',
    style: { fontSize: 31, lineHeight: 1.23, direction: 'ltr', language: 'en' },
  } as const satisfies { readonly text: string; readonly style: ParagraphStyle };
  const uikitPolicy = { wrap: 'word', overflow: 'clip' } as const satisfies LegacyConstraints;
  const uikitPolicyOnly = policyOnly(uikitPolicy);
  const uikitParagraph = await createParagraph({
    font: inter.font,
    text: uikitInput.text,
    style: uikitInput.style,
    policy: uikitPolicyOnly,
  });
  try {
    const uikitFixture = createUikitLayoutFixture(uikitParagraph, uikitPolicyOnly);
    const customLayouting = uikitFixture.customLayouting();
    const natural = customLayouting.measure(
      Number.NaN,
      YogaMeasureMode.Undefined,
      Number.NaN,
      YogaMeasureMode.Undefined,
    );
    const atMost = customLayouting.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost);
    const exactWidth = customLayouting.measure(420.001, YogaMeasureMode.Exactly, Number.NaN, YogaMeasureMode.Undefined);
    const expectedExactHeight =
      Math.ceil(Math.fround(retainedUikit.uikit.resolved.layout.measurement.contentHeight) * 100) / 100;
    if (exactWidth.height !== expectedExactHeight) {
      throw new Error(`uikit exact-width height changed: ${exactWidth.height} !== ${expectedExactHeight}`);
    }
    const retainedExactWidth = { ...exactWidth, height: retainedUikit.uikit.measurements.exactWidth.height };
    const definite = uikitFixture.resolveYogaLeaf(401.237, YogaMeasureMode.Exactly, 150.111, YogaMeasureMode.Exactly);
    const resolved = uikitFixture.layoutResolvedBox([401.24, 150.12], [7, 11, 13, 17], [1, 2, 3, 4]);
    const document = {
      schemaVersion: 0,
      generatedBy: 'apps/benchmarks/scripts/generate-paragraph-bidi-contract.mts',
      fonts: {
        amiri: {
          fixture: 'amiri-regular-v0',
          sourceSha256: 'ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7',
          shapingHash: amiri.shapingHash,
          sourceOracle: '../shaping/amiri-regular/harfrust.json',
          independentOracle: '../shaping/amiri-regular/harfbuzz.json',
        },
        inter: {
          fixture: 'inter-regular-v0',
          sourceSha256: '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82',
          shapingHash: inter.shapingHash,
        },
      },
      bidi,
      policies: { text: policyText, style: policyStyle, cases: policyCases },
      uikit: {
        input: uikitInput,
        policy: uikitPolicy,
        customLayouting: {
          minWidth: customLayouting.minWidth,
          minHeight: customLayouting.minHeight,
          firstBaseline: customLayouting.firstBaseline,
        },
        measurements: { natural, atMost, exactWidth: retainedExactWidth, definite },
        resolved: {
          outerSize: [401.24, 150.12],
          padding: [7, 11, 13, 17],
          border: [1, 2, 3, 4],
          contentBox: resolved.contentBox,
          centeredX: [...resolved.centeredX],
          centeredY: [...resolved.centeredY],
          layout: paragraphLayoutContract(resolved.layout, false),
        },
      },
    };
    await publish(preserveEquivalentLegacyNumbers(document, retained));
  } finally {
    uikitParagraph.dispose();
  }
} finally {
  amiri.dispose();
  inter.dispose();
  runtime.dispose();
}

async function publish(document: unknown): Promise<void> {
  if (check) {
    const expected = JSON.stringify(retained);
    const actual = JSON.stringify(document);
    if (expected !== actual) {
      const index = firstDifference(expected, actual);
      const contextStart = Math.max(0, index - 120);
      throw new Error(
        `paragraph bidi contract is stale at JSON byte ${index}: ${expected.slice(contextStart, index + 80)} !== ${actual.slice(contextStart, index + 80)}`,
      );
    }
    return;
  }
  await writeFile(output, `${JSON.stringify(document, undefined, 2)}\n`);
}

function firstDifference(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return index;
  return length;
}

/* @workflow
{
  "name": "fixture:paragraph-bidi:generate",
  "summary": "Regenerate the public Rust paragraph bidi contract fixture.",
  "requirements": "Built runtime packages and authenticated checked-in fonts.",
  "writes": "Checked-in paragraph bidi contract."
}
*/
/* @workflow
{
  "name": "fixture:paragraph-bidi:check",
  "summary": "Verify the public Rust paragraph bidi contract fixture by deterministic regeneration.",
  "requirements": "Built runtime packages and authenticated checked-in fonts.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
