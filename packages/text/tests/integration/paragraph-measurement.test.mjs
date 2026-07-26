import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createParagraphEngine,
  createRuntimeShaper,
  FontRegistry,
} from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'
import { hashParagraphLayout } from '../../../../apps/benchmarks/src/benchmark/paragraph-layout-digest.ts'

const fontDirectory = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/',
  import.meta.url,
)
const shapingDirectory = new URL(
  '../../../../apps/benchmarks/fixtures/shaping/inter-regular/',
  import.meta.url,
)
const paragraphContract = new URL(
  '../../../../apps/benchmarks/fixtures/contracts/paragraph-layout-v0.json',
  import.meta.url,
)

test('measures the exact GLB-extracted HarfRust paragraph without positioned arrays', async () => {
  const [{ font, shaper }, oracle, contract] = await Promise.all([
    runtime(),
    readJson(new URL('harfrust.json', shapingDirectory)),
    readJson(paragraphContract),
  ])
  const calls = { shape: 0, reshape: 0 }
  const reshapeRequests = []
  const observedShaper = observeShaper(shaper, calls, reshapeRequests)
  const engine = createParagraphEngine({ shaper: observedShaper })
  const expected = oracle.cases.find(({ id }) => id === 'paragraph')
  const layoutGoldens = contract.goldens
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
  assert.deepEqual(natural, layoutGoldens.natural.measurement)
  assert.equal('glyphIds' in natural, false)

  const wideConstraints = { width: { mode: 'at-most', size: 720 } }
  const wide = paragraph.measure(wideConstraints)
  assert.deepEqual(wide, layoutGoldens.wide.measurement)
  assert.equal(paragraph.measure(wideConstraints), wide, 'equivalent measurements reuse one object')
  assert.deepEqual(
    paragraph.measure({ width: { mode: 'at-most', size: 360 } }),
    layoutGoldens.narrow.measurement,
  )
  assert.deepEqual(calls, { shape: 2, reshape: 0 }, 'width-only reflow must not enter Wasm')

  const naturalLayout = paragraph.layout()
  assert.deepEqual(calls, { shape: 2, reshape: 0 }, 'unbroken layout reuses the broad shape')
  assert.deepEqual([...naturalLayout.glyphIds], expected.glyphs.map(({ glyphId }) => glyphId))
  assert.deepEqual([...naturalLayout.clusters], expected.glyphs.map(({ cluster }) => cluster))
  assert.deepEqual([...naturalLayout.glyphFlags], expected.glyphs.map(({ flags }) => flags))
  assert.deepEqual([...naturalLayout.x], expectedNaturalX(expected.glyphs, 32 / font.metrics.unitsPerEm))
  assert.deepEqual(
    [...naturalLayout.y],
    expected.glyphs.map(({ yOffset }) => Math.fround(naturalLayout.firstBaseline - yOffset * 32 / font.metrics.unitsPerEm)),
  )
  assertLayoutLines(naturalLayout, layoutGoldens.natural.layout)
  assert.equal(hashParagraphLayout(naturalLayout), layoutGoldens.natural.layout.hash)

  const wideLayout = paragraph.layout(wideConstraints)
  assert.deepEqual(calls, { shape: 2, reshape: 1 }, 'all wide boundaries reshape in one batch')
  assert.equal(paragraph.layout(wideConstraints), wideLayout, 'equivalent layout reuses one object')
  assertLayoutLines(wideLayout, layoutGoldens.wide.layout)
  assert.deepEqual([...wideLayout.glyphIds], expected.glyphs.map(({ glyphId }) => glyphId))
  assert.deepEqual([...wideLayout.clusters], expected.glyphs.map(({ cluster }) => cluster))
  assert.deepEqual([...wideLayout.glyphFlags], expected.glyphs.map(({ flags }) => flags))
  assert.equal(hashParagraphLayout(wideLayout), layoutGoldens.wide.layout.hash)

  const narrowConstraints = { width: { mode: 'at-most', size: 360 } }
  const narrowLayout = paragraph.layout(narrowConstraints)
  assert.deepEqual(calls, { shape: 2, reshape: 2 }, 'all narrow boundaries reshape in one batch')
  assert.deepEqual(reshapeRequests.map(({ ranges }) => ranges.length), [2, 3])
  assert.deepEqual(reshapeRequests[0].ranges, [
    { run: 0, itemStart: 0, itemEnd: 47, contextStart: 0, contextEnd: 56, flags: 0x43 },
    { run: 0, itemStart: 47, itemEnd: 56, contextStart: 0, contextEnd: 56, flags: 0x43 },
  ])
  assert.deepEqual(reshapeRequests[1].ranges, [
    { run: 0, itemStart: 0, itemEnd: 22, contextStart: 0, contextEnd: 56, flags: 0x43 },
    { run: 0, itemStart: 22, itemEnd: 47, contextStart: 0, contextEnd: 56, flags: 0x43 },
    { run: 0, itemStart: 47, itemEnd: 56, contextStart: 0, contextEnd: 56, flags: 0x43 },
  ])
  assertLayoutLines(narrowLayout, layoutGoldens.narrow.layout)
  assert.equal(hashParagraphLayout(narrowLayout), layoutGoldens.narrow.layout.hash)
  const exactHeight = paragraph.layout({
    ...narrowConstraints,
    height: { mode: 'exactly', size: 200 },
  })
  assert.deepEqual(calls, { shape: 2, reshape: 2 }, 'height-only layout reuses positioned lines')
  assert.equal(exactHeight.height, 200)
  assert.equal(exactHeight.glyphIds, narrowLayout.glyphIds)
  const postLayoutInterfering = engine.create({ text: 'ffi', font: font.handle })
  assert.equal(
    hashParagraphLayout(narrowLayout),
    layoutGoldens.narrow.layout.hash,
    'positioned arrays own their Wasm results',
  )

  postLayoutInterfering.dispose()
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
  const defaultLayout = paragraph.layout()

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
  const unkernedLayout = paragraph.layout()
  assert.notEqual(unkernedLayout, defaultLayout)
  assert.notDeepEqual([...unkernedLayout.x], [...defaultLayout.x])
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
  assert.throws(() => empty.measure({ width: { mode: 'invalid', size: 10 } }), /width mode/)
  assert.throws(() => empty.measure({ maxLines: 0 }), /positive safe integer/)
  assert.throws(() => empty.measure({ wrap: 'invalid' }), /wrap must/)
  assert.throws(() => empty.measure({ align: 'invalid' }), /align must/)
  assert.throws(() => empty.measure({ overflow: 'invalid' }), /overflow must/)
  assert.throws(() => engine.create(null), /paragraph input must be an object/)
  assert.throws(
    () => engine.create({ text: 'a', font: font.handle, style: null }),
    /paragraph style must be an object/,
  )
  assert.throws(
    () => engine.create({ text: 'a', font: font.handle, spans: null }),
    /paragraph spans must be an array/,
  )
  assert.throws(
    () => engine.create({ text: 'a', font: font.handle, spans: [null] }),
    /paragraph span must be an object/,
  )
  assert.throws(
    () => engine.create({ text: 'a', font: font.handle, style: { features: null } }),
    /paragraph style features must be an array/,
  )
  assert.throws(() => empty.measure(null), /paragraph constraints must be an object/)
  assert.throws(() => empty.layout([]), /paragraph constraints must be an object/)
  assert.throws(() => empty.measure({ width: null }), /width constraint must be an object/)
  assert.throws(
    () => engine.create({ text: 'a', font: font.handle, style: { language: null } }),
    /language must be a string/,
  )
  const emptyLayout = empty.layout()
  assert.deepEqual(emptyLayout, {
    width: 0,
    height: 0,
    contentWidth: 0,
    contentHeight: 0,
    firstBaseline: 0,
    lastBaseline: 0,
    overflowed: false,
    fontHandles: new Uint32Array(),
    glyphFontSlots: new Uint16Array(),
    glyphIds: new Uint16Array(),
    clusters: new Uint32Array(),
    glyphFontSizes: new Float32Array(),
    x: new Float32Array(),
    y: new Float32Array(),
    glyphFlags: new Uint16Array(),
    lineTextStarts: new Uint32Array(),
    lineTextEnds: new Uint32Array(),
    lineGlyphStarts: new Uint32Array(),
    lineGlyphCounts: new Uint32Array(),
    lineBaselines: new Float32Array(),
    lineAdvances: new Float32Array(),
  })
  const singleLine = engine.create({ text: 'a', font: font.handle }).measure()
  const trailingBreak = engine.create({ text: 'a\n', font: font.handle }).measure()
  assert.equal(trailingBreak.contentHeight, singleLine.contentHeight * 2)
  assert.equal(trailingBreak.lastBaseline, singleLine.lastBaseline + singleLine.contentHeight)
  const hardBreakEllipsis = engine.create({ text: 'a\nb', font: font.handle }).layout({
    maxLines: 1,
    overflow: 'ellipsis',
  })
  assert.deepEqual([...hardBreakEllipsis.lineTextEnds], [1])
  assert.equal(hardBreakEllipsis.clusters.at(-1), 1)
  assert.ok([...hardBreakEllipsis.clusters].every((cluster) => cluster <= 1))
  shaper.dispose()
  font.dispose()
})

