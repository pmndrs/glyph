import {
  createParagraphEngine,
  createRuntimeShaper,
  FontLoader,
  FontRegistry,
  type Paragraph,
  type ParagraphMeasurement,
  type RegisteredFont,
  type RuntimeShaper,
  type ShapeBatchRequest,
  type ShapedBatchViews,
} from '@pmndrs/text'
import { createFontBaker, type FontBakeCore } from '@pmndrs/text-font-baker'
import wasmUrl from '@pmndrs/text-font-baker/font-baker.wasm?url'
import shaperWasmUrl from '@pmndrs/text/text-shaper.wasm?url'
import canonicalFontUrl from '../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url'
import canonicalFontManifest from '../../fixtures/fonts/inter-v4.1/manifest.json'
import canonicalShapingOracle from '../../fixtures/shaping/inter-regular/harfrust.json'
import type { BenchmarkTarget } from './contracts'

function stableSyntheticHash(sample: number): string {
  let value = 2166136261
  for (let index = 0; index < 4096; index += 1) {
    value = Math.imul(value ^ ((index + sample) & 0xff), 16777619)
  }
  return (value >>> 0).toString(16).padStart(8, '0')
}

const syntheticTarget: BenchmarkTarget = {
  id: 'synthetic',
  label: 'Runner contract',
  detail: 'deterministic · CPU',
  color: 'violet',
  capabilities: new Set(['deterministic']),
  status: () => 'ready',
  load: async () => undefined,
  run: async (_input, sample) => ({ bytes: 4096, hash: stableSyntheticHash(sample) }),
  dispose: async () => undefined,
}

let baker: FontBakeCore | undefined
let canonicalFontBytes: Uint8Array | undefined
const bakerTarget: BenchmarkTarget = {
  id: 'font-baker',
  label: 'Rust font baker',
  detail: 'Wasm · direct memory ABI',
  color: 'green',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm']),
  status: () => 'ready',
  load: async () => {
    if (baker !== undefined && canonicalFontBytes !== undefined) return
    const [wasmResponse, fontResponse] = await Promise.all([
      fetch(wasmUrl),
      fetch(canonicalFontUrl),
    ])
    if (!wasmResponse.ok) throw new Error(`Unable to load font baker Wasm (${wasmResponse.status})`)
    if (!fontResponse.ok)
      throw new Error(`Unable to load canonical font fixture (${fontResponse.status})`)
    const [wasm, font] = await Promise.all([wasmResponse.arrayBuffer(), fontResponse.arrayBuffer()])
    baker = await createFontBaker(wasm)
    canonicalFontBytes = new Uint8Array(font)
  },
  run: async (input) => {
    if (baker === undefined || canonicalFontBytes === undefined)
      throw new Error('Font baker target was not loaded')
    const result = baker.bake({
      source: input.fontBytes ?? canonicalFontBytes,
      descriptor: { formatVersion: 0, fontFaceIndex: 0 },
    })
    const artifact = result.artifacts[0]
    if (artifact === undefined) throw new Error('Font baker returned no artifact')
    return { bytes: artifact.bytes.byteLength, hash: artifact.sha256 }
  },
  dispose: async () => undefined,
}

let workerParityReady = false
const loaderWorkerTarget: BenchmarkTarget = {
  id: 'font-loader-worker',
  label: 'Font loader Worker fallback',
  detail: 'baked miss · module Worker · validated GLB',
  color: 'cyan',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'loader']),
  status: () => 'ready',
  load: async () => {
    if (workerParityReady) return
    const { bakeFontInWorker } = await import('@pmndrs/text/runtime-bake')
    const response = await fetch(canonicalFontUrl)
    if (!response.ok) throw new Error(`Unable to load canonical font fixture (${response.status})`)
    const source = new Uint8Array(await response.arrayBuffer())
    const artifact = await bakeFontInWorker({ source, sourceUrl: canonicalFontUrl })
    const artifactHash = await sha256(artifact)
    if (artifactHash !== canonicalFontManifest.bake.expectedCore.artifactSha256) {
      throw new Error('Browser Worker bytes differ from the canonical Node artifact')
    }
    const font = await new FontRegistry().registerAsset(artifact)
    try {
      if (font.shapingHash !== canonicalFontManifest.bake.expectedCore.shapingHash) {
        throw new Error('Browser Worker artifact retained an unexpected shaping identity')
      }
    } finally {
      font.dispose()
    }
    workerParityReady = true
  },
  run: async () => {
    let font
    try {
      font = await new FontLoader({ development: false }).load(canonicalFontUrl)
    } catch (error) {
      const cause =
        error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
      throw new Error(
        `Worker fallback failed for ${canonicalFontUrl}: ${error instanceof Error ? error.message : String(error)}${cause === '' ? '' : ` (${cause})`}`,
        { cause: error },
      )
    }
    try {
      if (font.shapingHash !== canonicalFontManifest.bake.expectedCore.shapingHash) {
        throw new Error('Worker fallback registered an unexpected shaping identity')
      }
      return {
        bytes: canonicalFontManifest.bake.expectedCore.artifactBytes,
        hash: font.shapingHash,
      }
    } finally {
      font.dispose()
    }
  },
  dispose: async () => undefined,
}

