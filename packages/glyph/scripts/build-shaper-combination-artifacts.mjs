/* @workflow {
  "name": "glyph:shaper-combination-artifacts",
  "summary": "Assemble authenticated preparation and compiler-policy package arms from frozen archives.",
  "requirements": "Requires --control <original.tgz> --compiler <archived-compiler.tgz> --cleanup <retained-cleanup.tgz> --compiler-diagnostic <old optimizer output dir> --output <empty ignored dir>. No build tools or runtime source changes.",
  "writes": "Only --output: two derived experimental package archives, compiler named Wasm/map, and provenance manifests. Never writes dist."
} */
import { gzipSync } from 'node:zlib';
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureCommand } from './support/capture-command.mjs';
import { authenticateNamedShaper, sha256 } from './support/named-shaper.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const wasmMember = 'package/dist/text-shaper.wasm';
const hashes = {
  control: 'bec6c1735542bba49ab480d2337c787255950d09383c2f5720794a4d68fc5265',
  compiler: 'e1cfc4b20d65c0065f09bdc61c012aa10feb32cf365c15becd3966e8ae9a19eb',
  cleanup: '2a7f0317a49319203aac935a8d7387eafcc9f78443ff6de31c699c4605412627',
  controlWasm: 'c4fcd84c34bd3accac9454ffd2ae635285323480dff1426ab9ab80f7ba97a67a',
  compilerWasm: 'ed19321ea76df79caf5dc9f14f3eac9042590ec03c8adc3886cbe73aa83308a5',
  cleanupWasm: '6f7afa1c596dc7c08d2138a67c4ae955d8aff5824602452cb6d12f30f2df3bbd',
  diagnosticManifest: '2316dfdb164666f4b150b2212ddabea27ebac9f9a0057f2648f7399474bc6c49',
  namedManifest: '61903abb2562bde0f9170089b0f8eedb36676ab5b5ce3a94bc00d7e15cf673f8',
};
const cleanupPaths = [
  'package/dist/internal/handle-state.js',
  'package/dist/internal/handle-state.js.map',
  'package/dist/internal/render-planner.js',
  'package/dist/internal/render-planner.js.map',
  'package/src/internal/handle-state.ts',
  'package/src/internal/render-planner.ts',
];
const optionNames = ['--control', '--compiler', '--cleanup', '--compiler-diagnostic', '--output'];
const options = new Map();
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  const value = arguments_[index + 1];
  if (!optionNames.includes(key) || value === undefined || options.has(key)) {
    throw new Error(`Expected ${optionNames.join(' <path> ')} <path>`);
  }
  options.set(key, resolve(value));
}
if (options.size !== optionNames.length) throw new Error(`Expected ${optionNames.join(' <path> ')} <path>`);
const output = options.get('--output');
if (!relative(packageRoot, output).startsWith(`.cache${sep}`)) {
  throw new Error('--output must be inside packages/glyph/.cache');
}
const outputState = await lstat(output).catch((error) => {
  if (error.code === 'ENOENT') return undefined;
  throw error;
});
if (outputState && (!outputState.isDirectory() || (await readdir(output)).length !== 0)) {
  throw new Error('--output must be an empty directory');
}

