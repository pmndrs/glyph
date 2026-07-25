import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  bitmapBakerFromCore,
  createBitmapBaker,
  readBitmapBakerAbi,
} from '@pmndrs/text/bakers/bitmap'
import { bitmapDescriptor, bitmapRasterKey } from '@pmndrs/text/raster/bitmap'

const wasmUrl = new URL('../../dist/bitmap_baker.wasm', import.meta.url)
const abiUrl = new URL('../../dist/bitmap-baker-abi-v0.json', import.meta.url)
const fontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
  import.meta.url,
)
const shapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09'

async function setup() {
  const [wasm, source] = await Promise.all([readFile(wasmUrl), readFile(fontUrl)])
  const module = await WebAssembly.compile(wasm)
  const instance = await WebAssembly.instantiate(module, {})
  const core = await createBitmapBaker(module)
  return { wasm, source: new Uint8Array(source), module, instance, core }
}

async function bake(core, source, pages) {
  const options = { strikes: [16] }
  const descriptor = bitmapDescriptor(options)
  const rasterKey = await bitmapRasterKey(options)
  return bitmapBakerFromCore(core).bake({
    font: {
      source,
      fontFaceIndex: 0,
      glyphCount: 2937,
      shapingHash,
    },
    rasterKey,
    packaging: { artifact: 'external', pages },
    descriptor,
  })
}

test('ships a zero-import optimized Wasm module with its generated ABI', async () => {
  const { module, instance } = await setup()
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  const embedded = readBitmapBakerAbi(instance)
  const published = JSON.parse(await readFile(abiUrl, 'utf8'))
  assert.deepEqual(embedded, published)
  assert.deepEqual(embedded.versions, {
    bitmapFormat: 0,
    generator: '0.0.0',
    ktx2: '0.5.0',
    readFonts: '0.42.1',
    skrifa: '0.45.1',
    zeno: '0.3.3',
  })
})

test('bakes canonical Inter deterministically through the public direct-memory shim', async () => {
  const { source, core } = await setup()
  const first = await bake(core, source, 'embedded')
  const second = await bake(core, source, 'embedded')

  assert.deepEqual(first, second)
  assert.equal(first.kind, 'bitmap')
  assert.equal(first.extension, 'PMNDRS_font_bitmap')
  assert.equal(first.version, 0)
  assert.equal(first.report.metadataBytes, 2937 * 20)
  assert.ok(first.report.gpuBytes > 0)
  assert.ok(first.report.pages.length > 0)
  assert.ok(first.artifacts.every(({ role }) => role === 'raster'))
  assert.deepEqual([...first.artifacts[0].bytes.subarray(0, 4)], [0x67, 0x6c, 0x54, 0x46])
})

test('external page packaging preserves authoritative records and emits hashed KTX2 artifacts', async () => {
  const { source, core } = await setup()
  const embedded = await bake(core, source, 'embedded')
  const external = await bake(core, source, 'external')

  assert.equal(external.report.metadataBytes, embedded.report.metadataBytes)
  assert.equal(external.report.gpuBytes, embedded.report.gpuBytes)
  const pages = external.artifacts.filter(({ role }) => role === 'raster-page')
  assert.equal(pages.length, external.report.pages.length)
  assert.ok(pages.length > 0)
  for (const page of pages) {
    assert.deepEqual(
      [...page.bytes.subarray(0, 12)],
      [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a],
    )
    assert.match(page.sha256, /^[0-9a-f]{64}$/)
  }
})

test('rejects mismatched shaping context and honors pre-bake cancellation', async () => {
  const { source, core } = await setup()
  const descriptor = bitmapDescriptor({ strikes: [16] })
  const rasterKey = await bitmapRasterKey({ strikes: [16] })
  const baker = bitmapBakerFromCore(core)

  await assert.rejects(
    baker.bake({
      font: { source, fontFaceIndex: 0, glyphCount: 1, shapingHash },
      rasterKey,
      packaging: { artifact: 'external', pages: 'embedded' },
      descriptor,
    }),
    (error) => error.code === 'INVALID_GLYPH_COUNT',
  )

  const controller = new AbortController()
  controller.abort(new Error('cancelled by fixture'))
  await assert.rejects(
    baker.bake({
      font: { source, fontFaceIndex: 0, glyphCount: 2937, shapingHash },
      rasterKey,
      packaging: { artifact: 'external', pages: 'embedded' },
      descriptor,
      signal: controller.signal,
    }),
    /cancelled by fixture/,
  )
})
