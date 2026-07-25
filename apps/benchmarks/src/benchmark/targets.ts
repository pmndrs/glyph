import {
  createParagraphEngine,
  createRuntimeShaper,
  FontLoader,
  FontRegistry,
  type Paragraph,
  type ParagraphConstraints,
  type ParagraphLayout,
  type ParagraphMeasurement,
  type ParagraphStyle,
  type RegisteredFont,
  type RuntimeShaper,
  type ShapeBatchRequest,
  type ShapedBatchViews,
} from '@pmndrs/text'
import { createFontBaker, type FontBakeCore } from '@pmndrs/text-font-baker'
import wasmUrl from '@pmndrs/text-font-baker/font-baker.wasm?url'
import shaperWasmUrl from '@pmndrs/text/text-shaper.wasm?url'
import canonicalFontUrl from '../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url'
import amiriFontUrl from '../../fixtures/fonts/amiri-1.002/Amiri-Regular.ttf?url'
import canonicalFontManifest from '../../fixtures/fonts/inter-v4.1/manifest.json'
import paragraphBidiContract from '../../fixtures/contracts/paragraph-bidi-layout-v0.json'
import canonicalParagraphLayout from '../../fixtures/contracts/paragraph-layout-v0.json'
import canonicalShapingOracle from '../../fixtures/shaping/inter-regular/harfrust.json'
import type { BenchmarkTarget } from './contracts'
import { hashParagraphLayout, hashParagraphLayouts } from './paragraph-layout-digest'
import { createUikitLayoutFixture, YogaMeasureMode } from './uikit-layout-fixture'

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
  natural: canonicalParagraphLayout.goldens.natural.measurement,
  wide: canonicalParagraphLayout.goldens.wide.measurement,
  narrow: canonicalParagraphLayout.goldens.narrow.measurement,
}
const paragraphLayoutGolden = {
  natural: canonicalParagraphLayout.goldens.natural.layout,
  wide: canonicalParagraphLayout.goldens.wide.layout,
  narrow: canonicalParagraphLayout.goldens.narrow.layout,
}

let paragraphShaper: RuntimeShaper | undefined
let paragraphFont: RegisteredFont | undefined
let measuredParagraph: Paragraph | undefined
let paragraphShapeCalls = 0
let paragraphReshapeCalls = 0

async function loadParagraphFixture(): Promise<void> {
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
  if (!bakerResponse.ok) throw new Error(`Unable to load font baker Wasm (${bakerResponse.status})`)
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
    analyzeBidi: (text, direction) => shaper.analyzeBidi(text, direction),
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
    (fixture.glyphs.reduce((sum, glyph) => sum + glyph.xAdvance, 0) * 32) / font.metrics.unitsPerEm
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
}

async function disposeParagraphFixture(): Promise<void> {
  measuredParagraph?.dispose()
  paragraphShaper?.dispose()
  paragraphFont?.dispose()
  measuredParagraph = undefined
  paragraphShaper = undefined
  paragraphFont = undefined
  paragraphShapeCalls = 0
  paragraphReshapeCalls = 0
}

const paragraphTarget: BenchmarkTarget = {
  id: 'paragraph-engine',
  label: 'JavaScript paragraph engine',
  detail: 'validated GLB · exact HarfRust widths · cached reflow',
  color: 'violet',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph']),
  status: (input) => (input.fontBytes === undefined ? 'ready' : 'needs-fixture'),
  load: loadParagraphFixture,
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
  dispose: disposeParagraphFixture,
}