const inputs = {
  control: options.get('--control'),
  compiler: options.get('--compiler'),
  cleanup: options.get('--cleanup'),
};
for (const [arm, archive] of Object.entries(inputs)) {
  if (sha256(await readFile(archive)) !== hashes[arm])
    throw new Error(`${arm} archive differs from the approved input`);
}
const diagnostic = options.get('--compiler-diagnostic');
const diagnosticManifestBytes = await readFile(resolve(diagnostic, 'manifest.json'));
const namedManifestBytes = await readFile(resolve(diagnostic, 'named-manifest.json'));
if (
  sha256(diagnosticManifestBytes) !== hashes.diagnosticManifest ||
  sha256(namedManifestBytes) !== hashes.namedManifest
) {
  throw new Error('Archived compiler diagnostic manifests differ from the preserved provenance');
}
const diagnosticManifest = JSON.parse(diagnosticManifestBytes.toString());
const namedManifest = JSON.parse(namedManifestBytes.toString());
const namedBytes = await readFile(resolve(diagnostic, 'text-shaper.named.wasm'));
const functionMap = await readFile(resolve(diagnostic, 'functions.map'));
if (
  diagnosticManifest.control?.sha256 !== hashes.control ||
  diagnosticManifest.treatment?.sha256 !== hashes.compiler ||
  diagnosticManifest.diagnostic?.originalCandidateSha256 !== hashes.controlWasm ||
  diagnosticManifest.memberCount !== 1217 ||
  diagnosticManifest.memberDelta?.length !== 1 ||
  diagnosticManifest.memberDelta[0].path !== wasmMember ||
  diagnosticManifest.memberDelta[0].control?.sha256 !== hashes.controlWasm ||
  diagnosticManifest.memberDelta[0].treatment?.sha256 !== hashes.compilerWasm ||
  namedManifest.artifact?.sha256 !== hashes.compiler ||
  namedManifest.releaseSha256 !== hashes.compilerWasm ||
  namedManifest.executableSha256 !== hashes.compilerWasm ||
  namedManifest.namedSha256 !== sha256(namedBytes) ||
  diagnosticManifest.namedSha256 !== sha256(namedBytes) ||
  diagnosticManifest.functionMapSha256 !== sha256(functionMap) ||
  JSON.stringify(namedManifest.optimization) !== JSON.stringify(diagnosticManifest.treatmentFlags) ||
  namedManifest.sourceRevision !== diagnosticManifest.diagnostic?.sourceRevision
) {
  throw new Error('Archived compiler diagnostic does not authenticate the original same-input policy contrast');
}

