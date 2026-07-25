import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createParagraphEngine, createRuntimeShaper, FontRegistry } from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'

test('fixed-seed paragraph policy mutations stay safe, finite, and deterministic', async () => {
  const { font, shaper } = await runtime(
    new URL(
      '../../../../apps/benchmarks/fixtures/fonts/amiri-1.002/Amiri-Regular.ttf',
      import.meta.url,
    ),
  )
  const paragraph = createParagraphEngine({ shaper }).create({ text: '', font: font.handle })
  const cases = fuzzCases(0x5e_ed_53_03, 64)
  const first = []
  const second = []

  for (const results of [first, second]) {
    for (const entry of cases) {
      if (!entry.text.isWellFormed()) {
        assert.throws(
          () => paragraph.update({ text: entry.text, font: font.handle, style: entry.style }),
          /well-formed UTF-16/,
        )
        results.push('invalid-utf16')
        continue
      }
      paragraph.update({
        text: entry.text,
        font: font.handle,
        style: entry.style,
      })
      const measured = paragraph.measure(entry.constraints)
      assert.equal(paragraph.measure(entry.constraints), measured)
      assertMeasurement(measured)
      const layout = paragraph.layout(entry.constraints)
      assert.equal(paragraph.layout(entry.constraints), layout)
      assertMeasurement(layout)
      assertLayoutBoundaries(entry.text, layout)
      results.push(hashLayout(layout))
    }
  }
  assert.deepEqual(second, first)
  paragraph.dispose()
  shaper.dispose()
  font.dispose()
})

test('fixed-seed CJK boundary mutations stay safe, finite, and deterministic', async () => {
  const { font, shaper } = await runtime(
    new URL(
      '../../../../apps/benchmarks/fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf',
      import.meta.url,
    ),
  )
  const paragraph = createParagraphEngine({ shaper }).create({ text: '', font: font.handle })
  const cases = cjkFuzzCases(0x5e_ed_54_04, 32)
  assert.deepEqual(
    new Set(cases.map(({ style }) => style.language)),
    new Set(['zh-hans', 'zh-hant', 'ja', 'ko']),
  )
  assert.deepEqual(
    new Set(cases.map(({ constraints }) => constraints.width.mode)),
    new Set(['unconstrained', 'at-most', 'exactly']),
  )
  assert.deepEqual(
    new Set(cases.map(({ constraints }) => constraints.height.mode)),
    new Set(['unconstrained', 'at-most', 'exactly']),
  )
  const first = []
  const second = []

  for (const results of [first, second]) {
    for (const entry of cases) {
      paragraph.update({ text: entry.text, font: font.handle, style: entry.style })
      const measured = paragraph.measure(entry.constraints)
      const layout = paragraph.layout(entry.constraints)
      assertMeasurement(measured)
      assertMeasurement(layout)
      assertLayoutBoundaries(entry.text, layout)
      results.push(hashLayout(layout))
    }
  }
  assert.deepEqual(second, first)

  for (const text of ['漢\ud800字', '漢\udc00字', '禰\udb40', '禰\udd00', '禰\udd00\udb40']) {
    assert.throws(
      () => paragraph.update({ text, font: font.handle, style: { language: 'ja' } }),
      /well-formed UTF-16/,
    )
  }
  for (const text of ['\u{FE00}', '\u{E0100}', '漢\u{FE00}\u{FE01}', '禰\u{E0100}\u{E0101}']) {
    paragraph.update({ text, font: font.handle, style: { language: 'ja' } })
    const firstLayout = paragraph.layout({ width: { mode: 'exactly', size: 1 }, wrap: 'word' })
    assertLayoutBoundaries(text, firstLayout)
    assert.equal(
      paragraph.layout({ width: { mode: 'exactly', size: 1 }, wrap: 'word' }),
      firstLayout,
    )
  }
  for (const language of ['ja--jp', 'ja\0jp', 'ja_jp', '123']) {
    assert.throws(
      () => paragraph.update({ text: '漢字', font: font.handle, style: { language } }),
      /invalid batch request/,
    )
  }
  paragraph.update({ text: '漢字', font: font.handle, style: { language: 'ja' } })
  for (const constraints of [
    { width: { mode: 'at-most', size: -1 } },
    { width: { mode: 'exactly', size: Number.NaN } },
    { width: { mode: 'exactly', size: Number.POSITIVE_INFINITY } },
    { height: { mode: 'at-most', size: -1 } },
    { maxLines: 0 },
    { maxLines: 1.5 },
  ]) {
    assert.throws(() => paragraph.layout(constraints), RangeError)
  }

  paragraph.dispose()
  shaper.dispose()
  font.dispose()
})