const paragraphLayoutTarget: BenchmarkTarget = {
  id: 'paragraph-layout-engine',
  label: 'Positioned paragraph engine',
  detail: 'validated GLB · exact SoA · batched boundary reshape',
  color: 'cyan',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph']),
  status: (input) => (input.fontBytes === undefined ? 'ready' : 'needs-fixture'),
  load: loadParagraphFixture,
  run: async () => {
    if (measuredParagraph === undefined || paragraphFont === undefined) {
      throw new Error('Paragraph layout target was not loaded')
    }
    const natural = measuredParagraph.layout()
    const wideConstraints = { width: { mode: 'at-most' as const, size: 720 } }
    const wide = measuredParagraph.layout(wideConstraints)
    const cachedWide = measuredParagraph.layout(wideConstraints)
    const narrow = measuredParagraph.layout({ width: { mode: 'at-most', size: 360 } })
    if (cachedWide !== wide) throw new Error('Equivalent positioned constraints missed the cache')
    exactParagraphLayout('natural', natural, paragraphLayoutGolden.natural, paragraphFont.handle)
    exactParagraphLayout('wide', wide, paragraphLayoutGolden.wide, paragraphFont.handle)
    exactParagraphLayout('narrow', narrow, paragraphLayoutGolden.narrow, paragraphFont.handle)
    return {
      bytes: layoutBytes(natural) + layoutBytes(wide) + layoutBytes(narrow),
      hash: hashParagraphLayouts([natural, wide, narrow]),
      metrics: {
        batchedBoundaryLayouts: 2,
        glyphCount: natural.glyphIds.length + wide.glyphIds.length + narrow.glyphIds.length,
        layoutCount: 3,
        reshapeBoundaryCrossings: paragraphReshapeCalls,
        shapeBoundaryCrossings: paragraphShapeCalls,
      },
    }
  },
  dispose: disposeParagraphFixture,
}

interface ContractLayout {
  readonly measurement: ParagraphMeasurement
  readonly hash: string
  readonly glyphFontSlots?: readonly number[]
  readonly glyphIds: readonly number[]
  readonly clusters: readonly number[]
  readonly glyphFontSizes?: readonly number[]
  readonly x: readonly number[]
  readonly y?: readonly number[]
  readonly glyphFlags?: readonly number[]
  readonly lineTextStarts: readonly number[]
  readonly lineTextEnds: readonly number[]
  readonly lineGlyphStarts: readonly number[]
  readonly lineGlyphCounts: readonly number[]
  readonly lineBaselines: readonly number[]
  readonly lineAdvances: readonly number[]
}

let policyShaper: RuntimeShaper | undefined
let policyFonts: readonly RegisteredFont[] = []
let bidiParagraphs: readonly Paragraph[] = []
let policyParagraph: Paragraph | undefined
let uikitParagraph: Paragraph | undefined
let policyShapeCalls = 0
let policyReshapeCalls = 0

