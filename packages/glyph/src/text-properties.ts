import type { FontFeature } from './font-feature.js';
import type { TextInput } from './formatted-text.js';
import type { FontSelection } from './loaded-font.js';
import { mergePropertyList } from './property-list.js';
import type { RasterFormatMetadata } from './config/raster-format.js';

export interface GlyphBufferCapacity {
  readonly size: number;
  /** `grow` resizes to fit; `chunk` resizes in multiples of `size`; `fixed` rejects an update exceeding `size`, keeping the last complete revision visible. */
  readonly policy: 'grow' | 'chunk' | 'fixed';
}

/** @internal Validate and freeze one publication-capacity input at its user boundary. */
export function normalizeGlyphBufferCapacity(value: GlyphBufferCapacity, label: string): GlyphBufferCapacity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (!Number.isSafeInteger(value.size) || value.size <= 0) {
    throw new RangeError(`${label} size must be a positive safe integer`);
  }
  if (value.policy !== 'grow' && value.policy !== 'chunk' && value.policy !== 'fixed') {
    throw new TypeError(`${label} policy must be grow, chunk, or fixed`);
  }
  return Object.freeze({ size: value.size, policy: value.policy });
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

/** Paragraph-local inline/block bounds ordered as start-inline, start-block, end-inline, end-block. */
export type TextFlowBounds = readonly [number, number, number, number];

/** One paragraph-local point ordered as inline then block. */
export type TextFlowPoint = readonly [number, number];

/** A bounded 2D region or exclusion ring. Polygon rings are implicitly closed. */
export type TextFlowShape =
  | Readonly<{ kind: 'rectangle'; bounds: TextFlowBounds }>
  | Readonly<{ kind: 'polygon'; vertices: readonly TextFlowPoint[] }>;

/** One exclusion authored in its containing region's paragraph-local coordinate space. */
export interface TextFlowExclusion {
  /** Stable authoring key; array order is not identity. */
  readonly key: string;
  readonly shape: TextFlowShape;
  readonly wrapSide?: 'both' | 'inline-start' | 'inline-end' | 'largest';
  readonly marginInline?: number;
  readonly marginBlock?: number;
}

/** One sequential paragraph flow region and its local exclusions. */
export interface TextFlowRegion {
  /** Stable authoring key; array order is flow order, not identity. */
  readonly key: string;
  readonly shape: TextFlowShape;
  /** Optional clipping bounds; defaults to the shape bounds. */
  readonly clip?: TextFlowBounds;
  readonly exclusions?: readonly TextFlowExclusion[];
}

/** Ordered paragraph-local regions through which one text source flows. */
export interface TextFlow {
  readonly regions: readonly TextFlowRegion[];
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
  /** Word-space bounds as multiples of natural advance: `minWordSpaceRatio` in (0, 1] permits shrinking, `maxWordSpaceRatio` (>=1) caps expansion before spilling into letter-space expansion. */
  readonly justify?: {
    readonly minWordSpaceRatio?: number;
    readonly maxWordSpaceRatio?: number;
    /** Maximum extra advance per inter-cluster gap, in paragraph-local units. */
    readonly letterSpaceExpansion?: number;
  };
  /** Whether the final and hard-broken lines also justify. Defaults to 'auto'. */
  readonly lastLine?: 'auto' | 'justify';
  /** Flows text through ordered columns inside an exact `width`, filling in order without balancing (final column may run short); `gap` is inline space between columns. */
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
  /** Format-supported outline color and width in paragraph-local units. */
  readonly outline?: { readonly color: ColorInput; readonly width: number };
  /** Format-supported hard-shadow color and displacement in paragraph-local units. */
  readonly shadow?: { readonly color: ColorInput; readonly offset: readonly [number, number] };
}

/** Decoration geometry comes from the font's baked underline/strikeout metrics; `thickness`/`offset` override when nonzero. Only `solid` style is implemented — others are rejected. */
export interface TextDecorationStyle {
  readonly underline?: boolean;
  readonly overline?: boolean;
  readonly lineThrough?: boolean;
  readonly color?: ColorInput;
  readonly style?: 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
  readonly thickness?: number;
  readonly offset?: number;
}

