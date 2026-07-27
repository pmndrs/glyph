import type { BenchmarkFontFixture } from '../benchmark/font-fixtures'
import type { RasterTechnique } from '../benchmark/url-state'
import { captureBitmapTextConformance } from './bitmap-text'
import { captureMtsdfTextConformance } from './mtsdf-text'
import type { RendererBackend } from './webgpu-renderer'

export interface RuntimeFallbackCapture {
  readonly width: number
  readonly height: number
  readonly baked: Uint8Array
  readonly runtime: Uint8Array
  readonly difference: Uint8Array
  readonly mismatchBytes: number
  readonly changedPixels: number
  readonly maximumError: number
  readonly renderSubmitMs: number
}

export async function captureRuntimeFallbackConformance(options: {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly signal?: AbortSignal
  readonly technique: Exclude<RasterTechnique, 'slug'>
}): Promise<RuntimeFallbackCapture> {
  const capture = options.technique === 'bitmap' ? captureBitmap : captureMtsdf
  const baked = await capture({ ...options, delivery: 'baked' })
  options.signal?.throwIfAborted()
  const runtime = await capture({ ...options, delivery: 'runtime' })
  options.signal?.throwIfAborted()
  if (baked.width !== runtime.width || baked.height !== runtime.height) {
    throw new Error('baked and runtime captures produced different frame dimensions')
  }
  const comparison = comparePixels(baked.candidate, runtime.candidate)
  return {
    width: baked.width,
    height: baked.height,
    baked: baked.candidate,
    runtime: runtime.candidate,
    difference: comparison.difference,
    mismatchBytes: comparison.mismatchBytes,
    changedPixels: comparison.changedPixels,
    maximumError: comparison.maximumError,
    renderSubmitMs: baked.renderSubmitMs + runtime.renderSubmitMs,
  }
}

async function captureBitmap(options: {
  readonly backend: RendererBackend
  readonly delivery: 'baked' | 'runtime'
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly signal?: AbortSignal
}) {
  return captureBitmapTextConformance(options)
}

async function captureMtsdf(options: {
  readonly backend: RendererBackend
  readonly delivery: 'baked' | 'runtime'
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly signal?: AbortSignal
}) {
  return captureMtsdfTextConformance(options)
}

function comparePixels(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) {
    throw new Error('baked and runtime captures produced different byte lengths')
  }
  const difference = new Uint8Array(left.byteLength)
  let mismatchBytes = 0
  let changedPixels = 0
  let maximumError = 0
  for (let index = 0; index < left.byteLength; index += 4) {
    let pixelChanged = false
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(left[index + channel]! - right[index + channel]!)
      if (delta > 0) {
        mismatchBytes += 1
        pixelChanged = true
      }
      maximumError = Math.max(maximumError, delta)
    }
    if (pixelChanged) changedPixels += 1
    const extraRuntime = Math.max(0, right[index]! - left[index]!)
    const extraBaked = Math.max(0, left[index]! - right[index]!)
    difference[index] = Math.min(255, extraRuntime * 8)
    difference[index + 1] = Math.min(255, extraBaked * 8)
    difference[index + 2] = Math.min(255, extraBaked * 8)
    difference[index + 3] = 255
  }
  return { changedPixels, difference, maximumError, mismatchBytes }
}
