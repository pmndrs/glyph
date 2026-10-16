/* @workflow {
  "name": "glyph:shaper-optimizer-ablation",
  "summary": "Re-optimize one authenticated Rust shaper input under the release and historical inlining policies.",
  "requirements": "Pinned Binaryen through mise. Requires --artifact <frozen.tgz> --diagnostic <named-dir> --output <ignored-dir>. The diagnostic must describe the original clean release build and the release policy must reproduce the packed Wasm byte for byte.",
  "writes": "Only --output: named treatment Wasm, function map, exact-content treatment package archive and compact provenance manifest. Never writes dist."
} */
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCommand } from './support/capture-command.mjs';
import { attachOptimizerFunctionNames, deriveNamedShaper, sha256, wasmSections } from './support/named-shaper.mjs';
import { assertDiagnosticOutputOutsideDist, shaperOptimizationArguments } from './support/shaper-build.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const expected = {
  artifact: 'bec6c1735542bba49ab480d2337c787255950d09383c2f5720794a4d68fc5265',
  release: 'c4fcd84c34bd3accac9454ffd2ae635285323480dff1426ab9ab80f7ba97a67a',
  sourceRevision: '60d3c26f135b360ab1111131ce274218959d176f',
};
const wasmMember = 'package/dist/text-shaper.wasm';
const options = new Map();
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  const value = arguments_[index + 1];
  if (!['--artifact', '--diagnostic', '--output'].includes(key) || value === undefined || options.has(key)) {
    throw new Error('Expected --artifact <tgz> --diagnostic <named-dir> --output <ignored-dir>');
  }
  options.set(key, value);
}
if (options.size !== 3) throw new Error('Expected --artifact <tgz> --diagnostic <named-dir> --output <ignored-dir>');
const artifact = resolve(options.get('--artifact'));
const diagnostic = resolve(options.get('--diagnostic'));
const output = resolve(options.get('--output'));
assertDiagnosticOutputOutsideDist(resolve(packageRoot, 'dist'), output);
if (!relative(packageRoot, output).startsWith(`.cache${sep}`)) {
  throw new Error('--output must be inside the ignored packages/glyph/.cache directory');
}
if (
  (await stat(output).then(
    () => true,
    () => false,
  )) &&
  (await readdir(output)).length !== 0
) {
  throw new Error('--output must be empty');
}

const artifactBytes = await readFile(artifact);
if (sha256(artifactBytes) !== expected.artifact)
  throw new Error('Control archive is not the approved original artifact');
