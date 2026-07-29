export {}

type Variant = 'multiply-zero' | 'zero-width-branch'

const slugTextPath = '/src/renderer/slug-text.ts'
const environmentPath = '/src/benchmark/environment.ts'
const EXPERIMENT_ID = 'slug-outline-zero-branch-001'
const baseCommit = requiredCommit('baseCommit')
const candidateCommit = requiredCommit('candidateCommit')
const variants = ['multiply-zero', 'zero-width-branch'] as const
const [
  { captureSlugOutlineBranchQuality, captureSlugOutlineFragmentShader },
  { environmentResource },
] = await Promise.all([
  import(/* @vite-ignore */ slugTextPath),
  import(/* @vite-ignore */ environmentPath),
])

const cases: Array<Record<string, unknown>> = []
const membershipNegativeControls: Array<Record<string, unknown>> = []
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const dpr of [1, 2] as const) {
    const patternHashes = new Map<'all' | 'alternating', string>()
    const patternPixels = new Map<'all' | 'alternating', Uint8Array>()
    for (const paintStrokePattern of ['alternating', 'all'] as const) {
      const captures = new Map<
        Variant,
        Awaited<ReturnType<typeof captureSlugOutlineBranchQuality>>
      >()
      for (const variant of variants) {
        const capture = await captureSlugOutlineBranchQuality({
          backend,
          dpr,
          paintStrokePattern,
          slugOutlineExperimentVariant: variant,
        })
        if (
          capture.width !== 720 ||
          capture.height !== 340 ||
          capture.glyphCount <= 0 ||
          capture.drawCount !== 1
        ) {
          throw new Error(
            `${backend} ${String(dpr)}x ${paintStrokePattern} ${variant} changed the scene contract`,
          )
        }
        captures.set(variant, capture)
      }
      const baseline = captures.get('multiply-zero')!
      const candidate = captures.get('zero-width-branch')!
      const baselineHash = await sha256(baseline.candidate)
      const candidateHash = await sha256(candidate.candidate)
      if (baselineHash !== candidateHash || !equalBytes(baseline.candidate, candidate.candidate)) {
        throw new Error(
          `${backend} ${String(dpr)}x ${paintStrokePattern} zero-width branch changed pixels`,
        )
      }
      patternHashes.set(paintStrokePattern, baselineHash)
      patternPixels.set(paintStrokePattern, baseline.candidate)
      cases.push({
        backend,
        dpr,
        paintStrokePattern,
        width: baseline.width,
        height: baseline.height,
        glyphCount: baseline.glyphCount,
        drawCount: baseline.drawCount,
        baselineHash,
        candidateHash,
        baselineRenderSubmitMs: baseline.renderSubmitMs,
        candidateRenderSubmitMs: candidate.renderSubmitMs,
        exactPixels: true,
      })
    }
    if (patternHashes.get('alternating') === patternHashes.get('all')) {
      throw new Error(`${backend} ${String(dpr)}x outline-membership negative control was blind`)
    }
    const changedPixelCount = changedPixels(
      patternPixels.get('alternating')!,
      patternPixels.get('all')!,
    )
    if (changedPixelCount === 0) {
      throw new Error(`${backend} ${String(dpr)}x outline-membership pixels did not change`)
    }
    membershipNegativeControls.push({
      backend,
      dpr,
      alternatingHash: patternHashes.get('alternating'),
      allHash: patternHashes.get('all'),
      changedPixelCount,
    })
  }
}

const shaders: Array<Record<string, unknown>> = []
for (const backend of ['webgpu', 'webgl2'] as const) {
  const programs = new Map<Variant, string>()
  for (const variant of variants) {
    const capture = await captureSlugOutlineFragmentShader({
      backend,
      slugOutlineExperimentVariant: variant,
    })
    if (
      capture.backend !== backend ||
      capture.slugOutlineExperimentVariant !== variant ||
      capture.fragmentShader.length === 0
    ) {
      throw new Error(`${backend} ${variant} did not expose its generated fragment program`)
    }
    programs.set(variant, capture.fragmentShader)
  }
  const baseline = programs.get('multiply-zero')!
  const candidate = programs.get('zero-width-branch')!
  const baselineSha256 = await sha256(new TextEncoder().encode(baseline))
  const candidateSha256 = await sha256(new TextEncoder().encode(candidate))
  if (baselineSha256 === candidateSha256 || baseline === candidate) {
    throw new Error(`${backend} graph selector did not produce a distinct candidate program`)
  }
  const baselineGreaterThanCount = operatorCount(baseline, '>')
  const candidateGreaterThanCount = operatorCount(candidate, '>')
  if (candidateGreaterThanCount < baselineGreaterThanCount + 2) {
    throw new Error(`${backend} candidate program omitted its two visibility comparisons`)
  }
  shaders.push({
    backend,
    baselineBytes: new TextEncoder().encode(baseline).byteLength,
    candidateBytes: new TextEncoder().encode(candidate).byteLength,
    baselineSha256,
    candidateSha256,
    baselineGreaterThanCount,
    candidateGreaterThanCount,
    baselineSource: baseline,
    candidateSource: candidate,
    distinctPrograms: true,
  })
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
const gpuAdapterInfo = gpuAdapter?.info
console.log(
  'slug-outline-zero-branch-quality-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-outline-zero-branch-quality-observation',
    experimentId: EXPERIMENT_ID,
    baseCommit,
    candidateCommit,
    capturedAt: new Date().toISOString(),
    authority: 'exact-mixed-and-all-framebuffers-with-membership-negative-control',
    environment: await environmentResource(),
    gpuAdapter:
      gpuAdapterInfo === undefined
        ? undefined
        : {
            architecture: gpuAdapterInfo.architecture,
            description: gpuAdapterInfo.description,
            device: gpuAdapterInfo.device,
            vendor: gpuAdapterInfo.vendor,
          },
    cases,
    membershipNegativeControls,
    shaders,
  }),
)

function requiredCommit(name: string): string {
  const value = new URL(location.href).searchParams.get(name)
  if (value === null || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Slug outline zero-branch probe requires an exact ${name} query parameter`)
  }
  return value
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer),
  )
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

function changedPixels(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length) throw new Error('membership frames have different lengths')
  let changed = 0
  for (let offset = 0; offset < left.length; offset += 4) {
    if (
      left[offset] !== right[offset] ||
      left[offset + 1] !== right[offset + 1] ||
      left[offset + 2] !== right[offset + 2] ||
      left[offset + 3] !== right[offset + 3]
    ) {
      changed += 1
    }
  }
  return changed
}

function operatorCount(source: string, operator: string): number {
  return source.split(operator).length - 1
}
