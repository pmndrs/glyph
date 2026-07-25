import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createParagraphEngine,
  createRuntimeShaper,
  FontRegistry,
} from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'

const fontDirectory = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/',
  import.meta.url,
)
const shapingDirectory = new URL(
  '../../../../apps/benchmarks/fixtures/shaping/inter-regular/',
  import.meta.url,
)

test('measures the exact GLB-extracted HarfRust paragraph without positioned arrays', async () => {
  const [{ font, shaper }, oracle] = await Promise.all([
    runtime(),
    readJson(new URL('harfrust.json', shapingDirectory)),
  ])
  const calls = { shape: 0, reshape: 0 }
  const observedShaper = observeShaper(shaper, calls)
  const engine = createParagraphEngine({ shaper: observedShaper })
  const expected = oracle.cases.find(({ id }) => id === 'paragraph')
  assert.ok(expected)
  const paragraph = engine.create({
    text: expected.text,
    font: font.handle,
    style: {
      fontSize: 32,
      lineHeight: 1.3,
      language: 'en',
      direction: 'ltr',
      features: [],
    },
  })

  assert.equal(calls.shape, 1, 'preparation must shape the paragraph once')
  assert.equal(calls.reshape, 0)
  const interfering = engine.create({ text: 'AV', font: font.handle })
  assert.equal(calls.shape, 2, 'each prepared paragraph performs one broad shape')
  const expectedNaturalWidth =
    expected.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * 32 / font.metrics.unitsPerEm
  const natural = paragraph.measure()
  assert.equal(natural.width, expectedNaturalWidth)
  assert.deepEqual(natural, {
    width: 847.625,
    height: 41.599999999999994,
    contentWidth: 847.625,
    contentHeight: 41.599999999999994,
    firstBaseline: 32.440625,
    lastBaseline: 32.440625,
    overflowed: false,
  })
  assert.equal('glyphIds' in natural, false)

  const wideConstraints = { width: { mode: 'at-most', size: 720 } }
  const wide = paragraph.measure(wideConstraints)
  assert.deepEqual(wide, {
    width: 696.734375,
    height: 83.19999999999999,
    contentWidth: 696.734375,
    contentHeight: 83.19999999999999,
    firstBaseline: 32.440625,
    lastBaseline: 74.04062499999999,
    overflowed: false,
  })
  assert.equal(paragraph.measure(wideConstraints), wide, 'equivalent measurements reuse one object')
  assert.deepEqual(paragraph.measure({ width: { mode: 'at-most', size: 360 } }), {
    width: 356.546875,
    height: 124.79999999999998,
    contentWidth: 356.546875,
    contentHeight: 124.79999999999998,
    firstBaseline: 32.440625,
    lastBaseline: 115.64062499999999,
    overflowed: false,
  })
  assert.deepEqual(calls, { shape: 2, reshape: 0 }, 'width-only reflow must not enter Wasm')

  interfering.dispose()
  paragraph.dispose()
  assert.throws(() => paragraph.measure(), /disposed/)
  shaper.dispose()
  font.dispose()
})

test('resolves features and updates as one new broad-shape revision', async () => {
  const { font, shaper } = await runtime()
  const calls = { shape: 0, reshape: 0 }
  const paragraph = createParagraphEngine({ shaper: observeShaper(shaper, calls) }).create({
    text: 'AVATAR',
    font: font.handle,
    style: { fontSize: 32, direction: 'ltr', language: 'en' },
  })
  assert.equal(paragraph.measure().width, 119.75)
  assert.deepEqual(calls, { shape: 1, reshape: 0 })

  paragraph.update({
    text: 'AVATAR',
    font: font.handle,
    style: {
      fontSize: 32,
      direction: 'ltr',
      language: 'en',
      features: [{ tag: 'kern', value: 0 }],
    },
  })
  assert.equal(paragraph.measure().width, 129.5625)
  assert.deepEqual(calls, { shape: 2, reshape: 0 })
  shaper.dispose()
  font.dispose()
})

test('validates spans, constraints, empty text, and lifecycle deterministically', async () => {
  const { font, shaper } = await runtime()
  const engine = createParagraphEngine({ shaper })
  const empty = engine.create({ text: '', font: font.handle })
  assert.deepEqual(empty.measure(), {
    width: 0,
    height: 0,
    contentWidth: 0,
    contentHeight: 0,
    firstBaseline: 0,
    lastBaseline: 0,
    overflowed: false,
  })
  assert.deepEqual(empty.measure({
    width: { mode: 'exactly', size: 20 },
    height: { mode: 'exactly', size: 10 },
  }), {
    width: 20,
    height: 10,
    contentWidth: 0,
    contentHeight: 0,
    firstBaseline: 0,
    lastBaseline: 0,
    overflowed: false,
  })
  assert.throws(
    () => engine.create({ text: 'e\u0301', font: font.handle, spans: [{ start: 1, end: 2 }] }),
    /extended-grapheme boundaries/,
  )
  assert.throws(() => empty.measure({ width: { mode: 'at-most', size: Number.NaN } }), /finite/)
  assert.throws(() => empty.measure({ maxLines: 0 }), /positive safe integer/)
  assert.throws(() => empty.layout(), /roadmap item 5.2/)
  const singleLine = engine.create({ text: 'a', font: font.handle }).measure()
  const trailingBreak = engine.create({ text: 'a\n', font: font.handle }).measure()
  assert.equal(trailingBreak.contentHeight, singleLine.contentHeight * 2)
  assert.equal(trailingBreak.lastBaseline, singleLine.lastBaseline + singleLine.contentHeight)
  shaper.dispose()
  font.dispose()
})

async function runtime() {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL('Inter-Regular.ttf', fontDirectory)),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
    readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  ])
  const baker = await createFontBaker(bakerWasm)
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes
  const registry = new FontRegistry()
  const font = await registry.registerAsset(artifact)
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
  return { font, shaper }
}

function observeShaper(shaper, calls) {
  return {
    registry: shaper.registry,
    registerFont: (font) => shaper.registerFont(font),
    disposeFont: (font) => shaper.disposeFont(font),
    shapeBatch: (request) => {
      calls.shape += 1
      return shaper.shapeBatch(request)
    },
    reshapeRanges: (request) => {
      calls.reshape += 1
      return shaper.reshapeRanges(request)
    },
    memoryReport: () => shaper.memoryReport(),
    dispose: () => shaper.dispose(),
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}
