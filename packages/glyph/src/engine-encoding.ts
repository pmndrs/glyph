import type { ParagraphSpan } from './formatted-text.js';
import type { AnyRasterFormat } from './raster-format.js';
import type { AxisConstraint, Constraints, ParagraphLayout, TextStyle } from './text-properties.js';
import type {
  PlannerConstraint,
  PlannerDecoration,
  PlannerFrameLimits,
  PlannerRegion,
  PlannerStyleValue,
} from './core/frame-wire.js';
import type { HandleIdFactory, ParagraphId, StyleId } from './config/codec.js';

/**
 * The single implementation of the paragraph-to-engine encodings shared by every host:
 * the Three.js batch binding and the framework-neutral `Paragraph` both compile
 * constraints, regions, styles, and limits through these functions, and both derive
 * incremental text edits through the mutation helpers, so one host cannot drift from
 * another in what the engine is asked to flow.
 */

export function normalizedColumns(
  layout: ParagraphLayout | undefined,
  constraints: Constraints | undefined,
): {
  count: number;
  gap: number;
} {
  const columns = layout?.columns;
  if (columns === undefined) return { count: 1, gap: 0 };
  const gap = columns.gap ?? 0;
  if (!Number.isSafeInteger(columns.count) || columns.count < 1 || columns.count > 16) {
    throw new RangeError('layout columns count must be an integer between 1 and 16');
  }
  if (!Number.isFinite(gap) || gap < 0) {
    throw new RangeError('layout columns gap must be a nonnegative finite number');
  }
  if (columns.count > 1 && constraints?.width?.mode !== 'exact') {
    throw new TypeError('layout columns require an exact width constraint to derive the column measure');
  }
  // Ordered columns fill without balancing, so the column height is the only
  // signal that advances flow into the next region: unbounded height would
  // keep every line in the first column forever.
  if (columns.count > 1 && constraints?.height === undefined) {
    throw new TypeError('layout columns require a bounded height constraint to fill columns in order');
  }
  return { count: columns.count, gap };
}

export function compileEngineGeometry(
  id: HandleIdFactory,
  paragraphId: ParagraphId,
  transformIndex: number,
  geometryRevision: number,
  layout: ParagraphLayout | undefined,
  constraints: Constraints | undefined,
  regionStart: number,
  textLength: number,
): { readonly constraint: PlannerConstraint; readonly regions: readonly PlannerRegion[] } {
  const width = axis(constraints?.width);
  const height = axis(constraints?.height);
  const columns = normalizedColumns(layout, constraints);
  const inlineEnd = width.mode === 'unconstrained' ? 0x01_00_00_00 : width.size;
  const blockEnd = height.mode === 'unconstrained' ? 0x01_00_00_00 : height.size;
  const maxLines = layout?.maxLines ?? Math.max(1, textLength);
  const columnWidth = (inlineEnd - columns.gap * (columns.count - 1)) / columns.count;
  if (columns.count > 1 && columnWidth <= 0) {
    throw new RangeError('layout columns and gap leave no positive column measure');
  }
  return {
    constraint: {
      paragraphId,
      flowThreadId: id.flowThread(`paragraph/${paragraphId}`),
      geometryRevision,
      width: width.size,
      height: height.size,
      viewportBlockStart: 0,
      viewportBlockEnd: blockEnd,
      resumeBlockOffset: 0,
      maxLines,
      regionStart,
      resumeCluster: 0,
      regionCount: columns.count,
      resumeRegion: 0,
      widthMode: width.mode,
      heightMode: height.mode,
      wrap: layout?.wrap ?? 'word',
      align: layout?.align ?? 'start',
      overflow: layout?.overflow ?? 'visible',
      blockAlign: 'start',
      ...(layout?.firstLineIndent === undefined ? {} : { firstLineIndent: layout.firstLineIndent }),
      ...(layout?.spaceBefore === undefined ? {} : { spaceBefore: layout.spaceBefore }),
      ...(layout?.spaceAfter === undefined ? {} : { spaceAfter: layout.spaceAfter }),
      ...(layout?.justify === undefined ? {} : { justify: layout.justify }),
      ...(layout?.lastLine === undefined ? {} : { lastLine: layout.lastLine }),
    },
    regions: Array.from({ length: columns.count }, (_, column) => {
      const inlineStart = column * (columnWidth + columns.gap);
      const columnInlineEnd = column === columns.count - 1 ? inlineEnd : inlineStart + columnWidth;
      return {
        id: id.region(`paragraph/${paragraphId}/column/${column}`),
        geometryRevision,
        transformIndex,
        shape: 'rectangle' as const,
        exclusionStart: 0,
        exclusionCount: 0,
        writingMode: 'horizontal-tb' as const,
        textOrientation: 'mixed' as const,
        inlineStart,
        blockStart: 0,
        inlineEnd: columnInlineEnd,
        blockEnd,
        clipInlineStart: inlineStart,
        clipBlockStart: 0,
        clipInlineEnd: columnInlineEnd,
        clipBlockEnd: blockEnd,
      };
    }),
  };
}