async function loadParagraphPolicyFixture(): Promise<void> {
  if (policyShaper !== undefined) return
  const [bakerResponse, shaperResponse, interResponse, amiriResponse] = await Promise.all([
    fetch(wasmUrl),
    fetch(shaperWasmUrl),
    fetch(canonicalFontUrl),
    fetch(amiriFontUrl),
  ])
  for (const [label, response] of [
    ['font baker Wasm', bakerResponse],
    ['text shaper Wasm', shaperResponse],
    ['Inter fixture', interResponse],
    ['Amiri fixture', amiriResponse],
  ] as const) {
    if (!response.ok) throw new Error(`Unable to load ${label} (${response.status})`)
  }
  const [bakerBytes, shaperBytes, interSource, amiriSource] = await Promise.all([
    bakerResponse.arrayBuffer(),
    shaperResponse.arrayBuffer(),
    interResponse.arrayBuffer(),
    amiriResponse.arrayBuffer(),
  ])
  const directBaker = await createFontBaker(bakerBytes)
  const bakeArtifact = (source: ArrayBuffer) => {
    const artifact = directBaker.bake({
      source: new Uint8Array(source),
      descriptor: { formatVersion: 0, fontFaceIndex: 0 },
    }).artifacts[0]
    if (artifact === undefined) throw new Error('Font baker returned no paragraph policy artifact')
    return artifact
  }
  const interArtifact = bakeArtifact(interSource)
  const amiriArtifact = bakeArtifact(amiriSource)
  const registry = new FontRegistry()
  const [inter, amiri] = await Promise.all([
    registry.registerAsset(interArtifact.bytes),
    registry.registerAsset(amiriArtifact.bytes),
  ])
  if (
    inter.shapingHash !== paragraphBidiContract.fonts.inter.shapingHash ||
    amiri.shapingHash !== paragraphBidiContract.fonts.amiri.shapingHash
  ) {
    throw new Error('Paragraph policy fixtures retained unexpected shaping identities')
  }
  const shaper = await createRuntimeShaper({ registry, wasm: shaperBytes })
  const observed: RuntimeShaper = {
    registry,
    registerFont: (font) => shaper.registerFont(font),
    disposeFont: (font) => shaper.disposeFont(font),
    analyzeBidi: (text, direction) => shaper.analyzeBidi(text, direction),
    shapeBatch: (request) => {
      policyShapeCalls += 1
      return shaper.shapeBatch(request)
    },
    reshapeRanges: (request) => {
      policyReshapeCalls += 1
      return shaper.reshapeRanges(request)
    },
    memoryReport: () => shaper.memoryReport(),
    dispose: () => shaper.dispose(),
  }
  const engine = createParagraphEngine({ shaper: observed })
  bidiParagraphs = Object.values(paragraphBidiContract.bidi).map((fixture) =>
    engine.create({
      text: fixture.text,
      font: amiri.handle,
      style: fixture.style as ParagraphStyle,
    }),
  )
  policyParagraph = engine.create({
    text: paragraphBidiContract.policies.text,
    font: inter.handle,
    style: paragraphBidiContract.policies.style as ParagraphStyle,
  })
  uikitParagraph = engine.create({
    text: paragraphBidiContract.uikit.input.text,
    font: inter.handle,
    style: paragraphBidiContract.uikit.input.style as ParagraphStyle,
  })
  policyShaper = shaper
  policyFonts = [inter, amiri]
}

async function disposeParagraphPolicyFixture(): Promise<void> {
  for (const paragraph of [...bidiParagraphs, policyParagraph, uikitParagraph]) paragraph?.dispose()
  policyShaper?.dispose()
  for (const font of policyFonts) font.dispose()
  policyShaper = undefined
  policyFonts = []
  bidiParagraphs = []
  policyParagraph = undefined
  uikitParagraph = undefined
  policyShapeCalls = 0
  policyReshapeCalls = 0
}

