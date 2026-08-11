import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureCommand } from './support/capture-command.mjs';
import { writeGeneratedTypescriptAbi } from './support/generated-typescript-abi.mjs';
import { reproducibleRustEnvironment } from './support/reproducible-rust-env.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsc = fileURLToPath(
  new URL(process.platform === 'win32' ? '../node_modules/.bin/tsc.CMD' : '../node_modules/.bin/tsc', import.meta.url),
);
const rustEnvironment = reproducibleRustEnvironment(workspaceRoot);
const shaperSimdSetting = process.env.PMNDRS_TEXT_SHAPER_SIMD;
if (shaperSimdSetting !== undefined && shaperSimdSetting !== '0' && shaperSimdSetting !== '1') {
  throw new Error('PMNDRS_TEXT_SHAPER_SIMD must be 0 or 1');
}
const shaperSimd = shaperSimdSetting !== '0';
const shaperTargetDirectory = fileURLToPath(
  new URL(`../rust/shaper/target/wasm-${shaperSimd ? 'simd128' : 'scalar'}/`, import.meta.url),
);
const mtsdfArtifactTargetDirectory = fileURLToPath(
  new URL('../rust/mtsdf-baker/target/artifact-baker-wasm/', import.meta.url),
);
const slugArtifactTargetDirectory = fileURLToPath(
  new URL('../rust/slug-baker/target/artifact-baker-wasm/', import.meta.url),
);
const shaperRustEnvironment = {
  ...rustEnvironment,
  CARGO_TARGET_DIR: shaperTargetDirectory,
  CARGO_ENCODED_RUSTFLAGS: `${rustEnvironment.CARGO_ENCODED_RUSTFLAGS}\u001f-C\u001ftarget-feature=${shaperSimd ? '+simd128' : '-simd128'}`,
};
const mtsdfArtifactRustEnvironment = {
  ...rustEnvironment,
  CARGO_TARGET_DIR: mtsdfArtifactTargetDirectory,
};
const slugArtifactRustEnvironment = {
  ...rustEnvironment,
  CARGO_TARGET_DIR: slugArtifactTargetDirectory,
};
const executable = process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt';
const wasmOpt = fileURLToPath(new URL(`../node_modules/.bin/${executable}`, import.meta.url));
const rustWasm = fileURLToPath(
  new URL('../rust/bitmap-baker/target/wasm32-unknown-unknown/release/pmndrs_text_bitmap_baker.wasm', import.meta.url),
);
const distributedWasm = fileURLToPath(new URL('../dist/bitmap_baker.wasm', import.meta.url));
const shaperWasm = join(shaperTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_text_shaper.wasm');
const distributedShaperWasm = fileURLToPath(new URL('../dist/text_shaper.wasm', import.meta.url));
const mtsdfWasm = join(mtsdfArtifactTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_text_mtsdf_baker.wasm');
const distributedMtsdfWasm = fileURLToPath(new URL('../dist/mtsdf_baker.wasm', import.meta.url));
const slugWasm = join(slugArtifactTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_text_slug_baker.wasm');
const distributedSlugWasm = fileURLToPath(new URL('../dist/slug_baker.wasm', import.meta.url));
const fontBakerWasm = fileURLToPath(
  new URL('../rust/font-baker/target/wasm32-unknown-unknown/release/pmndrs_text_font_baker.wasm', import.meta.url),
);
const distributedFontBakerWasm = fileURLToPath(new URL('../dist/font_baker.wasm', import.meta.url));

const [bitmapAbiJson, shaperAbiJson, mtsdfAbiJson, slugAbiJson, fontBakerAbiJson] = await Promise.all([
  runCapture('cargo', [
    'run',
    '--manifest-path',
    'rust/bitmap-baker/Cargo.toml',
    '--bin',
    'generate-bitmap-abi',
    '--locked',
    '--quiet',
  ]),
  runCapture('cargo', [
    'run',
    '--manifest-path',
    'rust/shaper/Cargo.toml',
    '--bin',
    'generate-shaper-abi',
    '--locked',
    '--quiet',
  ]),
  runCapture('cargo', [
    'run',
    '--manifest-path',
    'rust/mtsdf-baker/Cargo.toml',
    '--bin',
    'generate-mtsdf-abi',
    '--locked',
    '--quiet',
  ]),
  runCapture('cargo', [
    'run',
    '--manifest-path',
    'rust/slug-baker/Cargo.toml',
    '--bin',
    'generate-slug-abi',
    '--locked',
    '--quiet',
  ]),
  runCapture('cargo', [
    'run',
    '--manifest-path',
    'rust/font-baker/Cargo.toml',
    '--bin',
    'generate-abi',
    '--locked',
    '--quiet',
  ]),
]);
await Promise.all([
  writeGeneratedTypescriptAbi(
    new URL('../src/generated/bitmap-baker-abi.ts', import.meta.url),
    'bitmapBakerAbi',
    bitmapAbiJson,
    { check: process.env.CI === 'true' },
  ),
  writeGeneratedTypescriptAbi(
    new URL('../src/generated/text-shaper-abi.ts', import.meta.url),
    'textShaperAbi',
    shaperAbiJson,
    { check: process.env.CI === 'true' },
  ),
  writeGeneratedTypescriptAbi(
    new URL('../src/generated/mtsdf-baker-abi.ts', import.meta.url),
    'mtsdfBakerAbi',
    mtsdfAbiJson,
    { check: process.env.CI === 'true' },
  ),
  writeGeneratedTypescriptAbi(
    new URL('../src/generated/slug-baker-abi.ts', import.meta.url),
    'slugBakerAbi',
    slugAbiJson,
    { check: process.env.CI === 'true' },
  ),
  writeGeneratedTypescriptAbi(
    new URL('../src/font-baker/generated/font-baker-abi.ts', import.meta.url),
    'fontBakerAbi',
    fontBakerAbiJson,
    { check: process.env.CI === 'true' },
  ),
]);

await run(
  'cargo',
  [
    'build',
    '--manifest-path',
    'rust/bitmap-baker/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
  ],
  rustEnvironment,
);
await run(
  'cargo',
  [
    'build',
    '--manifest-path',
    'rust/slug-baker/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
    '--features',
    'artifact-baker',
  ],
  slugArtifactRustEnvironment,
);
await run(
  'cargo',
  [
    'build',
    '--manifest-path',
    'rust/mtsdf-baker/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
    '--features',
    'artifact-baker',
  ],
  mtsdfArtifactRustEnvironment,
);
await run(
  'cargo',
  [
    'build',
    '--manifest-path',
    'rust/shaper/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
    ...(shaperSimd ? ['--features', 'simd128'] : []),
  ],
  shaperRustEnvironment,
);
await run(
  'cargo',
  [
    'build',
    '--manifest-path',
    'rust/font-baker/Cargo.toml',
    '--target',
    'wasm32-unknown-unknown',
    '--release',
    '--locked',
    '--no-default-features',
    '--features',
    'subsetting',
  ],
  rustEnvironment,
);
await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await run(tsc, ['-p', 'tsconfig.build.json']);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '--merge-similar-functions',
  '-Oz',
  '--merge-similar-functions',
  '-Oz',
  rustWasm,
  '-o',
  distributedWasm,
]);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  ...(shaperSimd ? ['--enable-simd'] : []),
  '--merge-similar-functions',
  '-Oz',
  '--merge-similar-functions',
  '-Oz',
  shaperWasm,
  '-o',
  distributedShaperWasm,
]);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '--merge-similar-functions',
  '-Oz',
  '--merge-similar-functions',
  '-Oz',
  mtsdfWasm,
  '-o',
  distributedMtsdfWasm,
]);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '--merge-similar-functions',
  '-Oz',
  '--merge-similar-functions',
  '-Oz',
  slugWasm,
  '-o',
  distributedSlugWasm,
]);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '--merge-similar-functions',
  '-Oz',
  '--merge-similar-functions',
  '-Oz',
  fontBakerWasm,
  '-o',
  distributedFontBakerWasm,
]);
await Promise.all([
  assertMtsdfArtifactBakerExports(distributedMtsdfWasm, mtsdfAbiJson),
  assertSlugArtifactBakerExports(distributedSlugWasm, slugAbiJson),
]);
await writeFile(new URL('../dist/bitmap-baker-abi-v0.json', import.meta.url), bitmapAbiJson);
await writeFile(new URL('../dist/text-shaper-abi-v0.json', import.meta.url), shaperAbiJson);
await writeFile(new URL('../dist/mtsdf-baker-abi-v1.json', import.meta.url), mtsdfAbiJson);
await writeFile(new URL('../dist/slug-baker-abi-v0.json', import.meta.url), slugAbiJson);
await writeFile(new URL('../dist/font-baker-abi-v0.json', import.meta.url), fontBakerAbiJson);
await mkdir(new URL('../dist/font-baker/schemas/', import.meta.url), { recursive: true });
await copyFile(
  new URL('../src/font-baker/schemas/KHRONOS-SPEC-LICENSE.txt', import.meta.url),
  new URL('../dist/font-baker/schemas/KHRONOS-SPEC-LICENSE.txt', import.meta.url),
);
await copyFile(
  new URL('../src/font-baker/schemas/README.md', import.meta.url),
  new URL('../dist/font-baker/schemas/README.md', import.meta.url),
);
if (process.platform !== 'win32') {
  await chmod(new URL('../dist/node/cli.js', import.meta.url), 0o755);
}

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function runCapture(command, args) {
  return captureCommand(command, args, { cwd: packageRoot });
}

async function assertMtsdfArtifactBakerExports(wasmPath, abiJson) {
  const abi = JSON.parse(abiJson);
  await assertWasmExports(wasmPath, Object.values(abi.artifactBaker.functions), 'MTSDF');
}

async function assertSlugArtifactBakerExports(wasmPath, abiJson) {
  const abi = JSON.parse(abiJson);
  await assertWasmExports(
    wasmPath,
    [...Object.values(abi.functions), ...Object.values(abi.segmented.functions)],
    'Slug',
  );
}

async function assertWasmExports(wasmPath, functions, label) {
  const module = await WebAssembly.compile(await readFile(wasmPath));
  const exports = new Set(WebAssembly.Module.exports(module).map(({ name }) => name));
  for (const definition of functions) {
    if (!exports.has(definition.export)) {
      throw new Error(`${label} distributable Wasm is missing artifact-baker export ${definition.export}`);
    }
  }
}