test('sweeps nested spans without repeatedly resolving active styles', async () => {
  const { font, shaper } = await runtime()
  let registrations = 0
  const observed = {
    registry: shaper.registry,
    registerFont: (registered) => {
      registrations += 1
      return shaper.registerFont(registered)
    },
    disposeFont: (registered) => shaper.disposeFont(registered),
    analyzeBidi: (text, direction) => shaper.analyzeBidi(text, direction),
    shapeBatch: (request) => shaper.shapeBatch(request),
    reshapeRanges: (request) => shaper.reshapeRanges(request),
    memoryReport: () => shaper.memoryReport(),
    dispose: () => shaper.dispose(),
  }
  const text = 'a'.repeat(320)
  const spans = Array.from({ length: 128 }, (_, index) => ({
    start: index,
    end: text.length - index,
  }))
  const engine = createParagraphEngine({ shaper: observed })
  const nested = engine.create({ text, font: font.handle, spans })
  assert.equal(registrations, 1, 'the root style is registered once, not once per active span')
  const plain = engine.create({ text, font: font.handle })
  assert.deepEqual(nested.measure(), plain.measure())
  assert.deepEqual(nested.layout(), plain.layout())
  nested.dispose()
  plain.dispose()
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

function observeShaper(shaper, calls, reshapeRequests = []) {
  return {
    registry: shaper.registry,
    registerFont: (font) => shaper.registerFont(font),
    disposeFont: (font) => shaper.disposeFont(font),
    analyzeBidi: (text, direction) => shaper.analyzeBidi(text, direction),
    shapeBatch: (request) => {
      calls.shape += 1
      return shaper.shapeBatch(request)
    },
    reshapeRanges: (request) => {
      calls.reshape += 1
      reshapeRequests.push({ ranges: request.ranges.map((range) => ({ ...range })) })
      return shaper.reshapeRanges(request)
    },
    memoryReport: () => shaper.memoryReport(),
    dispose: () => shaper.dispose(),
  }
}

function expectedNaturalX(glyphs, scale) {
  let cursor = 0
  return glyphs.map(({ xAdvance, xOffset }) => {
    const positioned = Math.fround(cursor + xOffset * scale)
    cursor += Math.abs(xAdvance) * scale
    return positioned
  })
}

function assertLayoutLines(layout, golden) {
  assert.equal(layout.glyphIds.length, golden.glyphCount)
  for (const key of [
    'lineTextStarts',
    'lineTextEnds',
    'lineGlyphStarts',
    'lineGlyphCounts',
    'lineBaselines',
    'lineAdvances',
  ]) {
    assert.deepEqual([...layout[key]], golden[key])
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}