export function engineStyleId(id: HandleIdFactory, paragraphId: ParagraphId, index: number): StyleId {
  if (!Number.isSafeInteger(index) || index < 1) throw new RangeError('style index must be a positive integer');
  return id.style(`paragraph/${paragraphId}/style/${index}`);
}

export function axis(value: AxisConstraint | undefined): {
  readonly mode: 'unconstrained' | 'at-most' | 'exact';
  readonly size: number;
} {
  if (value === undefined || value.mode === 'unconstrained') return { mode: 'unconstrained', size: 0 };
  return { mode: value.mode, size: value.size };
}

export function engineLimits(
  paragraphCount: number,
  textLength: number,
  maximumParagraphTextLength: number,
  regionCount: number,
  maxOutputBytes: number,
  mutationRecordCount = 0,
): PlannerFrameLimits {
  return {
    maxParagraphs: Math.max(1, paragraphCount),
    maxClusters: Math.max(1, textLength * 2, mutationRecordCount),
    // Rust applies this limit while composing each paragraph. Using aggregate batch text here makes every paragraph
    // reserve enough line scratch for the whole TextGroup, multiplying retained memory by paragraph count.
    maxLines: Math.max(1, maximumParagraphTextLength),
    maxRegions: Math.max(1, regionCount),
    maxExclusions: 1,
    maxInlineObjects: 1,
    maxSlotsPerBand: 8,
    maxOutputBytes,
  };
}

export function engineStyleValue(
  style: TextStyle,
  start: number,
  end: number,
  base: PlannerStyleValue,
): PlannerStyleValue {
  return {
    ...base,
    ...(style.fontSize === undefined ? {} : { fontSize: style.fontSize }),
    ...(style.lineHeight === undefined ? {} : { lineHeight: style.lineHeight }),
    ...(style.letterSpacing === undefined ? {} : { letterSpacing: style.letterSpacing }),
    ...(style.wordSpacing === undefined ? {} : { wordSpacing: style.wordSpacing }),
    ...(style.language === undefined ? {} : { language: style.language }),
    ...(style.direction === undefined ? {} : { direction: style.direction }),
    ...(style.features === undefined
      ? {}
      : {
          features: style.features.map((feature) => ({
            tag: feature.tag,
            value: feature.value ?? 1,
            start: feature.start ?? start,
            end: feature.end ?? end,
          })),
        }),
    ...(style.color === undefined ? {} : { foregroundRgba: packedColor(style.color) }),
    ...(style.opacity === undefined ? {} : { opacity: style.opacity }),
    ...(style.outline === undefined
      ? {}
      : { outline: { rgba: packedColor(style.outline.color), width: style.outline.width } }),
    ...(style.shadow === undefined
      ? {}
      : {
          shadow: {
            rgba: packedColor(style.shadow.color),
            offsetX: style.shadow.offset[0],
            offsetY: style.shadow.offset[1],
          },
        }),
    ...(style.decoration === undefined ? {} : { decoration: engineDecoration(style.decoration, style) }),
  };
}

/** @internal Reject effects at the public call that accepted a style. */
export function assertTextEffectsSupported(
  style: TextStyle,
  techniques: readonly AnyRasterFormat[],
  label: string,
): void {
  for (const technique of techniques) {
    if (style.outline !== undefined && !technique.textEffects.includes('outline')) {
      throw new TypeError(`raster format ${technique.id} does not support outline in ${label}`);
    }
    if (style.shadow !== undefined && !technique.textEffects.includes('shadow')) {
      throw new TypeError(`raster format ${technique.id} does not support shadow in ${label}`);
    }
  }
}

function engineDecoration(decoration: NonNullable<TextStyle['decoration']>, style: TextStyle): PlannerDecoration {
  if (decoration.style !== undefined && decoration.style !== 'solid') {
    throw new TypeError(`'${decoration.style}' decoration lines are not implemented yet; only 'solid' is supported`);
  }
  return {
    style: decoration.style ?? 'solid',
    rgba: packedForeground(decoration.color === undefined ? style : { color: decoration.color }),
    ...(decoration.underline === undefined ? {} : { underline: decoration.underline }),
    ...(decoration.overline === undefined ? {} : { overline: decoration.overline }),
    ...(decoration.lineThrough === undefined ? {} : { lineThrough: decoration.lineThrough }),
    thickness: decoration.thickness ?? 0,
    offset: decoration.offset ?? 0,
  };
}

