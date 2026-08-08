import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { reproducibleRustEnvironment } from '../../font-baker/scripts/reproducible-rust-env.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputRoot = fileURLToPath(new URL('../rust/shaper/target/kernel-lab/', import.meta.url));
const executable = process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt';
const wasmOpt = fileURLToPath(new URL(`../node_modules/.bin/${executable}`, import.meta.url));
const disExecutable = process.platform === 'win32' ? 'wasm-dis.CMD' : 'wasm-dis';
const wasmDis = fileURLToPath(new URL(`../node_modules/.bin/${disExecutable}`, import.meta.url));
const encodedFlagSeparator = '\u001f';
const variants = [
  { name: 'scalar', targetFeature: '-simd128', features: 'kernel-lab', simd: false },
  { name: 'auto', targetFeature: '+simd128', features: 'kernel-lab', simd: true },
  { name: 'explicit', targetFeature: '+simd128', features: 'kernel-lab,simd128', simd: true },
];

await mkdir(outputRoot, { recursive: true });
for (const variant of variants) {
  const targetDirectory = `${outputRoot}/${variant.name}-target`;
  const environment = reproducibleRustEnvironment(workspaceRoot);
  environment.CARGO_ENCODED_RUSTFLAGS += `${encodedFlagSeparator}-C${encodedFlagSeparator}target-feature=${variant.targetFeature}`;
  await run(
    'cargo',
    [
      'build',
      '--manifest-path',
      'rust/shaper/Cargo.toml',
      '--target',
      'wasm32-unknown-unknown',
      '--target-dir',
      targetDirectory,
      '--release',
      '--locked',
      '--no-default-features',
      '--features',
      variant.features,
    ],
    environment,
  );
  const rustWasm = `${targetDirectory}/wasm32-unknown-unknown/release/pmndrs_text_shaper.wasm`;
  await run(wasmOpt, [
    '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int',
    ...(variant.simd ? ['--enable-simd'] : []),
    '-Oz',
    rustWasm,
    '-o',
    `${outputRoot}/${variant.name}.wasm`,
  ]);
  await run(wasmDis, [
    ...(variant.simd ? ['--enable-simd'] : []),
    `${outputRoot}/${variant.name}.wasm`,
    '-o',
    `${outputRoot}/${variant.name}.wat`,
  ]);
}

function run(command, arguments_, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: packageRoot, env: environment, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}
