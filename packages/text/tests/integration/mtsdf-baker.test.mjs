import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createMtsdfBaker,
  createMtsdfBakerFromInstance,
  msdfBakerFromCore,
  readMtsdfBakerAbi,
} from '@pmndrs/text/bakers/msdf'
import {
  MSDF_EXTENSION,
  MTSDF_EM_SIZE,
  MTSDF_PIXEL_RANGE,
  MTSDF_PLANE_UNITS_PER_EM,
  msdfDescriptor,
  msdfDescriptorRasterKey,
} from '@pmndrs/text/raster/msdf'

const wasmUrl = new URL('../../dist/mtsdf_baker.wasm', import.meta.url)
const abiUrl = new URL('../../dist/mtsdf-baker-abi-v0.json', import.meta.url)
const fontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
  import.meta.url,
)
const shapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09'
const publishedAbi = JSON.parse(await readFile(abiUrl, 'utf8'))

async function setup() {
  const [wasm, source] = await Promise.all([readFile(wasmUrl), readFile(fontUrl)])
  const module = await WebAssembly.compile(wasm)
  const instance = await WebAssembly.instantiate(module, {})
  return {
    source: new Uint8Array(source),
    module,
    instance,
    core: await createMtsdfBaker(module),
  }
}

test('ships one zero-import generator and artifact baker contract', async () => {
  const { module, instance } = await setup()
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  const embedded = readMtsdfBakerAbi(instance)
  assert.deepEqual(embedded, publishedAbi)
  assert.deepEqual(embedded.artifactBaker.versions, {
    generator: '0.0.0',
    ktx2: '0.5.0',
    msdfFormat: 0,
    readFonts: '0.42.1',
    skrifa: '0.45.1',
  })
})

test('bakes canonical Inter through the public direct-memory shim', async () => {
  const { source, core } = await setup()
  const descriptor = msdfDescriptor()
  const rasterKey = await msdfDescriptorRasterKey()
  assert.equal(rasterKey, 'e944ba8d2856314856289466e82e471e0adc0775a7c9c3affec7c59bfdd8fe93')
  const result = await msdfBakerFromCore(core).bake({
    font: {
      source,
      fontFaceIndex: 0,
      glyphCount: 2937,
      shapingHash,
    },
    rasterKey,
    packaging: { artifact: 'external', pages: 'external' },
    descriptor,
  })

  assert.equal(result.kind, 'msdf')
  assert.equal(result.extension, MSDF_EXTENSION)
  assert.equal(result.version, 0)
  assert.equal(result.report.metadataBytes, 2937 * 20)
  assert.ok(result.report.gpuBytes > 0)
  assert.ok(result.report.pages.length > 0)
  assert.ok(result.report.pages.every((page) => page.format === 'rgba8unorm'))
  const raster = result.artifacts.find((artifact) => artifact.role === 'raster')
  assert.ok(raster)
  assert.match(raster.id, new RegExp(`^msdf-${shapingHash}-${rasterKey}\\.glb$`))
  const pages = result.artifacts.filter((artifact) => artifact.role === 'raster-page')
  assert.equal(pages.length, result.report.pages.length)
  for (const [index, page] of pages.entries()) {
    assert.match(page.id, new RegExp(`^msdf-${shapingHash}-${rasterKey}-p${index}\\.ktx2$`))
    assert.deepEqual(
      [...page.bytes.subarray(0, 12)],
      [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a],
    )
  }
  const extension = glbRoot(raster.bytes).extensions[MSDF_EXTENSION]
  assert.deepEqual(
    result.artifacts.map(({ bytes, sha256 }) => [bytes.byteLength, sha256]),
    [
      [63_720, 'caf3682e43eba0264ece5c37112e2fd031a1f052f9f9b2d8675dc723d2dce651'],
      [3_989_700, 'f208082adb4f6691f3b0910f5eee58bb58a0b546691a422e0610cfcb377bc841'],
      [4_190_404, '6af434e8459582b961cdb98e2b1b5963b6f7b6b6aff93494793e0629b8f88ae7'],
      [4_161_760, 'e12571a7ab0c74a8776e0f93d8752eecd2433d1034e3665fc5f3eae45e2ecb81'],
      [4_137_316, 'a58cfceb56111a8c70ac2c361f518263e4917e27b72517ab7facd91b8b5fd228'],
      [4_051_140, '77c020c96f930fac803aecc56aec9ac5e9af2077204c6a233d715525f89d28d6'],
      [3_969_644, '4c6243ec2b1b354148b41657dc0f5f82c21a5770897cb55aa3e644bc85298736'],
      [3_845_356, 'efc6bbe31c292afd40ba266d8eb4d819bb37731fd8dea7ab165122f9196444bd'],
      [4_178_128, '309903b82130a9b16c5c31d7405d1f4e375352476f6aabc82fae88dde4147a82'],
      [4_186_308, '716ef2c45e4b6dcddcbdce95e0511abfe07a7ff27205a2372ccc850c9e7960ac'],
      [2_403_940, 'ba146812b0a73fbb82e9bebbf360fd2b5393e64de0202e28b3b635ec1fdc8dc7'],
    ],
  )
  assert.equal(extension.encoding, 'mtsdf')
  assert.equal(extension.emSize, MTSDF_EM_SIZE)
  assert.equal(extension.pixelRange, MTSDF_PIXEL_RANGE)
  assert.equal(extension.planeUnitsPerEm, MTSDF_PLANE_UNITS_PER_EM)
  assert.equal(extension.recordStride, 20)
  assert.equal(extension.pages.length, pages.length)
})

test('rejects a malformed nested artifact contract', () => {
  const malformed = structuredClone(publishedAbi)
  malformed.artifactBaker.functions.bake.parameters = ['wrong']
  assert.throws(
    () => readMtsdfBakerAbi(fakeMtsdfBakerInstance({ abi: malformed })),
    /unsupported MTSDF baker ABI/,
  )
})

test('releases a source allocation when the request allocation fails', () => {
  const released = []
  let allocations = 0
  const core = createMtsdfBakerFromInstance(
    fakeMtsdfBakerInstance({
      allocate: () => (++allocations === 1 ? 4096 : 0),
      deallocate: (pointer, length) => released.push([pointer, length]),
    }),
  )
  assert.throws(
    () =>
      core.bake({
        source: new Uint8Array(8),
        request: {
          fontFaceIndex: 0,
          glyphCount: 1,
          shapingHash: '0'.repeat(64),
          rasterKey: '0'.repeat(64),
          packaging: { artifact: 'external', pages: 'embedded' },
          descriptor: msdfDescriptor(),
        },
      }),
    /allocation failed/,
  )
  assert.deepEqual(released, [[4096, 8]])
})

function glbRoot(bytes) {
  assert.deepEqual([...bytes.subarray(0, 4)], [0x67, 0x6c, 0x54, 0x46])
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)))
}

function fakeMtsdfBakerInstance({
  abi = publishedAbi,
  allocate = () => 0,
  deallocate = () => undefined,
} = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 })
  const abiBytes = new TextEncoder().encode(JSON.stringify(abi))
  new Uint8Array(memory.buffer, 0, abiBytes.byteLength).set(abiBytes)
  return {
    exports: {
      memory,
      pmndrs_text_mtsdf_abi_ptr: () => 0,
      pmndrs_text_mtsdf_abi_len: () => abiBytes.byteLength,
      pmndrs_text_mtsdf_alloc: allocate,
      pmndrs_text_mtsdf_dealloc: deallocate,
      pmndrs_text_mtsdf_bake: () => 0,
      pmndrs_text_mtsdf_bake_result_len: () => 0,
    },
  }
}