/**
 * The spans that state a style over text, in authored order.
 *
 * An empty span covers no cluster and so states nothing, but the engine's style resolution walks
 * the text offset by offset and cannot advance across a zero-width scope, so one reaching it fails
 * the whole frame (`style_state.rs`, `resolve`). Cluster resolution produces an empty span whenever
 * an edit hands a span's last cluster to the span before it, and keeps it in `Text.spans` so the
 * loss is visible and later indices do not shift; dropping it here is what keeps that record from
 * costing the paragraph. Style ids stay contiguous from the emitted order because the removal pass
 * that trims a shrunken style list counts on it.
 */
export function styledSpans<Span extends ParagraphSpan<AnyRasterFormat>>(
  spans: readonly Span[] | undefined,
): readonly Span[] {
  // Only a collapsed span is dropped. An INVERTED span is a caller arithmetic error whose owner
  // is range validation, so it is forwarded and rejected rather than filtered away -- swallowing
  // it here would make an impossible range publish as if it had been honoured.
  return spans === undefined ? [] : spans.filter((span) => span.start !== span.end);
}

export function packedForeground(style: TextStyle): number {
  const opacity = style.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    throw new RangeError('opacity must be in [0, 1]');
  }
  const rgba = colorBytes(style.color ?? '#ffffff');
  const alpha = Math.round(rgba[3] * opacity);
  return (rgba[0] | (rgba[1] << 8) | (rgba[2] << 16) | (alpha << 24)) >>> 0;
}

function packedColor(input: NonNullable<TextStyle['color']>): number {
  const rgba = colorBytes(input);
  return (rgba[0] | (rgba[1] << 8) | (rgba[2] << 16) | (rgba[3] << 24)) >>> 0;
}

function colorBytes(input: NonNullable<TextStyle['color']>): readonly [number, number, number, number] {
  return typeof input === 'string' ? parseHexColorBytes(input) : linearColorBytes(input);
}

function parseHexColorBytes(value: string): readonly [number, number, number, number] {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{8})$/iu.exec(value);
  if (match === null) throw new TypeError('colors must be #rrggbb, #rrggbbaa, or linear RGBA');
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
    hex.length === 8 ? Number.parseInt(hex.slice(6), 16) : 255,
  ];
}

function linearColorBytes(color: readonly number[]): readonly [number, number, number, number] {
  if (color.length !== 4 || color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError('linear RGBA colors must contain four finite channels in [0, 1]');
  }
  const srgbByte = (value: number): number => {
    const srgb = value <= 0.003_130_8 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  };
  return [srgbByte(color[0]!), srgbByte(color[1]!), srgbByte(color[2]!), Math.round(color[3]! * 255)];
}

/**
 * Replacement text carries its own formatting: a literal brings its spans and a
 * plain string brings none. Retaining the previous spans would reinterpret them
 * against unrelated text, so an update that replaces text without stating spans
 * clears the ones it replaced.
 */
export function replacedContent<Update extends { readonly text?: unknown; readonly spans?: unknown }>(
  update: Update,
): Update {
  if (!('text' in update) || 'spans' in update) return update;
  if (typeof update.text !== 'string') return update;
  return { ...update, spans: [] };
}

export interface EngineTextMutation {
  readonly start: number;
  readonly deleteCount: number;
  readonly insert: string;
}

/** Derives the smallest Unicode-scalar-aligned replace that turns `previous` into `next`. */
export function minimalTextMutation(previous: string, next: string): EngineTextMutation | undefined {
  if (previous === next) return undefined;
  const shared = Math.min(previous.length, next.length);
  let start = 0;
  while (start < shared) {
    const previousCodePoint = previous.codePointAt(start)!;
    if (previousCodePoint !== next.codePointAt(start)) break;
    start += previousCodePoint > 0xffff ? 2 : 1;
  }
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start) {
    const previousStart = previousScalarStart(previous, previousEnd);
    const nextStart = previousScalarStart(next, nextEnd);
    if (previous.codePointAt(previousStart) !== next.codePointAt(nextStart)) break;
    previousEnd = previousStart;
    nextEnd = nextStart;
  }
  return {
    start,
    deleteCount: previousEnd - start,
    insert: next.slice(start, nextEnd),
  };
}

function previousScalarStart(value: string, end: number): number {
  const last = end - 1;
  const unit = value.charCodeAt(last);
  const previous = value.charCodeAt(last - 1);
  return unit >= 0xdc00 && unit <= 0xdfff && last > 0 && previous >= 0xd800 && previous <= 0xdbff ? last - 1 : last;
}
