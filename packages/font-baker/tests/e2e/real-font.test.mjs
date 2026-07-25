import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createFontBaker } from '../../dist/index.js'
import { assertFontGlb } from '../support/font-glb.mjs'

const fixtureDirectory = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/', import.meta.url)

test('the canonical Inter fixture bakes deterministically through the packaged Wasm API', async () => {
  const [wasm, source, manifestSource] = await Promise.all([
    readFile(new URL('../../dist/font_baker.wasm', import.meta.url)),
    readFile(new URL('Inter-Regular.ttf', fixtureDirectory)),
    readFile(new URL('manifest.json', fixtureDirectory), 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource)
  const sourceHash = createHash('sha256').update(source).digest('hex')

  assert.equal(source.byteLength, manifest.source.fontBytes)
  assert.equal(sourceHash, manifest.source.fontSha256)

    const baker = await createFontBaker(wasm)
    const first = baker.bakeFont(source)
    const second = baker.bakeFont(source)

    assert.equal(first.artifacts.length, 1)
    assert.equal(first.artifacts[0].role, 'font')
    assert.equal(first.artifacts[0].sha256, second.artifacts[0].sha256)
    assert.deepEqual(first.artifacts[0].bytes, second.artifacts[0].bytes)
    assert.equal(first.report.source.bytes, source.byteLength)
    assertFontGlb(first.artifacts[0].bytes)
})
