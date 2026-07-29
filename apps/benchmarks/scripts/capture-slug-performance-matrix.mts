import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../fixtures/results/slug-performance-matrix-chromium149.json', import.meta.url);
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
const REQUIRED_STATS = [
  'rendererInitMs',
  'fontLoadMs',
  'textReadyMs',
  'firstDrawMs',
  'uploadFrameGpuMs',
  'uploadFrameCompleteMs',
  'startupMs',
  'medianSubmitMs',
  'p95SubmitMs',
  'medianGpuMs',
  'p95GpuMs',
  'glyphCount',
  'missingGlyphCount',
  'drawCount',
  'artifactBytes',
  'slugCurveGpuBytes',
  'slugHeaderGpuBytes',
  'slugReferenceGpuBytes',
  'slugGpuBytes',
  'framebufferGpuBytes',
  'totalGpuBytes',
] as const;

const child = spawn(executable, ['--gpu', '--path', '/?runner=probe', './vitexec/slug-performance-matrix.probe.ts'], {
  cwd,
  stdio: ['ignore', 'pipe', 'pipe'],
});

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
    `Slug performance matrix capture failed${code === 0 ? ' in the browser' : ` with status ${String(code)}`}`,
  );
}
const marker = /slug-performance-matrix-ready (\{[^\n]+\})/.exec(transcript)?.[1];
if (marker === undefined) throw new Error('Slug performance matrix omitted its result marker');
const value: unknown = JSON.parse(marker);
assertObservation(value);
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  const observation = objectRecord(candidate, 'Slug performance matrix');
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'slug-performance-matrix-observation' ||
    observation.technique !== 'slug' ||
    observation.delivery !== 'baked' ||
    observation.workload !== 'text-ladder' ||
    observation.steadyStateReportCount !== 12 ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt))
  ) {
    throw new TypeError('Slug performance matrix has an invalid envelope');
  }
  const viewport = objectRecord(observation.viewport, 'Slug performance matrix viewport');
  if (viewport.width !== 1500 || viewport.height !== 950) {
    throw new TypeError('Slug performance matrix used an unexpected viewport');
  }
  const environment = objectRecord(observation.environment, 'Slug performance matrix environment');
  if (environment.webgpu !== true) {
    throw new TypeError('Slug performance matrix environment must report WebGPU');
  }
  const gpuAdapter = objectRecord(observation.gpuAdapter, 'Slug performance matrix GPU adapter');
  if (typeof gpuAdapter.vendor !== 'string' || typeof gpuAdapter.architecture !== 'string') {
    throw new TypeError('Slug performance matrix GPU adapter identity must use strings');
  }
  if (!Array.isArray(observation.cases)) {
    throw new TypeError('Slug performance matrix cases must be an array');
  }

  const expectedIds = new Set(
    EXPECTED_BACKENDS.flatMap((backend) =>
      EXPECTED_DPRS.flatMap((dpr) => EXPECTED_FONT_FIXTURES.map((fontFixture) => `${backend}-${dpr}x-${fontFixture}`)),
    ),
  );
  const observedIds = new Set<string>();
  for (const candidateCase of observation.cases) {
    const entry = objectRecord(candidateCase, 'Slug performance matrix case');
    if (
      typeof entry.id !== 'string' ||
      !expectedIds.has(entry.id) ||
      observedIds.has(entry.id) ||
      !EXPECTED_BACKENDS.includes(entry.backend as (typeof EXPECTED_BACKENDS)[number]) ||
      !EXPECTED_DPRS.includes(entry.dpr as (typeof EXPECTED_DPRS)[number]) ||
      !EXPECTED_FONT_FIXTURES.includes(entry.fontFixture as (typeof EXPECTED_FONT_FIXTURES)[number]) ||
      typeof entry.fontLabel !== 'string' ||
      typeof entry.fontMetadata !== 'string'
    ) {
      throw new TypeError('Slug performance matrix case identity is invalid or duplicated');
    }
    observedIds.add(entry.id);
    const specimen = objectRecord(entry.specimen, `${entry.id} specimen`);
    if (
      typeof specimen.text !== 'string' ||
      specimen.text.length === 0 ||
      typeof specimen.language !== 'string' ||
      specimen.language.length === 0 ||
      (specimen.direction !== 'ltr' && specimen.direction !== 'rtl')
    ) {
      throw new TypeError(`${entry.id} specimen is invalid`);
    }
    const stats = objectRecord(entry.stats, `${entry.id} stats`);
    if (
      stats.technique !== 'slug' ||
      stats.backend !== entry.backend ||
      stats.dpr !== entry.dpr ||
      stats.gpuTimingSupported !== true
    ) {
      throw new TypeError(`${entry.id} stats do not authenticate their renderer configuration`);
    }
    for (const name of REQUIRED_STATS) finiteNonNegative(stats[name], `${entry.id}.${name}`);
    for (const name of ['submitHistory', 'fpsHistory', 'gpuHistory']) {
      const samples = stats[name];
      if (!Array.isArray(samples) || samples.length < 12) {
        throw new TypeError(`${entry.id}.${name} must retain at least 12 raw samples`);
      }
      for (const [index, sample] of samples.entries()) {
        finiteNonNegative(sample, `${entry.id}.${name}[${index}]`);
      }
    }
    if (
      stats.slugGpuBytes !==
        (stats.slugCurveGpuBytes as number) +
          (stats.slugHeaderGpuBytes as number) +
          (stats.slugReferenceGpuBytes as number) ||
      stats.atlasGpuBytes !== stats.slugGpuBytes ||
      stats.totalGpuBytes !== (stats.slugGpuBytes as number) + (stats.framebufferGpuBytes as number)
    ) {
      throw new TypeError(`${entry.id} resource-byte accounting is inconsistent`);
    }
    if (stats.missingGlyphCount !== 0 || stats.glyphCount === 0 || stats.slugReferenceCount === 0) {
      throw new TypeError(`${entry.id} did not render complete analytic glyphs`);
    }
  }
  if (observedIds.size !== expectedIds.size) {
    throw new TypeError(`Slug performance matrix retained ${observedIds.size} of ${expectedIds.size} required cases`);
  }
}

function objectRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function finiteNonNegative(metric: unknown, label: string): asserts metric is number {
  if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
}
