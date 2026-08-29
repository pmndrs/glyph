import type { FontFeature } from './font-feature.js';
import type { FormattedText, ParagraphSpan } from './formatted-text.js';
import type { FontSelection } from './loaded-font.js';
import { mergePropertyList } from './property-list.js';
import type { AnyRasterTechnique } from './raster-technique.js';

export interface GlyphBufferCapacity {
  readonly size: number;
  /**
   * `grow` resizes to what the content needs, `chunk` resizes in multiples of `size`, and `fixed`
   * rejects an update whose glyph requirement exceeds `size` and keeps the last complete revision
   * visible. The requirement is a text-length upper bound computed before shaping, so a caller can
   * size content against the cap rather than discovering it after the fact.
   */
  readonly policy: 'grow' | 'chunk' | 'fixed';
}

/** An object or nested, left-to-right property list; false and null entries are ignored. */
export type PropertyList<Value> = Value | false | null | undefined | readonly PropertyList<Value>[];

/** A measure-system-neutral axis constraint. */
export type AxisConstraint =
  | { readonly mode: 'unconstrained' }
  | { readonly mode: 'at-most'; readonly size: number }
  | { readonly mode: 'exact'; readonly size: number };

/** Parent-supplied bounds for one measurement or retained text instance. */
export interface Constraints {
  readonly width?: AxisConstraint;
  readonly height?: AxisConstraint;
}

/** Stable paragraph flow properties, independent of the box being measured. */
export interface ParagraphLayout {
  readonly maxLines?: number;
  readonly wrap?: 'none' | 'word' | 'character';
  readonly align?: 'start' | 'center' | 'end' | 'justify';
  readonly overflow?: 'visible' | 'clip' | 'ellipsis';
  /** Extra inline offset for the paragraph's first line, in paragraph-local units. */
  readonly firstLineIndent?: number;
  /** Block-axis space before the paragraph's first line. */
  readonly spaceBefore?: number;
  /** Block-axis space carried in measurements after the paragraph's final line. */
  readonly spaceAfter?: number;
  /**
   * Justification bounds on each word space as multiples of its natural
   * advance: `minWordSpaceRatio` in (0, 1] permits shrinking, and
   * `maxWordSpaceRatio` (at least 1) caps expansion before the remaining
   * deficit spills into per-gap letter-space expansion. Unset sides stay
   * unbounded.
   */
  readonly justify?: {
    readonly minWordSpaceRatio?: number;
    readonly maxWordSpaceRatio?: number;
    readonly letterSpaceExpansion?: number;
  };
  /** Whether the final and hard-broken lines also justify. Defaults to 'auto'. */
  readonly lastLine?: 'auto' | 'justify';
  /**
   * Flow the paragraph through side-by-side ordered columns inside an exact
   * constrained width. Text fills each column in order without balancing, so
   * the final column may run short. Requires an exact `width`; `gap` is the
   * inline space between adjacent columns in paragraph-local units.
   */
  readonly columns?: { readonly count: number; readonly gap?: number };
}

export type LinearRgbaInput = readonly [number, number, number, number];
export type ColorInput = string | LinearRgbaInput;

/** Text shaping, metrics, and presentation properties for a paragraph or inline span. */
export interface TextStyle {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  /** Extra advance added to each word-separating space, in paragraph-local units. */
  readonly wordSpacing?: number;
  readonly language?: string;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly features?: readonly FontFeature[];
  readonly decoration?: TextDecorationStyle;
  readonly color?: ColorInput;
  /** Alpha multiplier inherited independently from color. */
  readonly opacity?: number;
  /** Technique-supported outline color and width in paragraph-local units. */
  readonly outline?: { readonly color: ColorInput; readonly width: number };
  /** Technique-supported hard-shadow color and displacement in paragraph-local units. */
  readonly shadow?: { readonly color: ColorInput; readonly offset: readonly [number, number] };
}

/**
 * Text decoration lines for a styled range. Geometry comes from the font's baked
 * underline and strikeout metrics; `thickness` and `offset` override in paragraph-local units
 * when nonzero. Only `solid` lines are implemented: requesting another line style is
 * rejected at the boundary rather than silently rendered as solid.
 */
