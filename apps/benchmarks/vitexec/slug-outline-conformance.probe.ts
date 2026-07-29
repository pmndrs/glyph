export {}

type Variant = 'fill' | 'zero' | 'outline'

const slugTextPath = '/src/renderer/slug-text.ts'
const environmentPath = '/src/benchmark/environment.ts'
const [{ captureSlugOutlineConformance }, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ slugTextPath),
  import(/* @vite-ignore */ environmentPath),
])
const cases: Array<Record<string, unknown>> = []

for (const backend of ['webgpu', 'webgl2'] as const) {
  const dprOneHashes = new Map<Variant, string>()
  for (const dpr of [1, 2] as const) {
    const captures = new Map<Variant, Awaited<ReturnType<typeof captureSlugOutlineConformance>>>()
    for (const variant of ['fill', 'zero', 'outline'] as const) {
      console.log('slug-outline-conformance-start', backend, dpr, variant)
      const capture = await captureSlugOutlineConformance({ backend, dpr, variant })
      if (capture.width !== 720 || capture.height !== 340 || capture.glyphCount <= 0) {
        throw new Error(`${backend} ${dpr}x ${variant} changed its physical scene contract`)
      }
      captures.set(variant, capture)
    }

    const fill = captures.get('fill')!
    const zero = captures.get('zero')!
    const outline = captures.get('outline')!
    const fillHash = await sha256(fill.candidate)
    const zeroHash = await sha256(zero.candidate)
    const outlineHash = await sha256(outline.candidate)
    if (fillHash !== zeroHash || !equalBytes(fill.candidate, zero.candidate)) {
      throw new Error(`${backend} ${dpr}x zero-width outline changed fill pixels`)
    }
    if (outlineHash === fillHash) {
      throw new Error(`${backend} ${dpr}x positive outline did not change pixels`)
    }
    const firstFillHash = dprOneHashes.get('fill')
    const firstZeroHash = dprOneHashes.get('zero')
    const firstOutlineHash = dprOneHashes.get('outline')
    if (dpr === 1) {
      dprOneHashes.set('fill', fillHash)
      dprOneHashes.set('zero', zeroHash)
      dprOneHashes.set('outline', outlineHash)
    } else if (
      firstFillHash !== fillHash ||
      firstZeroHash !== zeroHash ||
      firstOutlineHash !== outlineHash
    ) {
      throw new Error(`${backend} outline output changed across equal physical DPR scenes`)
    }

    const fillBounds = inkBounds(fill.candidate, fill.width, fill.height)
    const outlineBounds = inkBounds(outline.candidate, outline.width, outline.height)
    if (fillBounds === undefined || outlineBounds === undefined) {
      throw new Error(`${backend} ${dpr}x outline conformance rendered no ink`)
    }
    const expansion = {
      left: fillBounds.minX - outlineBounds.minX,
      top: fillBounds.minY - outlineBounds.minY,
      right: outlineBounds.maxX - fillBounds.maxX,
      bottom: outlineBounds.maxY - fillBounds.maxY,
    }
    if (Object.values(expansion).some((value) => value < 6 || value > 10)) {
      throw new Error(
        `${backend} ${dpr}x outline is not centered at the requested 8 px radius: ${JSON.stringify({ fillBounds, outlineBounds, expansion })}`,
      )
    }
    const fillInkPixels = countInk(fill.candidate)
    const outlineInkPixels = countInk(outline.candidate)
    if (outlineInkPixels <= fillInkPixels) {
      throw new Error(`${backend} ${dpr}x outline did not expand the covered region`)
    }
    const darkenedFillPixels = countDarkenedFillPixels(fill.candidate, outline.candidate)
    if (darkenedFillPixels !== 0) {
      throw new Error(`${backend} ${dpr}x outline damaged ${darkenedFillPixels} fill pixels`)
    }
    const wrongReferenceMeanError = meanRgbError(outline.candidate, fill.reference)
    if (!(wrongReferenceMeanError > outline.meanAbsoluteError * 4)) {
      throw new Error(`${backend} ${dpr}x outline negative control did not reject fill-only pixels`)
    }
    if (
      outline.meanAbsoluteError > 0.01 ||
      outline.maximumError > 20 ||
      outline.errorPixels > 32 ||
      outline.severeErrorPixels !== 0
    ) {
      throw new Error(`${backend} ${dpr}x outline exceeded its independent CPU error envelope`)
    }

    cases.push({
      backend,
      dpr,
      physicalFontSize: outline.physicalFontSize,
      physicalOutlineWidth: outline.physicalOutlineWidth,
      glyphCount: outline.glyphCount,
      fillHash,
      outlineHash,
      fillInkPixels,
      outlineInkPixels,
      expansion,
      meanAbsoluteError: outline.meanAbsoluteError,
      maximumError: outline.maximumError,
      errorPixels: outline.errorPixels,
      severeErrorPixels: outline.severeErrorPixels,
      wrongReferenceMeanError,
      renderSubmitMs: outline.renderSubmitMs,
    })
    console.log('slug-outline-conformance-complete', backend, dpr)
  }
}

const gpuAdapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
const gpuAdapterInfo = gpuAdapter?.info
console.log(
  'slug-outline-conformance-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-outline-conformance-observation',
    capturedAt: new Date().toISOString(),
    authority: 'independent-cpu-slug-stroke-reference',
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
  }),
)

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer),
  )
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

interface Bounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

function inkBounds(bytes: Uint8Array, width: number, height: number): Bounds | undefined {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (bytes[offset]! === 0 && bytes[offset + 1]! === 0 && bytes[offset + 2]! === 0) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return maxX < 0 ? undefined : { minX, minY, maxX, maxY }
}

function countInk(bytes: Uint8Array): number {
  let count = 0
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (bytes[offset]! !== 0 || bytes[offset + 1]! !== 0 || bytes[offset + 2]! !== 0) count += 1
  }
  return count
}

function countDarkenedFillPixels(fill: Uint8Array, outline: Uint8Array): number {
  let count = 0
  for (let offset = 0; offset < fill.length; offset += 4) {
    if (
      outline[offset]! < fill[offset]! ||
      outline[offset + 1]! < fill[offset + 1]! ||
      outline[offset + 2]! < fill[offset + 2]!
    ) {
      count += 1
    }
  }
  return count
}

function meanRgbError(candidate: Uint8Array, reference: Uint8Array): number {
  let total = 0
  for (let offset = 0; offset < candidate.length; offset += 4) {
    total += Math.abs(candidate[offset]! - reference[offset]!)
    total += Math.abs(candidate[offset + 1]! - reference[offset + 1]!)
    total += Math.abs(candidate[offset + 2]! - reference[offset + 2]!)
  }
  return total / ((candidate.length / 4) * 3)
}
