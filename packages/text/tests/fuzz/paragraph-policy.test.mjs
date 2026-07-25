import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createParagraphEngine, createRuntimeShaper, FontRegistry } from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'

test('fixed-seed paragraph policy mutations stay safe, finite, and deterministic', async () => {
  const { font, shaper } = await runtime()
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
      assert.equal(layout.glyphIds.length, layout.clusters.length)
      assert.equal(layout.glyphIds.length, layout.x.length)
      assert.equal(layout.glyphIds.length, layout.y.length)
      assert.equal(layout.glyphIds.length, layout.glyphFlags.length)
      assert.equal(layout.lineTextStarts.length, layout.lineTextEnds.length)
      assert.equal(layout.lineTextStarts.length, layout.lineGlyphStarts.length)
      assert.equal(layout.lineTextStarts.length, layout.lineGlyphCounts.length)
      assert.equal(layout.lineTextStarts.length, layout.lineBaselines.length)
      assert.equal(layout.lineTextStarts.length, layout.lineAdvances.length)
      for (const value of [...layout.x, ...layout.y, ...layout.lineAdvances]) {
        assert.equal(Number.isFinite(value), true)
      }
      for (const cluster of layout.clusters) assert.ok(cluster <= entry.text.length)
      results.push(hashLayout(layout))
    }
  }
  assert.deepEqual(second, first)
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
    for (let index = 0; index < tokenCount; index += 1) text += tokens[integer(random, tokens.length)]
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

async function runtime() {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/fonts/amiri-1.002/Amiri-Regular.ttf', import.meta.url)),
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