const paragraphPolicyTarget: BenchmarkTarget = {
  id: 'paragraph-bidi-policy',
  label: 'Bidi + paragraph policies',
  detail: 'Amiri GLB · UAX #9 · alignment · truncation · uikit seam',
  color: 'amber',
  capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph']),
  status: (input) => (input.fontBytes === undefined ? 'ready' : 'needs-fixture'),
  load: loadParagraphPolicyFixture,
  run: async () => {
    if (policyParagraph === undefined || uikitParagraph === undefined) {
      throw new Error('Paragraph policy target was not loaded')
    }
    const layouts: ParagraphLayout[] = []
    for (const [index, fixture] of Object.values(paragraphBidiContract.bidi).entries()) {
      const layout = bidiParagraphs[index]?.layout(fixture.constraints as ParagraphConstraints)
      if (layout === undefined) throw new Error('Bidi paragraph fixture is missing')
      exactContractLayout(`bidi.${index}`, layout, fixture.layout)
      layouts.push(layout)
    }
    for (const [id, fixture] of Object.entries(paragraphBidiContract.policies.cases)) {
      const layout = policyParagraph.layout(fixture.constraints as ParagraphConstraints)
      exactContractLayout(`policy.${id}`, layout, fixture.layout)
      layouts.push(layout)
    }

    const uikit = createUikitLayoutFixture(
      uikitParagraph,
      paragraphBidiContract.uikit.policy as ParagraphConstraints,
    )
    const custom = uikit.customLayouting()
    exactObject(
      'uikit.customLayouting',
      {
        minWidth: custom.minWidth,
        minHeight: custom.minHeight,
        firstBaseline: custom.firstBaseline,
      },
      paragraphBidiContract.uikit.customLayouting,
    )
    const natural = custom.measure(NaN, YogaMeasureMode.Undefined, NaN, YogaMeasureMode.Undefined)
    const atMost = custom.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost)
    const exactWidth = custom.measure(
      420.001,
      YogaMeasureMode.Exactly,
      NaN,
      YogaMeasureMode.Undefined,
    )
    for (let index = 0; index < 20; index += 1) {
      exactObject(
        'uikit.repeatedAtMost',
        custom.measure(360, YogaMeasureMode.AtMost, 90, YogaMeasureMode.AtMost),
        paragraphBidiContract.uikit.measurements.atMost,
      )
    }
    exactObject('uikit.natural', natural, paragraphBidiContract.uikit.measurements.natural)
    exactObject('uikit.atMost', atMost, paragraphBidiContract.uikit.measurements.atMost)
    exactObject('uikit.exactWidth', exactWidth, paragraphBidiContract.uikit.measurements.exactWidth)
    exactObject(
      'uikit.definite',
      uikit.resolveYogaLeaf(401.237, YogaMeasureMode.Exactly, 150.111, YogaMeasureMode.Exactly),
      paragraphBidiContract.uikit.measurements.definite,
    )
    if (uikit.calls.layout !== 0) throw new Error('uikit measurement materialized glyph arrays')
    const resolved = uikit.layoutResolvedBox(
      paragraphBidiContract.uikit.resolved.outerSize as unknown as readonly [number, number],
      paragraphBidiContract.uikit.resolved.padding as unknown as readonly [
        number,
        number,
        number,
        number,
      ],
      paragraphBidiContract.uikit.resolved.border as unknown as readonly [
        number,
        number,
        number,
        number,
      ],
    )
    exactObject(
      'uikit.contentBox',
      resolved.contentBox,
      paragraphBidiContract.uikit.resolved.contentBox,
    )
    exactArray(
      'uikit.centeredX',
      resolved.centeredX,
      paragraphBidiContract.uikit.resolved.centeredX,
    )
    exactArray(
      'uikit.centeredY',
      resolved.centeredY,
      paragraphBidiContract.uikit.resolved.centeredY,
    )
    exactContractLayout(
      'uikit.layout',
      resolved.layout,
      paragraphBidiContract.uikit.resolved.layout,
    )
    layouts.push(resolved.layout)

    return {
      bytes:
        layouts.reduce((sum, layout) => sum + layoutBytes(layout), 0) +
        resolved.centeredX.byteLength +
        resolved.centeredY.byteLength,
      hash: hashParagraphLayouts(layouts),
      metrics: {
        bidiLayoutCount: 2,
        policyLayoutCount: 9,
        uikitMeasurementCount: uikit.calls.measure,
        uikitLayoutCount: uikit.calls.layout,
        shapeBoundaryCrossings: policyShapeCalls,
        reshapeBoundaryCrossings: policyReshapeCalls,
      },
    }
  },
  dispose: disposeParagraphPolicyFixture,
}

interface ParagraphLayoutGolden {
  readonly hash: string
  readonly glyphCount: number
  readonly lineTextStarts: readonly number[]
  readonly lineTextEnds: readonly number[]
  readonly lineGlyphStarts: readonly number[]
  readonly lineGlyphCounts: readonly number[]
  readonly lineBaselines: readonly number[]
  readonly lineAdvances: readonly number[]
}

