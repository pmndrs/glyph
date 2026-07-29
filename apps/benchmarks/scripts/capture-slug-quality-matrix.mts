import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../fixtures/results/slug-quality-matrix-chromium149.json', import.meta.url);
const EXPECTED_BACKENDS = ['webgpu', 'webgl2'] as const;
const EXPECTED_DPRS = [1, 2] as const;
const EXPECTED_FONT_FIXTURES = [
  'inter',
  'source-serif-4',
  'dancing-script',
  'amiri',
  'noto-sans-devanagari',
  'noto-sans-cjk-showcase',
  'dot-gothic-16',
] as const;
const child = spawn(
  executable,
  [
    '--gpu',
    '--path',
    '/?mode=conformance&technique=slug&backend=webgpu&workload=cross-technique-fidelity&dpr=1',
    './vitexec/slug-quality-matrix.probe.ts',
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
  throw new Error(`Slug quality matrix capture failed with status ${String(code)}`);
}
const marker = /slug-quality-matrix-ready (\{[^\n]+\})/.exec(transcript)?.[1];
if (marker === undefined) throw new Error('Slug quality matrix capture omitted its result marker');
const value: unknown = JSON.parse(marker);
assertObservation(value);
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError('Slug quality matrix observation must be an object');
  }
  const record = candidate as Record<string, unknown>;
  if (
    record.schemaVersion !== 0 ||
    record.kind !== 'slug-quality-matrix-observation' ||
    typeof record.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(record.capturedAt)) ||
    !Array.isArray(record.observations) ||
    record.observations.length !== 28
  ) {
    throw new TypeError('Slug quality matrix observation has an invalid envelope');
  }
  const environment = object(record.environment, 'Slug quality matrix environment');
  if (environment.webgpu !== true) {
    throw new TypeError('Slug quality matrix environment must report WebGPU');
  }
  const expectedIdentities = new Set(
    EXPECTED_BACKENDS.flatMap((backend) =>
      EXPECTED_DPRS.flatMap((dpr) =>
        EXPECTED_FONT_FIXTURES.map((fontFixture) => `${backend}:${String(dpr)}:${fontFixture}`),
      ),
    ),
  );
  const observedIdentities = new Set<string>();
  for (const observation of record.observations) {
    const entry = object(observation, 'Slug quality matrix entry');
    if (
      (entry.backend !== 'webgpu' && entry.backend !== 'webgl2') ||
      (entry.dpr !== 1 && entry.dpr !== 2) ||
      typeof entry.fontFixture !== 'string'
    ) {
      throw new TypeError('Slug quality matrix entry has an invalid identity');
    }
    const identity = `${entry.backend}:${String(entry.dpr)}:${entry.fontFixture}`;
    if (!expectedIdentities.has(identity) || observedIdentities.has(identity)) {
      throw new TypeError(`Unexpected or duplicate Slug quality entry: ${identity}`);
    }
    observedIdentities.add(identity);
    const sampling = object(entry.sampling, `${identity} sampling`);
    const sourceOutline = object(entry.sourceOutline, `${identity} source outline`);
    assertResult(sampling, identity, 'sampling');
    assertResult(sourceOutline, identity, 'sourceOutline');
    assertQualityMetrics(
      object(sampling.metrics, `${identity} sampling metrics`),
      entry.backend,
      entry.dpr,
      'sampling',
    );
    assertQualityMetrics(
      object(sourceOutline.metrics, `${identity} source outline metrics`),
      entry.backend,
      entry.dpr,
      'sourceOutline',
    );
  }
  if (observedIdentities.size !== expectedIdentities.size) {
    throw new TypeError('Slug quality matrix omitted a required case');
  }
}

function assertResult(result: Record<string, unknown>, identity: string, kind: 'sampling' | 'sourceOutline'): void {
  if (
    typeof result.hash !== 'string' ||
    typeof result.validation !== 'string' ||
    !finiteNonnegative(result.outputBytes) ||
    !finiteNonnegative(result.durationMs)
  ) {
    throw new TypeError(`${identity} ${kind} result has an invalid envelope`);
  }
}

function assertQualityMetrics(
  metrics: Record<string, unknown>,
  backend: unknown,
  dpr: unknown,
  kind: 'sampling' | 'sourceOutline',
): void {
  for (const [name, metricValue] of Object.entries(metrics)) {
    if (!finiteNonnegative(metricValue)) throw new TypeError(`${kind}.${name} must be non-negative`);
  }
  if (
    metrics.dpr !== dpr ||
    metrics.backendWebGpu !== (backend === 'webgpu' ? 1 : 0) ||
    metrics.backendWebGl2 !== (backend === 'webgl2' ? 1 : 0) ||
    !finitePositive(metrics.pixelCount) ||
    !finiteNonnegative(metrics.meanAbsoluteError) ||
    !finiteNonnegative(metrics.maximumError) ||
    !finiteNonnegative(metrics.errorPixels)
  ) {
    throw new TypeError(`${kind} metrics do not authenticate their renderer and quality contract`);
  }
  if (kind === 'sampling' && (!finitePositive(metrics.glyphCount) || !finitePositive(metrics.evaluatedCurves))) {
    throw new TypeError('Sampling metrics do not prove analytic glyph work');
  }
  if (kind === 'sourceOutline' && (metrics.techniqueSlug !== 1 || metrics.physicalPpem !== 64)) {
    throw new TypeError('Source-outline metrics do not prove the Slug 64-ppem contract');
  }
}

function object(candidateValue: unknown, label: string): Record<string, unknown> {
  if (typeof candidateValue !== 'object' || candidateValue === null || Array.isArray(candidateValue)) {
    throw new TypeError(`${label} must be an object`);
  }
  return candidateValue as Record<string, unknown>;
}

function finiteNonnegative(candidateValue: unknown): candidateValue is number {
  return typeof candidateValue === 'number' && Number.isFinite(candidateValue) && candidateValue >= 0;
}

function finitePositive(candidateValue: unknown): candidateValue is number {
  return finiteNonnegative(candidateValue) && candidateValue > 0;
}
