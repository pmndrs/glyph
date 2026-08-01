import * as THREE from 'three/webgpu';

import type { AnyFontToken, FontInput, RegisteredFont } from '../font.js';
import type { AnyRasterModule, RasterBatchStage, RasterObjectDrawBatch } from '../raster.js';
import type {
  FontFeature,
  TextLayoutProperties,
  TextPaintProperties,
  TextProperties,
  TextShapingProperties,
  TextSpan,
  TextUpdateProperties,
} from '../text.js';
import { canonicalJson } from './raster-identity.js';
import { isRegisteredFont } from './text-runtime.js';

export interface NormalizedRasterRequest {
  readonly module: AnyRasterModule;
  readonly options: unknown;
  readonly descriptorKey: string;
}

export interface TextState {
  readonly text: string;
  readonly spans: readonly TextSpan[];
  readonly font: AnyFontToken | FontInput | RegisteredFont | undefined;
  readonly raster: NormalizedRasterRequest | undefined;
  readonly width: number | undefined;
  readonly height: number | undefined;
  readonly maxLines: number | undefined;
  readonly wrap: TextLayoutProperties['wrap'];
  readonly overflow: TextLayoutProperties['overflow'];
  readonly textAlign: TextLayoutProperties['textAlign'];
  readonly fontSize: number | undefined;
  readonly lineHeight: number | undefined;
  readonly letterSpacing: number | undefined;
  readonly language: string | undefined;
  readonly direction: TextShapingProperties['direction'];
  readonly features: readonly FontFeature[];
  readonly color: THREE.ColorRepresentation | undefined;
  readonly opacity: number | undefined;
  readonly outline: TextPaintProperties['outline'];
  readonly shadow: TextPaintProperties['shadow'];
  readonly rasterPixelRatio: number;
  readonly onLayout: ((layout: import('../layout.js').ParagraphLayout) => void) | undefined;
}

type ComparablePaintProperties = {
  readonly color?: THREE.ColorRepresentation | undefined;
  readonly opacity?: number | undefined;
  readonly outline?: TextPaintProperties['outline'] | undefined;
  readonly shadow?: TextPaintProperties['shadow'] | undefined;
};

export const EMPTY_TEXT_STATE: TextState = Object.freeze({
  text: '',
  spans: Object.freeze([]),
  font: undefined,
  raster: undefined,
  width: undefined,
  height: undefined,
  maxLines: undefined,
  wrap: undefined,
  overflow: undefined,
  textAlign: undefined,
  fontSize: undefined,
  lineHeight: undefined,
  letterSpacing: undefined,
  language: undefined,
  direction: undefined,
  features: Object.freeze([]),
  color: undefined,
  opacity: undefined,
  outline: undefined,
  shadow: undefined,
  rasterPixelRatio: 1,
  onLayout: undefined,
});

export function normalizeTextState(
  current: TextState,
  value: TextProperties | TextUpdateProperties,
  initial: boolean,
): TextState {
  assertObject(value, 'text properties');
  if (!initial && Object.hasOwn(value, 'spans') && !Object.hasOwn(value, 'text')) {
    throw new TypeError('replacing spans requires text in the same update');
  }
  if (!initial && Object.hasOwn(value, 'raster') && !Object.hasOwn(value, 'font')) {
    throw new TypeError('replacing raster requires font in the same update');
  }
  const merged = { ...current, ...value };
  const text = stringValue(merged.text, 'text');
  const font = initial || Object.hasOwn(value, 'font') ? fontValue(merged.font) : current.font;
  const raster = initial || Object.hasOwn(value, 'raster') ? rasterValue(merged.raster) : current.raster;
  if (font === undefined && raster !== undefined) throw new TypeError('raster requires a font');
  if (font !== undefined && !isFontToken(font) && raster === undefined) {
    throw new TypeError('raw or registered fonts require a raster definition');
  }
  if (isFontToken(font) && raster !== undefined) {
    throw new TypeError('font tokens already own their raster definition');
  }
  const spans = initial || Object.hasOwn(value, 'text') ? normalizeSpans(merged.spans, text) : current.spans;
  return Object.freeze({
    text,
    spans,
    font,
    raster,
    width: optionalNonnegative(merged.width, 'width'),
    height: optionalNonnegative(merged.height, 'height'),
    maxLines: optionalPositiveInteger(merged.maxLines, 'maxLines'),
    wrap: optionalEnum(merged.wrap, ['none', 'word', 'character'], 'wrap'),
    overflow: optionalEnum(merged.overflow, ['visible', 'clip', 'ellipsis'], 'overflow'),
    textAlign: optionalEnum(merged.textAlign, ['start', 'center', 'end', 'justify'], 'textAlign'),
    fontSize: optionalPositive(merged.fontSize, 'fontSize'),
    lineHeight: optionalPositive(merged.lineHeight, 'lineHeight'),
    letterSpacing: optionalFinite(merged.letterSpacing, 'letterSpacing'),
    language: optionalString(merged.language, 'language'),
    direction: optionalEnum(merged.direction, ['auto', 'ltr', 'rtl'], 'direction'),
    features:
      initial || Object.hasOwn(value, 'text') || Object.hasOwn(value, 'features')
        ? normalizeFeatures(merged.features, 0, text.length)
        : current.features,
    color: optionalColor(merged.color, 'color'),
    opacity: optionalUnit(merged.opacity, 'opacity'),
    outline: initial || Object.hasOwn(value, 'outline') ? normalizeOutline(merged.outline) : current.outline,
    shadow: initial || Object.hasOwn(value, 'shadow') ? normalizeShadow(merged.shadow) : current.shadow,
    rasterPixelRatio: optionalPositive(merged.rasterPixelRatio, 'rasterPixelRatio') ?? 1,
    onLayout: optionalFunction(merged.onLayout, 'onLayout'),
  });
}

