import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createParagraphEngine, createRuntimeShaper, FontRegistry } from '@pmndrs/text'
import { createFontBaker } from '@pmndrs/text-font-baker'

import {
  createUikitLayoutFixture,
  YogaMeasureMode,
} from '../../../../apps/benchmarks/src/benchmark/uikit-layout-fixture.ts'

const text = 'office AVATAR café — ffi, kerning, marks, and wrapping.'

test('mirrors the current uikit CustomLayouting and resolved content-box flow', async () => {
  const { font, shaper } = await runtime()
  const input = {
    text,
    font: font.handle,
    style: { fontSize: 31, lineHeight: 1.23, direction: 'ltr', language: 'en' },
  }
  const paragraph = createParagraphEngine({ shaper }).create(input)
  const fixture = createUikitLayoutFixture(paragraph, { wrap: 'word', overflow: 'clip' })
  const custom = fixture.customLayouting()

  assert.deepEqual(
    {
      minWidth: custom.minWidth,
      minHeight: custom.minHeight,
      firstBaseline: custom.firstBaseline,
    },
    {
      minWidth: 96.0576171875,
      minHeight: 38.13,
      firstBaseline: 30.34185546875,
    },
  )
  assert.equal(fixture.calls.layout, 0, 'intrinsic sizing must not materialize glyph arrays')

  const natural = custom.measure(
    Number.NaN,
    YogaMeasureMode.Undefined,
    Number.NaN,
    YogaMeasureMode.Undefined,
  )
  assert.deepEqual(natural, { width: 821.14, height: 38.14 })
  const atMost = custom.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost)
  assert.deepEqual(atMost, { width: 345.41, height: 90 })
  const exactWidth = custom.measure(
    420.001,
    YogaMeasureMode.Exactly,
    NaN,
    YogaMeasureMode.Undefined,
  )
  assert.deepEqual(exactWidth, { width: 420.01, height: 114.4 })
  for (let index = 0; index < 20; index += 1) {
    assert.deepEqual(
      custom.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost),
      atMost,
    )
  }
  assert.equal(fixture.calls.layout, 0)

  const beforeDefinite = fixture.calls.measure
  assert.deepEqual(
    fixture.resolveYogaLeaf(401.237, YogaMeasureMode.Exactly, 150.111, YogaMeasureMode.Exactly),
    { width: 401.24, height: 150.12, measured: false },
  )
  assert.equal(
    fixture.calls.measure,
    beforeDefinite,
    'Yoga skips leaf measurement for two exact axes',
  )
  assert.throws(
    () => custom.measure(Number.NaN, YogaMeasureMode.AtMost, 10, YogaMeasureMode.Exactly),
    /Yoga width must be finite/,
  )
  assert.throws(() => custom.measure(10, 99, 10, YogaMeasureMode.Exactly), /measure mode/)

  const resolved = fixture.layoutResolvedBox([401.24, 150.12], [7, 11, 13, 17], [1, 2, 3, 4])
  assert.deepEqual(resolved.contentBox, { width: 367.24, height: 126.12 })
  assert.equal(fixture.calls.layout, 1)
  assert.equal(resolved.layout.width, 367.24)
  assert.equal(resolved.layout.height, 126.12)
  assert.equal(resolved.centeredX[0], Math.fround(resolved.layout.x[0] - 179.62))
  assert.equal(resolved.centeredY[0], Math.fround(67.06 - resolved.layout.y[0]))

  const dirtyBeforePaint = fixture.dirtyCount
  fixture.updatePaint()
  fixture.updateRaster()
  assert.equal(fixture.dirtyCount, dirtyBeforePaint)
  assert.deepEqual([fixture.paintRevision, fixture.rasterRevision], [1, 1])

  fixture.updateShapingPolicy({ maxLines: 2 })
  assert.equal(fixture.dirtyCount, dirtyBeforePaint + 1)
  fixture.updateParagraph({ ...input, text: `${text} Updated.` })
  assert.equal(fixture.dirtyCount, dirtyBeforePaint + 2)
  assert.notDeepEqual(
    fixture.customLayouting().measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost),
    atMost,
  )

  paragraph.dispose()
  shaper.dispose()
  font.dispose()
})

async function runtime() {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(
      new URL(
        '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
        import.meta.url,
      ),
    ),
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
