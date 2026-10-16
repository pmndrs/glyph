import { assertTextStyleFeatureRanges, type TextStyle } from '../text-properties.js';
import { reuseOrCreateTextStyleSnapshot } from './text-property.js';

/** The caller-owned fields shared by Three and retained text span records. */
export interface TextSpanOwnershipFields<Font, Material> {
  readonly start: number;
  readonly end: number;
  readonly font?: Font;
  readonly material?: Material;
  readonly style?: TextStyle;
}

export interface TextInputOwnershipFields<Font, Material> {
  readonly text: string;
  readonly spans: readonly TextSpanOwnershipFields<Font, Material>[];
}

type TextSpanOwnershipMode =
  | { readonly kind: 'core'; readonly textLength: number; readonly featureScopeLabel?: string }
  | { readonly kind: 'three' };

type SpanDataProof =
  | { readonly kind: 'owned-styles' }
  | { readonly kind: 'owned-ranges'; readonly textLength: number; readonly featureScope?: true }
  | { readonly kind: 'owned-empty' };

// This proves only package ownership of immutable span data. It never authenticates bindings or their lifetime.
const ownedSpanData = new WeakMap<object, SpanDataProof>();
const EMPTY_SPANS: readonly TextSpanOwnershipFields<never, never>[] = Object.freeze([]);
ownedSpanData.set(EMPTY_SPANS, { kind: 'owned-empty' });

/** @internal Snapshot text span records and styles while retaining equal identities from an owned prior array. */
export function ownTextSpanRecords<Font, Material>(
  previous: readonly TextSpanOwnershipFields<Font, Material>[] | undefined,
  spans: readonly TextSpanOwnershipFields<Font, Material>[],
  mode: TextSpanOwnershipMode,
): readonly TextSpanOwnershipFields<Font, Material>[] {
  const priorProof = previous === undefined ? undefined : ownedSpanData.get(previous);
  const prior = priorProof === undefined ? undefined : previous;
  const inputProof = ownedSpanData.get(spans);
  const coreMode = mode.kind === 'core' ? mode : undefined;

  if (spans.length === 0) {
    if (prior?.length === 0) return prior;
    if (inputProof?.kind === 'owned-empty') return spans;
    return EMPTY_SPANS;
  }

  const adoptOwned = coreMode !== undefined && inputProof !== undefined;
  const adoptProof = adoptOwned ? inputProof : undefined;
  if (
    adoptProof !== undefined &&
    coreMode !== undefined &&
    adoptProof.kind === 'owned-ranges' &&
    adoptProof.textLength === coreMode.textLength &&
    (coreMode.featureScopeLabel === undefined || adoptProof.featureScope === true)
  ) {
    return spans;
  }

  const checkSpanObject = coreMode !== undefined && !adoptOwned;
  const inputRangeProofMatchesText =
    coreMode !== undefined && inputProof?.kind === 'owned-ranges' && inputProof.textLength === coreMode.textLength;
  const rangeLimit =
    coreMode !== undefined && (!adoptOwned || !inputRangeProofMatchesText) ? coreMode.textLength : undefined;
  const featureScopeLabel = coreMode?.featureScopeLabel;
  const spanStylePrefix = coreMode === undefined ? 'Text' : 'text';
  const scopeAlreadyProven = adoptProof?.kind === 'owned-ranges' && adoptProof.featureScope === true;
  let owned: TextSpanOwnershipFields<Font, Material>[] | undefined = adoptOwned
    ? undefined
    : prior?.length === spans.length
      ? undefined
      : [];
  let featureScopeUnchanged =
    coreMode !== undefined && priorProof?.kind === 'owned-ranges' && priorProof.featureScope === true;
  for (const [index, span] of spans.entries()) {
    if (checkSpanObject && (typeof span !== 'object' || span === null || Array.isArray(span))) {
      throw new TypeError(`text span ${index} must be an object`);
    }
    const start = span.start;
    const end = span.end;
    if (rangeLimit !== undefined) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        throw new TypeError(`text span ${index} bounds must be safe integers`);
      }
      if (start < 0 || end < start || end > rangeLimit) {
        throw new RangeError(`text span ${index} is outside the text`);
      }
    }

    const previousRecord = adoptOwned ? undefined : prior?.[index];
    const statedStyle = span.style;
    const style =
      statedStyle === undefined
        ? undefined
        : adoptOwned
          ? statedStyle
          : reuseOrCreateTextStyleSnapshot(
              previousRecord?.style,
              statedStyle,
              featureScopeLabel ?? `${spanStylePrefix} span ${index} style`,
            );
    if (featureScopeLabel !== undefined && !scopeAlreadyProven && style !== undefined) {
      assertTextStyleFeatureRanges(style, start, end, featureScopeLabel);
    }
    const font = span.font;
    const material = span.material;
    if (adoptOwned) continue;
    if (
      featureScopeUnchanged &&
      (previousRecord === undefined ||
        previousRecord.start !== start ||
        previousRecord.end !== end ||
        previousRecord.style !== style)
    ) {
      featureScopeUnchanged = false;
    }
    if (
      previousRecord !== undefined &&
      previousRecord.start === start &&
      previousRecord.end === end &&
      previousRecord.font === font &&
      previousRecord.material === material &&
      previousRecord.style === style
    ) {
      owned?.push(previousRecord);
      continue;
    }
    if (owned === undefined) owned = prior!.slice(0, index);
    owned.push(makeOwnedSpan(start, end, font, material, style));
  }

  if (adoptProof !== undefined && coreMode !== undefined) {
    const featureScope =
      featureScopeLabel !== undefined || (adoptProof.kind === 'owned-ranges' && adoptProof.featureScope === true);
    ownedSpanData.set(
      spans,
      featureScope
        ? { kind: 'owned-ranges', textLength: coreMode.textLength, featureScope: true }
        : { kind: 'owned-ranges', textLength: coreMode.textLength },
    );
    return spans;
  }

  const result = owned === undefined ? prior! : Object.freeze(owned);
  if (coreMode !== undefined) {
    const featureScope = featureScopeLabel !== undefined || featureScopeUnchanged;
    ownedSpanData.set(
      result,
      featureScope
        ? { kind: 'owned-ranges', textLength: coreMode.textLength, featureScope: true }
        : { kind: 'owned-ranges', textLength: coreMode.textLength },
    );
  } else if (result !== prior) {
    ownedSpanData.set(result, { kind: 'owned-styles' });
  }
  return result;
}

