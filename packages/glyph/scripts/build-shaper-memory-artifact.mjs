/* @workflow {
  "name": "glyph:shaper-memory-artifact",
  "summary": "Build isolated diagnostic-live-memory Wasm and prove the feature-off control equals a frozen package shaper.",
  "requirements": "Pinned Rust/Binaryen through mise. Requires --artifact <frozen.tgz>; optional --source-root <worktree>, --output <ignored-directory>, --simd 0|1 (default 1), and --one-caller-inline-max-function-size 0|default (default 0). The 'default' value reproduces historical optimizer defaults by omitting only that flag. Fails on any feature-off byte difference.",
  "writes": "Ignored packages/glyph/.cache/shaper-memory-artifact (or --output): one isolated Cargo target, optimized control and diagnostic Wasm, and provenance manifest. Never writes dist."
} */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureCommand } from './support/capture-command.mjs';
import { sha256 } from './support/named-shaper.mjs';
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
if (arguments_.length % 2 !== 0) throw new Error('Options require values');
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  if (
    !['--artifact', '--source-root', '--output', '--simd', '--one-caller-inline-max-function-size'].includes(key) ||
    options.has(key)
  ) {
    throw new Error(`Unknown or repeated option: ${key}`);
  }
  options.set(key, arguments_[index + 1]);
}
if (!options.has('--artifact')) throw new Error('--artifact <frozen.tgz> is required');
const simdOption = options.get('--simd') ?? '1';
if (simdOption !== '0' && simdOption !== '1') throw new Error('--simd must be 0 or 1');
const simd = simdOption === '1';
const oneCallerInlineMaxFunctionSize = options.get('--one-caller-inline-max-function-size') ?? '0';
if (oneCallerInlineMaxFunctionSize !== '0' && oneCallerInlineMaxFunctionSize !== 'default') {
  throw new Error('--one-caller-inline-max-function-size must be 0 or default');
}
const sourceRoot = resolve(options.get('--source-root') ?? workspaceRoot);
const sourcePackageRoot = resolve(sourceRoot, 'packages/glyph');
const artifact = resolve(options.get('--artifact'));
const output = resolve(options.get('--output') ?? resolve(packageRoot, '.cache/shaper-memory-artifact'));
assertDiagnosticOutputOutsideDist(resolve(packageRoot, 'dist'), output);
assertDiagnosticOutputOutsideDist(resolve(sourcePackageRoot, 'dist'), output);