function normalizeSpans(value: unknown, text: string): readonly TextSpan[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('spans must be an array');
  return Object.freeze(
    value.map((entry, index) => {
      assertObject(entry, `span ${index}`);
      const start = nonnegativeInteger(requiredProperty(entry, 'start', `span ${index}`), `span ${index} start`);
      const end = nonnegativeInteger(requiredProperty(entry, 'end', `span ${index}`), `span ${index} end`);
      if (start >= end || end > text.length) throw new RangeError(`span ${index} range is invalid`);
      return Object.freeze({
        start,
        end,
        ...(readProperty(entry, 'font') === undefined ? {} : { font: fontValue(readProperty(entry, 'font')) }),
        ...(readProperty(entry, 'fontSize') === undefined
          ? {}
          : {
              fontSize: optionalPositive(readProperty(entry, 'fontSize'), `span ${index} fontSize`),
            }),
        ...(readProperty(entry, 'lineHeight') === undefined
          ? {}
          : {
              lineHeight: optionalPositive(readProperty(entry, 'lineHeight'), `span ${index} lineHeight`),
            }),
        ...(readProperty(entry, 'letterSpacing') === undefined
          ? {}
          : {
              letterSpacing: optionalFinite(readProperty(entry, 'letterSpacing'), `span ${index} letterSpacing`),
            }),
        ...(readProperty(entry, 'language') === undefined
          ? {}
          : {
              language: optionalString(readProperty(entry, 'language'), `span ${index} language`),
            }),
        ...(readProperty(entry, 'direction') === undefined
          ? {}
          : {
              direction: optionalEnum(
                readProperty(entry, 'direction'),
                ['auto', 'ltr', 'rtl'],
                `span ${index} direction`,
              ),
            }),
        ...(readProperty(entry, 'features') === undefined
          ? {}
          : { features: normalizeFeatures(readProperty(entry, 'features'), start, end) }),
        ...(readProperty(entry, 'color') === undefined
          ? {}
          : { color: colorValue(readProperty(entry, 'color'), `span ${index} color`) }),
        ...(readProperty(entry, 'opacity') === undefined
          ? {}
          : { opacity: optionalUnit(readProperty(entry, 'opacity'), `span ${index} opacity`) }),
        ...(readProperty(entry, 'outline') === undefined
          ? {}
          : { outline: normalizeOutline(readProperty(entry, 'outline')) }),
        ...(readProperty(entry, 'shadow') === undefined
          ? {}
          : { shadow: normalizeShadow(readProperty(entry, 'shadow')) }),
      }) as TextSpan;
    }),
  );
}