export interface TextDecorationStyle {
  readonly underline?: boolean;
  readonly overline?: boolean;
  readonly lineThrough?: boolean;
  readonly color?: ColorInput;
  readonly style?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
  readonly thickness?: number;
  readonly offset?: number;
}

export interface ParagraphBaseProperties<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  /** Text shaping and presentation properties inherited by inline spans. */
  readonly style?: PropertyList<TextStyle>;
  /** Paragraph flow properties such as wrapping, alignment, and line limits. */
  readonly layout?: PropertyList<ParagraphLayout>;
  /** Bounds imposed on the measured and rendered paragraph. */
  readonly constraints?: PropertyList<Constraints>;
  readonly rasterPixelRatio?: number;
  readonly order?: number;
}

export type ParagraphContentProperties<Technique extends AnyRasterTechnique> =
  | Readonly<{ text: string; spans?: readonly ParagraphSpan<Technique>[] }>
  | Readonly<{ text: FormattedText<Technique>; spans?: never }>;

export type ParagraphProperties<Technique extends AnyRasterTechnique> = ParagraphBaseProperties<Technique> &
  ParagraphContentProperties<Technique>;

interface PropertyRegistry<Value extends object> {
  create<const Rules extends Readonly<Record<string, PropertyList<Value>>>>(
    rules: Rules,
  ): Readonly<{ [Name in keyof Rules]: Readonly<Value> }>;
}

/** Creates named text-style objects for composition through the `style` property. */
export const TextStyle: PropertyRegistry<TextStyle> = createPropertyRegistry('TextStyle', assertTextStyle);

/** Creates named paragraph-layout objects for composition through the `layout` property. */
export const ParagraphLayout: PropertyRegistry<ParagraphLayout> = createPropertyRegistry(
  'ParagraphLayout',
  assertParagraphLayout,
);

/** Creates named constraint objects for composition through the `constraints` property. */
export const Constraints: PropertyRegistry<Constraints> = createPropertyRegistry('Constraints', assertConstraints);

function createPropertyRegistry<Value extends object>(
  label: string,
  validate: (value: Value, label: string) => void,
): PropertyRegistry<Value> {
  return Object.freeze({
    create<const Rules extends Readonly<Record<string, PropertyList<Value>>>>(
      rules: Rules,
    ): Readonly<{ [Name in keyof Rules]: Readonly<Value> }> {
      if (rules === null || typeof rules !== 'object' || Array.isArray(rules)) {
        throw new TypeError(`${label}.create rules must be an object`);
      }
      const resolved: Record<string, Readonly<Value>> = {};
      for (const [name, value] of Object.entries(rules)) {
        const ruleLabel = `${label}.create rule "${name}"`;
        const merged = mergePropertyList(value, ruleLabel);
        validate(merged, ruleLabel);
        resolved[name] = Object.freeze(merged);
      }
      return Object.freeze(resolved) as Readonly<{ [Name in keyof Rules]: Readonly<Value> }>;
    },
  });
}

