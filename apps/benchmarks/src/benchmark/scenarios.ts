import type { BenchmarkScenario } from './contracts'
import paragraphBidiContract from '../../fixtures/contracts/paragraph-bidi-layout-v0.json'
import cjkContract from '../../fixtures/contracts/paragraph-cjk-layout-v0.json'
import cjkManifest from '../../fixtures/fonts/noto-sans-cjk-2.004/manifest.json'
import cjkOracle from '../../fixtures/shaping/noto-sans-cjk/harfrust.json'

const paragraphPolicyHash = [
  ...Object.values(paragraphBidiContract.bidi).map(({ layout }) => layout.hash),
  ...Object.values(paragraphBidiContract.policies.cases).map(({ layout }) => layout.hash),
  paragraphBidiContract.uikit.resolved.layout.hash,
].join(':')

function deterministicValidation(hashes: readonly string[]): string {
  if (hashes.length === 0) throw new Error('Scenario produced no measurements')
  const unique = new Set(hashes)
  if (unique.size !== 1) throw new Error('Output hash changed between samples')
  return `${hashes.length}/${hashes.length} deterministic outputs`
}

function tslBaselineValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    const metrics = value.metrics
    const dpr = metrics?.dpr
    const physicalSize = typeof dpr === 'number' ? Math.round(4 * dpr) : 0
    if (
      dpr === undefined ||
      value.outputBytes !== physicalSize * physicalSize * 4 ||
      metrics?.renderTargetGpuBytes !== value.outputBytes ||
      metrics.pixelCount !== physicalSize * physicalSize ||
      metrics.exactRedPixels !== physicalSize * physicalSize ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('TSL baseline did not preserve its exact backend and pixel contract')
    }
  }
  return `${values.length}/${values.length} exact TSL shader readbacks`
}

function bitmapTextValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    const metrics = value.metrics
    const dpr = metrics?.dpr
    const physicalWidth = typeof dpr === 'number' ? Math.round(384 * dpr) : 0
    const physicalHeight = typeof dpr === 'number' ? Math.round(128 * dpr) : 0
    if (
      dpr === undefined ||
      value.outputBytes !== physicalWidth * physicalHeight * 4 ||
      metrics?.glyphCount !== 120 ||
      metrics.missingGlyphCount !== 0 ||
      metrics.drawCount !== 1 ||
      metrics.strikePpem !== 16 ||
      metrics.renderedPpem !== 16 ||
      metrics.cssFontSize !== 16 / dpr ||
      metrics.scaleRatio !== 1 ||
      metrics.atlasGpuBytes !== 695_296 ||
      metrics.renderTargetGpuBytes !== value.outputBytes ||
      metrics.totalGpuBytes !== metrics.atlasGpuBytes + metrics.renderTargetGpuBytes ||
      typeof metrics.litPixels !== 'number' ||
      metrics.litPixels < 100 ||
      typeof metrics.inkPixels !== 'number' ||
      metrics.inkPixels < 100 ||
      typeof metrics.inkMinX !== 'number' ||
      typeof metrics.inkMinY !== 'number' ||
      typeof metrics.inkMaxX !== 'number' ||
      typeof metrics.inkMaxY !== 'number' ||
      metrics.referenceMismatchBytes !== 0 ||
      typeof metrics.clippedInkPixels !== 'number' ||
      metrics.clippedInkPixels <= 0 ||
      metrics.clippedInkPixels >= metrics.inkPixels ||
      metrics.clippedTouchesBoundary !== 1 ||
      metrics.resizedWidth !== 192 ||
      metrics.resizedHeight !== 64 ||
      !finiteNonnegative(metrics.firstDrawMs) ||
      !finiteNonnegative(metrics.renderMs) ||
      !finiteNonnegative(metrics.clippedRenderMs) ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error(
        'Bitmap text did not preserve its strike, scale, batch, GPU-memory, and pixel contract',
      )
    }
  }
  return `${values.length}/${values.length} exact public Text frames with resize + clipping`
}

function reactTextValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.hash !== 'bb15bbcc' ||
      value.metrics?.coreObjectRetained !== 1 ||
      value.metrics.nestedSpanCount !== 1 ||
      value.metrics.glyphCount !== 55 ||
      value.metrics.drawCount !== 1 ||
      value.metrics.paintCount !== 2 ||
      value.metrics.widthReflowed !== 1 ||
      value.metrics.layoutRestored !== 1 ||
      value.metrics.oracleNaturalMatched !== 1 ||
      value.metrics.oracleNarrowMatched !== 1 ||
      typeof value.metrics.r3fDrawCalls !== 'number' ||
      value.metrics.r3fDrawCalls < 1
    ) {
      throw new Error('React Text did not preserve its reconciliation and nested-span contract')
    }
  }
  return `${values.length}/${values.length} exact React Text reconciliations + R3F frames`
}

function shapingValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.metrics?.boundaryCrossings !== 1 ||
      value.metrics.goldenCases !== 8 ||
      value.metrics.planCount !== 3
    ) {
      throw new Error('Shaping sample did not preserve its call, corpus, and plan-cache contract')
    }
  }
  return `${values.length}/${values.length} exact corpus outputs · 1 Wasm call/sample`
}

function paragraphValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.metrics?.shapeBoundaryCrossings !== 1 ||
      value.metrics.reshapeBoundaryCrossings !== 0 ||
      value.metrics.reflowBoundaryCrossings !== 0 ||
      value.metrics.measurementCount !== 3 ||
      value.metrics.positionedGlyphBytes !== 0
    ) {
      throw new Error('Paragraph sample did not preserve its prepare-once, cached-reflow contract')
    }
  }
  return `${values.length}/${values.length} exact paragraph outputs · 0 Wasm reflow calls/sample`
}

function paragraphLayoutValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.hash !== 'bb15bbcc:4f111a3f:e8c0e9d5' ||
      value.metrics?.shapeBoundaryCrossings !== 1 ||
      value.metrics.reshapeBoundaryCrossings !== 2 ||
      value.metrics.batchedBoundaryLayouts !== 2 ||
      value.metrics.layoutCount !== 3 ||
      value.metrics.glyphCount !== 165
    ) {
      throw new Error('Paragraph layout sample did not preserve its exact SoA and batch contract')
    }
  }
  return `${values.length}/${values.length} exact positioned outputs · 1 reshape batch/changed width`
}

function paragraphPolicyValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.hash !== paragraphPolicyHash ||
      value.metrics?.bidiLayoutCount !== 2 ||
      value.metrics.policyLayoutCount !== 9 ||
      value.metrics.uikitMeasurementCount !== 25 ||
      value.metrics.uikitLayoutCount !== 1 ||
      value.metrics.shapeBoundaryCrossings !== 4 ||
      value.metrics.reshapeBoundaryCrossings !== 5
    ) {
      throw new Error(
        'Paragraph policy sample did not preserve its bidi, policy, and uikit contract',
      )
    }
  }
  return `${values.length}/${values.length} exact bidi/policy outputs · current-uikit-shaped flow`
}

function cjkUniversalityValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  const corpusGlyphCount = cjkOracle.cases.reduce((sum, fixture) => sum + fixture.glyphs.length, 0)
  const sourceUtf16Units =
    cjkOracle.cases.reduce((sum, fixture) => sum + fixture.text.length, 0) +
    Object.values(cjkContract.cases).reduce((sum, fixture) => sum + fixture.text.length, 0)
  for (const value of values) {
    const metrics = value.metrics
    if (
      metrics?.sourceUtf16Units !== sourceUtf16Units ||
      metrics.corpusCaseCount !== cjkOracle.cases.length ||
      metrics.corpusGlyphCount !== corpusGlyphCount ||
      metrics.paragraphCaseCount !== Object.keys(cjkContract.cases).length ||
      metrics.layoutCount !== Object.keys(cjkContract.cases).length * 3 ||
      metrics.directShapeBoundaryCrossings !== 1 ||
      metrics.paragraphShapeBoundaryCrossings !== 4 ||
      metrics.reshapeBoundaryCrossings !== 0 ||
      metrics.retainedFontBytes !==
        cjkManifest.bake.expectedCore.transport.shapingPayload.rawBytes ||
      metrics.sourceFontBytes !== cjkManifest.source.fontBytes ||
      metrics.artifactBytes !== cjkManifest.bake.expectedCore.artifactBytes ||
      metrics.shapingPayloadRawBytes !==
        cjkManifest.bake.expectedCore.transport.shapingPayload.rawBytes ||
      metrics.shapingPayloadGzipBytes !==
        cjkManifest.bake.expectedCore.transport.shapingPayload.gzipBytes ||
      metrics.shapingPayloadBrotliBytes !==
        cjkManifest.bake.expectedCore.transport.shapingPayload.brotliBytes ||
      typeof metrics.planCount !== 'number' ||
      !Number.isFinite(metrics.planCount) ||
      metrics.planCount < 4 ||
      typeof metrics.wasmMemoryBytes !== 'number' ||
      !Number.isFinite(metrics.wasmMemoryBytes) ||
      metrics.wasmMemoryBytes <= 0 ||
      !finiteNonnegative(metrics.coldBakeMs) ||
      !finiteNonnegative(metrics.coldRegistrationMs) ||
      !finiteNonnegative(metrics.coldShaperInitializationMs)
    ) {
      throw new Error('CJK sample did not preserve its exact shaping, layout, and payload contract')
    }
  }
  return `${values.length}/${values.length} exact CJK corpus + horizontal paragraph outputs`
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export const scenarios: readonly BenchmarkScenario[] = [
  {
    id: 'react-text-reconciliation',
    label: 'React Text reconciliation',
    description:
      'React 19 and real R3F retain one public Text object across pinned-oracle nested-span reflow.',
    requiredCapabilities: new Set(['loader', 'shaping', 'paragraph', 'raster']),
    validate: reactTextValidation,
  },
  {
    id: 'bitmap-text-frame',
    label: 'Bitmap text frame',
    description:
      'Inter at its native 16 px bitmap strike, with shaping, layout, R8 upload, instanced TSL draw, and exact readback.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm', 'raster']),
    validate: bitmapTextValidation,
  },
  {
    id: 'tsl-shader-baseline',
    label: 'TSL shader baseline',
    description: 'Exact TSL compilation and readback through WebGPURenderer.',
    requiredCapabilities: new Set(['deterministic', 'raster']),
    validate: tslBaselineValidation,
  },
  {
    id: 'overview',
    label: 'Overview',
    description: 'Runner lifecycle, validation, and environment readiness.',
    requiredCapabilities: new Set(['deterministic']),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: 'cold-load-payload',
    label: 'Cold load + payload',
    description: 'Wasm startup, source-to-GLB bake time, output bytes, and determinism.',
    requiredCapabilities: new Set(['font-bytes', 'wasm']),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: 'worker-fallback',
    label: 'Worker fallback',
    description: 'Missing baked probe, module-Worker bake, validation, and registration.',
    requiredCapabilities: new Set(['loader', 'font-bytes', 'wasm']),
    validate: (values) => deterministicValidation(values.map((value) => value.hash)),
  },
  {
    id: 'shaping-conformance',
    label: 'HarfRust shaping conformance',
    description: 'Eight pinned runs in one Wasm call with exact SoA output and cache accounting.',
    requiredCapabilities: new Set(['shaping', 'font-bytes', 'wasm']),
    validate: shapingValidation,
  },
  {
    id: 'paragraph-measurement',
    label: 'Paragraph measurement',
    description: 'Exact GLB-backed broad shape followed by cached wide and narrow reflow.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm']),
    validate: paragraphValidation,
  },
  {
    id: 'paragraph-layout',
    label: 'Positioned paragraph layout',
    description: 'Exact natural, wide, and narrow SoA output with cached batched boundary reshape.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm']),
    validate: paragraphLayoutValidation,
  },
  {
    id: 'paragraph-bidi-policy',
    label: 'Bidi + paragraph policies',
    description: 'Exact Amiri bidi, line policies, and current-uikit-shaped retained layout.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm']),
    validate: paragraphPolicyValidation,
  },
  {
    id: 'cjk-universality',
    label: 'CJK universality',
    description: 'Exact pan-CJK source/reduced shaping and horizontal no-space reflow.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm']),
    validate: cjkUniversalityValidation,
  },
]

export const plannedScenarios = [
  'Screen-space ladder',
  'Off-axis / 3D',
  'Dynamic layout',
  'Paragraph stress',
  'Glyph coverage',
] as const

export function scenarioById(id: string): BenchmarkScenario {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!
}
