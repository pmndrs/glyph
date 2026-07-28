import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createRuntimeShaper, FontRegistry } from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'
import { validateFontArtifact } from '@pmndrs/text-font-baker/validate'

const fixtureDirectory = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/',
  import.meta.url,
)
const shaperWasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url)
const shaperAbiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url)
const shapingDirectory = new URL(
  '../../../../apps/benchmarks/fixtures/shaping/inter-regular/',
  import.meta.url,
)

async function fixture() {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL('Inter-Regular.ttf', fixtureDirectory)),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
    readFile(shaperWasmUrl),
  ])
  const baker = await createFontBaker(bakerWasm)
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes
  return { artifact, shaperWasm }
}

test('ships a zero-import optimized shaper module whose published ABI is generated', async () => {
  const [wasm, published] = await Promise.all([
    readFile(shaperWasmUrl),
    readFile(shaperAbiUrl, 'utf8'),
  ])
  const module = await WebAssembly.compile(wasm)
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  assert.equal(
    WebAssembly.Module.exports(module).some(({ name }) => name.includes('abi_')),
    false,
  )
  const generated = await import('../../dist/generated/text-shaper-abi.js')
  assert.deepEqual(generated.textShaperAbi, JSON.parse(published))
  assert.deepEqual(generated.textShaperAbi.versions, {
    fontFormat: 0,
    harfrust: '0.12.0',
    harfrustCommit: '60b28ea22b5261710018d69c168a762bcb28794c',
    shaper: '0.0.0',
    unicode: '17.0.0',
  })
})

test('the shaper registers only the exact shaping views retained from the validated GLB', async () => {
  const { artifact, shaperWasm } = await fixture()
  const validated = await validateFontArtifact(artifact)
  const registry = new FontRegistry()
  const font = await registry.registerAsset(artifact)
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })

  const initial = shaper.memoryReport()
  assert.deepEqual(initial, {
    fontCount: 0,
    retainedFontBytes: 0,
    planCount: 0,
    wasmMemoryBytes: initial.wasmMemoryBytes,
  })
  shaper.registerFont(font)
  const expectedBytes =
    validated.shapingSfnt.byteLength +
    validated.glyphExtents.byteLength +
    validated.glyphExtentsAvailability.byteLength
  assert.equal(expectedBytes, 171_056)
  assert.equal(shaper.memoryReport().fontCount, 1)
  assert.equal(shaper.memoryReport().retainedFontBytes, expectedBytes)
  assert.equal(shaper.memoryReport().planCount, 0)

  shaper.registerFont(font)
  assert.equal(shaper.memoryReport().retainedFontBytes, expectedBytes)
  font.dispose()
  assert.equal(shaper.memoryReport().fontCount, 0)
  assert.equal(shaper.memoryReport().retainedFontBytes, 0)
  assert.throws(() => shaper.registerFont(font), /not active/)
  shaper.dispose()
  assert.throws(() => shaper.memoryReport(), /disposed/)
})

