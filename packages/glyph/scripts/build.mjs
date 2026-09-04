import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
// Staging is per-build inside the ignored package cache. A single shared directory let a
// second build delete the first build's tree mid-write, which surfaced as a missing Wasm
// file rather than as the collision it was. Everything this build writes outside `dist/`
// lives under one cache root, so a stray tree can be cleared by deleting that root.
const buildCacheDirectory = join(packageRoot, '.cache', 'build');
const stagingPrefix = 'staging-';
const supersededPrefix = 'superseded-';
await mkdir(buildCacheDirectory, { recursive: true });
await reclaimAbandonedBuildDirectories();
const stagingPath = await mkdtemp(join(buildCacheDirectory, `${stagingPrefix}${process.pid}-`));
const supersededPath = join(buildCacheDirectory, basename(stagingPath).replace(stagingPrefix, supersededPrefix));
// `exit` fires for a clean finish, a thrown error, and an unhandled rejection alike, so a
// failed build cannot leave its staging tree behind. After a successful publish the tree
// has already been renamed away and the removal is a no-op.
//
// Only staging is removed here. The superseded tree exists solely between the two renames
// in `publishStagedDistribution`, and a swap that fails midway leaves it holding the only
// copy of the previous distribution -- deleting it on the way out would turn a failed
// build into a missing `dist/`. A successful publish removes it; an abandoned one is
// reclaimed by the next build, which is about to publish a replacement anyway.
process.on('exit', () => {
  try {
    rmSync(stagingPath, { recursive: true, force: true });
  } catch {
    // A tree that cannot be removed on the way out is reclaimed by the next build.
  }
});
const stagingDirectory = pathToFileURL(`${stagingPath}/`);
const staged = (path) => new URL(path, stagingDirectory);
/** How long a build keeps re-attempting the publish swap while other builds keep winning it. */
const publishRaceBudgetMs = 10_000;
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
const distributedWasm = fileURLToPath(staged('bitmap-baker.wasm'));
const shaperWasm = join(shaperTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm');
const distributedShaperWasm = fileURLToPath(staged('text-shaper.wasm'));
const mtsdfWasm = join(mtsdfArtifactTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_glyph_mtsdf_baker.wasm');
const distributedMtsdfWasm = fileURLToPath(staged('mtsdf-baker.wasm'));
const slugWasm = join(slugArtifactTargetDirectory, 'wasm32-unknown-unknown/release/pmndrs_glyph_slug_baker.wasm');
const distributedSlugWasm = fileURLToPath(staged('slug-baker.wasm'));
const fontBakerWasm = fileURLToPath(
  new URL('../rust/font-baker/target/wasm32-unknown-unknown/release/pmndrs_glyph_font_baker.wasm', import.meta.url),
);
const distributedFontBakerWasm = fileURLToPath(staged('font-baker.wasm'));

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
await run(process.execPath, [
  'scripts/generate-font-schema-types.mjs',
  ...(process.env.CI === 'true' ? ['--check'] : []),
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
// The build info has to travel with the outputs it describes. `tsconfig.build.json` points
// it at `dist/`, and overriding only `--outDir` leaves tsc recording staged emits against a
// path that survives a failed build: the next run deletes the staging tree, tsc reads the
// stale record, concludes its outputs are current, emits nothing, and fails in the same
// place forever. Staging it means a crashed build discards the record with the tree.
await run(tsc, [
  '-p',
  'tsconfig.build.json',
  '--outDir',
  fileURLToPath(stagingDirectory),
  '--tsBuildInfoFile',
  join(fileURLToPath(stagingDirectory), '.tsbuildinfo'),
]);
// Keep the complete unbundled emit for package-internal tests and maintenance tools, then
// replace every supported application entry with a tree-shaken tsdown bundle. This keeps
// private test seams out of the public module graph while the published subpaths share
// package-owned chunks and TypeGPU metadata compiled at publish time.
await run(tsdown, ['--out-dir', fileURLToPath(stagingDirectory), '--no-clean']);
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

/** Publishes via two renames (old tree aside, then staging in); a failed swap leaves the old tree intact rather than deleted. */
async function publishStagedDistribution() {
  const startedAt = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    // A fresh superseded path per attempt. Reusing one path deadlocks the retry: an attempt
    // that renames `dist/` aside and then loses the second rename leaves that path populated,
    // so every later attempt fails against its own leftover rather than the race it is
    // retrying. Leftovers are reclaimed by a later build.
    const attemptSupersededPath = `${supersededPath}-${attempt}`;
    const exists = await stat(distributionDirectory).then(
      () => true,
      () => false,
    );
    try {
      if (exists) await rename(distributionDirectory, pathToFileURL(`${attemptSupersededPath}/`));
      await rename(stagingDirectory, distributionDirectory);
      if (exists) await rm(attemptSupersededPath, { recursive: true, force: true });
      return;
    } catch (error) {
      // Another build published between the check above and the rename, so what was observed
      // is already stale: `dist/` moved out from under the first rename, or reappeared under
      // the second. Both are the same race seen from either side, and both are resolved by
      // observing the new state and trying again rather than failing a build that has already
      // produced a complete tree.
      const raced = error?.code === 'ENOENT' || error?.code === 'ENOTEMPTY' || error?.code === 'EEXIST';
      // Losing a race means another build published, so the contention is real work rather
      // than a spin, and a complete staged tree should not fail over which build goes first.
      // The budget is wall-clock instead of a fixed count so heavier contention resolves,
      // while an error that merely looks like a race cannot retry forever.
      if (!raced || Date.now() - startedAt >= publishRaceBudgetMs) throw error;
      await new Promise((settle) => setTimeout(settle, Math.min(25 * (attempt + 1), 200)));
    }
  }
}

/** Removes staging/superseded dirs from crashed builds; a dir is removed only once its owning process is dead, so concurrent builds stay safe. */
async function reclaimAbandonedBuildDirectories() {
  const entries = await readdir(buildCacheDirectory, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory()) return;
      const prefix = [stagingPrefix, supersededPrefix].find((candidate) => entry.name.startsWith(candidate));
      if (prefix === undefined) return;
      const owner = Number.parseInt(entry.name.slice(prefix.length), 10);
      if (!Number.isInteger(owner) || owner <= 0 || isProcessAlive(owner)) return;
      await rm(join(buildCacheDirectory, entry.name), { recursive: true, force: true });
    }),
  );
}

/** Signal 0 checks for existence without delivering anything; EPERM means alive but not ours. */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
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
