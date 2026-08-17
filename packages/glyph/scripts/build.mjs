import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureCommand } from './support/capture-command.mjs';
import { writeGeneratedTypescriptAbi } from './support/generated-typescript-abi.mjs';
import { reproducibleRustEnvironment } from './support/reproducible-rust-env.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
// The distribution is assembled in a staging directory and swapped into place by two
// renames. Emptying `dist/` up front and refilling it file by file leaves consumers --
// a watching dev server above all -- reading a package that is missing for the length of
// a Rust build, which they observe as a burst of 404s and invalidations. Staging makes
// the switch a single atomic-enough step: one invalidation, never a partial tree.
const distributionDirectory = new URL('../dist/', import.meta.url);
const stagingDirectory = new URL('../.dist-staging/', import.meta.url);
const supersededDirectory = new URL('../.dist-superseded/', import.meta.url);
const staged = (path) => new URL(path, stagingDirectory);
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const tsc = fileURLToPath(
  new URL(process.platform === 'win32' ? '../node_modules/.bin/tsc.CMD' : '../node_modules/.bin/tsc', import.meta.url),
);
const rustEnvironment = reproducibleRustEnvironment(workspaceRoot);
const shaperSimdSetting = process.env.PMNDRS_GLYPH_SHAPER_SIMD;
if (shaperSimdSetting !== undefined && shaperSimdSetting !== '0' && shaperSimdSetting !== '1') {
  throw new Error('PMNDRS_GLYPH_SHAPER_SIMD must be 0 or 1');
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
  new URL('../rust/bitmap-baker/target/wasm32-unknown-unknown/release/pmndrs_glyph_bitmap_baker.wasm', import.meta.url),
);
const distributedWasm = fileURLToPath(staged('bitmap_baker.wasm'));
const shaperWasm = join(shaperTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm');
const distributedShaperWasm = fileURLToPath(staged('text_shaper.wasm'));
const mtsdfWasm = join(mtsdfArtifactTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_glyph_mtsdf_baker.wasm');
const distributedMtsdfWasm = fileURLToPath(staged('mtsdf_baker.wasm'));
const slugWasm = join(slugArtifactTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_glyph_slug_baker.wasm');
const distributedSlugWasm = fileURLToPath(staged('slug_baker.wasm'));
const fontBakerWasm = fileURLToPath(
  new URL('../rust/font-baker/target/wasm32-unknown-unknown/release/pmndrs_glyph_font_baker.wasm', import.meta.url),
);
const distributedFontBakerWasm = fileURLToPath(staged('font_baker.wasm'));

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
await rm(stagingDirectory, { recursive: true, force: true });
await rm(supersededDirectory, { recursive: true, force: true });
await mkdir(stagingDirectory, { recursive: true });
await run(tsc, ['-p', 'tsconfig.build.json', '--outDir', fileURLToPath(stagingDirectory)]);
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
await writeFile(staged('bitmap-baker-abi-v0.json'), bitmapAbiJson);
await writeFile(staged('text-shaper-abi-v0.json'), shaperAbiJson);
await writeFile(staged('mtsdf-baker-abi-v1.json'), mtsdfAbiJson);
await writeFile(staged('slug-baker-abi-v0.json'), slugAbiJson);
await writeFile(staged('font-baker-abi-v0.json'), fontBakerAbiJson);
await mkdir(staged('font-baker/schemas/'), { recursive: true });
await copyFile(
  new URL('../src/font-baker/schemas/KHRONOS-SPEC-LICENSE.txt', import.meta.url),
  staged('font-baker/schemas/KHRONOS-SPEC-LICENSE.txt'),
);
await copyFile(new URL('../src/font-baker/schemas/README.md', import.meta.url), staged('font-baker/schemas/README.md'));
if (process.platform !== 'win32') {
  await chmod(staged('node/cli.js'), 0o755);
}
await publishStagedDistribution();

/**
 * Swap the staged distribution into place. The previous tree is renamed aside first so
 * the window in which `dist/` does not exist spans two renames rather than a build, and
 * is then removed. A failed swap leaves the superseded tree on disk under its own name
 * rather than deleting a working distribution.
 */
async function publishStagedDistribution() {
  const exists = await stat(distributionDirectory).then(
    () => true,
    () => false,
  );
  if (exists) await rename(distributionDirectory, supersededDirectory);
  await rename(stagingDirectory, distributionDirectory);
  if (exists) await rm(supersededDirectory, { recursive: true, force: true });
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
