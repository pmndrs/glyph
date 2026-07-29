import type { BenchmarkScenario } from './contracts'
import { ADVANCED_SHAPING_CASES } from './advanced-shaping'
import paragraphBidiContract from '../../fixtures/contracts/paragraph-bidi-layout-v0.json'
import cjkContract from '../../fixtures/contracts/paragraph-cjk-layout-v0.json'
import cjkManifest from '../../fixtures/fonts/noto-sans-cjk-2.004/manifest.json'
import cjkOracle from '../../fixtures/shaping/noto-sans-cjk/harfrust.json'

const paragraphPolicyHash = [
  ...Object.values(paragraphBidiContract.bidi).map(({ layout }) => layout.hash),
  ...Object.values(paragraphBidiContract.policies.cases).map(({ layout }) => layout.hash),
  paragraphBidiContract.uikit.resolved.layout.hash,
].join(':')
const ADVANCED_SHAPING_HASH = '51ba1d14'

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
      typeof metrics?.glyphCount !== 'number' ||
      metrics.glyphCount <= 0 ||
      metrics.missingGlyphCount !== 0 ||
      metrics.drawCount !== 1 ||
      metrics.strikePpem !== 16 ||
      metrics.renderedPpem !== 16 ||
      metrics.cssFontSize !== 16 / dpr ||
      metrics.scaleRatio !== 1 ||
      typeof metrics.atlasGpuBytes !== 'number' ||
      metrics.atlasGpuBytes <= 0 ||
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
    if (
      metrics.fixtureIsInter === 1 &&
      (metrics.glyphCount !== 120 || metrics.atlasGpuBytes !== 695_296)
    ) {
      throw new Error('Canonical Inter bitmap evidence drifted from its exact fixture contract')
    }
  }
  return `${values.length}/${values.length} exact public Text frames with resize + clipping`
}

function mtsdfTextValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    const metrics = value.metrics
    const dpr = metrics?.dpr
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0
    const height = typeof dpr === 'number' ? Math.round(320 * dpr) : 0
    if (
      dpr === undefined ||
      value.outputBytes !== width * height * 4 ||
      metrics?.sceneCount !== 4 ||
      metrics.textObjectCount !== 4 ||
      typeof metrics.glyphCount !== 'number' ||
      metrics.glyphCount < 40 ||
      typeof metrics.drawCount !== 'number' ||
      metrics.drawCount < 4 ||
      typeof metrics.changedPixels !== 'number' ||
      metrics.changedPixels < 500 ||
      typeof metrics.distinctRgbColors !== 'number' ||
      metrics.distinctRgbColors < 4 ||
      metrics.artifactBytes !== 39_347_712 ||
      metrics.compressedArtifactBytes !== 6_798_412 ||
      metrics.renderTargetGpuBytes !== value.outputBytes ||
      !finiteNonnegative(metrics.fontLoadMs) ||
      !finiteNonnegative(metrics.firstDrawMs) ||
      !finiteNonnegative(metrics.renderMs) ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error(
        'MTSDF text did not preserve its resize, base-level, transform, and effects contract',
      )
    }
  }
  return `${values.length}/${values.length} deterministic MTSDF resize + base-level + transform + effects frames`
}

function mtsdfSamplingValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    const metrics = value.metrics
    const dpr = metrics?.dpr
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0
    const height = typeof dpr === 'number' ? Math.round(512 * dpr) : 0
    if (
      dpr === undefined ||
      value.outputBytes !== width * height * 4 ||
      typeof metrics?.glyphCount !== 'number' ||
      metrics.glyphCount <= 0 ||
      !finiteNonnegative(metrics.meanAbsoluteError) ||
      !finiteNonnegative(metrics.maximumError) ||
      !finiteNonnegative(metrics.errorPixels) ||
      typeof metrics.pixelCount !== 'number' ||
      metrics.pixelCount !== width * height ||
      metrics.meanAbsoluteError > 0.25 ||
      metrics.maximumError > 48 ||
      metrics.errorPixels > metrics.pixelCount * 0.02 ||
      !finiteNonnegative(metrics.renderMs) ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('MTSDF sampling did not preserve its GPU/CPU comparison contract')
    }
    if (metrics.fixtureIsInter === 1 && dpr === 1 && metrics.glyphCount !== 84) {
      throw new Error('Canonical Inter MTSDF sampling evidence drifted')
    }
  }
  return `${values.length}/${values.length} deterministic GPU frames with CPU MTSDF comparison`
}

function slugTextValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    const metrics = value.metrics
    const dpr = metrics?.dpr
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0
    const height = typeof dpr === 'number' ? Math.round(320 * dpr) : 0
    if (
      dpr === undefined ||
      value.outputBytes !== width * height * 4 ||
      metrics?.sceneCount !== 4 ||
      metrics.textObjectCount !== 4 ||
      typeof metrics.glyphCount !== 'number' ||
      metrics.glyphCount < 40 ||
      typeof metrics.drawCount !== 'number' ||
      metrics.drawCount < 4 ||
      typeof metrics.changedPixels !== 'number' ||
      metrics.changedPixels < 500 ||
      typeof metrics.distinctRgbColors !== 'number' ||
      metrics.distinctRgbColors < 4 ||
      metrics.artifactBytes !== 3_444_916 ||
      metrics.compressedArtifactBytes !== 618_487 ||
      !finitePositive(metrics.slugCurveGpuBytes) ||
      !finitePositive(metrics.slugHeaderGpuBytes) ||
      !finitePositive(metrics.slugReferenceGpuBytes) ||
      metrics.slugGpuBytes !==
        metrics.slugCurveGpuBytes + metrics.slugHeaderGpuBytes + metrics.slugReferenceGpuBytes ||
      metrics.renderTargetGpuBytes !== value.outputBytes ||
      !finiteNonnegative(metrics.fontLoadMs) ||
      !finiteNonnegative(metrics.firstDrawMs) ||
      !finiteNonnegative(metrics.renderMs) ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('Slug text did not preserve its analytic scene and GPU-memory contract')
    }
  }
  return `${values.length}/${values.length} deterministic Slug resize + transform frames`
}

function slugSamplingValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    const metrics = value.metrics
    const dpr = metrics?.dpr
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0
    const height = typeof dpr === 'number' ? Math.round(512 * dpr) : 0
    const dotGothic = metrics?.fixtureIsDotGothic === 1
    if (
      dpr === undefined ||
      value.outputBytes !== width * height * 4 ||
      !finitePositive(metrics?.glyphCount) ||
      !finitePositive(metrics.evaluatedCurves) ||
      !finiteNonnegative(metrics.meanAbsoluteError) ||
      !finiteNonnegative(metrics.maximumError) ||
      !finiteNonnegative(metrics.errorPixels) ||
      metrics.pixelCount !== width * height ||
      metrics.meanAbsoluteError > 0.25 ||
      metrics.maximumError > (dotGothic ? 255 : 128) ||
      metrics.errorPixels > metrics.pixelCount * 0.03 ||
      !finiteNonnegative(metrics.severeErrorPixels) ||
      metrics.severeErrorPixels > (dotGothic ? 64 : 0) ||
      !finiteNonnegative(metrics.renderMs) ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('Slug sampling did not preserve its GPU/CPU comparison contract')
    }
  }
  return `${values.length}/${values.length} deterministic GPU frames with CPU Slug comparison`
}

function sourceOutlineFidelityValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    const metrics = value.metrics
    const pixelCount = metrics?.pixelCount
    const isBitmap = metrics?.techniqueBitmap === 1
    const isMtsdf = metrics?.techniqueMtsdf === 1
    const isSlug = metrics?.techniqueSlug === 1
    const dotGothic = metrics?.fixtureIsDotGothic === 1
    if (
      typeof pixelCount !== 'number' ||
      pixelCount <= 0 ||
      value.outputBytes !== pixelCount * 4 ||
      Number(isBitmap) + Number(isMtsdf) + Number(isSlug) !== 1 ||
      metrics?.physicalPpem !== (isBitmap ? 16 : 64) ||
      !finiteNonnegative(metrics.meanAbsoluteError) ||
      metrics.meanAbsoluteError > (dotGothic ? 24 : 12) ||
      !finiteNonnegative(metrics.maximumError) ||
      metrics.maximumError > 255 ||
      !finiteNonnegative(metrics.errorPixels) ||
      metrics.errorPixels > pixelCount * 0.2 ||
      !finiteNonnegative(metrics.renderMs) ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('Source-outline fidelity exceeded the reviewed browser coverage envelope')
    }
  }
  return `${values.length}/${values.length} deterministic source-outline comparisons within reviewed envelopes`
}

function runtimeFallbackValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  for (const value of values) {
    if (
      value.metrics?.mismatchBytes !== 0 ||
      value.metrics.changedPixels !== 0 ||
      value.metrics.maximumError !== 0 ||
      !finiteNonnegative(value.metrics.renderMs)
    ) {
      throw new Error('runtime-baked rendering diverged from the checked-in baked asset')
    }
  }
  return `${values.length}/${values.length} exact baked/runtime fallback frames`
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

function advancedShapingValidation(
  values: readonly import('./contracts').BenchmarkMeasurement[],
): string {
  deterministicValidation(values.map((value) => value.hash))
  const frameCount = ADVANCED_SHAPING_CASES.reduce(
    (count, definition) => count + definition.revealUnits.length + 1,
    0,
  )
  for (const value of values) {
    const metrics = value.metrics
    if (
      value.hash !== ADVANCED_SHAPING_HASH ||
      value.outputBytes !== 17_362 ||
      metrics?.caseCount !== ADVANCED_SHAPING_CASES.length ||
      metrics.frameCount !== frameCount ||
      metrics.finalFrameCount !== ADVANCED_SHAPING_CASES.length ||
      metrics.layoutBytes !== value.outputBytes ||
      metrics.missingGlyphCount !== 0 ||
      metrics.glyphCount !== 709 ||
      metrics.renderedGlyphCount !== 625 ||
      metrics.drawCount !== 72
    ) {
      throw new Error('Advanced shaping did not preserve its complete authored frame matrix')
    }
  }
  return `${values.length}/${values.length} exact advanced-shaping timelines · ${frameCount} frames/sample`
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export const scenarios: readonly BenchmarkScenario[] = [
  {
    id: 'slug-sampling-conformance',
    label: 'Slug text accuracy',
    description:
      'GPU analytic coverage compared visually with an independent scalar CPU reconstruction.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm', 'raster']),
    validate: slugSamplingValidation,
  },
  {
    id: 'slug-text-scenes',
    label: 'Slug rendering scenes',
    description: 'Resize, transformed text, fill, and opacity through copied-and-adapted TSL.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm', 'raster']),
    validate: slugTextValidation,
  },
  {
    id: 'mtsdf-sampling-conformance',
    label: 'MTSDF text accuracy',
    description:
      'GPU TSL sampling compared visually with an independent scalar CPU reconstruction.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm', 'raster']),
    validate: mtsdfSamplingValidation,
  },
  {
    id: 'mtsdf-text-scenes',
    label: 'MTSDF rendering scenes',
    description: 'Resize, minification, transformed text, and fill/outline/shadow through TSL.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm', 'raster']),
    validate: mtsdfTextValidation,
  },
  {
    id: 'advanced-shaping-conformance',
    label: 'Advanced shaping conformance',
    description:
      'Every authored Latin, Arabic, Devanagari, bidi, and CJK frame through public Text.',
    requiredCapabilities: new Set(['deterministic', 'shaping', 'paragraph', 'raster']),
    validate: advancedShapingValidation,
  },
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
    id: 'source-outline-fidelity',
    label: 'Cross-technique source-outline fidelity',
    description:
      'Bitmap, MTSDF, and Slug candidates compared independently with browser Canvas2D using the same pinned source font.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm', 'raster']),
    validate: sourceOutlineFidelityValidation,
  },
  {
    id: 'runtime-fallback-parity',
    label: 'Runtime fallback parity',
    description: 'Source-font runtime baking compared exactly with the checked-in baked render.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm', 'raster']),
    validate: runtimeFallbackValidation,
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