/** @internal Validate a resolved text style at the public call that accepted it. */
export function assertTextStyle(value: TextStyle, label = 'text style'): void {
  assertRecord(value, label);
  optionalPositiveFinite(value.fontSize, `${label} fontSize`);
  optionalPositiveFinite(value.lineHeight, `${label} lineHeight`);
  optionalFinite(value.letterSpacing, `${label} letterSpacing`);
  optionalFinite(value.wordSpacing, `${label} wordSpacing`);
  if (value.language !== undefined) {
    if (typeof value.language !== 'string' || !validLanguage(value.language)) {
      throw new TypeError(`${label} language must be a valid language tag`);
    }
  }
  if (value.direction !== undefined && !['auto', 'ltr', 'rtl'].includes(value.direction)) {
    throw new TypeError(`${label} direction is invalid`);
  }
  if (value.features !== undefined) {
    if (!Array.isArray(value.features)) throw new TypeError(`${label} features must be an array`);
    for (const [index, feature] of value.features.entries()) assertFeature(feature, `${label} feature ${index}`);
  }
  if (value.decoration !== undefined) assertDecoration(value.decoration, `${label} decoration`);
  if (value.color !== undefined) assertColor(value.color, `${label} color`);
  if (value.opacity !== undefined && (!Number.isFinite(value.opacity) || value.opacity < 0 || value.opacity > 1)) {
    throw new RangeError(`${label} opacity must be in [0, 1]`);
  }
  if (value.outline !== undefined) {
    assertRecord(value.outline, `${label} outline`);
    assertColor(value.outline.color, `${label} outline color`);
    optionalNonnegativeFinite(value.outline.width, `${label} outline width`, true);
  }
  if (value.shadow !== undefined) {
    assertRecord(value.shadow, `${label} shadow`);
    assertColor(value.shadow.color, `${label} shadow color`);
    if (!Array.isArray(value.shadow.offset) || value.shadow.offset.length !== 2) {
      throw new TypeError(`${label} shadow offset must contain two numbers`);
    }
    optionalFinite(value.shadow.offset[0], `${label} shadow offset x`, true);
    optionalFinite(value.shadow.offset[1], `${label} shadow offset y`, true);
  }
}

/** @internal Validate absolute feature ranges against the style scope that will carry them. */
export function assertTextStyleFeatureRanges(value: TextStyle, start: number, end: number, label = 'text style'): void {
  for (const [index, feature] of (value.features ?? []).entries()) {
    const featureStart = feature.start ?? start;
    const featureEnd = feature.end ?? end;
    if (featureStart < start || featureEnd > end) {
      throw new RangeError(`${label} feature ${index} (${feature.tag}) must stay inside [${start}, ${end})`);
    }
  }
}

/** @internal Validate resolved paragraph flow properties before they reach a planner. */
export function assertParagraphLayout(value: ParagraphLayout, label = 'paragraph layout'): void {
  assertRecord(value, label);
  if (value.maxLines !== undefined && (!Number.isSafeInteger(value.maxLines) || value.maxLines < 1)) {
    throw new RangeError(`${label} maxLines must be a positive integer`);
  }
  optionalEnum(value.wrap, ['none', 'word', 'character'], `${label} wrap`);
  optionalEnum(value.align, ['start', 'center', 'end', 'justify'], `${label} align`);
  optionalEnum(value.overflow, ['visible', 'clip', 'ellipsis'], `${label} overflow`);
  optionalNonnegativeFinite(value.firstLineIndent, `${label} firstLineIndent`);
  optionalNonnegativeFinite(value.spaceBefore, `${label} spaceBefore`);
  optionalNonnegativeFinite(value.spaceAfter, `${label} spaceAfter`);
  optionalEnum(value.lastLine, ['auto', 'justify'], `${label} lastLine`);
  if (value.justify !== undefined) {
    assertRecord(value.justify, `${label} justify`);
    const minimum = value.justify.minWordSpaceRatio;
    const maximum = value.justify.maxWordSpaceRatio;
    if (minimum !== undefined && (!Number.isFinite(minimum) || minimum <= 0 || minimum > 1)) {
      throw new RangeError(`${label} justify minWordSpaceRatio must be in (0, 1]`);
    }
    if (maximum !== undefined && (!Number.isFinite(maximum) || maximum < 1)) {
      throw new RangeError(`${label} justify maxWordSpaceRatio must be at least 1`);
    }
    optionalNonnegativeFinite(value.justify.letterSpaceExpansion, `${label} justify letterSpaceExpansion`);
  }
  if (value.columns !== undefined) {
    assertRecord(value.columns, `${label} columns`);
    if (!Number.isSafeInteger(value.columns.count) || value.columns.count < 1 || value.columns.count > 16) {
      throw new RangeError(`${label} columns count must be an integer between 1 and 16`);
    }
    optionalNonnegativeFinite(value.columns.gap, `${label} columns gap`);
  }
}