export interface ParagraphBaseProperties<Format extends RasterFormatMetadata> {
  readonly font: FontSelection<Format>;
  /** Text shaping and presentation properties inherited by inline spans. */
  readonly style?: PropertyList<TextStyle>;
  /** Paragraph flow properties such as wrapping, alignment, and line limits. */
  readonly layout?: PropertyList<ParagraphLayout>;
  /** Bounds imposed on the measured and rendered paragraph. */
  readonly constraints?: PropertyList<Constraints>;
  /** Explicit sequential 2D regions and exclusions; replaces generated columns when present. */
  readonly flow?: TextFlow;
  readonly rasterPixelRatio?: number;
  readonly order?: number;
}

export type ParagraphContentProperties<Format extends RasterFormatMetadata> = Readonly<{
  text: TextInput<Format>;
}>;

export type ParagraphProperties<Format extends RasterFormatMetadata> = ParagraphBaseProperties<Format> &
  ParagraphContentProperties<Format>;

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

/** @internal Validate, normalize winding, and freeze one public flow description. */
export function normalizeTextFlow(value: TextFlow, label = 'text flow'): TextFlow {
  assertRecord(value, label);
  if (!Array.isArray(value.regions) || value.regions.length === 0) {
    throw new TypeError(`${label} regions must be a nonempty array`);
  }
  const sourceRegions = value.regions as readonly TextFlowRegion[];
  const regionKeys = new Set<string>();
  const regions = sourceRegions.map((region, regionIndex) => {
    const regionLabel = `${label} region ${regionIndex}`;
    assertRecord(region, regionLabel);
    const key = flowKey(region.key, `${regionLabel} key`);
    if (regionKeys.has(key)) throw new TypeError(`${label} region key "${key}" is duplicated`);
    regionKeys.add(key);
    const shape = normalizeFlowShape(region.shape, `${regionLabel} shape`);
    const clip = region.clip === undefined ? undefined : normalizeFlowBounds(region.clip, `${regionLabel} clip`);
    const exclusionKeys = new Set<string>();
    const exclusions = (region.exclusions ?? []).map((exclusion, exclusionIndex) => {
      const exclusionLabel = `${regionLabel} exclusion ${exclusionIndex}`;
      assertRecord(exclusion, exclusionLabel);
      const exclusionKey = flowKey(exclusion.key, `${exclusionLabel} key`);
      if (exclusionKeys.has(exclusionKey)) {
        throw new TypeError(`${regionLabel} exclusion key "${exclusionKey}" is duplicated`);
      }
      exclusionKeys.add(exclusionKey);
      optionalEnum(exclusion.wrapSide, ['both', 'inline-start', 'inline-end', 'largest'], `${exclusionLabel} wrapSide`);
      const marginInline = normalizeOptionalFlowMargin(exclusion.marginInline, `${exclusionLabel} marginInline`);
      const marginBlock = normalizeOptionalFlowMargin(exclusion.marginBlock, `${exclusionLabel} marginBlock`);
      return Object.freeze({
        key: exclusionKey,
        shape: normalizeFlowShape(exclusion.shape, `${exclusionLabel} shape`),
        ...(exclusion.wrapSide === undefined ? {} : { wrapSide: exclusion.wrapSide }),
        ...(marginInline === undefined ? {} : { marginInline }),
        ...(marginBlock === undefined ? {} : { marginBlock }),
      });
    });
    return Object.freeze({
      key,
      shape,
      ...(clip === undefined ? {} : { clip }),
      ...(exclusions.length === 0 ? {} : { exclusions: Object.freeze(exclusions) }),
    });
  });
  return Object.freeze({ regions: Object.freeze(regions) });
}

