/* @workflow
{
  "name": "benchmark:slug-external-parity",
  "summary": "Regenerate the live external-resource Slug parity evidence.",
  "requirements": "GPU-enabled Chromium, Vitexec, and runtime package builds.",
  "writes": "Checked-in Slug external parity evidence and temporary artifacts."
}
*/
import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { bakeFont } from '@pmndrs/glyph/bake';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const renderingDirectory = resolve(cwd, 'fixtures/rendering');
const output = new URL('../fixtures/results/slug-external-render-parity-chromium149.json', import.meta.url);
await mkdir(renderingDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(renderingDirectory, 'slug-external-parity-'));

try {
  const externalOutput = resolve(temporaryDirectory, 'inter-external.font.glb');
  const report = await bakeFont({
    input: resolve(cwd, 'fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
    output: externalOutput,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: slugBaker,
        packaging: { artifact: 'external', pages: 'external' },
        options: undefined,
      },
    ],
  });
  if (report.execution.outputs.length !== 5) {
    throw new Error(
      `Fully external Inter Slug bake produced ${String(report.execution.outputs.length)} files instead of five`,
    );
  }
  const servedDirectory = `/fixtures/rendering/${basename(temporaryDirectory)}`;
  const expectedUrls = report.execution.outputs.map(({ file }) => `${servedDirectory}/${basename(file)}`);
  const artifacts = report.execution.outputs.map(({ role, file, bytes, sha256 }) => ({
    role,
    file: basename(file),
    bytes,
    sha256,
  }));
  if (new Set(expectedUrls).size !== 5) {
    throw new Error('Fully external Inter Slug bake produced duplicate output URLs');
  }
  const path = new URL('/?runner=probe', 'http://localhost');
  path.searchParams.set('slugExternalArtifact', `${servedDirectory}/${basename(externalOutput)}`);
  path.searchParams.set('slugExternalExpected', JSON.stringify(expectedUrls));
  path.searchParams.set('slugExternalArtifacts', JSON.stringify(artifacts));

  const child = spawn(
    executable,
    [
      '--gpu',
      '--timeout',
      '300',
      '--path',
      `${path.pathname}${path.search}`,
      './vitexec/slug-external-render-parity.probe.ts',
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
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  if (code !== 0 || transcript.includes('[error]')) {
    throw new Error(`Slug external render-parity capture failed with status ${String(code)}`);
  }
  const marker = /slug-external-render-parity-ready (\{[^\n]+\})/.exec(transcript)?.[1];
  if (marker === undefined) throw new Error('Slug external parity omitted its result marker');
  const value: unknown = JSON.parse(marker);
  assertObservation(value);
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  const observation = object(candidate, 'Slug external parity observation');
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'slug-external-render-parity-observation' ||
    observation.authority !== 'public-font-loader-and-text-framebuffer' ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt)) ||
    !Array.isArray(observation.cases) ||
    observation.cases.length !== 2 ||
    !Array.isArray(observation.artifacts) ||
    observation.artifacts.length !== 5
  ) {
    throw new TypeError('Slug external parity has an invalid envelope');
  }
  const environment = object(observation.environment, 'Slug external parity environment');
  if (environment.webgpu !== true || typeof environment.browser !== 'string') {
    throw new TypeError('Slug external parity requires a WebGPU-capable browser identity');
  }
  const adapter = object(observation.gpuAdapter, 'Slug external parity GPU adapter');
  if (typeof adapter.vendor !== 'string' || typeof adapter.architecture !== 'string') {
    throw new TypeError('Slug external parity requires a GPU adapter identity');
  }
  const artifactUrls = validateArtifacts(observation.artifacts);
  const expectedBackends = new Set(['webgpu', 'webgl2']);
  for (const candidateCase of observation.cases) {
    const entry = object(candidateCase, 'Slug external parity case');
    if (
      typeof entry.backend !== 'string' ||
      !expectedBackends.delete(entry.backend) ||
      entry.dpr !== 1 ||
      entry.width !== 512 ||
      entry.height !== 512 ||
      entry.fetchContract !==
        'core and companion once; page resources twice for public Text and independent CPU-reference decodes' ||
      !Array.isArray(entry.fetches) ||
      entry.fetches.length !== 5
    ) {
      throw new TypeError('Slug external parity case changed its render or fetch contract');
    }
    assertEqualHexPair(entry.framebufferHashes, `${entry.backend} framebuffer hashes`);
    assertEqualPositivePair(entry.glyphCounts, `${entry.backend} glyph counts`);
    assertEqualPositivePair(entry.evaluatedCurves, `${entry.backend} evaluated curves`);
    const sourceTypes = object(entry.sourceTypes, 'Slug external parity source types');
    if (['raster', 'curve', 'headers', 'references'].some((resource) => sourceTypes[resource] !== 'external')) {
      throw new TypeError(`${entry.backend} did not prove fully external Slug sources`);
    }
    const observedFetches = new Map<string, number>();
    for (const candidateFetch of entry.fetches) {
      const fetch = object(candidateFetch, 'Slug external parity fetch');
      if (
        typeof fetch.url !== 'string' ||
        typeof fetch.count !== 'number' ||
        !Number.isSafeInteger(fetch.count) ||
        observedFetches.has(fetch.url)
      ) {
        throw new TypeError(`${entry.backend} has an invalid external fetch record`);
      }
      observedFetches.set(fetch.url, fetch.count);
    }
    for (const url of artifactUrls) {
      const expectedCount = /(?:-curves\.ktx2|-headers\.r32ui\.bin|-references\.r16ui\.bin)$/u.test(url) ? 2 : 1;
      if (observedFetches.get(url) !== expectedCount) {
        throw new TypeError(`${entry.backend} changed the fetch count for ${url}`);
      }
    }
    finiteNonnegative(entry.embeddedRenderSubmitMs, 'embeddedRenderSubmitMs');
    finiteNonnegative(entry.externalRenderSubmitMs, 'externalRenderSubmitMs');
  }
  if (expectedBackends.size !== 0) throw new TypeError('Slug external parity omitted a backend');
}

