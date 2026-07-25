import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createFontBaker } from '../../dist/index.js'
import { assertFontGlb } from '../support/font-glb.mjs'

const fontPath = process.env.PMNDRS_TEXT_TEST_FONT

test(
  'a real OpenType font bakes deterministically through the packaged Wasm API',
  { skip: fontPath === undefined ? 'set PMNDRS_TEXT_TEST_FONT to a licensed .ttf or .otf fixture' : false },
  async () => {
    const [wasm, source] = await Promise.all([
      readFile(new URL('../../dist/font_baker.wasm', import.meta.url)),
      readFile(fontPath),
    ])
    const baker = await createFontBaker(wasm)
    const first = baker.bakeFont(source)
    const second = baker.bakeFont(source)

    assert.equal(first.artifacts.length, 1)
    assert.equal(first.artifacts[0].role, 'font')
    assert.equal(first.artifacts[0].sha256, second.artifacts[0].sha256)
    assert.deepEqual(first.artifacts[0].bytes, second.artifacts[0].bytes)
    assert.equal(first.report.source.bytes, source.byteLength)
    assertFontGlb(first.artifacts[0].bytes)
  },
)
