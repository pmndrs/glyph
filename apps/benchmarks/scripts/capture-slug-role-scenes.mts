import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  SLUG_AFFINE_ROLE_SCENE,
  SLUG_PROJECTION_ZOOM_SCENE,
  SLUG_ROLE_SCENES,
} from '../src/renderer/slug-role-scenes.ts';

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url));
const cwd = fileURLToPath(new URL('..', import.meta.url));
const output = new URL('../fixtures/results/slug-role-scenes-chromium149.json', import.meta.url);
const backends = ['webgpu', 'webgl2'] as const;
const dprs = [1, 2] as const;
const flatScenes = [
  'large-source-serif',
  'extreme-zoom-inter',
  'complex-arabic',
  'complex-devanagari',
  'complex-cjk',
  'clipped-source-serif',
] as const;
const expectedScenes = new Map<string, ExpectedScene>([
  ...SLUG_ROLE_SCENES.map((scene): readonly [string, ExpectedScene] => [
    scene.id,
    {
      kind: scene.kind,
      fontFixture: scene.fontFixture,
      width: scene.physicalWidth,
      height: scene.physicalHeight,
      ppemField: 'physicalPpem',
      ppem: scene.physicalPpem,
      viewportClipped: scene.expectsViewportClipping,
      numericalAuthority: 'independent-scalar-slug-reference',
    },
  ]),
  [
    SLUG_AFFINE_ROLE_SCENE.id,
    {
      kind: SLUG_AFFINE_ROLE_SCENE.kind,
      fontFixture: SLUG_AFFINE_ROLE_SCENE.fontFixture,
      width: SLUG_AFFINE_ROLE_SCENE.physicalWidth,
      height: SLUG_AFFINE_ROLE_SCENE.physicalHeight,
      ppemField: 'physicalPpem',
      ppem: SLUG_AFFINE_ROLE_SCENE.physicalPpem,
      numericalAuthority: 'not-applicable',
    },
  ],
  [
    SLUG_PROJECTION_ZOOM_SCENE.id,
    {
      kind: SLUG_PROJECTION_ZOOM_SCENE.kind,
      fontFixture: SLUG_PROJECTION_ZOOM_SCENE.fontFixture,
      width: SLUG_PROJECTION_ZOOM_SCENE.physicalWidth,
      height: SLUG_PROJECTION_ZOOM_SCENE.physicalHeight,
      ppemField: 'basePhysicalPpem',
      ppem: SLUG_PROJECTION_ZOOM_SCENE.physicalPpem,
      numericalAuthority: 'not-applicable',
    },
  ],
]);

interface ExpectedScene {
  readonly kind: string;
  readonly fontFixture: string;
  readonly width: number;
  readonly height: number;
  readonly ppemField: 'physicalPpem' | 'basePhysicalPpem';
  readonly ppem: number;
  readonly viewportClipped?: boolean;
  readonly numericalAuthority: 'independent-scalar-slug-reference' | 'not-applicable';
}