interface OracleGlyph {
  readonly glyphId: number
  readonly cluster: number
  readonly xAdvance: number
  readonly yAdvance: number
  readonly xOffset: number
  readonly yOffset: number
  readonly flags: number
}

interface OracleCase {
  readonly id: string
  readonly text: string
  readonly segment: {
    readonly direction: 'ltr' | 'rtl'
    readonly script: string
    readonly language: string
    readonly features: readonly string[]
  }
  readonly glyphs: readonly OracleGlyph[]
}

const shapingCases = canonicalShapingOracle.cases as readonly OracleCase[]
let runtimeShaper: RuntimeShaper | undefined
let runtimeShaperFont: RegisteredFont | undefined
let runtimeShapingRequest: ShapeBatchRequest | undefined
let runtimeShaperColdStartMs = 0

const harfrustShaperTarget: BenchmarkTarget = {
  id: 'harfrust-shaper',
  label: 'HarfRust Wasm shaper',
  detail: 'validated GLB · 8 golden runs · 1 coarse call',
  color: 'amber',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping']),
  status: (input) => (input.fontBytes === undefined ? 'ready' : 'needs-fixture'),
  load: async () => {
    if (
      runtimeShaper !== undefined &&
      runtimeShaperFont !== undefined &&
      runtimeShapingRequest !== undefined
    )
      return
    const [bakerResponse, shaperResponse, fontResponse] = await Promise.all([
      fetch(wasmUrl),
      fetch(shaperWasmUrl),
      fetch(canonicalFontUrl),
    ])
    if (!bakerResponse.ok)
      throw new Error(`Unable to load font baker Wasm (${bakerResponse.status})`)
    if (!shaperResponse.ok)
      throw new Error(`Unable to load text shaper Wasm (${shaperResponse.status})`)
    if (!fontResponse.ok)
      throw new Error(`Unable to load canonical font fixture (${fontResponse.status})`)
    const [bakerWasm, shaperWasm, source] = await Promise.all([
      bakerResponse.arrayBuffer(),
      shaperResponse.arrayBuffer(),
      fontResponse.arrayBuffer(),
    ])
    const directBaker = await createFontBaker(bakerWasm)
    const baked = directBaker.bake({
      source: new Uint8Array(source),
      descriptor: { formatVersion: 0, fontFaceIndex: 0 },
    })
    const artifact = baked.artifacts[0]
    if (artifact === undefined) throw new Error('Font baker returned no shaping artifact')
    const registry = new FontRegistry()
    const font = await registry.registerAsset(artifact.bytes)
    const coldStart = performance.now()
    const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
    shaper.registerFont(font)
    runtimeShaperColdStartMs = performance.now() - coldStart
    runtimeShaper = shaper
    runtimeShaperFont = font
    runtimeShapingRequest = shapingBatch(font.handle)
  },
  run: async () => {
    if (
      runtimeShaper === undefined ||
      runtimeShaperFont === undefined ||
      runtimeShapingRequest === undefined
    ) {
      throw new Error('HarfRust shaper target was not loaded')
    }
    const shapeStart = performance.now()
    const shaped = runtimeShaper.shapeBatch(runtimeShapingRequest)
    const shapeCallMs = performance.now() - shapeStart
    validateShapingGoldens(shaped, runtimeShaperFont.handle)
    const memory = runtimeShaper.memoryReport()
    return {
      bytes: shapedOutputBytes(shaped),
      hash: hashShapedOutput(shaped),
      metrics: {
        boundaryCrossings: 1,
        coldStartMs: runtimeShaperColdStartMs,
        shapeCallMs,
        goldenCases: shapingCases.length,
        glyphCount: shaped.glyphIds.length,
        planCount: memory.planCount,
        retainedFontBytes: memory.retainedFontBytes,
        wasmMemoryBytes: memory.wasmMemoryBytes,
      },
    }
  },
  dispose: async () => {
    runtimeShaper?.dispose()
    runtimeShaperFont?.dispose()
    runtimeShaper = undefined
    runtimeShaperFont = undefined
    runtimeShapingRequest = undefined
    runtimeShaperColdStartMs = 0
  },
}

