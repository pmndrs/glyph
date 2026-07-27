import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MtsdfGenerationError,
  createMtsdfGenerator,
  createMtsdfGeneratorFromInstance,
  readMtsdfGeneratorAbi,
} from '../../dist/internal/mtsdf-generator.js'
import { mtsdfOracleCases } from '../fixtures/mtsdf-oracle-cases.mjs'

const wasmUrl = new URL('../../dist/mtsdf_baker.wasm', import.meta.url)
const abiUrl = new URL('../../dist/mtsdf-baker-abi-v0.json', import.meta.url)
const publishedAbi = JSON.parse(await readFile(abiUrl, 'utf8'))

async function setup() {
  const bytes = await readFile(wasmUrl)
  const module = await WebAssembly.compile(bytes)
  const instance = await WebAssembly.instantiate(module, {})
  return { module, instance, generator: await createMtsdfGenerator(module) }
}

test('ships an optimized zero-import module with the exact generated ABI', async () => {
  const { module, instance } = await setup()
  assert.deepEqual(WebAssembly.Module.imports(module), [])
  assert.deepEqual(readMtsdfGeneratorAbi(instance), publishedAbi)
})

test('matches every native-msdfgen admission case through the TypeScript host', async () => {
  const { generator } = await setup()
  for (const testCase of mtsdfOracleCases) {
    const glyph = generator.generate(testCase.request)
    assert.equal(glyph.width, 40, testCase.id)
    assert.equal(glyph.height, 40, testCase.id)
    assert.equal(glyph.rgba.byteLength, 6_400, testCase.id)
    assert.equal(sha256(glyph.rgba), testCase.candidateSha256, testCase.id)
  }
})

test('copies borrowed output before the next generation and releases every request', async () => {
  const { generator } = await setup()
  const first = generator.generate(mtsdfOracleCases[0].request)
  const snapshot = first.rgba.slice()
  const second = generator.generate(mtsdfOracleCases[1].request)
  assert.deepEqual(first.rgba, snapshot)
  assert.notEqual(sha256(first.rgba), sha256(second.rgba))
})

test('rejects malformed host input before allocation and reports outline failures by status', async () => {
  const { generator } = await setup()
  const valid = mtsdfOracleCases[0].request
  assert.throws(
    () => generator.generate({ ...valid, unitsPerEm: Number.NaN }),
    /unitsPerEm must be finite/,
  )
  assert.throws(() => generator.generate({ ...valid, commands: [] }), /must not be empty/)
  assert.throws(
    () => generator.generate({ ...valid, region: { ...valid.region, paddingX: -1 } }),
    /padding must be a nonnegative safe integer/,
  )
  assert.throws(
    () => generator.generate({ ...valid, commands: [{ kind: 'move', x: 0, y: 0 }] }),
    (error) => error instanceof MtsdfGenerationError && error.code === 'INVALID_OUTLINE',
  )
  assert.throws(
    () =>
      generator.generate({
        ...valid,
        commands: [{ kind: 'move', x: 0, y: 0 }, { kind: 'move', x: 1, y: 1 }, { kind: 'close' }],
      }),
    (error) => error instanceof MtsdfGenerationError && error.code === 'INVALID_OUTLINE',
  )
})

test('rejects forged allocation ownership and recovers after invalid wire bytes', async () => {
  const { instance, generator } = await setup()
  const {
    memory,
    pmndrs_text_mtsdf_alloc: allocate,
    pmndrs_text_mtsdf_dealloc: deallocate,
    pmndrs_text_mtsdf_generate: generate,
  } = instance.exports
  assert.ok(memory instanceof WebAssembly.Memory)
  assert.equal(allocate(64 * 1024 * 1024 + 1), 0)
  const pointer = allocate(48)
  assert.notEqual(pointer, 0)
  new Uint8Array(memory.buffer, pointer, 48).fill(0)
  deallocate(pointer + 1, 47)
  deallocate(pointer, 47)
  assert.equal(generate(pointer, 48), publishedAbi.status.invalidRequest)
  deallocate(pointer, 48)
  deallocate(pointer, 48)
  assert.equal(generate(pointer, 48), publishedAbi.status.invalidRequest)
  assert.equal(
    sha256(generator.generate(mtsdfOracleCases[0].request).rgba),
    mtsdfOracleCases[0].candidateSha256,
  )
})

test('rejects malformed nested ABI fields and releases a request after output validation fails', () => {
  const malformed = structuredClone(publishedAbi)
  malformed.layouts.command.size = 24
  assert.throws(
    () => readMtsdfGeneratorAbi(fakeInstance({ abi: malformed })),
    /unsupported MTSDF generator ABI/,
  )

  const releases = []
  const generator = createMtsdfGeneratorFromInstance(
    fakeInstance({
      allocate: () => 4_096,
      deallocate: (pointer, length) => releases.push([pointer, length]),
      resultPointer: () => 8_192,
      resultLength: () => 1,
    }),
  )
  assert.throws(
    () => generator.generate(mtsdfOracleCases[0].request),
    /unexpected RGBA8 byte length/,
  )
  assert.deepEqual(releases, [[4_096, 188]])
})

function fakeInstance({
  abi = publishedAbi,
  allocate = () => 0,
  deallocate = () => undefined,
  resultPointer = () => 0,
  resultLength = () => 0,
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
      pmndrs_text_mtsdf_generate: () => publishedAbi.status.ok,
      pmndrs_text_mtsdf_result_ptr: resultPointer,
      pmndrs_text_mtsdf_result_len: resultLength,
    },
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
