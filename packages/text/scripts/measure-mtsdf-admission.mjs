import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { reproducibleRustEnvironment } from '../../font-baker/scripts/reproducible-rust-env.mjs';
import { assertHostSizeEvidenceFresh } from './support/host-size-evidence.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const rustEnvironment = reproducibleRustEnvironment(workspaceRoot);
const executable = process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt';
const wasmOpt = fileURLToPath(new URL(`../node_modules/.bin/${executable}`, import.meta.url));
const rawWasm = fileURLToPath(
  new URL(
    '../rust/mtsdf-admission/target/wasm32-unknown-unknown/release/pmndrs_text_mtsdf_admission.wasm',
    import.meta.url,
  ),
);
const optimizedWasm = fileURLToPath(
  new URL('../rust/mtsdf-admission/target/mtsdf-admission-opt.wasm', import.meta.url),
);
const evidenceUrl = new URL('../rust/mtsdf-admission/evidence/size-v0.json', import.meta.url);
const sizeBudgets = { rawBytes: 68_000, optimizedBytes: 61_000, gzipBytes: 27_000, brotliBytes: 23_000 };

await run('cargo', [
  'build',
  '--manifest-path',
  'rust/mtsdf-admission/Cargo.toml',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
]);
await run(wasmOpt, ['--enable-bulk-memory', '--enable-nontrapping-float-to-int', '-Oz', rawWasm, '-o', optimizedWasm]);

const [rawBytes, optimizedBytes, dependencyTree] = await Promise.all([
  readFile(rawWasm),
  readFile(optimizedWasm),
  capture('cargo', [
    'tree',
    '--manifest-path',
    'rust/mtsdf-admission/Cargo.toml',
    '--edges',
    'normal',
    '--no-default-features',
    '--locked',
  ]),
]);
for (const forbiddenDependency of ['skrifa', 'wgpu', 'ttf-parser']) {
  if (dependencyTree.includes(`${forbiddenDependency} v`)) {
    throw new Error(`MTSDF admission graph unexpectedly contains ${forbiddenDependency}`);
  }
}
const module = await WebAssembly.compile(optimizedBytes);
const imports = WebAssembly.Module.imports(module);
if (imports.length !== 0) {
  throw new Error(`MTSDF admission Wasm unexpectedly imports ${String(imports.length)} values`);
}
const instance = await WebAssembly.instantiate(module, {});
const checksumExport = instance.exports.pmndrs_mtsdf_admission_checksum;
if (typeof checksumExport !== 'function') {
  throw new TypeError('optimized admission Wasm is missing its checksum export');
}
// WebAssembly exposes an `i32` result as a signed JavaScript number. Normalize the
// bits before comparing or serializing FNV-1a identities above 0x7fffffff.
const outputChecksum = checksumExport() >>> 0;
if (outputChecksum !== 0xbfc7_6761) {
  throw new Error(`optimized admission Wasm returned unexpected checksum ${String(outputChecksum)}`);
}

const evidence = {
  schemaVersion: 0,
  kind: 'mtsdf-generator-admission-size',
  candidate: {
    crate: 'pmndrs-text-mtsdf-core',
    version: '0.0.0',
    source: 'repository-owned',
    defaultFeatures: false,
  },
  toolchain: {
    rust: '1.97.1',
    binaryen: '129.0.0',
    target: 'wasm32-unknown-unknown',
  },
  syntheticOutputFnv1a32: outputChecksum.toString(16).padStart(8, '0'),
  wasmImportCount: imports.length,
  measurementHost: {
    platform: process.platform,
    architecture: process.arch,
  },
  rawBytes: rawBytes.byteLength,
  optimizedBytes: optimizedBytes.byteLength,
  gzipBytes: gzipSync(optimizedBytes, { level: 9, mtime: 0 }).byteLength,
  brotliBytes: brotliCompressSync(optimizedBytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength,
  optimizedSha256: createHash('sha256').update(optimizedBytes).digest('hex'),
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const recorded = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assertHostSizeEvidenceFresh(recorded, evidence, sizeBudgets);
} else {
  await writeFile(evidenceUrl, serialized);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: rustEnvironment,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: rustEnvironment,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'));
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}
