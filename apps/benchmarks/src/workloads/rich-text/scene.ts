import { span, txt, type Font, type RasterFormatMetadata, type TextLiteral } from '@pmndrs/glyph';

import type { RasterFormatName } from '../../benchmark/url-state';
import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from '../comparison/contracts';
import { benchmarkContentWidth, LIVE_TEXT_COLOR_CSS, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextMetrics,
  exactWidth,
  type ComparisonWorkloadEntry,
  type WorkloadFont,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

/** Composed-span content: each span isolates one shaping/paint obligation (glyph selection, tracking, resize, font-slot, fallback, paint inheritance) a single check couldn't otherwise distinguish. */
export const RICH_TEXT_PARAGRAPH_COLOR = LIVE_TEXT_COLOR_CSS;
export const RICH_TEXT_ACCENT_COLOR = '#ff8800';
export const RICH_TEXT_TINT_COLOR = '#00c8ff';
export const RICH_TEXT_SMALL_CAPS_FEATURE = 'smcp';

/** Companion faces the composed content selects by span, in font-policy order: `emphasis` stands in for italic (no italic fixture exists), `foreign` is the actual fallback (no Latin face shapes Devanagari). */
export interface RichTextCompanionFonts {
  readonly emphasis: Font<RasterFormatMetadata>;
  readonly foreign: Font<RasterFormatMetadata>;
}

export interface RichTextComposition {
  readonly accentFontSize: number;
  readonly bodyFontSize: number;
  readonly emphasisFontSize: number;
  readonly letterSpacing: number;
  /** Whether the accent span encloses a nested style-only span; a composition input (not a size of `0`) so composing without it isolates what nesting itself costs. */
  readonly nested: boolean;
  readonly nestedFontSize: number;
  readonly smallCaps: boolean;
  readonly tintColor: string;
}

/** Which authored span occupies each index of the composed literal, with its exact UTF-16 range; pinning these turns a prose edit into a loud failure instead of silent re-attribution. */
export const RICH_TEXT_SPANS = [
  { end: 25, name: 'properNoun', start: 19 },
  { end: 66, name: 'tracked', start: 61 },
  { end: 83, name: 'emphasis', start: 74 },
  { end: 102, name: 'face', start: 96 },
  { end: 121, name: 'foreign', start: 113 },
  { end: 159, name: 'accent', start: 124 },
  { end: 141, name: 'nested', start: 132 },
  { end: 168, name: 'tint', start: 165 },
] as const;

export type RichTextSpanName = (typeof RICH_TEXT_SPANS)[number]['name'];

export function richTextSpanRange(name: RichTextSpanName): { readonly start: number; readonly end: number } {
  const found = RICH_TEXT_SPANS.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`rich text has no ${name} span`);
  return found;
}

export function richTextComposition(
  bodyFontSize: number,
  overrides: Partial<RichTextComposition> = {},
): RichTextComposition {
  if (!Number.isFinite(bodyFontSize) || bodyFontSize <= 0) {
    throw new RangeError('rich text body font size must be positive');
  }
  return {
    accentFontSize: bodyFontSize * 1.25,
    bodyFontSize,
    emphasisFontSize: bodyFontSize * 1.9,
    letterSpacing: bodyFontSize * 0.3125,
    nested: true,
    nestedFontSize: bodyFontSize * 0.78,
    smallCaps: true,
    tintColor: RICH_TEXT_TINT_COLOR,
    ...overrides,
  };
}