const paragraphGolden = {
  natural: {
    width: 847.625,
    height: 41.599999999999994,
    contentWidth: 847.625,
    contentHeight: 41.599999999999994,
    firstBaseline: 32.440625,
    lastBaseline: 32.440625,
    overflowed: false,
  },
  wide: {
    width: 696.734375,
    height: 83.19999999999999,
    contentWidth: 696.734375,
    contentHeight: 83.19999999999999,
    firstBaseline: 32.440625,
    lastBaseline: 74.04062499999999,
    overflowed: false,
  },
  narrow: {
    width: 356.546875,
    height: 124.79999999999998,
    contentWidth: 356.546875,
    contentHeight: 124.79999999999998,
    firstBaseline: 32.440625,
    lastBaseline: 115.64062499999999,
    overflowed: false,
  },
} as const

let paragraphShaper: RuntimeShaper | undefined
let paragraphFont: RegisteredFont | undefined
let measuredParagraph: Paragraph | undefined
let paragraphShapeCalls = 0
let paragraphReshapeCalls = 0

const paragraphTarget: BenchmarkTarget = {
  id: 'paragraph-engine',
  label: 'JavaScript paragraph engine',
  detail: 'validated GLB · exact HarfRust widths · cached reflow',
  color: 'violet',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph']),
  status: (input) => (input.fontBytes === undefined ? 'ready' : 'needs-fixture'),
  load: async () => {
    if (
      paragraphShaper !== undefined &&
      paragraphFont !== undefined &&
      measuredParagraph !== undefined
    )
      return
    const [bakerResponse, shaperResponse, fontResponse] = await Promise.all([
      fetch(wasmUrl),
      fetch(shaperWasmUrl),
      fetch(canonicalFontUrl),
    ])
    if (!bakerResponse.ok)
      throw new Error(`Unable to load font baker Wasm (${bakerResponse.status})`)
    if (!shaperResponse.ok)
      throw new Error(`Unable to load text shaper Wasm (${shaperResponse.status})`)
    if (!fontResponse.ok)
      throw new Error(`Unable to load canonical font fixture (${fontResponse.status})`)
    const [bakerWasm, shaperWasm, source] = await Promise.all([
      bakerResponse.arrayBuffer(),
      shaperResponse.arrayBuffer(),
      fontResponse.arrayBuffer(),
    ])
    const directBaker = await createFontBaker(bakerWasm)
    const artifact = directBaker.bake({
      source: new Uint8Array(source),
      descriptor: { formatVersion: 0, fontFaceIndex: 0 },
    }).artifacts[0]
    if (artifact === undefined) throw new Error('Font baker returned no paragraph artifact')
    const registry = new FontRegistry()
    const font = await registry.registerAsset(artifact.bytes)
    const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
    const observedShaper: RuntimeShaper = {
      registry: shaper.registry,
      registerFont: (registered) => shaper.registerFont(registered),
      disposeFont: (registered) => shaper.disposeFont(registered),
      shapeBatch: (request) => {
        paragraphShapeCalls += 1
        return shaper.shapeBatch(request)
      },
      reshapeRanges: (request) => {
        paragraphReshapeCalls += 1
        return shaper.reshapeRanges(request)
      },
      memoryReport: () => shaper.memoryReport(),
      dispose: () => shaper.dispose(),
    }
    const fixture = shapingCases.find(({ id }) => id === 'paragraph')
    if (fixture === undefined) throw new Error('Canonical paragraph shaping fixture is missing')
    const expectedNaturalWidth =
      (fixture.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * 32) /
      font.metrics.unitsPerEm
    if (expectedNaturalWidth !== paragraphGolden.natural.width) {
      throw new Error('Paragraph width golden is not derived from the pinned HarfRust advances')
    }
    const paragraph = createParagraphEngine({ shaper: observedShaper }).create({
      text: fixture.text,
      font: font.handle,
      style: {
        fontSize: 32,
        lineHeight: 1.3,
        language: 'en',
        direction: 'ltr',
        features: [],
      },
    })
    paragraphShaper = shaper
    paragraphFont = font
    measuredParagraph = paragraph
  },
  run: async () => {
    if (measuredParagraph === undefined) throw new Error('Paragraph target was not loaded')
    const shapeCalls = paragraphShapeCalls
    const reshapeCalls = paragraphReshapeCalls
    const natural = measuredParagraph.measure()
    const wideConstraints = { width: { mode: 'at-most' as const, size: 720 } }
    const wide = measuredParagraph.measure(wideConstraints)
    const cachedWide = measuredParagraph.measure(wideConstraints)
    const narrow = measuredParagraph.measure({ width: { mode: 'at-most', size: 360 } })
    exactMeasurement('natural', natural, paragraphGolden.natural)
    exactMeasurement('wide', wide, paragraphGolden.wide)
    exactMeasurement('narrow', narrow, paragraphGolden.narrow)
    if (cachedWide !== wide) throw new Error('Equivalent paragraph constraints missed the cache')
    if (paragraphShapeCalls !== shapeCalls || paragraphReshapeCalls !== reshapeCalls) {
      throw new Error('Width-only paragraph reflow crossed the Wasm boundary')
    }
    return {
      bytes: 3 * 7 * Float64Array.BYTES_PER_ELEMENT,
      hash: hashMeasurements([natural, wide, narrow]),
      metrics: {
        measurementCount: 3,
        positionedGlyphBytes: 0,
        reflowBoundaryCrossings: 0,
        reshapeBoundaryCrossings: paragraphReshapeCalls,
        shapeBoundaryCrossings: paragraphShapeCalls,
      },
    }
  },
  dispose: async () => {
    measuredParagraph?.dispose()
    paragraphShaper?.dispose()
    paragraphFont?.dispose()
    measuredParagraph = undefined
    paragraphShaper = undefined
    paragraphFont = undefined
    paragraphShapeCalls = 0
    paragraphReshapeCalls = 0
  },
}

