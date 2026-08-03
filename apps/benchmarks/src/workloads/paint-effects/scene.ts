import { Text, type TextSpan } from '@pmndrs/text';

import type { RasterTechnique } from '../../benchmark/url-state';
import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from '../comparison/contracts';
import { benchmarkContentWidth, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextLayout,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

export interface MutablePaintSpan extends TextSpan {
  color: number;
  outline?: { color: number; width: number };
  shadow?: { color: number; offset: readonly [number, number] };
}

export const PAINT_EFFECTS_TEXT =
  'Color begins as light, then the human eye turns wavelength into sensation. Our cones negotiate red, green, and blue while the brain invents every violet, amber, and electric cyan between them. Here each word carries its own chromatic phase, flowing through a continuous spectrum while opacity and contour remain live.';
const PAINT_WORD_RANGES = Array.from(PAINT_EFFECTS_TEXT.matchAll(/\S+/g), (match) => ({
  start: match.index,
  end: match.index + match[0].length,
}));

export const paintEffectsWorkload = {
  animate(entries, configuration, elapsedMs) {
    animatePaintEffectsEntries(entries, configuration, elapsedMs);
  },
  applyRetainedConfiguration(entries, configuration, technique) {
    applyPaintEffectsRetainedConfiguration(entries, technique, configuration);
  },
  cameraKind: 'orthographic',
  contentWidth: {},
  create(context) {
    return createPaintEffectsEntries({
      ...context.configuration,
      dpr: context.dpr,
      font: context.font,
      raster: context.raster,
      technique: context.technique,
      viewportWidth: context.viewportWidth,
    });
  },
  id: 'paint-effects',
  layout(entries, context) {
    layoutPaintEffectsEntries(entries, context.viewportWidth, context.viewportHeight);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

export function createPaintEffectsEntries(
  context: WorkloadTextFactoryContext & {
    readonly amount: number;
    readonly fontSize: number;
    readonly layoutWidthRatio: number;
    readonly paintOpacity: number;
    readonly paintShadowEnabled: boolean;
    readonly paintStrokeWidth: number;
    readonly technique: RasterTechnique;
    readonly viewportWidth: number;
  },
): readonly ComparisonWorkloadEntry[] {
  const maximumOutlineWidth = context.fontSize / 16;
  const paintOutlineWidth = context.technique === 'mtsdf' ? maximumOutlineWidth * context.paintStrokeWidth : undefined;
  const paintShadowOffset =
    context.technique === 'mtsdf' && context.paintShadowEnabled
      ? ([Math.max(3, context.fontSize / 10), Math.max(3, context.fontSize / 10)] as const)
      : undefined;
  const spans = createPaintSpans(0, context.amount, paintOutlineWidth, paintShadowOffset);
  const text = new Text({
    font: context.font,
    raster: context.raster,
    rasterPixelRatio: context.dpr,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
    text: PAINT_EFFECTS_TEXT,
    spans,
    fontSize: context.fontSize,
    opacity: context.paintOpacity,
    width: benchmarkContentWidth(context.viewportWidth, context.layoutWidthRatio),
    wrap: 'word',
  });
  return [
    {
      node: text,
      role: 'primary',
      sourceText: PAINT_EFFECTS_TEXT,
      text,
      paintSpans: spans,
      paintUpdate: { text: PAINT_EFFECTS_TEXT, spans },
      ...(paintOutlineWidth === undefined ? {} : { paintOutlineWidth }),
      ...(paintShadowOffset === undefined ? {} : { paintShadowOffset }),
    },
  ];
}

export function createPaintSpans(
  phase: number,
  amount: number,
  outlineWidth?: number,
  shadowOffset?: readonly [number, number],
): MutablePaintSpan[] {
  const spans = PAINT_WORD_RANGES.map((range) => ({ ...range, color: 0 }));
  updatePaintSpans(spans, phase, amount, outlineWidth, shadowOffset);
  return spans;
}

export function updatePaintSpans(
  spans: MutablePaintSpan[],
  phase: number,
  amount: number,
  outlineWidth?: number,
  shadowOffset?: readonly [number, number],
): void {
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    const hue = paintWordHue(index, PAINT_WORD_RANGES.length, phase, amount);
    span.color = hslColor(hue, 0.88, 0.53);
    if (outlineWidth === undefined || outlineWidth === 0) delete span.outline;
    else if (span.outline === undefined) span.outline = { color: 0xffffff, width: outlineWidth };
    else span.outline.width = outlineWidth;
    if (shadowOffset === undefined) delete span.shadow;
    else if (span.shadow === undefined) span.shadow = { color: hslColor(hue, 0.68, 0.28), offset: shadowOffset };
    else {
      span.shadow.color = hslColor(hue, 0.68, 0.28);
      span.shadow.offset = shadowOffset;
    }
  }
}

export function layoutPaintEffectsEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const entry = entries[0];
  if (entry === undefined) return;
  const layout = committedTextLayout(entry.text);
  entry.text.position.set(
    Math.max(12, (viewportWidth - layout.width) / 2),
    -Math.max(18, (viewportHeight - layout.height) / 2),
    0,
  );
}

export function animatePaintEffectsEntries(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'amount' | 'animationEnabled' | 'animationSpeed'>,
  timestamp: number,
): void {
  const entry = entries[0];
  if (entry === undefined || !configuration.animationEnabled) return;
  const paintFrame = Math.floor(timestamp / 16);
  if (entry.lastPaintFrame === paintFrame) return;
  entry.lastPaintFrame = paintFrame;
  const started = performance.now();
  // Identical text and shaping-span ranges keep Text on its synchronous paint-only batch path.
  const phase = timestamp * 0.0002 * animationRate(configuration.animationSpeed);
  entry.paintPhase = phase;
  if (entry.paintSpans === undefined || entry.paintUpdate === undefined) {
    throw new Error('paint effects entry is missing its retained span buffer');
  }
  updatePaintSpans(entry.paintSpans, phase, configuration.amount, entry.paintOutlineWidth, entry.paintShadowOffset);
  entry.text.setProperties(entry.paintUpdate);
  entry.paintRevision = (entry.paintRevision ?? 0) + 1;
  entry.lastPaintUpdateMs = performance.now() - started;
}

export function applyPaintEffectsRetainedConfiguration(
  entries: readonly ComparisonWorkloadEntry[],
  technique: RasterTechnique,
  configuration: Pick<
    ComparisonWorkloadConfiguration,
    'amount' | 'fontSize' | 'paintOpacity' | 'paintShadowEnabled' | 'paintStrokeWidth'
  >,
): void {
  const maximumOutlineWidth = configuration.fontSize / 16;
  const paintOutlineWidth = technique === 'mtsdf' ? maximumOutlineWidth * configuration.paintStrokeWidth : undefined;
  const paintShadowOffset =
    technique === 'mtsdf' && configuration.paintShadowEnabled
      ? ([Math.max(3, configuration.fontSize / 10), Math.max(3, configuration.fontSize / 10)] as const)
      : undefined;
  for (const entry of entries) {
    if (paintOutlineWidth === undefined) delete entry.paintOutlineWidth;
    else entry.paintOutlineWidth = paintOutlineWidth;
    if (paintShadowOffset === undefined) delete entry.paintShadowOffset;
    else entry.paintShadowOffset = paintShadowOffset;
    if (entry.paintSpans === undefined) throw new Error('paint effects entry is missing its retained span buffer');
    updatePaintSpans(
      entry.paintSpans,
      entry.paintPhase ?? 0,
      configuration.amount,
      paintOutlineWidth,
      paintShadowOffset,
    );
    entry.text.setProperties({
      opacity: configuration.paintOpacity,
      text: PAINT_EFFECTS_TEXT,
      spans: entry.paintSpans,
    });
  }
}

export function paintWordHue(wordIndex: number, wordCount: number, phase: number, amount: number): number {
  if (!Number.isSafeInteger(wordIndex) || wordIndex < 0 || wordIndex >= wordCount) {
    throw new RangeError('paint word index must address the word sequence');
  }
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    throw new RangeError('paint word count must be a positive safe integer');
  }
  const cycles = 0.5 + (amount / 100) * 1.5;
  const hue = phase + (wordIndex / wordCount) * cycles;
  return ((hue % 1) + 1) % 1;
}

function hslColor(hue: number, saturation: number, lightness: number): number {
  const channel = (offset: number): number => {
    const value = (offset + hue * 12) % 12;
    return (
      lightness - saturation * Math.min(lightness, 1 - lightness) * Math.max(-1, Math.min(value - 3, 9 - value, 1))
    );
  };
  return (Math.round(channel(0) * 255) << 16) | (Math.round(channel(8) * 255) << 8) | Math.round(channel(4) * 255);
}

function animationRate(animationSpeed: number): number {
  return 0.25 + animationSpeed * 0.0175;
}