/** @internal Validate parent constraints at the public call that accepted them. */
export function assertConstraints(value: Constraints, label = 'text constraints'): void {
  assertRecord(value, label);
  assertAxis(value.width, `${label} width`);
  assertAxis(value.height, `${label} height`);
}

function assertAxis(value: AxisConstraint | undefined, label: string): void {
  if (value === undefined) return;
  assertRecord(value, label);
  if (!['unconstrained', 'at-most', 'exact'].includes(value.mode)) throw new TypeError(`${label} mode is invalid`);
  if (value.mode === 'unconstrained') {
    if ('size' in value) throw new TypeError(`${label} must not state a size when unconstrained`);
    return;
  }
  optionalNonnegativeFinite(value.size, `${label} size`, true);
}

function assertFeature(value: FontFeature, label: string): void {
  assertRecord(value, label);
  if (typeof value.tag !== 'string' || value.tag.length !== 4 || !/^[\x20-\x7e]{4}$/u.test(value.tag)) {
    throw new RangeError(`${label} tag must contain exactly four printable ASCII bytes`);
  }
  if (
    value.value !== undefined &&
    (!Number.isSafeInteger(value.value) || value.value < 0 || value.value > 0xffff_ffff)
  ) {
    throw new RangeError(`${label} value must be a u32`);
  }
  optionalU32(value.start, `${label} start`);
  optionalU32(value.end, `${label} end`);
  if (value.start !== undefined && value.end !== undefined && value.end < value.start) {
    throw new RangeError(`${label} end must not precede start`);
  }
}

function assertDecoration(value: TextDecorationStyle, label: string): void {
  assertRecord(value, label);
  for (const [name, enabled] of [
    ['underline', value.underline],
    ['overline', value.overline],
    ['lineThrough', value.lineThrough],
  ] as const) {
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new TypeError(`${label} ${name} must be boolean`);
  }
  if (value.color !== undefined) assertColor(value.color, `${label} color`);
  optionalEnum(value.style, ['solid', 'double', 'dotted', 'dashed', 'wavy'], `${label} style`);
  optionalNonnegativeFinite(value.thickness, `${label} thickness`);
  optionalFinite(value.offset, `${label} offset`);
  if (value.style !== undefined && value.style !== 'solid') {
    throw new TypeError(`${label} style '${value.style}' is not implemented; only 'solid' is supported`);
  }
}

function assertColor(value: ColorInput, label: string): void {
  if (typeof value === 'string') {
    if (!/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value)) {
      throw new TypeError(`${label} must be #rrggbb, #rrggbbaa, or linear RGBA`);
    }
    return;
  }
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 1)
  ) {
    throw new TypeError(`${label} linear RGBA must contain four finite channels in [0, 1]`);
  }
}

function assertRecord(value: unknown, label: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
}

function optionalFinite(value: number | undefined, label: string, required = false): void {
  if (value === undefined) {
    if (required) throw new TypeError(`${label} is required`);
    return;
  }
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}

function optionalPositiveFinite(value: number | undefined, label: string): void {
  optionalFinite(value, label);
  if (value !== undefined && value <= 0) throw new RangeError(`${label} must be positive`);
}

function optionalNonnegativeFinite(value: number | undefined, label: string, required = false): void {
  optionalFinite(value, label, required);
  if (value !== undefined && value < 0) throw new RangeError(`${label} must be nonnegative`);
}

function optionalU32(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)) {
    throw new RangeError(`${label} must be a u32`);
  }
}

function optionalEnum(value: string | undefined, choices: readonly string[], label: string): void {
  if (value !== undefined && !choices.includes(value)) throw new TypeError(`${label} is invalid`);
}

function validLanguage(value: string): boolean {
  const parts = value.split('-');
  const primary = parts[0] ?? '';
  const privateOrGrandfathered = /^[xi]$/iu.test(primary);
  if ((!privateOrGrandfathered && !/^[a-z]{2,8}$/iu.test(primary)) || (privateOrGrandfathered && parts.length === 1)) {
    return false;
  }
  return parts.slice(1).every((part) => /^[a-z0-9]{1,8}$/iu.test(part));
}
