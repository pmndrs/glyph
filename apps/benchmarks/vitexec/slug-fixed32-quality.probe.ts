export {};

const slugTextPath = '/src/renderer/slug-text.ts';
const environmentPath = '/src/benchmark/environment.ts';
const fixturesPath = '/src/benchmark/font-fixtures.ts';
const fixed32ManifestPath = '/fixtures/autoresearch/slug-fixed32-bands-001/artifacts-v0.json';
const baselinePath = '/fixtures/results/slug-quality-matrix-chromium149.json';
const [{ captureSlugTextConformance }, { environmentResource }, { ADVANCED_FONT_FIXTURES }, fixed32Manifest, baseline] =
  await Promise.all([
    import(/* @vite-ignore */ slugTextPath),
    import(/* @vite-ignore */ environmentPath),
    import(/* @vite-ignore */ fixturesPath),
    fetchJson<Fixed32Manifest>(fixed32ManifestPath),
    fetchJson<QualityBaseline>(baselinePath),
  ]);

const observations: Array<Record<string, unknown>> = [];
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const dpr of [1, 2] as const) {
    for (const { id: fontFixture } of ADVANCED_FONT_FIXTURES) {
      const artifact = fixed32Manifest.artifacts.find((candidate) => candidate.fontFixture === fontFixture);
      const expected = baseline.observations.find(
        (candidate) => candidate.backend === backend && candidate.dpr === dpr && candidate.fontFixture === fontFixture,
      );
      if (artifact === undefined || expected === undefined) {
        throw new Error(`${backend} ${dpr}x ${fontFixture} lacks retained A/B evidence`);
      }
      console.log('slug-fixed32-quality-start', backend, dpr, fontFixture);
      const capture = await captureSlugTextConformance({
        backend,
        bakedArtifact: {
          url: new URL(`/fixtures/autoresearch/slug-fixed32-bands-001/${artifact.file}`, location.origin).href,
          compressed: artifact.compressed,
          uncompressed: artifact.uncompressed,
        },
        dpr,
        fontFixture,
      });
      const hash = await sha256(capture.candidate);
      if (hash !== expected.sampling.hash || hash !== expected.sourceOutline.hash) {
        throw new Error(`${backend} ${dpr}x ${fontFixture} changed retained output pixels`);
      }
      observations.push({
        backend,
        dpr,
        fontFixture,
        exactBaselinePixels: true,
        hash,
        glyphCount: capture.glyphCount,
        evaluatedCurves: capture.evaluatedCurves,
        meanAbsoluteError: capture.meanAbsoluteError,
        maximumError: capture.maximumError,
        errorPixels: capture.errorPixels,
        severeErrorPixels: capture.severeErrorPixels,
      });
      console.log('slug-fixed32-quality-complete', backend, dpr, fontFixture);
    }
  }
}

console.log(
  'slug-fixed32-quality-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-fixed32-quality-observation',
    experimentId: fixed32Manifest.experimentId,
    baseCommit: fixed32Manifest.baseCommit,
    capturedAt: new Date().toISOString(),
    environment: await environmentResource(),
    observations,
  }),
);

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchJson<Value>(url: string): Promise<Value> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as Value;
}

interface Fixed32Manifest {
  readonly experimentId: string;
  readonly baseCommit: string;
  readonly artifacts: readonly {
    readonly fontFixture: string;
    readonly file: string;
    readonly compressed: { readonly bytes: number; readonly sha256: string };
    readonly uncompressed: { readonly bytes: number; readonly sha256: string };
  }[];
}

interface QualityBaseline {
  readonly observations: readonly {
    readonly backend: 'webgpu' | 'webgl2';
    readonly dpr: 1 | 2;
    readonly fontFixture: string;
    readonly sampling: { readonly hash: string };
    readonly sourceOutline: { readonly hash: string };
  }[];
}
