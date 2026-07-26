import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createFontBaker } from '../../../font-baker/dist/index.js'
import { validateFontArtifact } from '../../../font-baker/dist/validator.js'

const wasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url)
const abiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url)

test('fixed-seed shaper request mutations fail safely and deterministically', async () => {
  const [wasm, abi, source, bakerWasm] = await Promise.all([
    readFile(wasmUrl),
    readFile(abiUrl, 'utf8').then(JSON.parse),
    readFile(
      new URL(
        '../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
        import.meta.url,
      ),
    ),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
  ])
  const artifact = (await createFontBaker(bakerWasm)).bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes
  const font = await validateFontArtifact(artifact)
  const module = await WebAssembly.compile(wasm)
  const corpus = mutationCorpus()
  const first = await execute(module, abi, corpus, font)
  const second = await execute(module, abi, corpus, font)
  assert.deepEqual(first, second)
  assert.deepEqual(first.slice(0, 2), [0, 0], 'both seed requests must reach shaping')
  assert.ok(first.every((status) => Number.isSafeInteger(status) && status >= 0 && status <= 7))
  assert.ok(
    first.slice(2).some((status) => status === 0),
    'mutations must reach valid shaping paths',
  )
  assert.ok(
    first.slice(2).some((status) => status !== 0),
    'mutations must retain malformed paths',
  )
})

test('raw shaper allocations reject forged releases and recover after invalid requests', async () => {
  const wasm = await readFile(wasmUrl)
  const module = await WebAssembly.compile(wasm)
  const instance = await WebAssembly.instantiate(module, {})
  const memory = instance.exports.memory
  const allocate = instance.exports.pmndrs_text_shaper_alloc
  const deallocate = instance.exports.pmndrs_text_shaper_dealloc
  const shapeBatch = instance.exports.pmndrs_text_shaper_shape_batch
  assert.ok(memory instanceof WebAssembly.Memory)
  assert.equal(typeof allocate, 'function')
  assert.equal(typeof deallocate, 'function')
  assert.equal(typeof shapeBatch, 'function')

  assert.equal(allocate(64 * 1024 * 1024 + 1), 0)
  const bytes = shapeRequest()
  const pointer = allocate(bytes.byteLength)
  assert.notEqual(pointer, 0)
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes)
  deallocate(pointer + 1, bytes.byteLength - 1)
  deallocate(pointer, bytes.byteLength - 1)
  assert.equal(shapeBatch(pointer, bytes.byteLength), 5)
  deallocate(pointer, bytes.byteLength)
  deallocate(pointer, bytes.byteLength)

  const recovered = allocate(bytes.byteLength)
  assert.notEqual(recovered, 0)
  deallocate(recovered, bytes.byteLength)
})

async function execute(module, abi, corpus, font) {
  const instance = await WebAssembly.instantiate(module, {})
  const memory = instance.exports.memory
  const allocate = instance.exports[abi.functions.allocate]
  const deallocate = instance.exports[abi.functions.deallocate]
  const registerFont = instance.exports[abi.functions.registerFont]
  const disposeFont = instance.exports[abi.functions.disposeFont]
  const shapeBatch = instance.exports[abi.functions.shapeBatch]
  const reshapeRanges = instance.exports[abi.functions.reshapeRanges]
  const fontInputs = [font.shapingSfnt, font.glyphExtents, font.glyphExtentsAvailability]
  const fontPointers = fontInputs.map((bytes) => copyBytes(memory, allocate, bytes))
  assert.equal(
    registerFont(
      1,
      fontPointers[0],
      fontInputs[0].byteLength,
      fontPointers[1],
      fontInputs[1].byteLength,
      fontPointers[2],
      fontInputs[2].byteLength,
    ),
    0,
  )
  for (let index = 0; index < fontInputs.length; index += 1) {
    deallocate(fontPointers[index], fontInputs[index].byteLength)
  }
  const statuses = []
  for (const { bytes, reshape } of corpus) {
    const pointer = allocate(bytes.length)
    new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes)
    statuses.push((reshape ? reshapeRanges : shapeBatch)(pointer, bytes.length))
    deallocate(pointer, bytes.length)
  }
  const outOfBounds = memory.buffer.byteLength - 2
  statuses.push(shapeBatch(outOfBounds, 8))
  statuses.push(reshapeRanges(outOfBounds, 8))
  assert.equal(disposeFont(1), 0)
  return statuses
}

function copyBytes(memory, allocate, bytes) {
  const pointer = allocate(bytes.byteLength)
  assert.notEqual(pointer, 0)
  new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes)
  return pointer
}

function mutationCorpus() {
  const bases = [shapeRequest(), reshapeRequest()]
  const corpus = bases.map((bytes, reshape) => ({ bytes, reshape: reshape === 1 }))
  let state = 0x504d_4e44
  for (const [baseIndex, base] of bases.entries()) {
    for (let mutation = 0; mutation < 128; mutation++) {
      const bytes = base.slice()
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      const offset = state % bytes.length
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      bytes[offset] ^= state & 0xff || 1
      corpus.push({ bytes, reshape: baseIndex === 1 })
    }
  }
  return corpus
}

function shapeRequest() {
  const bytes = new Uint8Array(68)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 32, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, 36, true)
  view.setUint32(12, 1, true)
  view.setUint32(16, 68, true)
  view.setUint32(20, 0, true)
  view.setUint32(24, 68, true)
  view.setUint32(28, 0, true)
  view.setUint16(32, 0x41, true)
  writeRun(view, 36)
  return bytes
}

function reshapeRequest() {
  const bytes = new Uint8Array(100)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 40, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, 44, true)
  view.setUint32(12, 1, true)
  view.setUint32(16, 76, true)
  view.setUint32(20, 0, true)
  view.setUint32(24, 76, true)
  view.setUint32(28, 0, true)
  view.setUint32(32, 76, true)
  view.setUint32(36, 1, true)
  view.setUint16(40, 0x41, true)
  writeRun(view, 44)
  view.setUint32(76, 0, true)
  view.setUint32(80, 0, true)
  view.setUint32(84, 1, true)
  view.setUint32(88, 0, true)
  view.setUint32(92, 1, true)
  view.setUint32(96, 0x40, true)
  return bytes
}

function writeRun(view, offset) {
  view.setUint32(offset, 1, true)
  view.setUint32(offset + 4, 0, true)
  view.setUint32(offset + 8, 1, true)
  view.setUint32(offset + 12, 0x4c61_746e, true)
  view.setUint32(offset + 16, 0xffff_ffff, true)
  view.setUint32(offset + 20, 0, true)
  view.setUint16(offset + 24, 0, true)
  view.setUint8(offset + 26, 0)
  view.setUint8(offset + 27, 0)
  view.setUint32(offset + 28, 0x40, true)
}
