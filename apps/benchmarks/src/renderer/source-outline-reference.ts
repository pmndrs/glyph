import type { ParagraphLayout } from '@pmndrs/text'

import amiriSourceUrl from '../../fixtures/fonts/amiri-1.002/Amiri-Regular.ttf?url'
import dancingScriptSourceUrl from '../../fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf?url'
import dotGothicSourceUrl from '../../fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf?url'
import interSourceUrl from '../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url'
import notoCjkSourceUrl from '../../fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf?url'
import devanagariSourceUrl from '../../fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf?url'
import sourceSerifSourceUrl from '../../fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf?url'
import type { BenchmarkFontFixture } from '../benchmark/font-fixtures'
import { compareRgba8Coverage } from './mtsdf-cpu-reference'

const sourceFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interSourceUrl,
  'source-serif-4': sourceSerifSourceUrl,
  'dancing-script': dancingScriptSourceUrl,
  amiri: amiriSourceUrl,
  'noto-sans-devanagari': devanagariSourceUrl,
  'noto-sans-cjk-showcase': notoCjkSourceUrl,
  'dot-gothic-16': dotGothicSourceUrl,
}

export interface SourceOutlineFidelityCapture {
  readonly width: number
  readonly height: number
  readonly candidate: Uint8Array
  readonly reference: Uint8Array
  readonly difference: Uint8Array
  readonly meanAbsoluteError: number
  readonly maximumError: number
  readonly errorPixels: number
  readonly renderSubmitMs: number
  readonly physicalPpem: number
}

export interface SourceOutlineReferenceOptions {
  readonly candidate: Uint8Array
  readonly width: number
  readonly height: number
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly fontSize: number
  readonly direction: 'ltr' | 'rtl'
  readonly layout: ParagraphLayout
  readonly originX: number
  readonly originY: number
  readonly text: string
  readonly renderSubmitMs: number
}

/**
 * Renders the pinned source font through browser Canvas2D at the exact physical
 * size and paragraph baselines used by the candidate. Canvas owns glyph
 * rasterization and shaping here; the candidate pipeline contributes only the
 * line boundaries and positions needed to compare the same authored specimen.
 */
export async function captureSourceOutlineFidelity(
  options: SourceOutlineReferenceOptions,
): Promise<SourceOutlineFidelityCapture> {
  const family = `pmndrs-source-outline-${options.fontFixture}`
  const response = await fetch(sourceFontUrls[options.fontFixture])
  if (!response.ok) {
    throw new Error(`Unable to load source font fixture (${response.status})`)
  }
  const face = new FontFace(family, await response.arrayBuffer())
  await face.load()
  document.fonts.add(face)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = options.width
    canvas.height = options.height
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('Unable to create source-outline reference canvas')
    context.fillStyle = '#000'
    context.fillRect(0, 0, options.width, options.height)
    context.fillStyle = '#fff'
    context.font = `${options.fontSize * options.dpr}px "${family}"`
    context.direction = options.direction
    context.textAlign = 'start'
    context.textBaseline = 'alphabetic'
    context.fontKerning = 'normal'
    for (let line = 0; line < options.layout.lineBaselines.length; line += 1) {
      const start = options.layout.lineTextStarts[line]
      const end = options.layout.lineTextEnds[line]
      const baseline = options.layout.lineBaselines[line]
      if (start === undefined || end === undefined || baseline === undefined) {
        throw new Error('Paragraph layout contains an incomplete source-reference line')
      }
      context.fillText(
        options.text.slice(start, end),
        (options.originX + (options.direction === 'rtl' ? options.layout.width : 0)) * options.dpr,
        (-options.originY + baseline) * options.dpr,
      )
    }
    const image = context.getImageData(0, 0, options.width, options.height)
    const reference = new Uint8Array(image.data)
    const comparison = compareRgba8Coverage(options.candidate, reference)
    return {
      width: options.width,
      height: options.height,
      candidate: options.candidate,
      reference,
      difference: comparison.heatmap,
      meanAbsoluteError: comparison.meanAbsoluteError,
      maximumError: comparison.maximumError,
      errorPixels: comparison.errorPixels,
      renderSubmitMs: options.renderSubmitMs,
      physicalPpem: options.fontSize * options.dpr,
    }
  } finally {
    document.fonts.delete(face)
  }
}
