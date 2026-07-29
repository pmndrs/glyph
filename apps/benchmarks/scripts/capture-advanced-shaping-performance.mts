import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../fixtures/results/advanced-shaping-performance-chromium149.json', import.meta.url);
const EXPECTED_CASE_IDS = new Set([
  'latin-features',
  'arabic-joining',
  'indic-reordering',
  'mixed-bidi',
  'cjk-line-breaks',
]);
const REQUIRED_CASE_METRICS = [
  'textReadyMs',
  'rendererInitMs',
  'fontLoadMs',
  'firstDrawMs',
  'startupMs',
  'framesPerSecond',
  'medianSubmitMs',
  'p95SubmitMs',
  'medianGpuMs',
  'p95GpuMs',
  'glyphCount',
  'drawCount',
  'artifactBytes',
  'atlasGpuBytes',
  'totalGpuBytes',
] as const;
const child = spawn(
  executable,
  [
    '--gpu',
    '--path',
    '/?mode=benchmark&technique=bitmap&backend=webgpu&workload=advanced-shaping',
    './vitexec/advanced-shaping-performance.probe.ts',
  ],
  { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
);

let transcript = '';
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    transcript += text;
    process.stdout.write(text);
  });
}

const code = await new Promise<number | null>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
if (code !== 0 || transcript.includes('[error]')) {
  throw new Error(
    `Advanced-shaping performance capture failed${code === 0 ? ' in the browser' : ` with status ${String(code)}`}`,
  );
}

const marker = /advanced-shaping-performance-ready (\{[^\n]+\})/.exec(transcript)?.[1];
if (marker === undefined) throw new Error('Performance capture did not emit its result marker');
const result: unknown = JSON.parse(marker);
assertPerformanceObservation(result);
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);

function assertPerformanceObservation(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Performance observation must be an object');
  }
  const observation = value as Record<string, unknown>;
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'live-performance-observation' ||
    observation.backend !== 'webgpu' ||
    observation.dpr !== 1 ||
    observation.steadyStateReportCount !== 12 ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt)) ||
    !Array.isArray(observation.cases) ||
    observation.cases.length !== 5
  ) {
    throw new TypeError('Performance observation has an invalid envelope');
  }
  const environment = observation.environment;
  if (typeof environment !== 'object' || environment === null || Array.isArray(environment)) {
    throw new TypeError('Performance environment must be an object');
  }
  if ((environment as Record<string, unknown>).webgpu !== true) {
    throw new TypeError('Performance environment must report WebGPU');
  }
  const gpuAdapter = observation.gpuAdapter;
  if (typeof gpuAdapter !== 'object' || gpuAdapter === null || Array.isArray(gpuAdapter)) {
    throw new TypeError('Performance observation must identify its GPU adapter');
  }
  const adapter = gpuAdapter as Record<string, unknown>;
  if (typeof adapter.vendor !== 'string' || typeof adapter.architecture !== 'string') {
    throw new TypeError('Performance GPU adapter identity must use strings');
  }
  const ids = new Set<string>();
  for (const item of observation.cases) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new TypeError('Performance case must be an object');
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.id !== 'string' ||
      !EXPECTED_CASE_IDS.has(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.fontFixture !== 'string'
    ) {
      throw new TypeError('Performance cases must use the exact unique corpus identities');
    }
    ids.add(entry.id);
    for (const name of REQUIRED_CASE_METRICS) {
      const metric = entry[name];
      if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) {
        throw new TypeError(`${entry.id}.${name} must be a finite non-negative number`);
      }
    }
  }
  if (ids.size !== EXPECTED_CASE_IDS.size) {
    throw new TypeError('Performance observation is missing a corpus case');
  }
}
