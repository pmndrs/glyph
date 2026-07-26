import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createFontBaker } from '@pmndrs/text-font-baker'
import { validateFontArtifact } from '@pmndrs/text-font-baker/validate'
import { bitmapBakerFromCore, createBitmapBaker } from '@pmndrs/text/bakers/bitmap'
import { FontRegistry, RasterRuntime, Text, defineRaster } from '../../dist/index.js'
import { bitmap, bitmapDescriptor, bitmapRasterKey } from '../../dist/raster/bitmap.js'
import { composeFontBake } from '../../dist/internal/compose-bake.js'

const fixtureUrl = new URL(
  '../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb',
  import.meta.url,
)
const shaperUrl = new URL('../../dist/text_shaper.wasm', import.meta.url)

test('Text commits layout and draw generations atomically', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const layouts = []
  const text = new Text({
    text: 'office AVATAR',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    onLayout: (layout) => layouts.push(layout),
  })
  try {
    assert.equal(text.children.length, 0)
    await text.ready
    assert.equal(text.children.length, 1)
    assert.equal(text.layout, layouts[0])
    assert.ok((text.layout?.glyphIds.length ?? 0) > 0)

    const initialLayout = text.layout
    const initialBatch = text.children[0]
    text.setProperties({ opacity: 0.5 })
    await text.ready
    assert.equal(text.layout, initialLayout, 'paint-only updates retain the committed layout')
    assert.equal(text.children[0], initialBatch, 'paint-only updates retain the draw batch')

    text.setProperties({ width: 72 })
    await text.ready
    assert.notEqual(text.layout, initialLayout, 'constraint updates commit a new layout')
    assert.equal(text.children.length, 1)

    text.setProperties({ text: 'first update' })
    const supersededReady = text.ready
    text.setProperties({ text: 'second update' })
    await assert.rejects(supersededReady, { name: 'AbortError' })
    await text.ready
    assert.equal(text.layout?.glyphIds.length, 13)

    const committedLayout = text.layout
    assert.throws(() => text.setProperties({ spans: [] }), /requires text/)
    assert.equal(text.layout, committedLayout, 'invalid patches cannot mutate committed state')
  } finally {
    text.dispose()
    font.dispose()
    restoreFetch()
  }
  assert.equal(text.children.length, 0)
  await assert.rejects(text.ready, { name: 'AbortError' })
  assert.throws(() => text.setProperties({ opacity: 1 }), /disposed/)
})

test('disposing Text rejects both pending and subsequent ready observations', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const text = new Text({
    text: 'cancel a paragraph-reusing constraint update',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
  })
  try {
    await text.ready
    text.setProperties({ width: 120 })
    const pending = text.ready
    text.dispose()
    await assert.rejects(pending, { name: 'AbortError' })
    await assert.rejects(text.ready, { name: 'AbortError' })
  } finally {
    text.dispose()
    font.dispose()
    restoreFetch()
  }
})

test('a cancelled reflow does not claim ownership of its committed paragraph', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const bitmapRequest = bitmap({ strikes: [16] })
  let disposeFontAfterBuild = false
  const raster = defineRaster({
    ...bitmapRequest.module,
    buildBatches(...arguments_) {
      const batch = bitmapRequest.module.buildBatches(...arguments_)
      if (disposeFontAfterBuild) {
        disposeFontAfterBuild = false
        queueMicrotask(() => font.dispose())
      }
      return batch
    },
  })
  const text = new Text({
    text: 'reuse one committed paragraph',
    font,
    raster: { module: raster, options: bitmapRequest.options },
    fontSize: 16,
  })
  try {
    await text.ready
    disposeFontAfterBuild = true
    text.setProperties({ width: 120 })
    const cancelled = text.ready
    await assert.rejects(cancelled, /font used by this text was disposed/i)
    await assert.rejects(text.ready, /font used by this text was disposed/i)
    assert.equal(text.children.length, 0)
    assert.equal(text.layout, undefined)
  } finally {
    text.dispose()
    font.dispose()
    restoreFetch()
  }
})

test('Text releases the superseded font-disposal listener after every committed reflow', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const subscribe = registry._onFontDispose.bind(registry)
  let activeSubscriptions = 0
  registry._onFontDispose = (listener) => {
    activeSubscriptions += 1
    const release = subscribe(listener)
    let released = false
    return () => {
      if (released) return
      released = true
      activeSubscriptions -= 1
      release()
    }
  }
  const text = new Text({
    text: 'continuous reflow keeps one live generation listener',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
  })
  try {
    await text.ready
    const stableSubscriptions = activeSubscriptions
    assert.ok(stableSubscriptions > 0)
    for (let width = 120; width < 140; width += 1) {
      text.setProperties({ width })
      await text.ready
      assert.equal(activeSubscriptions, stableSubscriptions)
    }
    text.dispose()
    assert.equal(activeSubscriptions, stableSubscriptions - 1)
  } finally {
    text.dispose()
    font.dispose()
    restoreFetch()
  }
})

test('Text validates feature ranges with text updates and treats global empty features as no-ops', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const text = new Text({
    text: 'feature bounds',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    features: [{ tag: 'liga', start: 0, end: 14 }],
  })
  const empty = new Text({
    text: '',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    features: [{ tag: 'liga' }],
  })
  try {
    await Promise.all([text.ready, empty.ready])
    const committed = text.layout
    assert.throws(() => text.setProperties({ text: 'ab' }), /feature 0 ends after/)
    assert.equal(text.layout, committed)
    assert.equal(empty.layout?.glyphIds.length, 0)
  } finally {
    text.dispose()
    empty.dispose()
    font.dispose()
    restoreFetch()
  }
})