const temporary = await mkdtemp(resolve(tmpdir(), 'glyph-shaper-combination-'));
try {
  const inventories = {};
  for (const [arm, archive] of Object.entries(inputs)) {
    const directory = resolve(temporary, arm);
    await mkdir(directory);
    inventories[arm] = await unpackAndInventory(archive, directory);
    if (inventories[arm].size !== 1217) throw new Error(`${arm} member count differs from 1217`);
  }
  assertWasm(inventories.control, hashes.controlWasm, 'control');
  assertWasm(inventories.compiler, hashes.compilerWasm, 'compiler');
  assertWasm(inventories.cleanup, hashes.cleanupWasm, 'cleanup');
  assertDelta(inventories.control, inventories.compiler, [wasmMember], 'control to compiler');
  assertDelta(inventories.control, inventories.cleanup, [...cleanupPaths, wasmMember], 'control to cleanup');
  const compilerWasm = await readFile(resolve(temporary, 'compiler', wasmMember));
  const proof = authenticateNamedShaper(compilerWasm, namedBytes);
  if (
    proof.executableSha256 !== hashes.compilerWasm ||
    JSON.stringify(proof.functions) !== JSON.stringify(namedManifest.functions) ||
    proof.functions.length !== diagnosticManifest.namedFunctionCount
  ) {
    throw new Error('Archived named Wasm does not authenticate compiler executable and function names');
  }

  const assembled = resolve(temporary, 'assembled');
  await mkdir(assembled);
  await cp(resolve(temporary, 'cleanup', 'package'), resolve(assembled, 'package'), { recursive: true });
  const arms = [
    { key: 'preparationOnly', file: 'preparation-only-normalized.tgz', wasm: hashes.controlWasm },
    { key: 'preparationCompiler', file: 'preparation-plus-compiler.tgz', wasm: hashes.compilerWasm },
  ];
  for (const arm of arms) {
    await copyFile(
      resolve(temporary, arm.wasm === hashes.controlWasm ? 'control' : 'compiler', wasmMember),
      resolve(assembled, wasmMember),
    );
    arm.archive = resolve(temporary, arm.file);
    await captureCommand('tar', ['-czf', arm.archive, '-C', assembled, 'package']);
    const extracted = resolve(temporary, `verified-${arm.key}`);
    await mkdir(extracted);
    arm.members = await unpackAndInventory(arm.archive, extracted);
    assertWasm(arm.members, arm.wasm, arm.key);
    arm.sha256 = sha256(await readFile(arm.archive));
  }
  assertDelta(inventories.control, arms[0].members, cleanupPaths, '00 to 10');
  assertDelta(inventories.compiler, arms[1].members, cleanupPaths, '01 to 11');
  assertDelta(arms[0].members, arms[1].members, [wasmMember], '10 to 11');
  assertDelta(inventories.cleanup, arms[0].members, [wasmMember], 'cleanup to 10');
  assertDelta(inventories.cleanup, arms[1].members, [wasmMember], 'cleanup to 11');
  for (const [arm, archive] of Object.entries(inputs)) {
    if (sha256(await readFile(archive)) !== hashes[arm]) throw new Error(`${arm} archive changed during assembly`);
  }
  const archiveSizes = {
    control: (await stat(inputs.control)).size,
    compiler: (await stat(inputs.compiler)).size,
    cleanup: (await stat(inputs.cleanup)).size,
    preparationOnly: (await stat(arms[0].archive)).size,
    preparationCompiler: (await stat(arms[1].archive)).size,
  };

  const manifest = {
    classification: 'DERIVED EXPERIMENTAL; normalized four-arm comparison, not fresh production builds',
    method: 'tar repack of authenticated retained-cleanup member tree; replace only packed shaper Wasm bytes',
    diagnostic: {
      manifestSha256: sha256(diagnosticManifestBytes),
      namedManifestSha256: sha256(namedManifestBytes),
      sourceRevisionOfCompilerInput: diagnosticManifest.diagnostic.sourceRevision,
      sameInputPolicyContrast: {
        controlFlags: diagnosticManifest.controlFlags,
        compilerFlags: diagnosticManifest.treatmentFlags,
      },
    },
    arms: Object.fromEntries([
      ['00', armRecord(inputs.control, hashes.control, inventories.control, hashes.controlWasm, archiveSizes.control)],
      [
        '01',
        armRecord(inputs.compiler, hashes.compiler, inventories.compiler, hashes.compilerWasm, archiveSizes.compiler),
      ],
      [
        '10',
        armRecord(arms[0].file, arms[0].sha256, arms[0].members, hashes.controlWasm, archiveSizes.preparationOnly),
      ],
      [
        '11',
        armRecord(arms[1].file, arms[1].sha256, arms[1].members, hashes.compilerWasm, archiveSizes.preparationCompiler),
      ],
    ]),
    retainedCleanupInput: armRecord(
      inputs.cleanup,
      hashes.cleanup,
      inventories.cleanup,
      hashes.cleanupWasm,
      archiveSizes.cleanup,
    ),
    deltas: {
      '00-to-01': memberDelta(inventories.control, inventories.compiler),
      '00-to-10': memberDelta(inventories.control, arms[0].members),
      '01-to-11': memberDelta(inventories.compiler, arms[1].members),
      '10-to-11': memberDelta(arms[0].members, arms[1].members),
    },
    named: {
      file: 'text-shaper.named.wasm',
      sha256: sha256(namedBytes),
      executableSha256: proof.executableSha256,
      functionMapFile: 'functions.map',
      functionMapSha256: sha256(functionMap),
      functionCount: proof.functions.length,
      namedManifest: 'named-manifest.json',
    },
    sizeMethod: {
      compression: 'Node zlib gzip level 9',
      zlibVersion: process.versions.zlib,
      javascript: 'concatenate shipped .js members in sorted member-path order, then gzip once',
      packageArchive: 'exact .tgz byte length; tar metadata and packing prevent causal size attribution',
    },
  };
  const derivedNamedManifest = {
    artifact: { file: arms[1].file, sha256: arms[1].sha256 },
    classification: manifest.classification,
    releaseSha256: hashes.compilerWasm,
    namedSha256: sha256(namedBytes),
    executableSha256: proof.executableSha256,
    provenance: {
      archivedCompilerArtifactSha256: hashes.compiler,
      archivedNamedManifestSha256: sha256(namedManifestBytes),
      archivedDiagnosticManifestSha256: sha256(diagnosticManifestBytes),
      sourceRevisionOfCompilerInput: diagnosticManifest.diagnostic.sourceRevision,
    },
    functions: proof.functions,
  };
  await mkdir(output, { recursive: true });
  for (const arm of arms) await copyFile(arm.archive, resolve(output, arm.file));
  await writeFile(resolve(output, 'text-shaper.named.wasm'), namedBytes);
  await writeFile(resolve(output, 'functions.map'), functionMap);
  await writeFile(resolve(output, 'named-manifest.json'), `${JSON.stringify(derivedNamedManifest, null, 2)}\n`);
  await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`Authenticated four-arm combination artifacts: ${output}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function unpackAndInventory(archive, directory) {
  const listing = String(await captureCommand('tar', ['-tzf', archive]))
    .trim()
    .split('\n');
  const seen = new Set();
  for (const entry of listing) {
    const path = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    if (
      (path !== 'package' && !path.startsWith('package/')) ||
      path.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
      seen.has(path)
    ) {
      throw new Error(`Unexpected or duplicate archive member: ${entry}`);
    }
    seen.add(path);
  }
  await captureCommand('tar', ['-xzf', archive, '-C', directory]);
  const members = new Map();
  const javascript = [];
  for (const entry of listing) {
    if (entry.endsWith('/')) continue;
    const path = resolve(directory, entry);
    if (!(await lstat(path)).isFile()) throw new Error(`Non-file archive member: ${entry}`);
    const bytes = await readFile(path);
    members.set(entry, { sha256: sha256(bytes), bytes: bytes.length });
    if (entry.endsWith('.js')) javascript.push([entry, bytes]);
    if (entry === wasmMember) members.wasmGzip9 = gzipSync(bytes, { level: 9 }).length;
  }
  members.javascriptGzip9 = gzipSync(
    Buffer.concat(
      javascript.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, bytes]) => bytes),
    ),
    { level: 9 },
  ).length;
  return members;
}

function assertWasm(members, expected, arm) {
  if (members.get(wasmMember)?.sha256 !== expected) throw new Error(`${arm} packed shaper Wasm differs`);
}

function memberDelta(left, right) {
  return [...new Set([...left.keys(), ...right.keys()])]
    .sort()
    .filter((path) => left.get(path)?.sha256 !== right.get(path)?.sha256)
    .map((path) => ({ path, left: left.get(path), right: right.get(path) }));
}

function assertDelta(left, right, expected, label) {
  const actual = memberDelta(left, right).map((entry) => entry.path);
  if (left.size !== 1217 || right.size !== 1217 || JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} archive member delta differs from approved paths: ${actual.join(', ')}`);
  }
}

function armRecord(file, sha, members, wasmSha, archiveBytes) {
  const javascript = [...members].filter(([path]) => path.endsWith('.js'));
  const wasm = members.get(wasmMember);
  return {
    file,
    sha256: sha,
    wasmSha256: wasmSha,
    memberCount: members.size,
    sizes: {
      wasm: { raw: wasm.bytes, gzip9: members.wasmGzip9 },
      package: { raw: [...members.values()].reduce((total, member) => total + member.bytes, 0), archiveBytes },
      javascript: {
        files: javascript.length,
        raw: javascript.reduce((total, [, member]) => total + member.bytes, 0),
        gzip9: members.javascriptGzip9,
      },
    },
  };
}
