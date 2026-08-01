import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker as NodeWorker } from 'node:worker_threads';

import { reproducibleRustEnvironment } from '../../font-baker/scripts/reproducible-rust-env.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const fontPath = join(workspaceRoot, 'apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf');
const evidencePath = join(packageRoot, 'rust/mtsdf-admission/evidence/baker-phases-v0.json');
const profileBinary = join(
  packageRoot,
  'rust/mtsdf-baker/target/release',
  platform() === 'win32' ? 'profile-mtsdf-baker.exe' : 'profile-mtsdf-baker',
);
const cases = ['small', 'medium', 'complete'];
const selectedCase = readOption('--case') ?? 'all';

async function main() {
  if (process.argv.includes('--worker-child')) {
    await runWorkerChild(requiredCase(selectedCase));
  } else {
    const selectedCases = selectedCase === 'all' ? cases : [requiredCase(selectedCase)];
    await buildNativeProfiler();
    const source = new Uint8Array(await readFile(fontPath));
    const observations = [];
    for (const profileCase of selectedCases) {
      process.stderr.write(`Profiling MTSDF ${profileCase} coverage\n`);
      const native = await runNativeProfile(profileCase);
      const direct = await runDirectProfile(profileCase, source);
      const worker = await runWorkerProfile(profileCase);
      assert.equal(worker.artifactSha256, direct.artifactSha256, `${profileCase} Worker/direct artifact drift`);
      observations.push(summarize(profileCase, native, direct, worker));
    }
    const report = {
      schemaVersion: 0,
      kind: 'mtsdf-baker-phase-profile',
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version,
        rust: '1.97.1',
        fixture: 'apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
      },
      cases: observations,
    };
    if (process.argv.includes('--check')) await checkEvidence(report);
    if (process.argv.includes('--write')) {
      if (selectedCase !== 'all') throw new TypeError('--write requires --case=all');
      await writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

async function buildNativeProfiler() {
  await capture(
    'cargo',
    [
      'build',
      '--manifest-path',
      'rust/mtsdf-baker/Cargo.toml',
      '--release',
      '--locked',
      '--features=profiling',
      '--bin=profile-mtsdf-baker',
    ],
    packageRoot,
  );
}

async function runNativeProfile(profileCase) {
  return JSON.parse(
    await capture(
      profileBinary,
      [`--font=${fontPath}`, `--case=${profileCase}`],
      packageRoot,
      reproducibleRustEnvironment(workspaceRoot),
    ),
  );
}

async function runDirectProfile(profileCase, source) {
  const [{ createProfiledDirectRasterBakerFromInstance }, { mtsdfBakerAbi }, contract] = await Promise.all([
    import('../dist/internal/raster-baker-wasm.js'),
    import('../dist/generated/mtsdf-baker-abi.js'),
    import('../dist/internal/msdf-contract.js'),
  ]);
  const instance = await WebAssembly.instantiate(
    await WebAssembly.compile(await readFile(new URL('../dist/mtsdf_baker.wasm', import.meta.url))),
    {
      env: { pmndrs_text_bake_progress() {} },
    },
  );
  const samples = [];
  const descriptor = contract.msdfDescriptor(optionsForCase(profileCase));
  const rasterKey = await contract.msdfDescriptorRasterKey(descriptor);
  const shapingHash = createHash('sha256').update(source).digest('hex');
  const directAbi = {
    memory: mtsdfBakerAbi.memory,
    functions: {
      allocate: { export: mtsdfBakerAbi.functions.allocate, parameters: ['byteLength'], result: 'pointer' },
      deallocate: { export: mtsdfBakerAbi.functions.deallocate, parameters: ['pointer', 'byteLength'] },
      bake: mtsdfBakerAbi.artifactBaker.functions.bake,
      responseByteLength: mtsdfBakerAbi.artifactBaker.functions.responseByteLength,
    },
    response: mtsdfBakerAbi.artifactBaker.response,
    segmented: {
      chunkByteLength: mtsdfBakerAbi.artifactBaker.response.segmented.chunkByteLength,
      unavailableStatus: mtsdfBakerAbi.artifactBaker.response.segmented.unavailableStatus,
      functions: {
        status: mtsdfBakerAbi.artifactBaker.functions.segmentedStatus,
        metadataPointer: mtsdfBakerAbi.artifactBaker.functions.segmentedMetadataPointer,
        metadataByteLength: mtsdfBakerAbi.artifactBaker.functions.segmentedMetadataByteLength,
        artifactCount: mtsdfBakerAbi.artifactBaker.functions.segmentedArtifactCount,
        artifactByteLength: mtsdfBakerAbi.artifactBaker.functions.segmentedArtifactByteLength,
        chunkPointer: mtsdfBakerAbi.artifactBaker.functions.segmentedChunkPointer,
        chunkByteLength: mtsdfBakerAbi.artifactBaker.functions.segmentedChunkByteLength,
        release: mtsdfBakerAbi.artifactBaker.functions.releaseSegmentedResponse,
      },
    },
  };
  const baker = createProfiledDirectRasterBakerFromInstance(
    instance,
    directAbi,
    {
      label: 'profiled MTSDF baker',
      kind: 'msdf',
      extension: contract.MSDF_EXTENSION,
      version: contract.MSDF_FORMAT_VERSION,
      pageFormat: 'rgba8unorm',
      createError(error) {
        return Object.assign(new Error(error.message), error);
      },
    },
    (sample) => samples.push(sample),
  );
  const result = baker.bake({
    source,
    request: {
      fontFaceIndex: 0,
      glyphCount: 2937,
      shapingHash,
      rasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor,
    },
  });
  assert.equal(samples.length, 1);
  return {
    ...samples[0],
    artifactSha256: result.artifacts[0].sha256,
    serializedBytes: result.report.serializedBytes,
  };
}

async function runWorkerProfile(profileCase) {
  return JSON.parse(
    await capture(process.execPath, [scriptPath, '--worker-child', `--case=${profileCase}`], packageRoot),
  );
}

async function runWorkerChild(profileCase) {
  globalThis.Worker = NodeWebWorker;
  const [{ default: baker }, contract] = await Promise.all([
    import('../dist/runtime-bakers/msdf.js'),
    import('../dist/internal/msdf-contract.js'),
  ]);
  const source = new Uint8Array(await readFile(fontPath));
  const shapingHash = createHash('sha256').update(source).digest('hex');
  const options = optionsForCase(profileCase);
  const rasterKey = await contract.msdfRasterKey(options);
  const rssBeforeBytes = process.memoryUsage.rss();
  const started = performance.now();
  let completeAt;
  const result = await baker.bake({
    source,
    font: { glyphCount: 2937, shapingHash },
    fontFaceIndex: 0,
    rasterKey,
    options,
    onProgress(event) {
      if (event.phase === 'complete') completeAt = performance.now();
    },
  });
  const completed = performance.now();
  const report = {
    totalMs: completed - started,
    responseTransferMs: completeAt === undefined ? null : completed - completeAt,
    rssBeforeBytes,
    rssAfterBytes: process.memoryUsage.rss(),
    processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
    artifactSha256: result.artifacts[0].sha256,
    serializedBytes: result.report.serializedBytes,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`, () => process.exit(0));
}

class NodeWebWorker {
  #worker;
  #listeners = new Map();

  constructor(workerUrl, options) {
    this.#worker = new NodeWorker(new URL('./support/node-web-worker-bootstrap.mjs', import.meta.url), {
      name: options?.name,
      type: 'module',
      workerData: { workerUrl: workerUrl.href },
    });
  }

  addEventListener(type, listener, options) {
    const wrapped =
      type === 'message' ? (data) => listener({ data }) : type === 'error' ? (error) => listener(error) : undefined;
    if (wrapped === undefined) return;
    this.#listeners.set(listener, wrapped);
    if (options?.once === true) this.#worker.once(type, wrapped);
    else this.#worker.on(type, wrapped);
  }

  removeEventListener(type, listener) {
    const wrapped = this.#listeners.get(listener);
    if (wrapped === undefined) return;
    this.#listeners.delete(listener);
    this.#worker.off(type, wrapped);
  }

  postMessage(data, transfer) {
    this.#worker.postMessage(data, transfer);
  }

  terminate() {
    void this.#worker.terminate();
  }
}

function summarize(profileCase, native, direct, worker) {
  const phasesMs = Object.fromEntries(
    Object.entries(native.profile.phasesNs).map(([phase, nanoseconds]) => [phase, nanoseconds / 1_000_000]),
  );
  const seconds = phasesMs.texelGeneration / 1_000;
  const counters = native.profile.counters;
  return {
    id: profileCase,
    coverage: optionsForCase(profileCase)?.coverage ?? 'complete-face',
    counters,
    phasesMs,
    throughput: {
      generatedGlyphsPerSecond: counters.generatedGlyphs / seconds,
      generatedTexelsPerSecond: counters.generatedTexels / seconds,
      edgeVisitsPerSecond: counters.edgesVisited / seconds,
    },
    payload: native.payload,
    artifactSha256: direct.artifactSha256,
    nativeArtifactSha256: native.artifacts[0].sha256,
    wasmHost: direct,
    worker,
  };
}

function optionsForCase(profileCase) {
  switch (profileCase) {
    case 'small':
      return { coverage: { text: 'Sphinx of black quartz, judge my vow. 0123456789' } };
    case 'medium':
      return { coverage: { unicodeRanges: [{ start: 0x20, end: 0x24f }] } };
    case 'complete':
      return undefined;
    default:
      throw new TypeError(`unknown profile case ${profileCase}`);
  }
}

async function checkEvidence(report) {
  const recorded = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(report.schemaVersion, recorded.schemaVersion, 'MTSDF baker phase schema is stale');
  assert.equal(report.kind, recorded.kind, 'MTSDF baker phase kind is stale');
  assert.equal(report.environment.fixture, recorded.environment.fixture, 'MTSDF baker phase fixture is stale');
  const recordedCases = new Map(recorded.cases.map((entry) => [entry.id, stableCase(entry)]));
  for (const entry of report.cases) {
    assert.deepEqual(stableCase(entry), recordedCases.get(entry.id), `${entry.id} MTSDF baker evidence is stale`);
  }
}

function stableCase(entry) {
  return {
    id: entry.id,
    coverage: entry.coverage,
    counters: entry.counters,
    payload: entry.payload,
    artifactSha256: entry.artifactSha256,
    nativeArtifactSha256: entry.nativeArtifactSha256,
    directArtifactSha256: entry.wasmHost.artifactSha256,
    directSerializedBytes: entry.wasmHost.serializedBytes,
    workerArtifactSha256: entry.worker.artifactSha256,
    workerSerializedBytes: entry.worker.serializedBytes,
  };
}

function requiredCase(value) {
  if (!cases.includes(value)) throw new TypeError('--case must be small, medium, complete, or all');
  return value;
}

function readOption(name) {
  const prefix = `${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length);
}

function capture(command, arguments_, cwd, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr.push(chunk);
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8'));
      else reject(new Error(`${command} failed (${signal ?? code})\n${Buffer.concat(stderr).toString('utf8')}`));
    });
  });
}

await main();
