export {}

const slugTextPath = '/src/renderer/slug-text.ts'
const environmentPath = '/src/benchmark/environment.ts'
const fixturesPath = '/src/benchmark/font-fixtures.ts'
const baselinePath = '/fixtures/results/slug-quality-matrix-chromium149.json'
const EXPERIMENT_ID = 'slug-root-branch-001'
const baseCommit = requiredBaseCommit()
const candidateCommit = requiredCommit('candidateCommit')
const [
  { captureSlugFragmentShader, captureSlugTextConformance },
  { environmentResource },
  { ADVANCED_FONT_FIXTURES },
  baseline,
] = await Promise.all([
  import(/* @vite-ignore */ slugTextPath),
  import(/* @vite-ignore */ environmentPath),
  import(/* @vite-ignore */ fixturesPath),
  fetchJson<QualityBaseline>(baselinePath),
])

const shaderPrograms: Array<Record<string, unknown>> = []
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const variant of ['baseline', 'root-branch'] as const) {
    const capture = await captureSlugFragmentShader({ backend, variant })
    shaderPrograms.push(await analyzeShader(capture.fragmentShader, backend, variant))
  }
}

const observations: Array<Record<string, unknown>> = []
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const dpr of [1, 2] as const) {
    for (const { id: fontFixture } of ADVANCED_FONT_FIXTURES) {
      const expected = baseline.observations.find(
        (candidate) =>
          candidate.backend === backend &&
          candidate.dpr === dpr &&
          candidate.fontFixture === fontFixture,
      )
      if (expected === undefined) {
        throw new Error(
          `${backend} ${String(dpr)}x ${fontFixture} lacks retained baseline evidence`,
        )
      }
      console.log('slug-root-branch-quality-start', backend, dpr, fontFixture)
      const capture = await captureSlugTextConformance({
        backend,
        dpr,
        fontFixture,
        slugExperimentVariant: 'root-branch',
      })
      const hash = await sha256(capture.candidate)
      if (hash !== expected.sampling.hash || hash !== expected.sourceOutline.hash) {
        throw new Error(`${backend} ${String(dpr)}x ${fontFixture} changed retained output pixels`)
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
      })
      console.log('slug-root-branch-quality-complete', backend, dpr, fontFixture)
    }
  }
}

console.log(
  'slug-root-branch-quality-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-root-branch-quality-observation',
    experimentId: EXPERIMENT_ID,
    baseCommit,
    candidateCommit,
    capturedAt: new Date().toISOString(),
    environment: await environmentResource(),
    shaderPrograms,
    observations,
  }),
)

async function analyzeShader(
  source: string,
  backend: 'webgpu' | 'webgl2',
  variant: 'baseline' | 'root-branch',
): Promise<Record<string, unknown>> {
  const language = backend === 'webgpu' ? 'wgsl' : 'glsl'
  const languageMarker = backend === 'webgpu' ? '@fragment' : '#version 300 es'
  if (!source.includes(languageMarker)) {
    throw new Error(`${backend} Slug shader capture did not return ${language}`)
  }
  const rootConditionBranches = [
    'slugHorizontalHasRoot1',
    'slugHorizontalHasRoot2',
    'slugVerticalHasRoot1',
    'slugVerticalHasRoot2',
  ].reduce((total, name) => total + occurrences(source, `if ( ${name} )`), 0)
  const candidateContributionVariables = source.includes('slugHorizontalRoot1Contribution')
  const expectedBranches = variant === 'baseline' ? 8 : 4
  if (
    rootConditionBranches !== expectedBranches ||
    candidateContributionVariables !== (variant === 'root-branch')
  ) {
    throw new Error(`${backend} ${variant} did not emit the expected root contribution structure`)
  }
  const bytes = new TextEncoder().encode(source)
  return {
    backend,
    variant,
    language,
    sourceBytes: bytes.byteLength,
    sha256: await sha256(bytes),
    rootConditionBranches,
    candidateContributionVariables,
  }
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

function requiredBaseCommit(): string {
  return requiredCommit('baseCommit')
}

function requiredCommit(name: string): string {
  const value = new URL(location.href).searchParams.get(name)
  if (value === null || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Slug root-branch probe requires an exact ${name} query parameter`)
  }
  return value
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function fetchJson<Value>(url: string): Promise<Value> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} returned ${String(response.status)}`)
  return (await response.json()) as Value
}

interface QualityBaseline {
  readonly observations: readonly {
    readonly backend: 'webgpu' | 'webgl2'
    readonly dpr: 1 | 2
    readonly fontFixture: string
    readonly sampling: { readonly hash: string }
    readonly sourceOutline: { readonly hash: string }
  }[]
}
