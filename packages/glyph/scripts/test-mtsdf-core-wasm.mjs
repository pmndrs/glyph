import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mtsdfBakerAbi as abi } from '../dist/mtsdf-baker-abi.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = 'rust/mtsdf-baker/Cargo.toml';
const targetDirectory = fileURLToPath(new URL('../rust/mtsdf-baker/target/kernel-only-wasm/', import.meta.url));
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
  { cwd: packageRoot, env: { ...process.env, CARGO_TARGET_DIR: targetDirectory }, stdio: 'inherit' },
);

const bytes = await readFile(join(targetDirectory, 'wasm32-unknown-unknown/release/pmndrs_glyph_mtsdf_baker.wasm'));
const module = await WebAssembly.compile(bytes);
assert.deepEqual(WebAssembly.Module.imports(module), []);
const { exports } = await WebAssembly.instantiate(module, {});
const memory = exports.memory;
assert.ok(memory instanceof WebAssembly.Memory);
assert.equal(abi.name, 'pmndrs-glyph-mtsdf-baker');
assert.ok(abi.artifactBaker);
const exportNames = new Set(WebAssembly.Module.exports(module).map(({ name }) => name));
for (const definition of Object.values(abi.artifactBaker.functions)) {
  assert.equal(exportNames.has(definition.export), false);
}
assert.equal(abi.layouts.request.size, 48);
assert.equal(abi.layouts.command.size, 28);

const commands = [[0, 100, 100], [1, 100, 900], [1, 900, 900], [1, 900, 100], [4]];
const requestLength = abi.layouts.request.size + commands.length * abi.layouts.command.size;
const requestPointer = exports.pmndrs_glyph_mtsdf_alloc(requestLength);
assert.notEqual(requestPointer, 0);
const request = new DataView(memory.buffer, requestPointer, requestLength);
const u32 = (offset, value) => request.setUint32(offset, value, true);
const f32 = (offset, value) => request.setFloat32(offset, value, true);
u32(abi.layouts.request.byteLength, requestLength);
u32(abi.layouts.request.commandsOffset, abi.layouts.request.size);
u32(abi.layouts.request.commandCount, commands.length);
f32(abi.layouts.request.unitsPerEm, 1000);
f32(abi.layouts.request.minX, 100);
f32(abi.layouts.request.minY, 100);
f32(abi.layouts.request.maxX, 900);
f32(abi.layouts.request.maxY, 900);
u32(abi.layouts.request.innerWidth, 32);
u32(abi.layouts.request.innerHeight, 32);
u32(abi.layouts.request.paddingX, 4);
u32(abi.layouts.request.paddingY, 4);
for (const [index, command] of commands.entries()) {
  const offset = abi.layouts.request.size + index * abi.layouts.command.size;
  u32(offset, command[0]);
  for (let value = 1; value < command.length; value += 1) f32(offset + value * 4, command[value]);
}

assert.equal(exports.pmndrs_glyph_mtsdf_generate(requestPointer, requestLength), abi.status.ok);
const resultPointer = exports.pmndrs_glyph_mtsdf_result_ptr();
const resultLength = exports.pmndrs_glyph_mtsdf_result_len();
assert.equal(resultLength, 40 * 40 * 4);
const output = new Uint8Array(memory.buffer, resultPointer, resultLength);
let hash = 0x811c9dc5;
for (const byte of output) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
assert.equal(hash, 0x4f1de5a5);

const { createMtsdfGenerator } = await import('../dist/internal/mtsdf-generator.js');
const generator = await createMtsdfGenerator(module);
const generated = generator.generate({
  unitsPerEm: 1_000,
  bounds: { minX: 100, minY: 100, maxX: 900, maxY: 900 },
  region: { innerWidth: 32, innerHeight: 32, paddingX: 4, paddingY: 4 },
  commands: [
    { kind: 'move', x: 100, y: 100 },
    { kind: 'line', x: 100, y: 900 },
    { kind: 'line', x: 900, y: 900 },
    { kind: 'line', x: 900, y: 100 },
    { kind: 'close' },
  ],
});
assert.equal(generated.rgba.byteLength, 40 * 40 * 4);

exports.pmndrs_glyph_mtsdf_dealloc(requestPointer, requestLength);
assert.equal(exports.pmndrs_glyph_mtsdf_generate(requestPointer, requestLength), abi.status.invalidRequest);