const child = spawn(
  executable,
  [
    '--gpu',
    '--timeout',
    '300',
    '--path',
    '/?mode=conformance&technique=slug&backend=webgpu&workload=cross-technique-fidelity&dpr=1',
    './vitexec/slug-role-scenes.probe.ts',
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
  throw new Error(`Slug role-scene capture failed with status ${String(code)}`);
}
const marker = /slug-role-scenes-ready (\{[^\n]+\})/.exec(transcript)?.[1];
if (marker === undefined) throw new Error('Slug role-scene capture omitted its result marker');
const value: unknown = JSON.parse(marker);
assertObservation(value);
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`);

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  const record = object(candidate, 'Slug role-scene observation');
  if (
    record.schemaVersion !== 0 ||
    record.kind !== 'slug-role-scene-observation' ||
    typeof record.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(record.capturedAt)) ||
    !Array.isArray(record.observations) ||
    record.observations.length !== 36
  ) {
    throw new TypeError('Slug role-scene observation has an invalid envelope');
  }
  const environment = object(record.environment, 'Slug role-scene environment');
  if (environment.webgpu !== true) {
    throw new TypeError('Slug role-scene environment must report WebGPU');
  }
  const authority = object(record.authority, 'Slug role-scene authority');
  if (
    authority.visual !== 'current-browser-source-font' ||
    authority.flatNumerical !== 'independent-scalar-slug-reference' ||
    authority.transformedNumerical !== 'not-applicable' ||
    authority.historicalOnly !== 'three-flatland'
  ) {
    throw new TypeError('Slug role-scene observation changed its authority boundary');
  }
  const priorArt = object(record.priorArt, 'Slug role-scene prior art');
  if (
    priorArt.revision !== '2935a89fcd9999e8a8b3d3b733f7f7302285cd60' ||
    priorArt.transformGate !== 'examples/three/uikit/s3.ts' ||
    priorArt.projectionZoomGate !== 'examples/three/uikit/u2.ts'
  ) {
    throw new TypeError('Slug role-scene observation changed its reviewed prior art');
  }

  const expected = new Set(
    backends.flatMap((backend) =>
      dprs.flatMap((dpr) => [
        ...flatScenes.map((scene) => identity(backend, dpr, scene)),
        identity(backend, dpr, 'affine-37deg-3x05'),
        identity(backend, dpr, 'camera-zoom-1x-8x', 1),
        identity(backend, dpr, 'camera-zoom-1x-8x', 8),
      ]),
    ),
  );
  const observed = new Set<string>();
  const dprStableCandidateHashes = new Map<string, string>();
  for (const candidateObservation of record.observations) {
    const observation = object(candidateObservation, 'Slug role-scene cell');
    const backend = observation.backend;
    const dpr = observation.dpr;
    const sceneId = observation.sceneId;
    const zoom = observation.zoom;
    if (
      (backend !== 'webgpu' && backend !== 'webgl2') ||
      (dpr !== 1 && dpr !== 2) ||
      typeof sceneId !== 'string' ||
      (zoom !== undefined && zoom !== 1 && zoom !== 8)
    ) {
      throw new TypeError('Slug role-scene cell has an invalid identity');
    }
    const key = identity(backend, dpr, sceneId, zoom);
    if (!expected.has(key) || observed.has(key)) {
      throw new TypeError(`Unexpected or duplicate Slug role-scene cell: ${key}`);
    }
    observed.add(key);
    const expectedScene = expectedScenes.get(sceneId);
    if (
      expectedScene === undefined ||
      observation.kind !== expectedScene.kind ||
      observation.fontFixture !== expectedScene.fontFixture ||
      observation.width !== expectedScene.width ||
      observation.height !== expectedScene.height ||
      observation[expectedScene.ppemField] !== expectedScene.ppem ||
      observation.numericalAuthority !== expectedScene.numericalAuthority ||
      (expectedScene.viewportClipped !== undefined && observation.viewportClipped !== expectedScene.viewportClipped)
    ) {
      throw new TypeError(`Slug role-scene ${key} changed its canonical physical contract`);
    }
    for (const field of ['candidateHash', 'sourceReferenceHash'] as const) {
      if (typeof observation[field] !== 'string' || !/^[0-9a-f]{64}$/.test(observation[field])) {
        throw new TypeError(`Slug role-scene ${key} has an invalid ${field}`);
      }
    }
    const candidateHash = observation.candidateHash as string;
    const dprStableKey = `${backend}:${sceneId}:${zoom === undefined ? '-' : String(zoom)}`;
    const firstCandidateHash = dprStableCandidateHashes.get(dprStableKey);
    if (dpr === 1) {
      if (firstCandidateHash !== undefined) {
        throw new TypeError(`Duplicate Slug role-scene DPR-1 identity: ${dprStableKey}`);
      }
      dprStableCandidateHashes.set(dprStableKey, candidateHash);
    } else if (firstCandidateHash !== candidateHash) {
      throw new TypeError(`Slug role scene changed physical output across DPR: ${dprStableKey}`);
    }
    for (const [name, metric] of Object.entries(observation)) {
      if (typeof metric === 'number' && !finiteNonnegative(metric)) {
        throw new TypeError(`Slug role-scene ${key}.${name} must be finite and nonnegative`);
      }
    }
    if (
      !finitePositive(observation.width) ||
      !finitePositive(observation.height) ||
      !finiteNonnegative(observation.sourceMeanAbsoluteError) ||
      !finiteNonnegative(observation.sourceMaximumError) ||
      !finiteNonnegative(observation.sourceErrorPixels) ||
      !finiteNonnegative(observation.renderSubmitMs)
    ) {
      throw new TypeError(`Slug role-scene ${key} omitted required quality evidence`);
    }
    if (zoom === 1 || zoom === 8) {
      if (
        !finitePositive(observation.fringeWidth) ||
        observation.fringeWidth > 2 ||
        observation.fringeSampleY !== Math.floor(expectedScene.height / 2) ||
        !finiteNonnegative(observation.fringeInkMinX) ||
        !finitePositive(observation.fringeInkMaxX) ||
        observation.fringeInkMinX >= observation.fringeInkMaxX ||
        !finiteNonnegative(observation.leftFringeWidth) ||
        !finiteNonnegative(observation.rightFringeWidth) ||
        observation.leftFringeWidth + observation.rightFringeWidth <= 0 ||
        !finitePositive(observation.inkPixels)
      ) {
        throw new TypeError(`Slug role-scene ${key} omitted projection-zoom evidence`);
      }
    } else if (sceneId === 'affine-37deg-3x05') {
      if (observation.boundaryInkPixels !== 0 || observation.kind !== 'transform') {
        throw new TypeError('Slug affine scene is clipped or mislabeled');
      }
    } else if (
      typeof observation.viewportClipped !== 'boolean' ||
      !finitePositive(observation.glyphCount) ||
      !finitePositive(observation.evaluatedCurves) ||
      !finiteNonnegative(observation.cpuMeanAbsoluteError) ||
      !finiteNonnegative(observation.cpuMaximumError) ||
      !finiteNonnegative(observation.cpuErrorPixels) ||
      !finiteNonnegative(observation.cpuSevereErrorPixels) ||
      typeof observation.cpuReferenceHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(observation.cpuReferenceHash)
    ) {
      throw new TypeError(`Slug role-scene ${key} omitted scalar-reference evidence`);
    }
  }
  if (observed.size !== expected.size) throw new TypeError('Slug role-scene observation is incomplete');
}

function identity(backend: string, dpr: number, scene: string, zoom?: unknown): string {
  return `${backend}:${String(dpr)}:${scene}:${zoom === undefined ? '-' : String(zoom)}`;
}

function object(candidate: unknown, label: string): Record<string, unknown> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError(`${label} must be an object`);
  }
  return candidate as Record<string, unknown>;
}

function finiteNonnegative(candidate: unknown): candidate is number {
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0;
}

function finitePositive(candidate: unknown): candidate is number {
  return finiteNonnegative(candidate) && candidate > 0;
}