test('Text skips semantic no-op paint uploads and bitmap rejects unsupported effects', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const text = new Text({
    text: 'office',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    features: [{ tag: 'liga' }],
  })
  try {
    await text.ready
    const batch = text.children[0]
    const mesh = batch?.children[0]
    const colors = mesh?.geometry?.getAttribute('bitmapColor')
    assert.ok(colors)
    const initialVersion = colors.version
    text.setProperties({ features: [{ tag: 'liga' }], onLayout: () => undefined })
    await text.ready
    assert.equal(colors.version, initialVersion)
    assert.throws(
      () => text.setProperties({ outline: { color: '#fff', width: 1 } }),
      /bitmap raster does not support outline or shadow/,
    )
    assert.equal(colors.version, initialVersion)
  } finally {
    text.dispose()
    font.dispose()
    restoreFetch()
  }
})

test('disposing a registered font invalidates live Text batches before raster release', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const text = new Text({
    text: 'font lifecycle',
    font,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
  })
  try {
    await text.ready
    assert.equal(text.children.length, 1)
    text.visible = false
    font.dispose()
    assert.equal(text.children.length, 0)
    assert.equal(text.layout, undefined)
    assert.equal(text.visible, false, 'font lifecycle does not override caller visibility')
    await assert.rejects(text.ready, /font used by this text was disposed/i)
  } finally {
    text.dispose()
    restoreFetch()
  }
})

test('Text rejects a raster batch without the required Three.js lifecycle surface', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const invalidBatchModule = {
    kind: 'bitmap',
    extension: 'PMNDRS_font_bitmap',
    version: 0,
    descriptor() {
      return { generatorVersion: '0.0.0', strikes: [16] }
    },
    async decode() {
      return {}
    },
    async prepare() {},
    buildBatches() {
      return {}
    },
    updatePaint() {},
    dispose() {},
  }
  const text = new Text({
    text: 'invalid batch',
    font,
    raster: { module: invalidBatchModule },
    fontSize: 16,
  })
  try {
    await assert.rejects(text.ready, /invalid draw batch/)
    assert.equal(text.children.length, 0)
  } finally {
    text.dispose()
    font.dispose()
    restoreFetch()
  }
})

test('Text resolves independent raster resources for two fonts in one paragraph', async () => {
  const restoreFetch = installFileFetch()
  const registry = new FontRegistry()
  const [inter, amiriBytes] = await Promise.all([
    registry.registerAsset(await readFile(fixtureUrl)),
    bakeBitmapFont(
      new URL(
        '../../../../apps/benchmarks/fixtures/fonts/amiri-1.002/Amiri-Regular.ttf',
        import.meta.url,
      ),
    ),
  ])
  const amiri = await registry.registerAsset(amiriBytes)
  const content = 'Latin العربية'
  const text = new Text({
    text: content,
    font: inter,
    raster: bitmap({ strikes: [16] }),
    fontSize: 16,
    spans: [
      {
        start: 6,
        end: content.length,
        font: amiri,
        language: 'ar',
        direction: 'rtl',
      },
    ],
  })
  try {
    await text.ready
    assert.equal(text.layout?.fontHandles.length, 2)
    assert.equal(text.children.length, 2)
  } finally {
    text.dispose()
    inter.dispose()
    amiri.dispose()
    restoreFetch()
  }
})

test('RasterRuntime caches one decoded resource per font and disposes it with its owner', async () => {
  const registry = new FontRegistry()
  const font = await registry.registerAsset(await readFile(fixtureUrl))
  const runtime = new RasterRuntime()
  let decodeCount = 0
  let disposeCount = 0
  const module = defineRaster({
    kind: 'bitmap',
    extension: 'PMNDRS_font_bitmap',
    version: 0,
    descriptor() {
      return { generatorVersion: '0.0.0', strikes: [16] }
    },
    async decode() {
      decodeCount += 1
      return { decodeCount }
    },
    async prepare() {},
    buildBatches() {
      throw new Error('not used by the raster-runtime cache test')
    },
    updatePaint() {},
    dispose() {
      disposeCount += 1
    },
  })

  const [left, right] = await Promise.all([
    runtime.load(font, { module }),
    runtime.load(font, { module }),
  ])
  assert.equal(left.resource, right.resource)
  assert.equal(decodeCount, 1)

  font.dispose()
  await Promise.resolve()
  assert.equal(disposeCount, 1)
  runtime.dispose()
})

function installFileFetch() {
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === shaperUrl.href) {
      init?.signal?.throwIfAborted()
      return new Response(await readFile(shaperUrl), { status: 200 })
    }
    return original(input, init)
  }
  return () => {
    globalThis.fetch = original
  }
}

async function bakeBitmapFont(sourceUrl) {
  const [source, fontWasm, bitmapWasm] = await Promise.all([
    readFile(sourceUrl),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
    readFile(new URL('../../dist/bitmap_baker.wasm', import.meta.url)),
  ])
  const fontBaker = await createFontBaker(fontWasm)
  const core = fontBaker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  })
  const validation = await validateFontArtifact(core.artifacts[0].bytes)
  const descriptor = bitmapDescriptor({ strikes: [16] })
  const rasterKey = await bitmapRasterKey({ strikes: [16] })
  const bitmapBaker = bitmapBakerFromCore(await createBitmapBaker(bitmapWasm))
  const raster = await bitmapBaker.bake({
    font: {
      source,
      fontFaceIndex: 0,
      glyphCount: validation.glyphCount,
      shapingHash: validation.shapingHash,
    },
    rasterKey,
    packaging: { artifact: 'embedded', pages: 'embedded' },
    descriptor,
  })
  const composed = await composeFontBake(core, [
    { raster, packaging: { artifact: 'embedded', pages: 'embedded' } },
  ])
  return composed.artifacts[0].bytes
}
