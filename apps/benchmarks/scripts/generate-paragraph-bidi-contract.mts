import { readFile, writeFile } from 'node:fs/promises'

import {
  createParagraphEngine,
  createRuntimeShaper,
  FontRegistry,
  type ParagraphConstraints,
  type ParagraphLayout,
  type ParagraphStyle,
} from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'

import { createUikitLayoutFixture, YogaMeasureMode } from '../src/benchmark/uikit-layout-fixture.ts'

const root = new URL('../', import.meta.url)
const output = new URL('../fixtures/contracts/paragraph-bidi-layout-v0.json', import.meta.url)
const cliArguments = process.argv.slice(2)
if (cliArguments.some((argument) => argument !== '--check') || cliArguments.length > 1) {
  throw new Error('usage: generate-paragraph-bidi-contract.mts [--check]')
}
const check = cliArguments[0] === '--check'
const [bakerWasm, shaperWasm] = await Promise.all([
  readFile(new URL('../../packages/font-baker/dist/font_baker.wasm', root)),
  readFile(new URL('../../packages/text/dist/text_shaper.wasm', root)),
])

async function runtime(sourceUrl: URL) {
  const source = await readFile(sourceUrl)
  const baker = await createFontBaker(bakerWasm)
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0]
  if (artifact === undefined) throw new Error('font baker returned no contract artifact')
  const registry = new FontRegistry()
  const font = await registry.registerAsset(artifact.bytes)
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
  return { font, shaper }
}

function measurement(layout: ParagraphLayout) {
  return {
    width: layout.width,
    height: layout.height,
    contentWidth: layout.contentWidth,
    contentHeight: layout.contentHeight,
    firstBaseline: layout.firstBaseline,
    lastBaseline: layout.lastBaseline,
    overflowed: layout.overflowed,
  }
}

function values(layout: ParagraphLayout, full: boolean) {
  const document: Record<string, unknown> = {
    measurement: measurement(layout),
    hash: hashLayout(layout),
  }
  const fields = full
    ? ([
        'glyphFontSlots',
        'glyphIds',
        'clusters',
        'glyphFontSizes',
        'x',
        'y',
        'glyphFlags',
        'lineTextStarts',
        'lineTextEnds',
        'lineGlyphStarts',
        'lineGlyphCounts',
        'lineBaselines',
        'lineAdvances',
      ] as const)
    : ([
        'glyphIds',
        'clusters',
        'x',
        'lineTextStarts',
        'lineTextEnds',
        'lineGlyphStarts',
        'lineGlyphCounts',
        'lineBaselines',
        'lineAdvances',
      ] as const)
  for (const field of fields) document[field] = [...layout[field]]
  return document
}

