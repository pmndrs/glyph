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
import type { BenchmarkInput, BenchmarkTarget } from './contracts'
import { exactValue as exactJsonValue } from './exact-value'
import {
  hashParagraphLayout,
  hashParagraphLayouts,
  paragraphLayoutBytes,
} from './paragraph-layout-digest'
import {
  assertShapingFixture,
  hashShapedFixture,
  shapedFixtureBytes,
  shapingFixtureBatch,
  type ShapingOracleCase,
} from './shaping-fixture'
import { createUikitLayoutFixture, YogaMeasureMode } from './uikit-layout-fixture'
import { cjkUniversalityTarget } from './cjk-universality'
import { selectableFontFixture } from './font-fixtures'

function stableSyntheticHash(): string {
  let value = 2166136261
  for (let index = 0; index < 4096; index += 1) {
    value = Math.imul(value ^ (index & 0xff), 16777619)
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
  run: async () => ({ bytes: 4096, hash: stableSyntheticHash() }),
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

const shapingCases = canonicalShapingOracle.cases as readonly ShapingOracleCase[]
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
    runtimeShapingRequest = shapingFixtureBatch(shapingCases, font.handle)
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
    assertShapingFixture(shaped, runtimeShaperFont.handle, shapingCases)
    const memory = runtimeShaper.memoryReport()
    return {
      bytes: shapedFixtureBytes(shaped),
      hash: hashShapedFixture(shaped),
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
      bytes:
        paragraphLayoutBytes(natural) + paragraphLayoutBytes(wide) + paragraphLayoutBytes(narrow),
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
        layouts.reduce((sum, layout) => sum + paragraphLayoutBytes(layout), 0) +
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
  if (!exactJsonValue(actual, expected)) {
    throw new Error(`${label} differs`)
  }
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

function tslBaselineTarget(backend: 'webgpu' | 'webgl2'): BenchmarkTarget {
  let loaded: BenchmarkTarget | undefined
  return {
    id: `tsl-${backend}-baseline`,
    label: backend === 'webgpu' ? 'TSL WebGPU baseline' : 'TSL WebGL2 fallback baseline',
    detail: 'WebGPURenderer · TSL · deterministic readback',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set(['deterministic', 'raster']),
    status: () => 'ready',
    load: async (controls) => {
      loaded ??= (await import('../renderer/tsl-baseline')).createTslBaselineTarget(backend)
      await loaded.load(controls)
    },
    run: async (input, sampleIndex, controls) => {
      if (loaded === undefined) throw new Error('TSL baseline target was not loaded')
      return loaded.run(input, sampleIndex, controls)
    },
    dispose: async () => {
      const target = loaded
      loaded = undefined
      if (target !== undefined) await target.dispose()
    },
  }
}

function bitmapTextTarget(backend: 'webgpu' | 'webgl2'): BenchmarkTarget {
  let loaded: BenchmarkTarget | undefined
  let configuredInput: BenchmarkInput = {}
  return {
    id: `bitmap-text-${backend}`,
    label: backend === 'webgpu' ? 'Bitmap text · WebGPU' : 'Bitmap text · WebGL2 fallback',
    detail: 'Selected font GLB · HarfRust layout · R8 KTX2 · instanced TSL',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set([
      'deterministic',
      'font-bytes',
      'wasm',
      'shaping',
      'paragraph',
      'raster',
    ]),
    configure: (input) => {
      configuredInput = input
      loaded?.configure?.(input)
    },
    status: () => 'ready',
    load: async (controls) => {
      loaded ??= (await import('../renderer/bitmap-text')).createBitmapTextTarget(backend)
      loaded.configure?.(configuredInput)
      await loaded.load(controls)
    },
    run: async (input, sampleIndex, controls) => {
      if (loaded === undefined) throw new Error('bitmap text target was not loaded')
      return loaded.run(input, sampleIndex, controls)
    },
    dispose: async () => {
      const target = loaded
      loaded = undefined
      if (target !== undefined) await target.dispose()
    },
  }
}

function advancedShapingConformanceTarget(): BenchmarkTarget {
  let loaded: BenchmarkTarget | undefined
  return {
    id: 'advanced-shaping-conformance',
    label: 'Advanced shaping conformance',
    detail: 'five scripts · every authored frame · public Text bitmap batches',
    color: 'violet',
    capabilities: new Set([
      'deterministic',
      'font-bytes',
      'wasm',
      'shaping',
      'paragraph',
      'raster',
    ]),
    status: () => 'ready',
    load: async (controls) => {
      loaded ??= (
        await import('../renderer/advanced-shaping-conformance')
      ).createAdvancedShapingConformanceTarget()
      await loaded.load(controls)
    },
    run: async (input, sampleIndex, controls) => {
      if (loaded === undefined) throw new Error('advanced-shaping target was not loaded')
      return loaded.run(input, sampleIndex, controls)
    },
    dispose: async () => {
      const target = loaded
      loaded = undefined
      if (target !== undefined) await target.dispose()
    },
  }
}

function reactTextTarget(): BenchmarkTarget {
  let loaded: BenchmarkTarget | undefined
  return {
    id: 'react-text-reconciliation',
    label: 'React Text reconciliation',
    detail: 'React 19 · R3F · WebGPURenderer · pinned oracle',
    color: 'violet',
    capabilities: new Set(['deterministic', 'loader', 'shaping', 'paragraph', 'raster']),
    status: () => 'ready',
    load: async (controls) => {
      loaded ??= (await import('../renderer/react-text')).createReactTextTarget()
      await loaded.load(controls)
    },
    run: async (input, sampleIndex, controls) => {
      if (loaded === undefined) throw new Error('React Text target was not loaded')
      return loaded.run(input, sampleIndex, controls)
    },
    dispose: async () => {
      const target = loaded
      loaded = undefined
      if (target !== undefined) await target.dispose()
    },
  }
}

function mtsdfTextTarget(backend: 'webgpu' | 'webgl2'): BenchmarkTarget {
  let loaded: BenchmarkTarget | undefined
  return {
    id: `mtsdf-text-${backend}`,
    label: backend === 'webgpu' ? 'MTSDF text · WebGPU' : 'MTSDF text · WebGL2 fallback',
    detail: 'Inter GLB · RGBA8 KTX2 · shared TSL graph',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set([
      'deterministic',
      'font-bytes',
      'wasm',
      'shaping',
      'paragraph',
      'raster',
    ]),
    status: () => 'ready',
    load: async (controls) => {
      loaded ??= (await import('../renderer/mtsdf-text')).createMtsdfTextTarget(backend)
      await loaded.load(controls)
    },
    run: async (input, sampleIndex, controls) => {
      if (loaded === undefined) throw new Error('MTSDF text target was not loaded')
      return loaded.run(input, sampleIndex, controls)
    },
    dispose: async () => {
      const target = loaded
      loaded = undefined
      if (target !== undefined) await target.dispose()
    },
  }
}

function mtsdfConformanceTarget(backend: 'webgpu' | 'webgl2'): BenchmarkTarget {
  let loaded: BenchmarkTarget | undefined
  let configuredInput: BenchmarkInput = {}
  return {
    id: `mtsdf-conformance-${backend}`,
    label:
      backend === 'webgpu'
        ? 'MTSDF sampling conformance · WebGPU'
        : 'MTSDF sampling conformance · WebGL2 fallback',
    detail: 'GPU TSL candidate · independent scalar CPU reconstruction',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set([
      'deterministic',
      'font-bytes',
      'wasm',
      'shaping',
      'paragraph',
      'raster',
    ]),
    configure: (input) => {
      configuredInput = input
      loaded?.configure?.(input)
    },
    status: () => 'ready',
    load: async (controls) => {
      loaded ??= (await import('../renderer/mtsdf-text')).createMtsdfConformanceTarget(backend)
      loaded.configure?.(configuredInput)
      await loaded.load(controls)
    },
    run: async (input, sampleIndex, controls) => {
      if (loaded === undefined) throw new Error('MTSDF conformance target was not loaded')
      return loaded.run(input, sampleIndex, controls)
    },
    dispose: async () => {
      const target = loaded
      loaded = undefined
      if (target !== undefined) await target.dispose()
    },
  }
}

function sourceOutlineFidelityTarget(
  technique: 'bitmap' | 'mtsdf',
  backend: 'webgpu' | 'webgl2',
): BenchmarkTarget {
  let configuredInput: BenchmarkInput = {}
  return {
    id: `source-outline-${technique}-${backend}`,
    label: `${technique === 'mtsdf' ? 'MSDF' : 'Bitmap'} source-outline fidelity · ${backend === 'webgpu' ? 'WebGPU' : 'WebGL2 fallback'}`,
    detail: 'GPU candidate · pinned source font · browser Canvas2D reference',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set([
      'deterministic',
      'font-bytes',
      'wasm',
      'shaping',
      'paragraph',
      'raster',
    ]),
    configure: (input) => {
      configuredInput = input
    },
    status: () => 'ready',
    load: async () => undefined,
    run: async (input, _sampleIndex, controls) => {
      const fontFixture = selectableFontFixture(
        input.fontFixture ?? configuredInput.fontFixture ?? 'inter',
      )
      const capture =
        technique === 'mtsdf'
          ? await import('../renderer/mtsdf-text').then(({ captureMtsdfSourceOutlineFidelity }) =>
              captureMtsdfSourceOutlineFidelity({
                backend,
                dpr: controls.dpr,
                fontFixture,
              }),
            )
          : await import('../renderer/bitmap-text').then(({ captureBitmapSourceOutlineFidelity }) =>
              captureBitmapSourceOutlineFidelity({
                backend,
                dpr: controls.dpr,
                fontFixture,
              }),
            )
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          techniqueBitmap: technique === 'bitmap' ? 1 : 0,
          techniqueMtsdf: technique === 'mtsdf' ? 1 : 0,
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: controls.dpr,
          pixelCount: capture.width * capture.height,
          physicalPpem: capture.physicalPpem,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          renderMs: capture.renderSubmitMs,
        },
      }
    },
    dispose: async () => undefined,
  }
}

export const targets: readonly BenchmarkTarget[] = [
  syntheticTarget,
  tslBaselineTarget('webgl2'),
  tslBaselineTarget('webgpu'),
  bakerTarget,
  loaderWorkerTarget,
  harfrustShaperTarget,
  paragraphTarget,
  paragraphLayoutTarget,
  paragraphPolicyTarget,
  cjkUniversalityTarget,
  advancedShapingConformanceTarget(),
  bitmapTextTarget('webgl2'),
  bitmapTextTarget('webgpu'),
  mtsdfTextTarget('webgl2'),
  mtsdfTextTarget('webgpu'),
  mtsdfConformanceTarget('webgl2'),
  mtsdfConformanceTarget('webgpu'),
  sourceOutlineFidelityTarget('bitmap', 'webgl2'),
  sourceOutlineFidelityTarget('bitmap', 'webgpu'),
  sourceOutlineFidelityTarget('mtsdf', 'webgl2'),
  sourceOutlineFidelityTarget('mtsdf', 'webgpu'),
  reactTextTarget(),
  unavailableTarget('slug', 'Three Flatland Slug', 'adapter not landed', 'green'),
]

export function targetById(id: string): BenchmarkTarget {
  return targets.find((target) => target.id === id) ?? syntheticTarget
}
