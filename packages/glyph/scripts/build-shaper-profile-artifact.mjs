/* @workflow {
  "name": "glyph:shaper-profile-artifact",
  "summary": "Build named shaper diagnostics authenticated against an exact packed release artifact.",
  "requirements": "Pinned Rust/Binaryen through mise. Requires --artifact <frozen.tgz>; optional --output <directory> and --simd 0|1 (default 1). Fails if optimized executable sections differ.",
  "writes": "Ignored packages/glyph/.cache/shaper-profile (or --output): isolated Cargo target, optimized candidate, named Wasm and provenance/function-map manifest. Never writes dist."
} */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCommand } from './support/capture-command.mjs';
import { attachOptimizerFunctionNames, deriveNamedShaper, sha256, wasmSections } from './support/named-shaper.mjs';
import {
  assertDiagnosticOutputOutsideDist,
  shaperBuildEnvironment,
  shaperCargoArguments,
  shaperOptimizationArguments,
} from './support/shaper-build.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const options = new Map();
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  const value = arguments_[index + 1];
  if (!['--artifact', '--output', '--simd'].includes(key) || value === undefined || options.has(key)) {
    throw new Error('Expected --artifact <tgz> [--output <directory>] [--simd 0|1]');
  }
  options.set(key, value);
}
if (!options.has('--artifact')) throw new Error('--artifact is required');
const simdOption = options.get('--simd') ?? '1';
if (simdOption !== '0' && simdOption !== '1') throw new Error('--simd must be 0 or 1');
const simd = simdOption === '1';
const artifact = resolve(options.get('--artifact'));
const output = resolve(options.get('--output') ?? resolve(packageRoot, '.cache/shaper-profile'));
assertDiagnosticOutputOutsideDist(resolve(packageRoot, 'dist'), output);
const artifactBytes = await readFile(artifact);
const release = await captureCommand('tar', ['-xOf', '-', 'package/dist/text-shaper.wasm'], { input: artifactBytes });
await mkdir(output, { recursive: true });
await Promise.all(
  ['text-shaper.named.wasm', 'manifest.json'].map((file) => rm(resolve(output, file), { force: true })),
);
const target = resolve(output, `target-${simd ? 'simd128' : 'scalar'}`);
const environment = {
  ...shaperBuildEnvironment(workspaceRoot, target, simd),
  RUSTC_WRAPPER: fileURLToPath(new URL('./support/named-shaper-rustc.mjs', import.meta.url)),
};
await captureCommand('cargo', shaperCargoArguments(simd), { cwd: packageRoot, env: environment });
const raw = resolve(target, 'wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm');
const candidatePath = resolve(output, 'candidate.wasm');
// Keep names as a sidecar: Binaryen uses internal names to break optimization/reordering ties.
const rawBytes = await readFile(raw);
const input = resolve(output, 'input.wasm');
await writeFile(
  input,
  Buffer.concat([
    rawBytes.subarray(0, 8),
    ...wasmSections(rawBytes)
      .filter((section) => section.id !== 0)
      .map((section) => section.bytes),
  ]),
);
const wasmOpt = resolve(packageRoot, 'node_modules/.bin', process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt');
const optimization = shaperOptimizationArguments(simd);
const symbolMap = await captureCommand(wasmOpt, [...optimization, '--print-function-map', input, '-o', candidatePath], {
  cwd: packageRoot,
});
await writeFile(resolve(output, 'functions.map'), symbolMap);
const { bytes, proof } = deriveNamedShaper(
  release,
  attachOptimizerFunctionNames(rawBytes, await readFile(candidatePath), String(symbolMap)),
);
await writeFile(resolve(output, 'text-shaper.named.wasm'), bytes);
await writeFile(
  resolve(output, 'manifest.json'),
  `${JSON.stringify(
    {
      artifact: { file: artifact, sha256: sha256(artifactBytes) },
      releaseSha256: sha256(release),
      namedSha256: sha256(bytes),
      executableSha256: proof.executableSha256,
      sourceRevision: String(await captureCommand('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot })).trim(),
      sourceDirty: String(await captureCommand('git', ['status', '--porcelain'], { cwd: workspaceRoot })).trim(),
      tools: {
        rustc: String(await captureCommand('rustc', ['--version'])).trim(),
        wasmOpt: String(await captureCommand(wasmOpt, ['--version'])).trim(),
      },
      simd,
      optimization,
      functions: proof.functions,
    },
    null,
    2,
  )}\n`,
);
process.stdout.write(`Authenticated named shaper: ${output}\n`);