function fuzzCases(seed, count) {
  const random = xorshift(seed)
  const tokens = ['abc', 'مرحبا', '123', ' ', '\n', 'لا', 'e\u0301', '\ud800', '…', '(אב)']
  const wraps = ['none', 'word', 'character']
  const aligns = ['start', 'center', 'end', 'justify']
  const overflows = ['visible', 'clip', 'ellipsis']
  const directions = ['auto', 'ltr', 'rtl']
  return Array.from({ length: count }, () => {
    let text = ''
    const tokenCount = 1 + integer(random, 10)
    for (let index = 0; index < tokenCount; index += 1)
      text += tokens[integer(random, tokens.length)]
    const widthMode = integer(random, 3)
    const heightMode = integer(random, 3)
    return {
      text,
      style: {
        fontSize: 8 + integer(random, 65),
        lineHeight: 0.75 + integer(random, 200) / 100,
        letterSpacing: (integer(random, 81) - 40) / 10,
        direction: directions[integer(random, directions.length)],
        language: integer(random, 2) === 0 ? 'ar' : 'en',
      },
      constraints: {
        width: axis(widthMode, random),
        height: axis(heightMode, random),
        ...(integer(random, 3) === 0 ? { maxLines: 1 + integer(random, 5) } : {}),
        wrap: wraps[integer(random, wraps.length)],
        align: aligns[integer(random, aligns.length)],
        overflow: overflows[integer(random, overflows.length)],
      },
    }
  })
}

function cjkFuzzCases(seed, count) {
  const random = xorshift(seed)
  const tokens = [
    '漢字',
    'かなカナ',
    '한글',
    '한글',
    '、。「」（）',
    '　',
    '\u{2000B}',
    '、\u{FE00}。\u{FE01}',
    '禰\u{E0100}',
  ]
  const languages = ['zh-hans', 'zh-hant', 'ja', 'ko']
  const wraps = ['none', 'word', 'character']
  return Array.from({ length: count }, () => {
    const shuffled = [...tokens]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const selected = integer(random, index + 1)
      const value = shuffled[index]
      shuffled[index] = shuffled[selected]
      shuffled[selected] = value
    }
    const widthMode = integer(random, 3)
    const heightMode = integer(random, 3)
    return {
      text: shuffled.join(''),
      style: {
        fontSize: 10 + integer(random, 55),
        lineHeight: 0.75 + integer(random, 200) / 100,
        letterSpacing: (integer(random, 41) - 20) / 10,
        language: languages[integer(random, languages.length)],
      },
      constraints: {
        width: axis(widthMode, random),
        height: axis(heightMode, random),
        ...(integer(random, 3) === 0 ? { maxLines: 1 + integer(random, 5) } : {}),
        wrap: wraps[integer(random, wraps.length)],
      },
    }
  })
}

function axis(mode, random) {
  if (mode === 0) return { mode: 'unconstrained' }
  return { mode: mode === 1 ? 'at-most' : 'exactly', size: integer(random, 321) }
}

function xorshift(seed) {
  let state = seed >>> 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

function integer(random, limit) {
  return random() % limit
}

function assertMeasurement(value) {
  for (const field of [
    'width',
    'height',
    'contentWidth',
    'contentHeight',
    'firstBaseline',
    'lastBaseline',
  ]) {
    assert.equal(Number.isFinite(value[field]), true, field)
    assert.ok(value[field] >= 0, field)
  }
  assert.equal(typeof value.overflowed, 'boolean')
}

function assertLayoutBoundaries(text, layout) {
  assert.equal(layout.glyphIds.length, layout.clusters.length)
  assert.equal(layout.glyphIds.length, layout.x.length)
  assert.equal(layout.glyphIds.length, layout.y.length)
  assert.equal(layout.glyphIds.length, layout.glyphFlags.length)
  assert.equal(layout.lineTextStarts.length, layout.lineTextEnds.length)
  assert.equal(layout.lineTextStarts.length, layout.lineGlyphStarts.length)
  assert.equal(layout.lineTextStarts.length, layout.lineGlyphCounts.length)
  assert.equal(layout.lineTextStarts.length, layout.lineBaselines.length)
  assert.equal(layout.lineTextStarts.length, layout.lineAdvances.length)
  for (const offset of [...layout.clusters, ...layout.lineTextStarts, ...layout.lineTextEnds]) {
    assert.ok(offset <= text.length)
    assert.equal(isUtf16Boundary(text, offset), true, `UTF-16 boundary ${offset}`)
  }
  for (const value of [...layout.x, ...layout.y, ...layout.lineAdvances]) {
    assert.equal(Number.isFinite(value), true)
  }
}

function isUtf16Boundary(text, offset) {
  if (offset === 0 || offset === text.length) return true
  const previous = text.charCodeAt(offset - 1)
  const current = text.charCodeAt(offset)
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff)
}

function hashLayout(layout) {
  let hash = 2_166_136_261
  for (const values of [
    layout.glyphIds,
    layout.clusters,
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
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    for (const value of bytes) hash = Math.imul(hash ^ value, 16_777_619)
  }
  return hash >>> 0
}

async function runtime(sourceUrl) {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(sourceUrl),
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