function exactParagraphLayout(
  label: string,
  layout: ParagraphLayout,
  golden: ParagraphLayoutGolden,
  fontHandle: RegisteredFont['handle'],
): void {
  const fixture = shapingCases.find(({ id }) => id === 'paragraph')
  if (fixture === undefined) throw new Error('Canonical paragraph shaping fixture is missing')
  exactArray(
    `${label}.glyphIds`,
    layout.glyphIds,
    fixture.glyphs.map(({ glyphId }) => glyphId),
  )
  exactArray(
    `${label}.clusters`,
    layout.clusters,
    fixture.glyphs.map(({ cluster }) => cluster),
  )
  exactArray(
    `${label}.glyphFlags`,
    layout.glyphFlags,
    fixture.glyphs.map(({ flags }) => flags),
  )
  if (
    layout.fontHandles.length !== 1 ||
    layout.fontHandles[0] !== fontHandle ||
    layout.glyphFontSlots.some((slot) => slot !== 0)
  ) {
    throw new Error(`${label} paragraph layout did not normalize its font slots`)
  }
  if (layout.glyphIds.length !== golden.glyphCount) {
    throw new Error(`${label} paragraph layout has an unexpected glyph count`)
  }
  exactArray(`${label}.lineTextStarts`, layout.lineTextStarts, golden.lineTextStarts)
  exactArray(`${label}.lineTextEnds`, layout.lineTextEnds, golden.lineTextEnds)
  exactArray(`${label}.lineGlyphStarts`, layout.lineGlyphStarts, golden.lineGlyphStarts)
  exactArray(`${label}.lineGlyphCounts`, layout.lineGlyphCounts, golden.lineGlyphCounts)
  exactArray(`${label}.lineBaselines`, layout.lineBaselines, golden.lineBaselines)
  exactArray(`${label}.lineAdvances`, layout.lineAdvances, golden.lineAdvances)
  const hash = hashParagraphLayout(layout)
  if (hash !== golden.hash)
    throw new Error(`${label} paragraph layout hash ${hash} != ${golden.hash}`)
}

function exactContractLayout(label: string, layout: ParagraphLayout, golden: ContractLayout): void {
  exactMeasurement(label, layout, golden.measurement)
  for (const field of [
    'glyphIds',
    'clusters',
    'x',
    'lineTextStarts',
    'lineTextEnds',
    'lineGlyphStarts',
    'lineGlyphCounts',
    'lineBaselines',
    'lineAdvances',
  ] as const) {
    exactArray(`${label}.${field}`, layout[field], golden[field])
  }
  for (const field of ['glyphFontSlots', 'glyphFontSizes', 'y', 'glyphFlags'] as const) {
    const expected = golden[field]
    if (expected !== undefined) exactArray(`${label}.${field}`, layout[field], expected)
  }
  const hash = hashParagraphLayout(layout)
  if (hash !== golden.hash) throw new Error(`${label} hash ${hash} != ${golden.hash}`)
}

function exactObject(
  label: string,
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
): void {
  const actualSource = JSON.stringify(actual)
  const expectedSource = JSON.stringify(expected)
  if (actualSource !== expectedSource) {
    throw new Error(`${label} differs: ${actualSource} != ${expectedSource}`)
  }
}

function layoutArrays(layout: ParagraphLayout): readonly ArrayBufferView[] {
  return [
    layout.fontHandles,
    layout.glyphFontSlots,
    layout.glyphIds,
    layout.clusters,
    layout.glyphFontSizes,
    layout.x,
    layout.y,
    layout.glyphFlags,
    layout.lineTextStarts,
    layout.lineTextEnds,
    layout.lineGlyphStarts,
    layout.lineGlyphCounts,
    layout.lineBaselines,
    layout.lineAdvances,
  ]
}

function layoutBytes(layout: ParagraphLayout): number {
  return layoutArrays(layout).reduce((sum, values) => sum + values.byteLength, 0)
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
  paragraphLayoutTarget,
  paragraphPolicyTarget,
  unavailableTarget('bitmap', 'Bitmap atlas', 'capability not landed', 'amber'),
  unavailableTarget('msdf', 'MSDF atlas', 'capability not landed', 'cyan'),
  unavailableTarget('slug', 'Three Flatland Slug', 'adapter not landed', 'green'),
]

export function targetById(id: string): BenchmarkTarget {
  return targets.find((target) => target.id === id) ?? syntheticTarget
}
