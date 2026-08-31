/* @workflow {
  "name": "glyph:mtsdf-admission-size",
  "summary": "Verify or refresh the feature-minimal MTSDF generator size evidence.",
  "requirements": "Pinned Rust and Binaryen toolchains through mise. Pass --write to refresh same-host evidence.",
  "writes": "stdout only, or rust/mtsdf-admission/evidence/size-v0.json with --write"
} */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { assertHostSizeEvidenceFresh } from './support/host-size-evidence.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const evidencePath = join(packageRoot, 'rust/mtsdf-admission/evidence/size-v0.json');
const recorded = JSON.parse(await readFile(evidencePath, 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'glyph-mtsdf-admission-'));

try {
  const target = join(scratch, 'target');
  execFileSync(
    'cargo',
    [
      'build',
      '--manifest-path',
      'rust/mtsdf-admission/Cargo.toml',
      '--target',
      'wasm32-unknown-unknown',
      '--release',
      '--locked',
    ],
    { cwd: packageRoot, env: { ...process.env, CARGO_TARGET_DIR: target }, stdio: 'inherit' },
  );
  const raw = await readFile(join(target, 'wasm32-unknown-unknown/release/pmndrs_glyph_mtsdf_admission.wasm'));
  const optimizedPath = join(scratch, 'mtsdf-admission-opt.wasm');
  execFileSync(
    process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt',
    [
      '-Oz',
      '--enable-bulk-memory',
      '--enable-nontrapping-float-to-int',
      join(target, 'wasm32-unknown-unknown/release/pmndrs_glyph_mtsdf_admission.wasm'),
      '-o',
      optimizedPath,
    ],
    { cwd: packageRoot, stdio: 'inherit' },
  );
  const optimized = await readFile(optimizedPath);
  const module = await WebAssembly.compile(optimized);
  const { exports } = await WebAssembly.instantiate(module, {});
  const current = {
    ...recorded,
    // The Wasm export returns an i32, so a checksum with the high bit set arrives negative and
    // formats as a signed hex string. Coerce to unsigned before rendering the identity.
    syntheticOutputFnv1a32: (exports.pmndrs_mtsdf_admission_checksum() >>> 0).toString(16).padStart(8, '0'),
    wasmImportCount: WebAssembly.Module.imports(module).length,
    measurementHost: { platform: platform(), architecture: arch() },
    rawBytes: raw.byteLength,
    optimizedBytes: optimized.byteLength,
    gzipBytes: gzipSync(optimized, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(optimized, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    optimizedSha256: createHash('sha256').update(optimized).digest('hex'),
  };
  const budgets = {
    rawBytes: 78_000,
    optimizedBytes: 71_000,
    gzipBytes: 31_000,
    brotliBytes: 26_000,
  };
  if (process.argv.includes('--write')) {
    assertHostSizeEvidenceFresh(current, current, budgets);
    await writeFile(evidencePath, `${JSON.stringify(current, null, 2)}\n`);
  } else {
    assertHostSizeEvidenceFresh(recorded, current, budgets);
  }
  process.stdout.write(`${JSON.stringify(current, null, 2)}\n`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