const manifestBytes = await readFile(resolve(diagnostic, 'manifest.json'));
const diagnosticManifest = JSON.parse(manifestBytes.toString());
if (
  diagnosticManifest.artifact?.sha256 !== expected.artifact ||
  diagnosticManifest.releaseSha256 !== expected.release ||
  diagnosticManifest.sourceRevision !== expected.sourceRevision ||
  diagnosticManifest.sourceDirty !== '' ||
  diagnosticManifest.simd !== true ||
  JSON.stringify(diagnosticManifest.optimization) !== JSON.stringify(shaperOptimizationArguments(true))
) {
  throw new Error('Diagnostic manifest does not identify the clean original SIMD release build');
}
const wasmOpt = resolve(packageRoot, 'node_modules/.bin', process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt');
const tools = {
  rustc: String(await captureCommand('rustc', ['--version'])).trim(),
  wasmOpt: String(await captureCommand(wasmOpt, ['--version'])).trim(),
};
if (tools.rustc !== diagnosticManifest.tools?.rustc || tools.wasmOpt !== diagnosticManifest.tools?.wasmOpt) {
  throw new Error('Current Rust or Binaryen tool differs from the original diagnostic');
}
const rawPath = resolve(diagnostic, 'target-simd128/wasm32-unknown-unknown/release/pmndrs_glyph_shaper.wasm');
const raw = await readFile(rawPath);
const input = await readFile(resolve(diagnostic, 'input.wasm'));
const strippedRaw = Buffer.concat([
  raw.subarray(0, 8),
  ...wasmSections(raw)
    .filter((section) => section.id !== 0)
    .map((section) => section.bytes),
]);
if (!strippedRaw.equals(input)) throw new Error('Raw named Rust module does not authenticate the optimizer input');
const originalCandidate = await readFile(resolve(diagnostic, 'candidate.wasm'));
if (sha256(originalCandidate) !== expected.release)
  throw new Error('Original optimized candidate differs from release');

const temporary = await mkdtemp(resolve(tmpdir(), 'glyph-optimizer-ablation-'));
try {
  const release = await captureCommand('tar', ['-xOf', artifact, wasmMember]);
  if (sha256(release) !== expected.release || !release.equals(originalCandidate)) {
    throw new Error('Packed release Wasm does not authenticate the original diagnostic');
  }
  const controlPath = resolve(temporary, 'control.wasm');
  const treatmentPath = resolve(temporary, 'treatment.wasm');
  const frozenInputPath = resolve(temporary, 'input.wasm');
  await writeFile(frozenInputPath, input);
  const controlFlags = shaperOptimizationArguments(true);
  const treatmentFlags = controlFlags.filter((flag) => flag !== '--one-caller-inline-max-function-size=0');
  if (controlFlags.length !== treatmentFlags.length + 1) throw new Error('Unexpected optimizer flag delta');
  await captureCommand(wasmOpt, [...controlFlags, frozenInputPath, '-o', controlPath]);
  const control = await readFile(controlPath);
  if (!control.equals(release)) throw new Error('Re-optimized control does not reproduce the packed release Wasm');
  const functionMap = await captureCommand(
    wasmOpt,
    [...treatmentFlags, '--print-function-map', frozenInputPath, '-o', treatmentPath],
    { cwd: packageRoot },
  );
  const treatment = await readFile(treatmentPath);
  const named = deriveNamedShaper(treatment, attachOptimizerFunctionNames(raw, treatment, String(functionMap)));
  const packageDirectory = resolve(temporary, 'unpacked');
  await mkdir(packageDirectory);
  await captureCommand('tar', ['-xzf', artifact, '-C', packageDirectory]);
  const originalMembers = await members(artifact, packageDirectory);
  if (originalMembers.get(wasmMember)?.sha256 !== expected.release) throw new Error('Archive extraction differs');
  await writeFile(resolve(packageDirectory, wasmMember), treatment);
  await mkdir(output, { recursive: true });
  const treatmentArchive = resolve(output, 'pmndrs-glyph-0.1.0-optimizer-ablation.tgz');
  // Packing the authenticated member tree avoids pnpm rewriting package.json or other package bytes.
  await captureCommand('tar', ['-czf', treatmentArchive, '-C', packageDirectory, 'package']);
  const repackedDirectory = resolve(temporary, 'repacked');
  await mkdir(repackedDirectory);
  await captureCommand('tar', ['-xzf', treatmentArchive, '-C', repackedDirectory]);
  const treatmentMembers = await members(treatmentArchive, repackedDirectory);
  const delta = [...new Set([...originalMembers.keys(), ...treatmentMembers.keys()])]
    .sort()
    .filter((path) => originalMembers.get(path)?.sha256 !== treatmentMembers.get(path)?.sha256)
    .map((path) => ({ path, control: originalMembers.get(path), treatment: treatmentMembers.get(path) }));
  if (delta.length !== 1 || delta[0].path !== wasmMember || originalMembers.size !== treatmentMembers.size) {
    throw new Error('Treatment archive changed members other than the shaper Wasm');
  }
  await writeFile(resolve(output, 'text-shaper.named.wasm'), named.bytes);
  await writeFile(resolve(output, 'functions.map'), functionMap);
  const treatmentArchiveSha256 = sha256(await readFile(treatmentArchive));
  await writeFile(
    resolve(output, 'named-manifest.json'),
    `${JSON.stringify(
      {
        artifact: { file: treatmentArchive, sha256: treatmentArchiveSha256 },
        releaseSha256: sha256(treatment),
        namedSha256: sha256(named.bytes),
        executableSha256: named.proof.executableSha256,
        sourceRevision: diagnosticManifest.sourceRevision,
        tools,
        optimization: treatmentFlags,
        functions: named.proof.functions,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(output, 'manifest.json'),
    `${JSON.stringify(
      {
        control: { file: artifact, sha256: expected.artifact },
        treatment: { file: treatmentArchive, sha256: treatmentArchiveSha256 },
        diagnostic: {
          directory: diagnostic,
          manifestSha256: sha256(manifestBytes),
          sourceRevision: diagnosticManifest.sourceRevision,
          sourceDirty: diagnosticManifest.sourceDirty,
          rawSha256: sha256(raw),
          inputSha256: sha256(input),
          originalCandidateSha256: sha256(originalCandidate),
        },
        tools,
        controlFlags,
        treatmentFlags,
        packageMethod: 'tar repack of authenticated original member tree with only text-shaper.wasm replaced',
        memberCount: originalMembers.size,
        memberDelta: delta,
        sizes: {
          control: inventory(release, artifactBytes, originalMembers),
          treatment: inventory(treatment, await readFile(treatmentArchive), treatmentMembers),
        },
        namedSha256: sha256(named.bytes),
        namedExecutableSha256: named.proof.executableSha256,
        namedFunctionCount: named.proof.functions.length,
        namedManifest: 'named-manifest.json',
        functionMapSha256: sha256(functionMap),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Authenticated optimizer ablation: ${output}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function members(archive, directory) {
  const paths = String(await captureCommand('tar', ['-tzf', archive]))
    .trim()
    .split('\n')
    .filter((path) => !path.endsWith('/'));
  const result = new Map();
  for (const path of paths) {
    if (!path.startsWith('package/') || path.includes('..') || result.has(path)) {
      throw new Error(`Unexpected or duplicate archive member: ${path}`);
    }
    const bytes = await readFile(resolve(directory, path));
    result.set(path, {
      sha256: sha256(bytes),
      bytes: bytes.length,
      ...(path.endsWith('.js') ? { gzip: gzipSync(bytes).length } : {}),
    });
  }
  return result;
}

function inventory(wasm, archive, archiveMembers) {
  const javascript = [...archiveMembers].filter(([path]) => path.endsWith('.js'));
  return {
    wasm: { raw: wasm.length, gzip: gzipSync(wasm).length },
    package: {
      raw: [...archiveMembers.values()].reduce((total, member) => total + member.bytes, 0),
      gzip: archive.length,
      members: archiveMembers.size,
    },
    javascript: {
      files: javascript.length,
      raw: javascript.reduce((total, [, member]) => total + member.bytes, 0),
      gzip: javascript.reduce((total, [, member]) => total + member.gzip, 0),
    },
  };
}