/** @internal Read and own a retained text envelope or plain string through the core span policy. */
export function ownTextInput<Font, Material>(
  input: string | TextInputOwnershipFields<Font, Material>,
  previous?: TextInputOwnershipFields<Font, Material>,
): TextInputOwnershipFields<Font, Material> {
  if (typeof input === 'string') {
    const spans = ownTextSpanRecords(previous?.spans, EMPTY_SPANS, { kind: 'core', textLength: input.length });
    return Object.freeze({ text: input, spans });
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('text must be a string or formatted text value');
  }
  const text = input.text;
  if (typeof text !== 'string') throw new TypeError('text must be a string or formatted text value');
  const statedSpans = input.spans;
  if (!Array.isArray(statedSpans)) throw new TypeError('text must be a string or formatted text value');
  const spans = ownTextSpanRecords(previous?.spans, statedSpans, { kind: 'core', textLength: text.length });
  return Object.freeze({ text, spans });
}

/** @internal Project bindings while transferring only exact-array span-data proof. */
export function mapTextSpanBindings<Font, Material, BoundFont, BoundMaterial>(
  sourceSpans: readonly TextSpanOwnershipFields<Font, Material>[],
  bind: {
    readonly font: (font: Font) => BoundFont;
    readonly material: (material: Material) => BoundMaterial;
  },
): readonly TextSpanOwnershipFields<BoundFont, BoundMaterial>[] {
  const sourceProof = ownedSpanData.get(sourceSpans);
  if (sourceSpans.length === 0 && sourceProof?.kind === 'owned-empty') return EMPTY_SPANS;
  const projected: TextSpanOwnershipFields<BoundFont, BoundMaterial>[] = [];
  for (const span of sourceSpans) {
    const font = span.font;
    const mappedFont = font === undefined ? undefined : bind.font(font);
    const material = span.material;
    const mappedMaterial = material === undefined ? undefined : bind.material(material);
    const start = span.start;
    const end = span.end;
    const style = span.style;
    projected.push(makeOwnedSpan(start, end, mappedFont, mappedMaterial, style));
  }
  const result = Object.freeze(projected);
  if (sourceProof !== undefined) ownedSpanData.set(result, sourceProof);
  return result;
}

function makeOwnedSpan<Font, Material>(
  start: number,
  end: number,
  font: Font | undefined,
  material: Material | undefined,
  style: TextStyle | undefined,
): TextSpanOwnershipFields<Font, Material> {
  return Object.freeze({
    start,
    end,
    ...(font === undefined ? {} : { font }),
    ...(material === undefined ? {} : { material }),
    ...(style === undefined ? {} : { style }),
  });
}