function normalizeFlowShape(value: TextFlowShape, label: string): TextFlowShape {
  assertRecord(value, label);
  if (value.kind === 'rectangle') {
    return Object.freeze({ kind: 'rectangle', bounds: normalizeFlowBounds(value.bounds, `${label} bounds`) });
  }
  if (value.kind !== 'polygon' || !Array.isArray(value.vertices) || value.vertices.length < 3) {
    throw new TypeError(`${label} must be a rectangle or a polygon with at least three vertices`);
  }
  const vertices = value.vertices.map((point, index) => normalizeFlowPoint(point, `${label} vertex ${index}`));
  for (let index = 0; index < vertices.length; index += 1) {
    const next = vertices[(index + 1) % vertices.length]!;
    if (samePoint(vertices[index]!, next)) throw new TypeError(`${label} has consecutive duplicate vertices`);
  }
  for (let first = 0; first < vertices.length; first += 1) {
    for (let second = first + 1; second < vertices.length; second += 1) {
      if (samePoint(vertices[first]!, vertices[second]!)) throw new TypeError(`${label} repeats a vertex`);
    }
  }
  const area = signedArea(vertices);
  if (!Number.isFinite(area) || area === 0) throw new RangeError(`${label} must have nonzero finite area`);
  assertSimplePolygon(vertices, label);
  if (area < 0) vertices.reverse();
  return Object.freeze({ kind: 'polygon', vertices: Object.freeze(vertices) });
}

function normalizeFlowBounds(value: TextFlowBounds, label: string): TextFlowBounds {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(`${label} must contain four finite coordinates`);
  }
  const bounds: TextFlowBounds = [
    finiteFlowCoordinate(value[0], label),
    finiteFlowCoordinate(value[1], label),
    finiteFlowCoordinate(value[2], label),
    finiteFlowCoordinate(value[3], label),
  ];
  if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    throw new RangeError(`${label} must have positive inline and block extents`);
  }
  return Object.freeze(bounds);
}

function normalizeFlowPoint(value: TextFlowPoint, label: string): TextFlowPoint {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError(`${label} must contain two finite coordinates`);
  }
  return Object.freeze([finiteFlowCoordinate(value[0], label), finiteFlowCoordinate(value[1], label)]);
}

function normalizeOptionalFlowMargin(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const margin = finiteFlowCoordinate(value, label);
  if (margin < 0) throw new RangeError(`${label} must be nonnegative`);
  return margin;
}

function finiteFlowCoordinate(value: number, label: string): number {
  const narrowed = Math.fround(value);
  if (!Number.isFinite(value) || !Number.isFinite(narrowed)) {
    throw new TypeError(`${label} must contain finite f32 coordinates`);
  }
  return narrowed === 0 ? 0 : narrowed;
}

function signedArea(vertices: readonly TextFlowPoint[]): number {
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const first = vertices[index]!;
    const second = vertices[(index + 1) % vertices.length]!;
    twiceArea += first[0] * second[1] - second[0] * first[1];
  }
  return twiceArea;
}

function assertSimplePolygon(vertices: readonly TextFlowPoint[], label: string): void {
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length;
      if (first === second || first === secondNext || firstNext === second || firstNext === secondNext) continue;
      if (segmentsIntersect(vertices[first]!, vertices[firstNext]!, vertices[second]!, vertices[secondNext]!)) {
        throw new TypeError(`${label} must not self-intersect`);
      }
    }
  }
}

function segmentsIntersect(a: TextFlowPoint, b: TextFlowPoint, c: TextFlowPoint, d: TextFlowPoint): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && onSegment(a, b, c)) return true;
  if (abD === 0 && onSegment(a, b, d)) return true;
  if (cdA === 0 && onSegment(c, d, a)) return true;
  if (cdB === 0 && onSegment(c, d, b)) return true;
  return Math.sign(abC) !== Math.sign(abD) && Math.sign(cdA) !== Math.sign(cdB);
}

function orientation(a: TextFlowPoint, b: TextFlowPoint, c: TextFlowPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: TextFlowPoint, b: TextFlowPoint, point: TextFlowPoint): boolean {
  return (
    Math.min(a[0], b[0]) <= point[0] &&
    point[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= point[1] &&
    point[1] <= Math.max(a[1], b[1])
  );
}

function samePoint(left: TextFlowPoint, right: TextFlowPoint): boolean {
  return Object.is(left[0], right[0]) && Object.is(left[1], right[1]);
}

function flowKey(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a nonempty string`);
  return value;
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
