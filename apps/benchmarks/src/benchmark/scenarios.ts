import type { BenchmarkScenario } from './contracts';
import { ADVANCED_SHAPING_CASES } from '../workloads/advanced-shaping/scene';
const ADVANCED_SHAPING_HASH = '51ba1d14';
const UPDATED_EXTERNAL_RASTER_GLYPHS = 13;

function deterministicValidation(hashes: readonly string[]): string {
  if (hashes.length === 0) throw new Error('Scenario produced no measurements');
  const unique = new Set(hashes);
  if (unique.size !== 1) throw new Error('Output hash changed between samples');
  return `${hashes.length}/${hashes.length} deterministic outputs`;
}

function tslBaselineValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    const dpr = metrics?.dpr;
    const physicalSize = typeof dpr === 'number' ? Math.round(4 * dpr) : 0;
    if (
      dpr === undefined ||
      value.outputBytes !== physicalSize * physicalSize * 4 ||
      metrics?.renderTargetGpuBytes !== value.outputBytes ||
      metrics.pixelCount !== physicalSize * physicalSize ||
      metrics.exactRedPixels !== physicalSize * physicalSize ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('TSL baseline did not preserve its exact backend and pixel contract');
    }
  }
  return `${values.length}/${values.length} exact TSL shader readbacks`;
}

function externalRasterProofValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    if (
      metrics?.glyphCount !== UPDATED_EXTERNAL_RASTER_GLYPHS ||
      metrics.drawCount !== 1 ||
      metrics.retainedObject !== 1 ||
      metrics.retainedGeometry !== 1 ||
      (metrics.litPixels ?? 0) < 100 ||
      (metrics.layeringPixels ?? 0) < 100 ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('External raster proof did not preserve its visible retained draw contract');
    }
  }
  return `${values.length}/${values.length} deterministic external raster frames`;
}

function bitmapTextValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    const dpr = metrics?.dpr;
    const physicalWidth = typeof dpr === 'number' ? Math.round(384 * dpr) : 0;
    const physicalHeight = typeof dpr === 'number' ? Math.round(128 * dpr) : 0;
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
      throw new Error('Bitmap text did not preserve its strike, scale, batch, GPU-memory, and pixel contract');
    }
    if (metrics.fixtureIsInter === 1 && (metrics.glyphCount !== 120 || metrics.atlasGpuBytes !== 695_296)) {
      throw new Error('Canonical Inter bitmap evidence drifted from its exact fixture contract');
    }
  }
  return `${values.length}/${values.length} exact public Text frames with resize + clipping`;
}

function mtsdfTextValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    const dpr = metrics?.dpr;
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0;
    const height = typeof dpr === 'number' ? Math.round(320 * dpr) : 0;
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
      throw new Error('MTSDF text did not preserve its resize, base-level, transform, and effects contract');
    }
  }
  return `${values.length}/${values.length} deterministic MTSDF resize + base-level + transform + effects frames`;
}

function mtsdfSamplingValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    const dpr = metrics?.dpr;
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0;
    const height = typeof dpr === 'number' ? Math.round(512 * dpr) : 0;
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
      throw new Error('MTSDF sampling did not preserve its GPU/CPU comparison contract');
    }
    if (metrics.fixtureIsInter === 1 && dpr === 1 && metrics.glyphCount !== 84) {
      throw new Error('Canonical Inter MTSDF sampling evidence drifted');
    }
  }
  return `${values.length}/${values.length} deterministic GPU frames with CPU MTSDF comparison`;
}

function slugTextValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    const dpr = metrics?.dpr;
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0;
    const height = typeof dpr === 'number' ? Math.round(320 * dpr) : 0;
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
      !finitePositive(metrics.slugCurveBytes) ||
      !finitePositive(metrics.slugHeaderBytes) ||
      !finitePositive(metrics.slugReferenceBytes) ||
      !finitePositive(metrics.slugResourceBytes) ||
      // The technique reports what it decoded and the Three targets report what they uploaded, so a renderer that
      // retains less than the decoded pages has lost a page rather than merely repacked one. Comparing the decoded
      // subtotals against their own sum would only restate the app's arithmetic, so that check is gone.
      !finitePositive(metrics.slugGpuBytes) ||
      metrics.slugGpuBytes < metrics.slugResourceBytes ||
      metrics.renderTargetGpuBytes !== value.outputBytes ||
      !finiteNonnegative(metrics.fontLoadMs) ||
      !finiteNonnegative(metrics.firstDrawMs) ||
      !finiteNonnegative(metrics.renderMs) ||
      (metrics.backendWebGpu ?? 0) + (metrics.backendWebGl2 ?? 0) !== 1
    ) {
      throw new Error('Slug text did not preserve its analytic scene and GPU-memory contract');
    }
  }
  return `${values.length}/${values.length} deterministic Slug resize + transform frames`;
}

function slugSamplingValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    const dpr = metrics?.dpr;
    const width = typeof dpr === 'number' ? Math.round(512 * dpr) : 0;
    const height = typeof dpr === 'number' ? Math.round(512 * dpr) : 0;
    const dotGothic = metrics?.fixtureIsDotGothic === 1;
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
      throw new Error('Slug sampling did not preserve its GPU/CPU comparison contract');
    }
  }
  return `${values.length}/${values.length} deterministic GPU frames with CPU Slug comparison`;
}

function sourceOutlineFidelityValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    const pixelCount = metrics?.pixelCount;
    const isBitmap = metrics?.techniqueBitmap === 1;
    const isMtsdf = metrics?.techniqueMtsdf === 1;
    const isSlug = metrics?.techniqueSlug === 1;
    const dotGothic = metrics?.fixtureIsDotGothic === 1;
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
      throw new Error('Source-outline fidelity exceeded the reviewed browser coverage envelope');
    }
  }
  return `${values.length}/${values.length} deterministic source-outline comparisons within reviewed envelopes`;
}

function runtimeFallbackValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    if (
      value.metrics?.mismatchBytes !== 0 ||
      value.metrics.changedPixels !== 0 ||
      value.metrics.maximumError !== 0 ||
      !finiteNonnegative(value.metrics.renderMs)
    ) {
      throw new Error('runtime-baked rendering diverged from the checked-in baked asset');
    }
  }
  return `${values.length}/${values.length} exact baked/runtime fallback frames`;
}

function reactTextValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
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
      throw new Error('React Text did not preserve its reconciliation and nested-span contract');
    }
  }
  return `${values.length}/${values.length} exact React Text reconciliations + R3F frames`;
}

function paragraphContractsValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    if (
      value.metrics?.bidiLayoutCount !== 2 ||
      value.metrics.policyLayoutCount !== 9 ||
      value.metrics.cjkLayoutCount !== 12 ||
      value.metrics.uikitMeasurementCount !== 25 ||
      value.metrics.uikitLayoutCount !== 1
    ) {
      throw new Error('Rust paragraph contracts did not execute the complete retained matrix');
    }
  }
  return `${values.length}/${values.length} exact bidi, policy, uikit, and CJK contract matrices`;
}

function advancedShapingValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  const frameCount = ADVANCED_SHAPING_CASES.reduce((count, definition) => count + definition.revealUnits.length + 1, 0);
  for (const value of values) {
    const metrics = value.metrics;
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
      metrics.drawCount !== 72 ||
      metrics.coldReadyObservationCount !== ADVANCED_SHAPING_CASES.length ||
      metrics.warmLifecyclePublicationCount !== frameCount - ADVANCED_SHAPING_CASES.length ||
      metrics.warmReadyWaitCount !== 0
    ) {
      throw new Error('Advanced shaping did not preserve its complete authored frame matrix');
    }
  }
  return `${values.length}/${values.length} exact advanced-shaping timelines · ${frameCount} frames/sample`;
}

/**
 * The composed paragraph's exact span evidence.
 *
 * Each pin answers one question that the others cannot. Glyph-id changes prove the shaper honoured a span; origin
 * changes with unchanged ids prove a span altered metrics without altering selection; the line-count and first-break
 * pins prove a size span reached line breaking rather than only advances; the slot pins prove a font span reached the
 * shaper's font selection; and the `.notdef` pin proves the fallback span is what resolved the Devanagari at all.
 */
const RICH_TEXT_SPAN_EVIDENCE = {
  hash: 'f73e324f',
  glyphCount: 175,
  renderedGlyphCount: 149,
  drawCount: 7,
  fontHandleCount: 3,
  distinctFontSizeCount: 4,
  spanCount: 8,
  caseCount: 7,
  smallCapsChangedGlyphs: 5,
  trackingMovedOrigins: 12,
  emphasisMovedOrigins: 101,
  lineCount: 3,
  bodySizeEmphasisLineCount: 2,
  emphasisFirstLineTextEnd: 74,
  bodySizeEmphasisFirstLineTextEnd: 87,
  faceSpanSlotGlyphs: 6,
  fallbackSpanSlotGlyphs: 8,
  fallbackMissingGlyphsWithoutSpan: 8,
  accentPaintGlyphs: 32,
  tintPaintGlyphs: 3,
  paragraphPaintGlyphs: 114,
  nestedGlyphCount: 9,
} as const;