test('shaper ownership stays scoped to its FontRegistry', async () => {
  const { artifact, shaperWasm } = await fixture()
  const firstRegistry = new FontRegistry()
  const secondRegistry = new FontRegistry()
  const foreign = await firstRegistry.registerAsset(artifact)
  const shaper = await createRuntimeShaper({ registry: secondRegistry, wasm: shaperWasm })

  assert.throws(() => shaper.registerFont(foreign), /not active in this shaper's registry/)
  shaper.dispose()
  foreign.dispose()
})

test('re-registering the same artifact creates a new lifecycle without reviving stale handles', async () => {
  const { artifact, shaperWasm } = await fixture()
  const registry = new FontRegistry()
  const first = await registry.registerAsset(artifact)
  const firstHandle = first.handle
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
  const request = {
    textUtf16: utf16('A'),
    features: [],
    runs: [
      {
        font: firstHandle,
        textStart: 0,
        textEnd: 1,
        direction: 'ltr',
        script: 'Latn',
        language: 'en',
        clusterLevel: 0,
        flags: 0x40,
        featureStart: 0,
        featureCount: 0,
      },
    ],
  }
  const ranges = [{ run: 0, itemStart: 0, itemEnd: 1, contextStart: 0, contextEnd: 1, flags: 0x40 }]

  shaper.registerFont(first)
  assert.equal(shaper.shapeBatch(request).glyphIds.length, 1)
  first.dispose()
  assert.throws(() => shaper.shapeBatch(request), /font handle .* is not registered/)
  assert.throws(
    () => shaper.reshapeRanges({ ...request, ranges }),
    /font handle .* is not registered/,
  )

  const second = await registry.registerAsset(artifact)
  assert.notEqual(second.handle, firstHandle)
  assert.equal(second.shapingHash, first.shapingHash)
  shaper.registerFont(second)
  const secondRequest = {
    ...request,
    runs: [{ ...request.runs[0], font: second.handle }],
  }
  assert.equal(shaper.shapeBatch(secondRequest).glyphIds.length, 1)
  assert.throws(() => shaper.shapeBatch(request), /font handle .* is not registered/)

  second.dispose()
  shaper.dispose()
})

test('shapes every pinned HarfRust case exactly from GLB-extracted font data', async () => {
  const [{ artifact, shaperWasm }, corpus, oracle] = await Promise.all([
    fixture(),
    readJson(new URL('cases.json', shapingDirectory)),
    readJson(new URL('harfrust.json', shapingDirectory)),
  ])
  const registry = new FontRegistry()
  const font = await registry.registerAsset(artifact)
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
  shaper.registerFont(font)
  const corpusCases = new Map(corpus.cases.map((entry) => [entry.id, entry]))

  for (const expected of oracle.cases) {
    const fixtureCase = corpusCases.get(expected.id)
    assert.ok(fixtureCase, `missing corpus case ${expected.id}`)
    const request = shapeRequest(font.handle, expected, fixtureCase)
    assertShapedBatch(shaper.shapeBatch(request), font.handle, expected.glyphs)
    assertShapedBatch(
      shaper.reshapeRanges({
        ...request,
        ranges: [
          {
            run: 0,
            itemStart: 0,
            itemEnd: request.textUtf16.length,
            contextStart: 0,
            contextEnd: request.textUtf16.length,
            flags: 0x40,
          },
        ],
      }),
      font.handle,
      expected.glyphs,
    )
  }

  assert.equal(shaper.memoryReport().planCount, 3)
  const first = oracle.cases[0]
  const firstCase = corpusCases.get(first.id)
  shaper.shapeBatch(shapeRequest(font.handle, first, firstCase))
  assert.equal(shaper.memoryReport().planCount, 3, 'equivalent plans must be reused')
  font.dispose()
  assert.equal(shaper.memoryReport().planCount, 0, 'font disposal must release its plans')
  shaper.dispose()
})

test('rejects malformed batch fields before or at the Wasm trust boundary', async () => {
  const { artifact, shaperWasm } = await fixture()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(artifact)
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
  shaper.registerFont(font)
  const base = {
    textUtf16: utf16('A'),
    features: [],
    runs: [
      {
        font: font.handle,
        textStart: 0,
        textEnd: 1,
        direction: 'ltr',
        script: 'Latn',
        language: 'en',
        clusterLevel: 0,
        flags: 0x40,
        featureStart: 0,
        featureCount: 0,
      },
    ],
  }
  assert.throws(
    () => shaper.shapeBatch({ ...base, runs: [{ ...base.runs[0], script: 'Latin' }] }),
    /exactly four bytes/,
  )
  assert.throws(
    () => shaper.shapeBatch({ ...base, runs: [{ ...base.runs[0], flags: 0x100 }] }),
    /unknown bits/,
  )
  assert.throws(
    () =>
      shaper.reshapeRanges({
        ...base,
        ranges: [{ run: 0, itemStart: 0, itemEnd: 2, contextStart: 0, contextEnd: 2, flags: 0 }],
      }),
    /outside its run context/,
  )

  for (const language of ['zh-hans', 'zh-hant', 'ja', 'ko']) {
    assert.doesNotThrow(() => shaper.shapeBatch({ ...base, runs: [{ ...base.runs[0], language }] }))
  }
  assert.equal(
    shaper.memoryReport().planCount,
    4,
    'canonical CJK languages must remain distinct shape-plan inputs',
  )
  for (const language of ['en\0us', 'en\nus', 'en--us']) {
    assert.throws(
      () => shaper.shapeBatch({ ...base, runs: [{ ...base.runs[0], language }] }),
      /invalid batch request/,
    )
  }
  assert.throws(
    () => shaper.shapeBatch({ ...base, runs: [{ ...base.runs[0], language: '' }] }),
    /must encode to 1\.\.65535 UTF-8 bytes/,
  )
  assert.throws(
    () =>
      shaper.shapeBatch({
        ...base,
        runs: [{ ...base.runs[0], language: 'a'.repeat(0x1_0000) }],
      }),
    /must encode to 1\.\.65535 UTF-8 bytes/,
  )
  assert.equal(shaper.memoryReport().planCount, 4, 'invalid languages must not create plans')
  shaper.dispose()
  font.dispose()
})

test("bounds each font's least-recently-used shape plans", async () => {
  const { artifact, shaperWasm } = await fixture()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(artifact)
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
  shaper.registerFont(font)
  const base = {
    textUtf16: utf16('A'),
    features: [],
    runs: [
      {
        font: font.handle,
        textStart: 0,
        textEnd: 1,
        direction: 'ltr',
        script: 'Latn',
        clusterLevel: 0,
        flags: 0x40,
        featureStart: 0,
        featureCount: 0,
      },
    ],
  }

  for (let index = 0; index < 80; index += 1) {
    shaper.shapeBatch({
      ...base,
      runs: [{ ...base.runs[0], language: `en-x-${index.toString(36)}` }],
    })
  }
  assert.equal(shaper.memoryReport().planCount, 64)
  shaper.shapeBatch({ ...base, runs: [{ ...base.runs[0], language: 'en-x-0' }] })
  assert.equal(
    shaper.memoryReport().planCount,
    64,
    'revisiting an evicted plan must preserve the bound',
  )

  shaper.dispose()
  font.dispose()
})

test('one coarse call shapes and reshapes multiple runs with absolute UTF-16 clusters', async () => {
  const [{ artifact, shaperWasm }, oracle] = await Promise.all([
    fixture(),
    readJson(new URL('harfrust.json', shapingDirectory)),
  ])
  const registry = new FontRegistry()
  const font = await registry.registerAsset(artifact)
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
  shaper.registerFont(font)
  const expectedRuns = [
    oracle.cases.find(({ id }) => id === 'ligature-default'),
    oracle.cases.find(({ id }) => id === 'combining-mark'),
  ]
  assert.ok(expectedRuns.every(Boolean))
  const combinedText = expectedRuns.map(({ text }) => text).join('')
  const textUtf16 = utf16(combinedText)
  let start = 0
  const runs = expectedRuns.map((expected) => {
    const end = start + utf16(expected.text).length
    const run = {
      font: font.handle,
      textStart: start,
      textEnd: end,
      direction: expected.segment.direction,
      script: expected.segment.script,
      language: expected.segment.language,
      clusterLevel: 0,
      flags: 0x40,
      featureStart: 0,
      featureCount: 0,
    }
    start = end
    return run
  })
  const request = { textUtf16, runs, features: [] }
  const expectedGlyphs = expectedRuns.map((expected, run) =>
    expected.glyphs.map((glyph) => ({ ...glyph, cluster: glyph.cluster + runs[run].textStart })),
  )
  assertMultiRun(shaper.shapeBatch(request), font.handle, expectedGlyphs)
  assert.equal(shaper.memoryReport().planCount, 1)
  assertMultiRun(
    shaper.reshapeRanges({
      ...request,
      ranges: runs.map((run, index) => ({
        run: index,
        itemStart: run.textStart,
        itemEnd: run.textEnd,
        contextStart: run.textStart,
        contextEnd: run.textEnd,
        flags: run.flags,
      })),
    }),
    font.handle,
    expectedGlyphs,
  )
  assert.equal(shaper.memoryReport().planCount, 1)
  shaper.dispose()
  font.dispose()
})

function shapeRequest(font, expected, fixtureCase) {
  const textUtf16 = utf16(expected.text)
  assert.equal(textUtf16.length, fixtureCase.utf16Length)
  const features = expected.segment.features.map((source) => {
    const match = /^(.{4})(?:=(\d+))?$/.exec(source)
    assert.ok(match, `unsupported fixture feature ${source}`)
    return {
      tag: match[1],
      value: match[2] === undefined ? 1 : Number(match[2]),
      start: 0,
      end: textUtf16.length,
    }
  })
  return {
    textUtf16,
    features,
    runs: [
      {
        font,
        textStart: 0,
        textEnd: textUtf16.length,
        direction: expected.segment.direction,
        script: expected.segment.script,
        language: expected.segment.language,
        clusterLevel: 0,
        flags: 0x40,
        featureStart: 0,
        featureCount: features.length,
      },
    ],
  }
}

function assertShapedBatch(actual, fontHandle, glyphs) {
  assert.deepEqual([...actual.fontHandles], [fontHandle])
  assert.deepEqual([...actual.runFontSlots], [0])
  assert.deepEqual([...actual.runGlyphStarts], [0])
  assert.deepEqual([...actual.runGlyphCounts], [glyphs.length])
  assert.deepEqual(
    {
      glyphIds: [...actual.glyphIds],
      clusters: [...actual.clusters],
      xAdvances: [...actual.xAdvances],
      yAdvances: [...actual.yAdvances],
      xOffsets: [...actual.xOffsets],
      yOffsets: [...actual.yOffsets],
      glyphFlags: [...actual.glyphFlags],
    },
    {
      glyphIds: glyphs.map(({ glyphId }) => glyphId),
      clusters: glyphs.map(({ cluster }) => cluster),
      xAdvances: glyphs.map(({ xAdvance }) => xAdvance),
      yAdvances: glyphs.map(({ yAdvance }) => yAdvance),
      xOffsets: glyphs.map(({ xOffset }) => xOffset),
      yOffsets: glyphs.map(({ yOffset }) => yOffset),
      glyphFlags: glyphs.map(({ flags }) => flags),
    },
  )
}

function assertMultiRun(actual, fontHandle, runs) {
  const glyphs = runs.flat()
  const starts = []
  let start = 0
  for (const run of runs) {
    starts.push(start)
    start += run.length
  }
  assert.deepEqual([...actual.fontHandles], [fontHandle])
  assert.deepEqual(
    [...actual.runFontSlots],
    runs.map(() => 0),
  )
  assert.deepEqual([...actual.runGlyphStarts], starts)
  assert.deepEqual(
    [...actual.runGlyphCounts],
    runs.map((run) => run.length),
  )
  assert.deepEqual(
    [...actual.glyphIds],
    glyphs.map(({ glyphId }) => glyphId),
  )
  assert.deepEqual(
    [...actual.clusters],
    glyphs.map(({ cluster }) => cluster),
  )
  assert.deepEqual(
    [...actual.xAdvances],
    glyphs.map(({ xAdvance }) => xAdvance),
  )
  assert.deepEqual(
    [...actual.yAdvances],
    glyphs.map(({ yAdvance }) => yAdvance),
  )
  assert.deepEqual(
    [...actual.xOffsets],
    glyphs.map(({ xOffset }) => xOffset),
  )
  assert.deepEqual(
    [...actual.yOffsets],
    glyphs.map(({ yOffset }) => yOffset),
  )
  assert.deepEqual(
    [...actual.glyphFlags],
    glyphs.map(({ flags }) => flags),
  )
}

function utf16(value) {
  return Uint16Array.from({ length: value.length }, (_, index) => value.charCodeAt(index))
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'))
}