function normalizeFeatures(
  value: unknown,
  containingStart = 0,
  containingEnd = Number.MAX_SAFE_INTEGER,
): readonly FontFeature[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('features must be an array');
  const normalized: FontFeature[] = [];
  for (const [index, entry] of value.entries()) {
    assertObject(entry, `feature ${index}`);
    const tag = stringValue(requiredProperty(entry, 'tag', `feature ${index}`), `feature ${index} tag`);
    if (/^[\x20-\x7e]{4}$/.test(tag) === false) {
      throw new TypeError(`feature ${index} tag must contain four printable ASCII bytes`);
    }
    const featureValue = readProperty(entry, 'value');
    const startValue = readProperty(entry, 'start');
    const endValue = readProperty(entry, 'end');
    const resolvedStart =
      startValue === undefined ? undefined : nonnegativeInteger(startValue, `feature ${index} start`);
    const resolvedEnd = endValue === undefined ? undefined : nonnegativeInteger(endValue, `feature ${index} end`);
    const resolvedValue =
      featureValue === undefined ? undefined : nonnegativeInteger(featureValue, `feature ${index} value`);
    if (resolvedValue !== undefined && resolvedValue > 0xffff_ffff) {
      throw new RangeError(`feature ${index} value must fit uint32`);
    }
    if (containingStart === containingEnd && resolvedStart === undefined && resolvedEnd === undefined) {
      continue;
    }
    if ((resolvedStart ?? containingStart) < containingStart) {
      throw new RangeError(`feature ${index} starts before its style range`);
    }
    if ((resolvedEnd ?? containingEnd) > containingEnd) {
      throw new RangeError(`feature ${index} ends after its style range`);
    }
    if ((resolvedStart ?? containingStart) >= (resolvedEnd ?? containingEnd)) {
      throw new RangeError(`feature ${index} range is invalid`);
    }
    normalized.push(
      Object.freeze({
        tag,
        ...(resolvedValue === undefined ? {} : { value: resolvedValue }),
        ...(resolvedStart === undefined ? {} : { start: resolvedStart }),
        ...(resolvedEnd === undefined ? {} : { end: resolvedEnd }),
      }),
    );
  }
  return Object.freeze(normalized);
}

function normalizeOutline(value: unknown): TextPaintProperties['outline'] {
  if (value === undefined) return undefined;
  assertObject(value, 'outline');
  return Object.freeze({
    color: colorValue(requiredProperty(value, 'color', 'outline'), 'outline color'),
    width: nonnegative(requiredProperty(value, 'width', 'outline'), 'outline width'),
  });
}

function normalizeShadow(value: unknown): TextPaintProperties['shadow'] {
  if (value === undefined) return undefined;
  assertObject(value, 'shadow');
  const offset = requiredProperty(value, 'offset', 'shadow');
  if (!Array.isArray(offset) || offset.length !== 2) {
    throw new TypeError('shadow offset must contain two numbers');
  }
  return Object.freeze({
    color: colorValue(requiredProperty(value, 'color', 'shadow'), 'shadow color'),
    offset: Object.freeze([finite(offset[0], 'shadow offset x'), finite(offset[1], 'shadow offset y')] as const),
  });
}

export function normalizeRasterInput(value: unknown): NormalizedRasterRequest {
  const candidate = isObject(value) && hasProperty(value, 'module') ? value.module : value;
  assertRasterModule(candidate);
  const options = isObject(value) && hasProperty(value, 'module') ? readProperty(value, 'options') : undefined;
  const descriptorKey = canonicalJson(candidate.descriptor(options));
  return {
    module: candidate,
    options,
    descriptorKey,
  };
}

export function isNormalizedRasterRequest(value: unknown): value is NormalizedRasterRequest {
  return (
    isObject(value) &&
    hasProperty(value, 'module') &&
    hasProperty(value, 'options') &&
    typeof readProperty(value, 'descriptorKey') === 'string' &&
    isRasterModule(value.module)
  );
}

function assertRasterModule(value: unknown): asserts value is AnyRasterModule {
  if (!isRasterModule(value)) {
    throw new TypeError('raster module does not implement the complete runtime contract');
  }
}

function isRasterModule(value: unknown): value is AnyRasterModule {
  return (
    isObject(value) &&
    typeof readProperty(value, 'kind') === 'string' &&
    typeof readProperty(value, 'extension') === 'string' &&
    Number.isSafeInteger(readProperty(value, 'version')) &&
    typeof readProperty(value, 'descriptor') === 'function' &&
    typeof readProperty(value, 'decode') === 'function' &&
    typeof readProperty(value, 'prepare') === 'function' &&
    typeof readProperty(value, 'stageBatch') === 'function' &&
    typeof readProperty(value, 'dispose') === 'function'
  );
}

export type ThreeRasterDrawBatch = RasterObjectDrawBatch<THREE.Object3D>;

function assertRasterBatch(value: unknown): asserts value is ThreeRasterDrawBatch {
  if (
    !isObject(value) ||
    !(readProperty(value, 'object') instanceof THREE.Object3D) ||
    typeof readProperty(value, 'dispose') !== 'function'
  ) {
    throw new TypeError('raster module returned an invalid draw batch');
  }
}

