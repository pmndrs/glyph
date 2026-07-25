import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'

import {
  UNICODE_VERSION,
  analyzeUnicodeText,
  findGraphemeBoundaries,
  findLineBreaks,
  itemizeScripts,
  scriptForCodePoint,
  scriptsForCodePoint,
} from '../../dist/internal/unicode.js'

const fixtureDirectory = new URL('../fixtures/unicode-17.0.0/', import.meta.url)

test('uses one pinned Unicode version for every paragraph analysis lane', () => {
  assert.equal(UNICODE_VERSION, '17.0.0')
  assert.equal(scriptForCodePoint(0x41), 'Latn')
  assert.equal(scriptForCodePoint(0x16ea0), 'Berf')
  assert.deepEqual(scriptsForCodePoint(0x0301).includes('Latn'), true)
  assert.throws(() => scriptForCodePoint(0xd800), /Unicode scalar value/)
  assert.throws(() => analyzeUnicodeText('\ud800'), /well-formed UTF-16/)
})

test('passes every official Unicode 17 extended-grapheme test vector', async () => {
  const cases = await conformanceCases('GraphemeBreakTest.txt.gz')
  assert.equal(cases.length, 766)
  for (const entry of cases) {
    assert.deepEqual(
      [...findGraphemeBoundaries(entry.text)],
      entry.boundaries,
      `GraphemeBreakTest line ${entry.line}`,
    )
  }
})

test('passes every official Unicode 17 line-break test vector', async () => {
  const cases = await conformanceCases('LineBreakTest.txt.gz')
  assert.equal(cases.length, 19_338)
  for (const entry of cases) {
    assert.deepEqual(
      findLineBreaks(entry.text).map(({ position }) => position),
      entry.boundaries.filter((position) => position !== 0),
      `LineBreakTest line ${entry.line}`,
    )
  }
})

test('itemizes scripts at grapheme boundaries and records mandatory breaks', () => {
  assert.deepEqual(itemizeScripts('cafe\u0301 العربية'), [
    { start: 0, end: 6, script: 'Latn' },
    { start: 6, end: 13, script: 'Arab' },
  ])
  assert.deepEqual(itemizeScripts('😀'), [{ start: 0, end: 2, script: 'Zyyy' }])
  assert.deepEqual(findLineBreaks('one\r\ntwo'), [
    { position: 5, required: true },
    { position: 8, required: true },
  ])
})

test('resolves CJK Script_Extensions from surrounding shaping context', () => {
  assert.deepEqual(itemizeScripts('漢、字'), [{ start: 0, end: 3, script: 'Hani' }])
  assert.deepEqual(itemizeScripts('あ、ア'), [
    { start: 0, end: 2, script: 'Hira' },
    { start: 2, end: 3, script: 'Kana' },
  ])
  assert.deepEqual(itemizeScripts('한、글'), [{ start: 0, end: 3, script: 'Hang' }])
  assert.deepEqual(itemizeScripts('「日本語」'), [{ start: 0, end: 5, script: 'Hani' }])
  assert.deepEqual(itemizeScripts('あーア'), [
    { start: 0, end: 2, script: 'Hira' },
    { start: 2, end: 3, script: 'Kana' },
  ])
  assert.deepEqual(itemizeScripts('漢\u{E0100}字'), [{ start: 0, end: 4, script: 'Hani' }])
})

async function conformanceCases(file) {
  const compressed = await readFile(new URL(file, fixtureDirectory))
  const contents = gunzipSync(compressed).toString('utf8')
  const cases = []
  for (const [index, source] of contents.split(/\r?\n/u).entries()) {
    const body = source.split('#', 1)[0]?.trim()
    if (!body) continue
    const tokens = body.split(/\s+/u)
    const codePoints = []
    const boundaries = []
    let utf16Offset = 0
    for (let cursor = 0; cursor < tokens.length; cursor += 2) {
      const marker = tokens[cursor]
      if (marker === '÷') boundaries.push(utf16Offset)
      const hexadecimal = tokens[cursor + 1]
      if (hexadecimal === undefined) break
      const codePoint = Number.parseInt(hexadecimal, 16)
      codePoints.push(codePoint)
      utf16Offset += codePoint > 0xffff ? 2 : 1
    }
    cases.push({ line: index + 1, text: String.fromCodePoint(...codePoints), boundaries })
  }
  return cases
}