function validateArtifacts(candidate: unknown): Set<string> {
  if (!Array.isArray(candidate) || candidate.length !== 5) {
    throw new TypeError('Slug external parity requires five artifacts');
  }
  const roles = new Map<string, number>();
  const urls = new Set<string>();
  for (const candidateArtifact of candidate) {
    const artifact = object(candidateArtifact, 'Slug external parity artifact');
    if (
      typeof artifact.role !== 'string' ||
      typeof artifact.file !== 'string' ||
      artifact.file.length === 0 ||
      typeof artifact.bytes !== 'number' ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes <= 0 ||
      !hexDigest(artifact.sha256)
    ) {
      throw new TypeError('Slug external parity artifact has invalid identity metadata');
    }
    roles.set(artifact.role, (roles.get(artifact.role) ?? 0) + 1);
    const url = `transient:///${artifact.file}`;
    if (urls.has(url)) throw new TypeError('Slug external parity artifact files must be unique');
    urls.add(url);
  }
  if (roles.get('font') !== 1 || roles.get('raster') !== 1 || roles.get('raster-page') !== 3) {
    throw new TypeError('Slug external parity artifact roles changed');
  }
  return urls;
}

function assertEqualPositivePair(candidate: unknown, label: string): void {
  const pair = object(candidate, label);
  if (
    typeof pair.embedded !== 'number' ||
    !Number.isSafeInteger(pair.embedded) ||
    pair.embedded <= 0 ||
    pair.external !== pair.embedded
  ) {
    throw new TypeError(`${label} must be equal and positive`);
  }
}

function assertEqualHexPair(candidate: unknown, label: string): void {
  const pair = object(candidate, label);
  if (!hexDigest(pair.embedded) || pair.external !== pair.embedded) {
    throw new TypeError(`${label} must be equal SHA-256 identities`);
  }
}

function object(candidate: unknown, label: string): Record<string, unknown> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError(`${label} must be an object`);
  }
  return candidate as Record<string, unknown>;
}

function hexDigest(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && /^[0-9a-f]{64}$/u.test(candidate);
}

function finiteNonnegative(candidate: unknown, label: string): void {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
    throw new TypeError(`${label} must be finite and nonnegative`);
  }
}