function exactMeasurement(
  label: string,
  actual: ParagraphMeasurement,
  expected: ParagraphMeasurement,
): void {
  for (const key of [
    'width',
    'height',
    'contentWidth',
    'contentHeight',
    'firstBaseline',
    'lastBaseline',
    'overflowed',
  ] as const) {
    if (actual[key] !== expected[key]) {
      throw new Error(
        `Paragraph ${label}.${key} differs: ${String(actual[key])} !== ${String(expected[key])}`,
      )
    }
  }
}

function hashMeasurements(measurements: readonly ParagraphMeasurement[]): string {
  let hash = 2_166_136_261
  for (const measurement of measurements) {
    for (const value of [
      measurement.width,
      measurement.height,
      measurement.contentWidth,
      measurement.contentHeight,
      measurement.firstBaseline,
      measurement.lastBaseline,
      Number(measurement.overflowed),
    ]) {
      for (const codeUnit of String(value))
        hash = Math.imul(hash ^ codeUnit.charCodeAt(0), 16_777_619)
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function shapingBatch(font: RegisteredFont['handle']): ShapeBatchRequest {
  const codeUnits: number[] = []
  const features: { tag: string; value: number; start: number; end: number }[] = []
  const runs: ShapeBatchRequest['runs'][number][] = []
  for (const fixture of shapingCases) {
    const start = codeUnits.length
    for (let index = 0; index < fixture.text.length; index++) {
      codeUnits.push(fixture.text.charCodeAt(index))
    }
    const end = codeUnits.length
    const featureStart = features.length
    for (const source of fixture.segment.features) {
      const match = /^(.{4})(?:=(\d+))?$/.exec(source)
      if (match === null) throw new Error(`Unsupported shaping fixture feature ${source}`)
      features.push({
        tag: match[1]!,
        value: match[2] === undefined ? 1 : Number(match[2]),
        start,
        end,
      })
    }
    runs.push({
      font,
      textStart: start,
      textEnd: end,
      direction: fixture.segment.direction,
      script: fixture.segment.script,
      language: fixture.segment.language,
      clusterLevel: 0,
      flags: 0x40,
      featureStart,
      featureCount: features.length - featureStart,
    })
  }
  return { textUtf16: Uint16Array.from(codeUnits), runs, features }
}

function validateShapingGoldens(shaped: ShapedBatchViews, font: RegisteredFont['handle']): void {
  exactArray('fontHandles', shaped.fontHandles, [font])
  exactArray(
    'runFontSlots',
    shaped.runFontSlots,
    shapingCases.map(() => 0),
  )
  let glyphStart = 0
  let textStart = 0
  for (const [run, fixture] of shapingCases.entries()) {
    if (shaped.runGlyphStarts[run] !== glyphStart) {
      throw new Error(`Shaping golden ${fixture.id} has an unexpected glyph start`)
    }
    if (shaped.runGlyphCounts[run] !== fixture.glyphs.length) {
      throw new Error(`Shaping golden ${fixture.id} has an unexpected glyph count`)
    }
    for (const [local, expected] of fixture.glyphs.entries()) {
      const glyph = glyphStart + local
      exactValue(fixture.id, 'glyphId', local, shaped.glyphIds[glyph], expected.glyphId)
      exactValue(fixture.id, 'cluster', local, shaped.clusters[glyph], expected.cluster + textStart)
      exactValue(fixture.id, 'xAdvance', local, shaped.xAdvances[glyph], expected.xAdvance)
      exactValue(fixture.id, 'yAdvance', local, shaped.yAdvances[glyph], expected.yAdvance)
      exactValue(fixture.id, 'xOffset', local, shaped.xOffsets[glyph], expected.xOffset)
      exactValue(fixture.id, 'yOffset', local, shaped.yOffsets[glyph], expected.yOffset)
      exactValue(fixture.id, 'flags', local, shaped.glyphFlags[glyph], expected.flags)
    }
    glyphStart += fixture.glyphs.length
    textStart += fixture.text.length
  }
  if (glyphStart !== shaped.glyphIds.length) {
    throw new Error('Shaping output contains trailing glyphs outside the pinned corpus')
  }
}

function exactArray(label: string, actual: ArrayLike<number>, expected: readonly number[]): void {
  if (actual.length !== expected.length) throw new Error(`${label} length differs from its golden`)
  for (let index = 0; index < expected.length; index++) {
    exactValue('batch', label, index, actual[index], expected[index])
  }
}

function exactValue(
  fixture: string,
  field: string,
  index: number,
  actual: number | undefined,
  expected: number | undefined,
): void {
  if (actual !== expected) {
    throw new Error(
      `Shaping golden ${fixture}.${field}[${index}] differs: ${String(actual)} !== ${String(expected)}`,
    )
  }
}

function shapedOutputBytes(shaped: ShapedBatchViews): number {
  return (
    shaped.fontHandles.byteLength +
    shaped.runFontSlots.byteLength +
    shaped.runGlyphStarts.byteLength +
    shaped.runGlyphCounts.byteLength +
    shaped.glyphIds.byteLength +
    shaped.clusters.byteLength +
    shaped.xAdvances.byteLength +
    shaped.yAdvances.byteLength +
    shaped.xOffsets.byteLength +
    shaped.yOffsets.byteLength +
    shaped.glyphFlags.byteLength
  )
}

function hashShapedOutput(shaped: ShapedBatchViews): string {
  let hash = 2_166_136_261
  const arrays: readonly ArrayLike<number>[] = [
    shaped.fontHandles,
    shaped.runFontSlots,
    shaped.runGlyphStarts,
    shaped.runGlyphCounts,
    shaped.glyphIds,
    shaped.clusters,
    shaped.xAdvances,
    shaped.yAdvances,
    shaped.xOffsets,
    shaped.yOffsets,
    shaped.glyphFlags,
  ]
  for (const values of arrays) {
    hash = Math.imul(hash ^ values.length, 16_777_619)
    for (let index = 0; index < values.length; index++) {
      hash = Math.imul(hash ^ (values[index]! >>> 0), 16_777_619)
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

async function sha256(bytes: ArrayBufferView): Promise<string> {
  const owned = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice().buffer
  const digest = await crypto.subtle.digest('SHA-256', owned)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function unavailableTarget(
  id: string,
  label: string,
  detail: string,
  color: BenchmarkTarget['color'],
): BenchmarkTarget {
  return {
    id,
    label,
    detail,
    color,
    capabilities: new Set(['raster']),
    status: () => 'unavailable',
    load: async () => {
      throw new Error(`${label} is not implemented yet`)
    },
    run: async () => {
      throw new Error(`${label} is not implemented yet`)
    },
    dispose: async () => undefined,
  }
}

export const targets: readonly BenchmarkTarget[] = [
  syntheticTarget,
  bakerTarget,
  loaderWorkerTarget,
  harfrustShaperTarget,
  paragraphTarget,
  unavailableTarget('bitmap', 'Bitmap atlas', 'capability not landed', 'amber'),
  unavailableTarget('msdf', 'MSDF atlas', 'capability not landed', 'cyan'),
  unavailableTarget('slug', 'Three Flatland Slug', 'adapter not landed', 'green'),
]

export function targetById(id: string): BenchmarkTarget {
  return targets.find((target) => target.id === id) ?? syntheticTarget
}