function hashLayout(layout: ParagraphLayout): string {
  let hash = 2_166_136_261
  for (const field of [
    layout.glyphFontSlots,
    layout.glyphIds,
    layout.clusters,
    layout.glyphFontSizes,
    layout.x,
    layout.y,
    layout.glyphFlags,
    layout.lineTextStarts,
    layout.lineTextEnds,
    layout.lineGlyphStarts,
    layout.lineGlyphCounts,
    layout.lineBaselines,
    layout.lineAdvances,
  ]) {
    hash = Math.imul(hash ^ field.length, 16_777_619)
    const bytes = new Uint8Array(field.buffer, field.byteOffset, field.byteLength)
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const amiri = await runtime(
  new URL('../fixtures/fonts/amiri-1.002/Amiri-Regular.ttf', import.meta.url),
)
const amiriEngine = createParagraphEngine({ shaper: amiri.shaper })
const bidiStyle = {
  fontSize: 40,
  lineHeight: 1.25,
  direction: 'auto',
  language: 'ar',
} as const satisfies ParagraphStyle
const bidiConstraints = {
  width: { mode: 'exactly', size: 300 },
  wrap: 'word',
  align: 'start',
} as const satisfies ParagraphConstraints
const bidi: Record<string, unknown> = {}
for (const [id, text] of [
  ['ltr', 'ABC مرحبا 123 DEF'],
  ['rtl', 'مرحبا ABC 123 عالم'],
] as const) {
  const paragraph = amiriEngine.create({ text, font: amiri.font.handle, style: bidiStyle })
  bidi[id] = {
    text,
    style: bidiStyle,
    constraints: bidiConstraints,
    layout: values(paragraph.layout(bidiConstraints), true),
  }
}

const inter = await runtime(
  new URL('../fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url),
)
const policyEngine = createParagraphEngine({ shaper: inter.shaper })
const policyText = 'one two three four five six seven'
const policyStyle = {
  fontSize: 32,
  lineHeight: 1.25,
  direction: 'ltr',
  language: 'en',
} as const satisfies ParagraphStyle
const paragraph = policyEngine.create({
  text: policyText,
  font: inter.font.handle,
  style: policyStyle,
})
const policyInputs = {
  start: { width: { mode: 'exactly', size: 180 }, align: 'start' },
  center: { width: { mode: 'exactly', size: 180 }, align: 'center' },
  end: { width: { mode: 'exactly', size: 180 }, align: 'end' },
  justify: { width: { mode: 'exactly', size: 180 }, align: 'justify' },
  clip: {
    width: { mode: 'exactly', size: 180 },
    height: { mode: 'exactly', size: 60 },
    overflow: 'clip',
  },
  maxLines: { width: { mode: 'exactly', size: 180 }, maxLines: 2, overflow: 'clip' },
  ellipsisOne: {
    width: { mode: 'exactly', size: 180 },
    maxLines: 1,
    overflow: 'ellipsis',
  },
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
} as const satisfies Record<string, ParagraphConstraints>
const policyCases: Record<string, unknown> = {}
for (const [id, constraints] of Object.entries(policyInputs)) {
  policyCases[id] = { constraints, layout: values(paragraph.layout(constraints), false) }
}

const uikitInput = {
  text: 'office AVATAR café — ffi, kerning, marks, and wrapping.',
  font: inter.font.handle,
  style: { fontSize: 31, lineHeight: 1.23, direction: 'ltr', language: 'en' },
} as const
const uikitPolicy = { wrap: 'word', overflow: 'clip' } as const
const uikitParagraph = policyEngine.create(uikitInput)
const uikitFixture = createUikitLayoutFixture(uikitParagraph, uikitPolicy)
const customLayouting = uikitFixture.customLayouting()
const uikitNatural = customLayouting.measure(
  Number.NaN,
  YogaMeasureMode.Undefined,
  Number.NaN,
  YogaMeasureMode.Undefined,
)
const uikitAtMost = customLayouting.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost)
const uikitExactWidth = customLayouting.measure(
  420.001,
  YogaMeasureMode.Exactly,
  Number.NaN,
  YogaMeasureMode.Undefined,
)
const uikitDefinite = uikitFixture.resolveYogaLeaf(
  401.237,
  YogaMeasureMode.Exactly,
  150.111,
  YogaMeasureMode.Exactly,
)
const uikitResolved = uikitFixture.layoutResolvedBox(
  [401.24, 150.12],
  [7, 11, 13, 17],
  [1, 2, 3, 4],
)

const document = {
  schemaVersion: 0,
  generatedBy: 'apps/benchmarks/scripts/generate-paragraph-bidi-contract.mts',
  fonts: {
    amiri: {
      fixture: 'amiri-regular-v0',
      sourceSha256: 'ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7',
      shapingHash: '2e29d8d1378084212287efa84db35066310164048a6b4495aff97512d46336d5',
      sourceOracle: '../shaping/amiri-regular/harfrust.json',
      independentOracle: '../shaping/amiri-regular/harfbuzz.json',
    },
    inter: {
      fixture: 'inter-regular-v0',
      sourceSha256: '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82',
      shapingHash: '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09',
    },
  },
  bidi,
  policies: { text: policyText, style: policyStyle, cases: policyCases },
  uikit: {
    input: { text: uikitInput.text, style: uikitInput.style },
    policy: uikitPolicy,
    customLayouting: {
      minWidth: customLayouting.minWidth,
      minHeight: customLayouting.minHeight,
      firstBaseline: customLayouting.firstBaseline,
    },
    measurements: {
      natural: uikitNatural,
      atMost: uikitAtMost,
      exactWidth: uikitExactWidth,
      definite: uikitDefinite,
    },
    resolved: {
      outerSize: [401.24, 150.12],
      padding: [7, 11, 13, 17],
      border: [1, 2, 3, 4],
      contentBox: uikitResolved.contentBox,
      centeredX: [...uikitResolved.centeredX],
      centeredY: [...uikitResolved.centeredY],
      layout: values(uikitResolved.layout, false),
    },
  },
}
if (check) {
  const checkedIn = JSON.parse(await readFile(output, 'utf8')) as unknown
  if (JSON.stringify(checkedIn) !== JSON.stringify(document)) {
    throw new Error(
      'paragraph bidi contract is stale; run pnpm generate:paragraph-bidi-contract and review the exact diff',
    )
  }
} else {
  await writeFile(output, `${JSON.stringify(document, undefined, 2)}\n`)
}