export function richTextLiteral(
  fonts: RichTextCompanionFonts,
  composition: RichTextComposition,
): TextLiteral<RasterFormatMetadata> {
  const properNoun = composition.smallCaps
    ? span(fonts.emphasis, { features: [{ tag: RICH_TEXT_SMALL_CAPS_FEATURE }] })
    : span(fonts.emphasis);
  const tracked = span({ letterSpacing: composition.letterSpacing });
  const emphasis = span({ decoration: { underline: true }, fontSize: composition.emphasisFontSize });
  const face = span(fonts.emphasis);
  const foreign = span(fonts.foreign);
  const accent = span({
    color: RICH_TEXT_ACCENT_COLOR,
    decoration: { lineThrough: true },
    fontSize: composition.accentFontSize,
  });
  const tint = span({ color: composition.tintColor, decoration: { lineThrough: true } });
  // Interpolating the same word as a plain string keeps the paragraph text — and therefore every other span range —
  // byte-identical, so the only difference the control introduces is the nesting itself.
  const inner = composition.nested ? span({ fontSize: composition.nestedFontSize })`virtually` : 'virtually';
  return txt`Early next century ${properNoun`Tyrell`} advanced replicant design past the ${tracked`NEXUS`} phase: ${emphasis`identical`} to a human, ${face`almost`}, filed as ${foreign`देवनागरी`} — ${accent`a being ${inner} indistinguishable`} from ${tint`its`} maker.`;
}

/** The span names a composition emits, in the order `txt` composes them. */
export function richTextSpanNames(composition: RichTextComposition): readonly RichTextSpanName[] {
  return RICH_TEXT_SPANS.filter((entry) => composition.nested || entry.name !== 'nested').map(({ name }) => name);
}

/** The authored ranges are load-bearing evidence, so prose drift must fail loudly rather than silently re-attribute. */
export function assertRichTextSpans(
  literal: TextLiteral<RasterFormatMetadata>,
  composition: RichTextComposition,
): void {
  const expected = richTextSpanNames(composition).map((name) => ({ name, ...richTextSpanRange(name) }));
  if (literal.spans.length !== expected.length) {
    throw new Error(`rich text composed ${String(literal.spans.length)} spans instead of ${String(expected.length)}`);
  }
  for (const [index, entry] of expected.entries()) {
    const composed = literal.spans[index]!;
    if (composed.start !== entry.start || composed.end !== entry.end) {
      throw new Error(
        `rich text ${entry.name} span composed [${String(composed.start)}, ${String(composed.end)}) instead of [${String(entry.start)}, ${String(entry.end)})`,
      );
    }
  }
}

const RICH_TEXT_PARAGRAPH_GAP = 18;
const RICH_TEXT_MINIMUM_PARAGRAPHS = 1;
const RICH_TEXT_MAXIMUM_PARAGRAPHS = 6;
/** Reshapes on a fixed cadence, not every frame: this workload measures composed reflow cost, which must stay comparable across technique/backend lanes rather than scale with frame rate. */
const RICH_TEXT_RESHAPE_INTERVAL_MS = 125;

export function richTextParagraphCount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
    throw new RangeError('rich text amount must be a percentage');
  }
  const range = RICH_TEXT_MAXIMUM_PARAGRAPHS - RICH_TEXT_MINIMUM_PARAGRAPHS;
  return RICH_TEXT_MINIMUM_PARAGRAPHS + Math.round((amount / 100) * range);
}

/** Per-paragraph emphasis phase, so a stack reflows at staggered offsets instead of in lockstep. */
export function richTextEmphasisScale(index: number, count: number, elapsedMs: number): number {
  assertParagraphIndex(index, count);
  const step = Math.floor(elapsedMs / RICH_TEXT_RESHAPE_INTERVAL_MS);
  return 1 + 0.45 * (1 + Math.sin((step / 32 + index / count) * Math.PI * 2));
}

export function richTextTintColor(index: number, count: number, elapsedMs: number): string {
  assertParagraphIndex(index, count);
  const step = Math.floor(elapsedMs / RICH_TEXT_RESHAPE_INTERVAL_MS);
  const hue = (((step / 96 + index / count) % 1) + 1) % 1;
  const channel = (offset: number): number => {
    const value = (offset + hue * 12) % 12;
    return 0.55 - 0.42 * Math.max(-1, Math.min(value - 3, 9 - value, 1));
  };
  const hex = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}

function assertParagraphIndex(index: number, count: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new RangeError('rich text paragraph index must address the paragraph stack');
  }
}

