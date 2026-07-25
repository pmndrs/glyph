import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createParagraphEngine, createRuntimeShaper, FontRegistry } from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'

const contractUrl = new URL(
  '../../../../apps/benchmarks/fixtures/contracts/paragraph-bidi-layout-v0.json',
  import.meta.url,
)
const contract = JSON.parse(await readFile(contractUrl, 'utf8'))

test('lays out exact mixed-direction Amiri goldens through retained GLB shaping data', async () => {
  const { font, shaper } = await runtime('amiri-1.002/Amiri-Regular.ttf')
  const calls = { shape: 0, reshape: 0 }
  const requests = []
  const observed = observeShaper(shaper, calls, requests)
  const engine = createParagraphEngine({ shaper: observed })
  let retainedLayout

  assert.equal(
    contract.generatedBy,
    'apps/benchmarks/scripts/generate-paragraph-bidi-contract.mts',
  )
  assert.equal(font.shapingHash, contract.fonts.amiri.shapingHash)
  for (const fixture of Object.values(contract.bidi)) {
    const paragraph = engine.create({
      text: fixture.text,
      font: font.handle,
      style: fixture.style,
    })
    const layout = paragraph.layout(fixture.constraints)
    assertGoldenLayout(layout, fixture.layout, true)
    if (retainedLayout === undefined) retainedLayout = layout
  }

  assert.deepEqual(calls, { shape: 2, reshape: 0 })
  assert.deepEqual(
    requests.filter(({ shape }) => shape !== undefined).map(({ shape }) => shape.runs.slice(0, shape.runs.length / 2).map((run) => ({
      text: String.fromCharCode(...shape.textUtf16.slice(run.textStart, run.textEnd)),
      direction: run.direction,
      script: run.script,
    }))),
    [
      [
        { text: 'ABC ', direction: 'ltr', script: 'Latn' },
        { text: 'مرحبا ', direction: 'rtl', script: 'Arab' },
        { text: '123', direction: 'ltr', script: 'Arab' },
        { text: ' ', direction: 'ltr', script: 'Arab' },
        { text: 'DEF', direction: 'ltr', script: 'Latn' },
      ],
      [
        { text: 'مرحبا ', direction: 'rtl', script: 'Arab' },
        { text: 'ABC 123', direction: 'ltr', script: 'Latn' },
        { text: ' ', direction: 'rtl', script: 'Latn' },
        { text: 'عالم', direction: 'rtl', script: 'Arab' },
      ],
    ],
  )
  assert.equal(
    hashLayout(retainedLayout),
    contract.bidi.ltr.layout.hash,
    'later borrowed Wasm results must not mutate an earlier paragraph layout',
  )
  shaper.dispose()
  font.dispose()
})

test('applies exact alignment, clipping, max-lines, and ellipsis policies without hidden calls', async () => {
  const { font, shaper } = await runtime('inter-v4.1/Inter-Regular.ttf')
  const calls = { shape: 0, reshape: 0 }
  const requests = []
  const observed = observeShaper(shaper, calls, requests)
  const paragraph = createParagraphEngine({ shaper: observed }).create({
    text: contract.policies.text,
    font: font.handle,
    style: contract.policies.style,
  })
  assert.equal(calls.shape, 1, 'text and every per-run ellipsis are prepared in one batch')

  const expectedCrossings = {
    start: 1,
    center: 1,
    end: 1,
    justify: 1,
    clip: 1,
    maxLines: 2,
    ellipsisOne: 3,
    ellipsisHeightOne: 3,
    ellipsisHeightTwo: 4,
  }
  const layouts = {}
  for (const [id, fixture] of Object.entries(contract.policies.cases)) {
    const measured = paragraph.measure(fixture.constraints)
    assert.deepEqual(measured, fixture.layout.measurement)
    const layout = paragraph.layout(fixture.constraints)
    layouts[id] = layout
    assertGoldenLayout(layout, fixture.layout, false)
    assert.equal(calls.reshape, expectedCrossings[id], `${id} reshape boundary count`)
  }

  assert.equal(layouts.clip.glyphIds.length, layouts.start.glyphIds.length)
  assert.equal(layouts.clip.height, 60)
  assert.equal(layouts.clip.overflowed, true)
  assert.deepEqual([...layouts.maxLines.lineTextEnds], [8, 19])
  assert.equal(layouts.maxLines.contentHeight, 160)
  assert.equal(layouts.ellipsisOne.glyphIds.at(-1), 1503)
  assert.equal(layouts.ellipsisOne.clusters.at(-1), 8)
  assert.equal(layouts.ellipsisHeightOne.glyphIds, layouts.ellipsisOne.glyphIds)
  assert.notEqual(layouts.ellipsisHeightTwo.glyphIds, layouts.ellipsisHeightOne.glyphIds)
  assert.deepEqual(
    requests.filter(({ ranges }) => ranges !== undefined).map(({ ranges }) => ranges.length),
    [4, 2, 1, 2],
  )

  shaper.dispose()
  font.dispose()
})

async function runtime(relativeFontPath) {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL(`../../../../apps/benchmarks/fixtures/fonts/${relativeFontPath}`, import.meta.url)),
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

function observeShaper(shaper, calls, requests) {
  return {
    registry: shaper.registry,
    registerFont: (font) => shaper.registerFont(font),
    disposeFont: (font) => shaper.disposeFont(font),
    analyzeBidi: (text, direction) => shaper.analyzeBidi(text, direction),
    shapeBatch: (shape) => {
      calls.shape += 1
      requests.push({ shape })
      return shaper.shapeBatch(shape)
    },
    reshapeRanges: (request) => {
      calls.reshape += 1
      requests.push({ ranges: request.ranges.map((range) => ({ ...range })) })
      return shaper.reshapeRanges(request)
    },
    memoryReport: () => shaper.memoryReport(),
    dispose: () => shaper.dispose(),
  }
}

function assertGoldenLayout(layout, golden, full) {
  assert.deepEqual({
    width: layout.width,
    height: layout.height,
    contentWidth: layout.contentWidth,
    contentHeight: layout.contentHeight,
    firstBaseline: layout.firstBaseline,
    lastBaseline: layout.lastBaseline,
    overflowed: layout.overflowed,
  }, golden.measurement)
  const fields = full
    ? [
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
      ]
    : [
        'glyphIds',
        'clusters',
        'x',
        'lineTextStarts',
        'lineTextEnds',
        'lineGlyphStarts',
        'lineGlyphCounts',
        'lineBaselines',
        'lineAdvances',
      ]
  for (const field of fields) assert.deepEqual([...layout[field]], golden[field], field)
  assert.equal(hashLayout(layout), golden.hash)
}

function hashLayout(layout) {
  let hash = 2_166_136_261
  for (const values of [
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
    hash = Math.imul(hash ^ values.length, 16_777_619)
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    for (const value of bytes) hash = Math.imul(hash ^ value, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