const archive = await readFile(artifact);
const release = await captureCommand('tar', ['-xzOf', '-', 'package/dist/text-shaper.wasm'], { input: archive });
const wasmOpt = resolve(packageRoot, 'node_modules/.bin', process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt');
const optimization = shaperOptimizationArguments(simd).filter(
  (argument) => oneCallerInlineMaxFunctionSize === '0' || argument !== '--one-caller-inline-max-function-size=0',
);
await mkdir(output, { recursive: true });
const target = resolve(output, `target-${simd ? 'simd128' : 'scalar'}`);

async function build(name, feature) {
  const environment = shaperBuildEnvironment(sourceRoot, target, simd);
  const cargo = shaperCargoArguments(simd);
  if (feature !== null) cargo.push('--features', feature);
  await captureCommand('cargo', cargo, { cwd: sourcePackageRoot, env: environment });
  const raw = resolve(target, 'wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm');
  const optimized = resolve(output, `text-shaper.${name}.wasm`);
  await captureCommand(wasmOpt, [...optimization, raw, '-o', optimized], { cwd: packageRoot });
  return { bytes: await readFile(optimized), cargo, optimized };
}

const control = await build('control', null);
if (!control.bytes.equals(release)) {
  throw new Error(
    `Feature-off control differs from frozen shaper: release ${sha256(release)}, control ${sha256(control.bytes)}`,
  );
}
const diagnostic = await build('diagnostic', 'diagnostic-live-memory');
const controlExports = WebAssembly.Module.exports(new WebAssembly.Module(control.bytes)).map((entry) => entry.name);
const diagnosticExports = WebAssembly.Module.exports(new WebAssembly.Module(diagnostic.bytes)).map(
  (entry) => entry.name,
);
const diagnosticNames = [
  'pmndrs_glyph_shaper_diagnostic_memory_snapshot',
  'pmndrs_glyph_shaper_diagnostic_memory_reset_window',
  'pmndrs_glyph_shaper_diagnostic_memory_probe_sequence',
];
if (diagnosticNames.some((name) => controlExports.includes(name) || !diagnosticExports.includes(name))) {
  throw new Error('Diagnostic export isolation failed');
}
const allocationProof = await verifyRealAllocator(diagnostic.bytes);

const sourceFiles = await sourceIdentity(resolve(sourcePackageRoot, 'rust/shaper/src'));
const sourceManifests = Object.fromEntries(
  await Promise.all(
    ['Cargo.toml', 'Cargo.lock', 'build.rs'].map(async (name) => [
      name,
      sha256(await readFile(resolve(sourcePackageRoot, 'rust/shaper', name))),
    ]),
  ),
);
const manifest = {
  format: 'glyph-shaper-memory-artifact-v1',
  artifact: { path: artifact, sha256: sha256(archive), shaperSha256: sha256(release) },
  source: {
    root: sourceRoot,
    revision: String(await captureCommand('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).trim(),
    dirty: String(await captureCommand('git', ['status', '--porcelain'], { cwd: sourceRoot })).trim(),
    rustSourceSha256: sourceFiles,
    sourceManifests,
  },
  control: {
    file: control.optimized,
    sha256: sha256(control.bytes),
    features: simd ? ['simd128'] : [],
    cargo: control.cargo,
  },
  diagnostic: {
    file: diagnostic.optimized,
    sha256: sha256(diagnostic.bytes),
    features: [...(simd ? ['simd128'] : []), 'diagnostic-live-memory'],
    cargo: diagnostic.cargo,
    exports: diagnosticNames,
    allocationProof,
    record: {
      byteLength: 32,
      littleEndianU32: [
        'version',
        'status',
        'requestedLive',
        'requestedPeak',
        'allocations',
        'reallocations',
        'deallocations',
        'cumulativeRequested',
      ],
      statusBits: { arithmeticOverflow: 1, arithmeticUnderflow: 2, sizeUnrepresentable: 4 },
      semantics:
        'Counts include successful operations only. Cumulative requested bytes add the full new size of each successful realloc, not its net growth.',
      limits:
        'Requested bytes at completed allocator calls; excludes Talc fragmentation and transient physical realloc peak.',
    },
  },
  tools: {
    rustc: String(await captureCommand('rustc', ['--version'])).trim(),
    wasmOpt: String(await captureCommand(wasmOpt, ['--version'])).trim(),
  },
  oneCallerInlineMaxFunctionSize,
  optimization,
};
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Diagnostic memory artifact: ${output}\n`);

async function sourceIdentity(directory) {
  const hash = createHash('sha256');
  async function visit(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        hash.update(relative(directory, file).split(sep).join('/'));
        hash.update('\0');
        hash.update(await readFile(file));
      }
    }
  }
  await visit(directory);
  return hash.digest('hex');
}

async function verifyRealAllocator(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes);
  const wasm = instance.exports;
  if (!(wasm.memory instanceof WebAssembly.Memory)) throw new Error('Diagnostic module must export memory');
  const pointer = wasm.pmndrs_glyph_shaper_alloc(32);
  if (pointer === 0) throw new Error('Could not reserve diagnostic snapshot buffer');
  const snapshot = () => {
    if (wasm.pmndrs_glyph_shaper_diagnostic_memory_snapshot(pointer, 32) !== 0) {
      throw new Error('Diagnostic snapshot rejected owned request buffer');
    }
    const view = new DataView(wasm.memory.buffer, pointer, 32);
    return Array.from({ length: 8 }, (_, index) => view.getUint32(index * 4, true));
  };
  wasm.pmndrs_glyph_shaper_diagnostic_memory_reset_window();
  const before = snapshot();
  if (before[0] !== 1 || before[1] !== 0) throw new Error('Diagnostic counter format or status invalid');
  if (wasm.pmndrs_glyph_shaper_diagnostic_memory_probe_sequence() !== 0) {
    throw new Error('Talc alloc/realloc/dealloc probe failed');
  }
  const after = snapshot();
  if (
    after[1] !== 0 ||
    after[2] !== before[2] ||
    after[3] !== before[2] + 32 ||
    after[4] !== 1 ||
    after[5] !== 1 ||
    after[6] !== 1 ||
    after[7] !== 48
  ) {
    throw new Error(`Talc-backed accounting mismatch: ${JSON.stringify({ before, after })}`);
  }
  wasm.pmndrs_glyph_shaper_dealloc(pointer, 32);
  return { before, after, expected: { requestedPeakIncrease: 32, requestedLiveDelta: 0, cumulativeRequested: 48 } };
}