export function assertRasterBatchStage(value: unknown): asserts value is RasterBatchStage<ThreeRasterDrawBatch> {
  if (
    !isObject(value) ||
    typeof readProperty(value, 'commit') !== 'function' ||
    typeof readProperty(value, 'abort') !== 'function'
  ) {
    throw new TypeError('raster module returned an invalid batch stage');
  }
  assertRasterBatch(readProperty(value, 'batch'));
}

export function isFontToken(value: AnyFontToken | FontInput | RegisteredFont | undefined): value is AnyFontToken {
  return isObject(value) && hasProperty(value, 'input') && hasProperty(value, 'raster');
}

function fontValue(value: unknown): TextState['font'] {
  if (value === undefined || isRegisteredFont(value)) return value;
  const token = fontTokenValue(value);
  if (token !== undefined) return token;
  if (typeof value === 'string' || value instanceof URL) return value;
  return fontInputValue(value);
}

function fontTokenValue(value: unknown): AnyFontToken | undefined {
  if (!isObject(value) || !hasProperty(value, 'input') || !hasProperty(value, 'raster')) {
    return undefined;
  }
  const input = fontInputValue(readProperty(value, 'input'));
  const raster = normalizeRasterInput(readProperty(value, 'raster'));
  return Object.freeze({
    input,
    raster: Object.freeze({ module: raster.module, options: raster.options }),
  });
}

function fontInputValue(value: unknown): FontInput {
  if (typeof value === 'string' || value instanceof URL) return value;
  assertObject(value, 'font input');
  const source = urlValue(readProperty(value, 'source'), 'font source');
  const baked = urlValue(readProperty(value, 'baked'), 'baked font source');
  if (source !== undefined) return baked === undefined ? { source } : { source, baked };
  if (baked !== undefined) return { baked };
  throw new TypeError('font input requires source or baked');
}

function urlValue(value: unknown, name: string): string | URL | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' || value instanceof URL) return value;
  throw new TypeError(`${name} must be a string or URL`);
}

function rasterValue(value: unknown): NormalizedRasterRequest | undefined {
  if (value === undefined) return undefined;
  const request = normalizeRasterInput(value);
  return request;
}

export function sameParagraphInput(left: TextState, right: TextState): boolean {
  return (
    left.text === right.text &&
    sameFont(left.font, right.font) &&
    sameRaster(left.raster, right.raster) &&
    left.fontSize === right.fontSize &&
    left.lineHeight === right.lineHeight &&
    left.letterSpacing === right.letterSpacing &&
    left.language === right.language &&
    left.direction === right.direction &&
    sameFeatures(left.features, right.features) &&
    sameShapingSpans(left.spans, right.spans)
  );
}

function sameFont(left: TextState['font'], right: TextState['font']): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (isRegisteredFont(left) || isRegisteredFont(right)) return false;
  const leftToken = isFontToken(left);
  const rightToken = isFontToken(right);
  if (leftToken || rightToken) {
    return (
      leftToken &&
      rightToken &&
      sameFontInput(left.input, right.input) &&
      sameRaster(normalizeRasterInput(left.raster), normalizeRasterInput(right.raster))
    );
  }
  return sameFontInput(left, right);
}

function sameFontInput(left: FontInput, right: FontInput): boolean {
  if (left === right) return true;
  if (typeof left === 'string' || left instanceof URL) {
    return (typeof right === 'string' || right instanceof URL) && String(left) === String(right);
  }
  if (typeof right === 'string' || right instanceof URL) return false;
  return (
    String(left.source ?? '') === String(right.source ?? '') && String(left.baked ?? '') === String(right.baked ?? '')
  );
}

function sameRaster(left: NormalizedRasterRequest | undefined, right: NormalizedRasterRequest | undefined): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      left.module === right.module &&
      left.descriptorKey === right.descriptorKey)
  );
}

export function sameLayoutInput(left: TextState, right: TextState): boolean {
  return (
    sameParagraphInput(left, right) &&
    left.rasterPixelRatio === right.rasterPixelRatio &&
    left.width === right.width &&
    left.height === right.height &&
    left.maxLines === right.maxLines &&
    left.wrap === right.wrap &&
    left.overflow === right.overflow &&
    left.textAlign === right.textAlign
  );
}