/**
 * Glyphs the nested style-only span loses to the paragraph paint instead of inheriting from the span that encloses it.
 *
 * This was 9 while paint resolved by taking the innermost covering span's `paint` whole, so a span stating no paint
 * fell through to the paragraph paint rather than to the span enclosing it — contradicting the README. It reached `0`
 * when one span cascade began resolving every property by containment for both shaping and paint, and those nine
 * glyphs moved from `paragraphPaintGlyphs` into `accentPaintGlyphs`. Keep the pin: a regression would raise it again.
 */
const NESTED_SPAN_PAINT_CASCADE_DELTA = 0;

function richTextSpanValidation(values: readonly import('./contracts').BenchmarkMeasurement[]): string {
  deterministicValidation(values.map((value) => value.hash));
  for (const value of values) {
    const metrics = value.metrics;
    if (metrics === undefined) throw new Error('Rich text span conformance reported no metrics');
    for (const [key, expected] of Object.entries(RICH_TEXT_SPAN_EVIDENCE)) {
      if (key === 'hash') continue;
      if (metrics[key] !== expected) {
        throw new Error(
          `Rich text span conformance changed ${key}: ${String(metrics[key])} instead of ${String(expected)}`,
        );
      }
    }
    if (value.hash !== RICH_TEXT_SPAN_EVIDENCE.hash) {
      throw new Error(
        `Rich text span conformance changed its composed shaping and paint evidence: ${value.hash} instead of ${RICH_TEXT_SPAN_EVIDENCE.hash}`,
      );
    }
    if (
      // A feature span must re-select glyphs only inside its own range.
      metrics.smallCapsChangedGlyphsOutside !== 0 ||
      // Tracking and size must move metrics without re-selecting a single glyph.
      metrics.trackingChangedGlyphs !== 0 ||
      metrics.emphasisChangedGlyphs !== 0 ||
      // Dropping a font span must return its range to the body face's slot.
      metrics.faceSpanSlotGlyphsWithoutSpan !== 0 ||
      metrics.fallbackFontHandleCountWithoutSpan !== 2 ||
      // The composed paragraph must resolve every glyph and account for every drawn instance.
      metrics.missingGlyphCount !== 0 ||
      (metrics.accentPaintGlyphs ?? 0) + (metrics.tintPaintGlyphs ?? 0) + (metrics.paragraphPaintGlyphs ?? 0) !==
        metrics.renderedGlyphCount
    ) {
      throw new Error('Rich text span conformance did not preserve its composed-span contract');
    }
    if (metrics.nestedPaintDelta !== NESTED_SPAN_PAINT_CASCADE_DELTA) {
      throw new Error(
        `Nested style-only span paint inheritance changed: ${String(metrics.nestedPaintDelta)} glyphs lost to the paragraph paint instead of ${String(NESTED_SPAN_PAINT_CASCADE_DELTA)}`,
      );
    }
  }
  const nestedPaint = NESTED_SPAN_PAINT_CASCADE_DELTA > 0 ? 'resets' : 'inherits';
  return `${values.length}/${values.length} exact composed-span paragraphs · ${String(RICH_TEXT_SPAN_EVIDENCE.caseCount)} controls · nested paint ${nestedPaint}`;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export const scenarios: readonly BenchmarkScenario[] = [
  {
    id: 'slug-sampling-conformance',
    label: 'Slug text accuracy',
    description: 'GPU analytic coverage compared visually with an independent scalar CPU reconstruction.',
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
    description: 'GPU TSL sampling compared visually with an independent scalar CPU reconstruction.',
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
    description: 'Every authored Latin, Arabic, Devanagari, bidi, and CJK frame through public Text.',
    requiredCapabilities: new Set(['deterministic', 'shaping', 'paragraph', 'raster']),
    validate: advancedShapingValidation,
  },
  {
    id: 'rich-text-spans-conformance',
    label: 'Rich text span conformance',
    description:
      'Composed spans carrying features, tracking, size, face, fallback, nesting, and paint through public Text.',
    requiredCapabilities: new Set(['deterministic', 'shaping', 'paragraph', 'raster']),
    validate: richTextSpanValidation,
  },
  {
    id: 'react-text-reconciliation',
    label: 'React Text reconciliation',
    description: 'React 19 and real R3F retain one public Text object across pinned-oracle nested-span reflow.',
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
    id: 'external-raster-proof',
    label: 'Public external raster proof',
    description: 'Private package bake, load, Text publication, retained update, TSL draw, and readback.',
    requiredCapabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    validate: externalRasterProofValidation,
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
    id: 'paragraph-contracts',
    label: 'Rust paragraph contracts',
    description: 'Exact retained bidi, policy, uikit, and CJK layouts through public Text.',
    requiredCapabilities: new Set(['paragraph', 'shaping', 'font-bytes', 'wasm']),
    validate: paragraphContractsValidation,
  },
];

export function scenarioById(id: string): BenchmarkScenario {
  return scenarios.find((scenario) => scenario.id === id) ?? scenarios[0]!;
}
