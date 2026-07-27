import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const manifest = 'rust/mtsdf-baker/Cargo.toml'
execFileSync(
  'cargo',
  [
    'build',
    '--manifest-path',
    manifest,
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
  ],
  { cwd: packageRoot, stdio: 'inherit' },
)

const bytes = await readFile(
  new URL(
    '../rust/mtsdf-baker/target/wasm32-unknown-unknown/release/pmndrs_text_mtsdf_baker.wasm',
    import.meta.url,
  ),
)
const module = await WebAssembly.compile(bytes)
assert.deepEqual(WebAssembly.Module.imports(module), [])
const { exports } = await WebAssembly.instantiate(module, {})
const memory = exports.memory
assert.ok(memory instanceof WebAssembly.Memory)

const abiPointer = exports.pmndrs_text_mtsdf_abi_ptr()
const abiLength = exports.pmndrs_text_mtsdf_abi_len()
const abi = JSON.parse(
  new TextDecoder().decode(new Uint8Array(memory.buffer, abiPointer, abiLength)),
)
assert.equal(abi.name, 'pmndrs-text-mtsdf-baker')
assert.equal(abi.layouts.request.size, 48)
assert.equal(abi.layouts.command.size, 28)

const commands = [[0, 100, 100], [1, 100, 900], [1, 900, 900], [1, 900, 100], [4]]
const requestLength = abi.layouts.request.size + commands.length * abi.layouts.command.size
const requestPointer = exports.pmndrs_text_mtsdf_alloc(requestLength)
assert.notEqual(requestPointer, 0)
const request = new DataView(memory.buffer, requestPointer, requestLength)
const u32 = (offset, value) => request.setUint32(offset, value, true)
const f32 = (offset, value) => request.setFloat32(offset, value, true)
u32(0, requestLength)
u32(4, abi.layouts.request.size)
u32(8, commands.length)
f32(12, 1000)
f32(16, 100)
f32(20, 100)
f32(24, 900)
f32(28, 900)
u32(32, 32)
u32(36, 32)
u32(40, 4)
u32(44, 4)
for (const [index, command] of commands.entries()) {
  const offset = abi.layouts.request.size + index * abi.layouts.command.size
  u32(offset, command[0])
  for (let value = 1; value < command.length; value += 1) f32(offset + value * 4, command[value])
}

assert.equal(exports.pmndrs_text_mtsdf_generate(requestPointer, requestLength), abi.status.ok)
const resultPointer = exports.pmndrs_text_mtsdf_result_ptr()
const resultLength = exports.pmndrs_text_mtsdf_result_len()
assert.equal(resultLength, 40 * 40 * 4)
const output = new Uint8Array(memory.buffer, resultPointer, resultLength)
let hash = 0x811c9dc5
for (const byte of output) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
assert.equal(hash, 0x3d9625f1)

exports.pmndrs_text_mtsdf_dealloc(requestPointer, requestLength)
assert.equal(
  exports.pmndrs_text_mtsdf_generate(requestPointer, requestLength),
  abi.status.invalidRequest,
)