export function samePaintInput(left: TextState, right: TextState): boolean {
  return (
    samePaintProperties(left, right) &&
    left.spans.length === right.spans.length &&
    left.spans.every((span, index) => {
      const other = right.spans[index];
      return other !== undefined && samePaintProperties(span, other);
    })
  );
}

export function sameTextInput(left: TextState, right: TextState): boolean {
  return sameLayoutInput(left, right) && samePaintInput(left, right);
}

export function samePaintProperties(left: ComparablePaintProperties, right: ComparablePaintProperties): boolean {
  return (
    sameColor(left.color, right.color) &&
    left.opacity === right.opacity &&
    sameOutline(left.outline, right.outline) &&
    sameShadow(left.shadow, right.shadow)
  );
}

export function sameFeatures(left: readonly FontFeature[], right: readonly FontFeature[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (feature, index) =>
        feature.tag === right[index]?.tag &&
        feature.value === right[index]?.value &&
        feature.start === right[index]?.start &&
        feature.end === right[index]?.end,
    )
  );
}

function sameColor(left: THREE.ColorRepresentation | undefined, right: THREE.ColorRepresentation | undefined): boolean {
  return left === right || (left instanceof THREE.Color && right instanceof THREE.Color && left.equals(right));
}

function sameOutline(left: TextPaintProperties['outline'], right: TextPaintProperties['outline']): boolean {
  return (
    left === right ||
    (left !== undefined && right !== undefined && left.width === right.width && sameColor(left.color, right.color))
  );
}

function sameShadow(left: TextPaintProperties['shadow'], right: TextPaintProperties['shadow']): boolean {
  return (
    left === right ||
    (left !== undefined &&
      right !== undefined &&
      sameColor(left.color, right.color) &&
      left.offset[0] === right.offset[0] &&
      left.offset[1] === right.offset[1])
  );
}

function sameShapingSpans(left: readonly TextSpan[], right: readonly TextSpan[]): boolean {
  return (
    left.length === right.length &&
    left.every((span, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        span.start === other.start &&
        span.end === other.end &&
        sameFont(span.font, other.font) &&
        span.fontSize === other.fontSize &&
        span.lineHeight === other.lineHeight &&
        span.letterSpacing === other.letterSpacing &&
        span.language === other.language &&
        span.direction === other.direction &&
        sameFeatures(span.features ?? [], other.features ?? [])
      );
    })
  );
}

function assertObject(value: unknown, name: string): asserts value is object {
  if (!isObject(value)) throw new TypeError(`${name} must be a non-array object`);
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasProperty<Key extends PropertyKey>(value: object, key: Key): value is object & Record<Key, unknown> {
  return key in value;
}

function readProperty(value: object, key: PropertyKey): unknown {
  return key in value ? Reflect.get(value, key) : undefined;
}

function requiredProperty(value: object, key: PropertyKey, name: string): unknown {
  if (!(key in value)) throw new TypeError(`${name} requires ${String(key)}`);
  return Reflect.get(value, key);
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, name);
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

function optionalFinite(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : finite(value, name);
}

function optionalNonnegative(value: unknown, name: string): number | undefined {
  const result = optionalFinite(value, name);
  if (result !== undefined && result < 0) throw new RangeError(`${name} must be non-negative`);
  return result;
}

function nonnegative(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result < 0) throw new RangeError(`${name} must be non-negative`);
  return result;
}

function colorValue(value: unknown, name: string): THREE.ColorRepresentation {
  if (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    value instanceof THREE.Color
  ) {
    return value;
  }
  throw new TypeError(`${name} must be a CSS color, finite hexadecimal number, or Three Color`);
}

function optionalColor(value: unknown, name: string): THREE.ColorRepresentation | undefined {
  return value === undefined ? undefined : colorValue(value, name);
}

function optionalPositive(value: unknown, name: string): number | undefined {
  const result = optionalFinite(value, name);
  if (result !== undefined && result <= 0) throw new RangeError(`${name} must be positive`);
  return result;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

function optionalUnit(value: unknown, name: string): number | undefined {
  const result = optionalFinite(value, name);
  if (result !== undefined && (result < 0 || result > 1)) {
    throw new RangeError(`${name} must be between zero and one`);
  }
  return result;
}

function optionalEnum<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  name: string,
): Value | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    throw new TypeError(`${name} is unsupported`);
  }
  return value as Value;
}

function optionalFunction<Arguments extends readonly unknown[], Result>(
  value: unknown,
  name: string,
): ((...arguments_: Arguments) => Result) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value as (...arguments_: Arguments) => Result;
}