export const richTextWorkload = {
  animate(entries, configuration, elapsedMs) {
    animateRichTextEntries(entries, configuration, elapsedMs);
  },
  applyRetainedConfiguration(entries, configuration, technique) {
    applyRichTextRetainedConfiguration(entries, configuration, technique);
  },
  batching: 'group',
  cameraKind: 'orthographic',
  contentWidth: {},
  create(context) {
    return createRichTextEntries({
      amount: context.configuration.amount,
      companionFonts: richTextCompanionFonts(context.companionFonts),
      dpr: context.dpr,
      elapsedMs: context.animationElapsedMs,
      font: context.font,
      root: context.root,
      fontSize: context.configuration.fontSize,
      layoutWidthRatio: context.configuration.layoutWidthRatio,
      paintOpacity: context.configuration.paintOpacity,
      paintShadowEnabled: context.configuration.paintShadowEnabled,
      paintStrokeWidth: context.configuration.paintStrokeWidth,
      technique: context.technique,
      viewportWidth: context.viewportWidth,
    });
  },
  id: 'rich-text',
  layout(entries, context) {
    layoutRichTextEntries(entries, context.viewportWidth, context.viewportHeight);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

/** The host supplies companions in the order the route's font policy declares them. */
export function richTextCompanionFonts(companions: readonly WorkloadFont[]): RichTextCompanionFonts {
  const foreign = companions[0];
  const emphasis = companions[1];
  if (foreign === undefined || emphasis === undefined) {
    throw new Error('rich text requires its foreign-script and emphasis companion fixtures');
  }
  return { emphasis, foreign };
}

/** Bitmap rejects outline/shadow and Slug V0 omits them, so composed style only reaches for them on MTSDF — the same gate the paint-effects lane uses. */
function richTextParagraphPaint(
  technique: RasterFormatName,
  fontSize: number,
  paintOpacity: number,
  paintShadowEnabled: boolean,
  paintStrokeWidth: number,
) {
  const outlineWidth = technique === 'mtsdf' ? (fontSize / 16) * paintStrokeWidth : 0;
  const shadowOffset = Math.max(3, fontSize / 10);
  return {
    color: RICH_TEXT_PARAGRAPH_COLOR,
    opacity: paintOpacity,
    ...(outlineWidth > 0 ? { outline: { color: '#101014', width: outlineWidth } } : {}),
    ...(technique === 'mtsdf' && paintShadowEnabled
      ? { shadow: { color: '#000000', offset: [shadowOffset, shadowOffset] as const } }
      : {}),
  };
}

export function createRichTextEntries(
  context: WorkloadTextFactoryContext & {
    readonly amount: number;
    readonly companionFonts: RichTextCompanionFonts;
    readonly elapsedMs: number;
    readonly fontSize: number;
    readonly layoutWidthRatio: number;
    readonly paintOpacity: number;
    readonly paintShadowEnabled: boolean;
    readonly paintStrokeWidth: number;
    readonly technique: RasterFormatName;
    readonly viewportWidth: number;
  },
): readonly ComparisonWorkloadEntry[] {
  const count = richTextParagraphCount(context.amount);
  const width = exactWidth(benchmarkContentWidth(context.viewportWidth, context.layoutWidthRatio));
  const paint = richTextParagraphPaint(
    context.technique,
    context.fontSize,
    context.paintOpacity,
    context.paintShadowEnabled,
    context.paintStrokeWidth,
  );
  return Array.from({ length: count }, (_, index) => {
    const composition = richTextComposition(context.fontSize, {
      emphasisFontSize: context.fontSize * richTextEmphasisScale(index, count, context.elapsedMs),
      tintColor: richTextTintColor(index, count, context.elapsedMs),
    });
    const literal = richTextLiteral(context.companionFonts, composition);
    assertRichTextSpans(literal, composition);
    const text = context.root.createText({
      font: context.font,
      rasterPixelRatio: context.dpr,
      text: literal,
      style: [{ fontSize: context.fontSize, lineHeight: LIVE_TEXT_LINE_HEIGHT }, paint],
      constraints: { width },
      layout: { wrap: 'word' },
    });
    return {
      animationPhase: index,
      node: text,
      role: 'primary',
      sourceText: literal.text,
      text,
      richTextCompanionFonts: [context.companionFonts.emphasis, context.companionFonts.foreign],
    };
  });
}

export function layoutRichTextEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const layouts = entries.map(({ text }) => committedTextMetrics(text));
  if (layouts.length === 0) return;
  const stackHeight =
    layouts.reduce((total, layout) => total + layout.height, 0) + RICH_TEXT_PARAGRAPH_GAP * (layouts.length - 1);
  const widest = layouts.reduce((maximum, layout) => Math.max(maximum, layout.width), 0);
  const x = Math.max(12, (viewportWidth - widest) / 2);
  let y = Math.max(18, (viewportHeight - stackHeight) / 2);
  for (const [index, { text }] of entries.entries()) {
    text.position.set(x, -y, 0);
    y += layouts[index]!.height + RICH_TEXT_PARAGRAPH_GAP;
  }
}

/** Republishes every paragraph's composed literal; a span size change is shaping input, so this deliberately takes the reshape path — that reshape cost is what this workload measures. */
export function animateRichTextEntries(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationEnabled' | 'animationSpeed' | 'fontSize'>,
  elapsedMs: number,
): void {
  if (!configuration.animationEnabled || entries.length === 0) return;
  const scaled = elapsedMs * (0.25 + configuration.animationSpeed * 0.0175);
  const reshapeFrame = Math.floor(scaled / RICH_TEXT_RESHAPE_INTERVAL_MS);
  const first = entries[0]!;
  if (first.lastPaintFrame === reshapeFrame) return;
  const started = performance.now();
  for (const [index, entry] of entries.entries()) {
    entry.lastPaintFrame = reshapeFrame;
    const literal = richTextLiteral(
      retainedCompanionFonts(entry),
      richTextComposition(configuration.fontSize, {
        emphasisFontSize: configuration.fontSize * richTextEmphasisScale(index, entries.length, scaled),
        tintColor: richTextTintColor(index, entries.length, scaled),
      }),
    );
    entry.sourceText = literal.text;
    entry.text.set({ text: literal });
    entry.paintRevision = (entry.paintRevision ?? 0) + 1;
  }
  first.lastPaintUpdateMs = performance.now() - started;
}

export function applyRichTextRetainedConfiguration(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<
    ComparisonWorkloadConfiguration,
    'fontSize' | 'paintOpacity' | 'paintShadowEnabled' | 'paintStrokeWidth'
  >,
  technique: RasterFormatName,
): void {
  const paint = richTextParagraphPaint(
    technique,
    configuration.fontSize,
    configuration.paintOpacity,
    configuration.paintShadowEnabled,
    configuration.paintStrokeWidth,
  );
  for (const [index, entry] of entries.entries()) {
    const literal = richTextLiteral(
      retainedCompanionFonts(entry),
      richTextComposition(configuration.fontSize, {
        emphasisFontSize: configuration.fontSize * richTextEmphasisScale(index, entries.length, 0),
      }),
    );
    entry.sourceText = literal.text;
    entry.text.set({
      text: literal,
      style: [{ fontSize: configuration.fontSize, lineHeight: LIVE_TEXT_LINE_HEIGHT }, paint],
    });
  }
}

/** Reads the immutable companion leases retained beside the entry; `Text` intentionally doesn't expose the compiler's generated span records as mutable public state. */
function retainedCompanionFonts(entry: ComparisonWorkloadEntry): RichTextCompanionFonts {
  const fonts = entry.richTextCompanionFonts;
  if (fonts === undefined) throw new Error('rich text paragraph lost its retained companion fonts');
  return { emphasis: fonts[0], foreign: fonts[1] };
}
