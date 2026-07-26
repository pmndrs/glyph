import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createRuntimeShaper } from '../../dist/index.js'

const wasm = await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url))

test('direct-memory bidi ABI returns exact Unicode 17 levels and classes', async () => {
  const shaper = await createRuntimeShaper({ wasm })
  try {
    const text = 'אב(גד[&ef].)gh'
    const result = shaper.analyzeBidi(utf16(text), 'ltr')
    assert.deepEqual([...result.levels], [1, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    assert.deepEqual([...result.classes], [1, 1, 13, 1, 1, 13, 13, 0, 0, 13, 7, 13, 0, 0])
    assert.deepEqual([...result.paragraphStarts], [0])
    assert.deepEqual([...result.paragraphEnds], [14])
    assert.deepEqual([...result.paragraphLevels], [0])
  } finally {
    shaper.dispose()
  }
})

test('bidi ABI is UTF-16-indexed and honors auto and explicit paragraph direction', async () => {
  const shaper = await createRuntimeShaper({ wasm })
  try {
    const text = utf16('\u{10940}😀 A\u2029אב')
    const automatic = own(shaper.analyzeBidi(text))
    assert.equal(automatic.levels.length, text.length)
    assert.equal(automatic.levels[0], automatic.levels[1])
    assert.equal(automatic.levels[2], automatic.levels[3])
    assert.deepEqual([...automatic.paragraphStarts], [0, 7])
    assert.deepEqual([...automatic.paragraphEnds], [7, 9])
    assert.deepEqual([...automatic.paragraphLevels], [1, 1])

    const ltr = own(shaper.analyzeBidi(text, 'ltr'))
    const rtl = own(shaper.analyzeBidi(text, 'rtl'))
    assert.deepEqual([...ltr.paragraphLevels], [0, 0])
    assert.deepEqual([...rtl.paragraphLevels], [1, 1])
    assert.throws(() => shaper.analyzeBidi(text, 'sideways'), /auto, ltr, or rtl/)
    assert.throws(() => shaper.analyzeBidi(new Uint8Array(text), 'auto'), /Uint16Array/)
  } finally {
    shaper.dispose()
  }
})

function utf16(value) {
  const units = []
  for (let index = 0; index < value.length; index += 1) units.push(value.charCodeAt(index))
  return Uint16Array.from(units)
}

function own(result) {
  return {
    levels: result.levels.slice(),
    classes: result.classes.slice(),
    paragraphStarts: result.paragraphStarts.slice(),
    paragraphEnds: result.paragraphEnds.slice(),
    paragraphLevels: result.paragraphLevels.slice(),
  }
}
