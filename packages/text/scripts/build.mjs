import { spawn } from 'node:child_process';
import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { captureCommand } from '../../font-baker/scripts/capture-command.mjs';
import { reproducibleRustEnvironment } from '../../font-baker/scripts/reproducible-rust-env.mjs';
import { writeGeneratedTypescriptAbi } from '../../font-baker/scripts/generated-typescript-abi.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsc = fileURLToPath(
  new URL(process.platform === 'win32' ? '../node_modules/.bin/tsc.CMD' : '../node_modules/.bin/tsc', import.meta.url),
);
const tsdown = fileURLToPath(
  new URL(
    process.platform === 'win32' ? '../node_modules/.bin/tsdown.CMD' : '../node_modules/.bin/tsdown',
    import.meta.url,
  ),
);
const rustEnvironment = reproducibleRustEnvironment(workspaceRoot);
const executable = process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt';
const wasmOpt = fileURLToPath(new URL(`../node_modules/.bin/${executable}`, import.meta.url));
const rustWasm = fileURLToPath(
  new URL('../rust/bitmap-baker/target/wasm32-unknown-unknown/release/pmndrs_text_bitmap_baker.wasm', import.meta.url),
);
const distributedWasm = fileURLToPath(new URL('../dist/bitmap_baker.wasm', import.meta.url));
const shaperWasm = fileURLToPath(
  new URL('../rust/shaper/target/wasm32-unknown-unknown/release/pmndrs_text_shaper.wasm', import.meta.url),
);
const distributedShaperWasm = fileURLToPath(new URL('../dist/text_shaper.wasm', import.meta.url));
const mtsdfWasm = fileURLToPath(
  new URL('../rust/mtsdf-baker/target/wasm32-unknown-unknown/release/pmndrs_text_mtsdf_baker.wasm', import.meta.url),
);
const distributedMtsdfWasm = fileURLToPath(new URL('../dist/mtsdf_baker.wasm', import.meta.url));
const slugWasm = fileURLToPath(
  new URL('../rust/slug-baker/target/wasm32-unknown-unknown/release/pmndrs_text_slug_baker.wasm', import.meta.url),
);
const distributedSlugWasm = fileURLToPath(new URL('../dist/slug_baker.wasm', import.meta.url));

const [bitmapAbiJson, shaperAbiJson, mtsdfAbiJson, slugAbiJson] = await Promise.all([
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
  rustEnvironment,
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
  rustEnvironment,
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
  ],
  rustEnvironment,
);
// `tsdown` emits without typechecking, so the compiler keeps owning the build gate.
await run(tsc, ['-p', 'tsconfig.build.json', '--noEmit']);
await run(tsdown);
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await rm(new URL('../dist/font_baker.wasm', import.meta.url), { force: true });
await rm(new URL('../dist/mtsdf-baker-abi-v0.json', import.meta.url), { force: true });
await rm(new URL('../dist/slug-baker-abi-v1.json', import.meta.url), { force: true });
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '-Oz',
  rustWasm,
  '-o',
  distributedWasm,
]);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '-Oz',
  shaperWasm,
  '-o',
  distributedShaperWasm,
]);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '-Oz',
  mtsdfWasm,
  '-o',
  distributedMtsdfWasm,
]);
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '-Oz',
  slugWasm,
  '-o',
  distributedSlugWasm,
]);
await writeFile(new URL('../dist/bitmap-baker-abi-v0.json', import.meta.url), bitmapAbiJson);
await writeFile(new URL('../dist/text-shaper-abi-v0.json', import.meta.url), shaperAbiJson);
await writeFile(new URL('../dist/mtsdf-baker-abi-v1.json', import.meta.url), mtsdfAbiJson);
await writeFile(new URL('../dist/slug-baker-abi-v0.json', import.meta.url), slugAbiJson);
if (process.platform !== 'win32') {
  await chmod(new URL('../dist/node/cli.js', import.meta.url), 0o755);
}

function run(command, args = [], environment = process.env) {
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
