import {
  replaceInText,
  type TextCaret,
  type TextDirection,
  type TextMovement,
  type TextPosition,
  type TextRange,
  type TextUnit,
} from '../text-editing.js';
import type {
  Font,
  FontFaceRasterOf,
  FontFaceSelection,
  GlyphHandleFonts,
  GlyphRootServices,
  GlyphTextController,
  BorrowedGlyphLayout,
  ParagraphLayoutSummary,
  GlyphLayoutInspection,
  RasterFormatRequest,
  TextStyle,
  ParagraphLayout,
  Constraints,
} from '../index.js';
import type { LayoutBox, LayoutPoint } from '../layout.js';
import type { bitmap } from '../raster/bitmap.js';
import type { msdf } from '../raster/msdf.js';
import type { slug } from '../raster/slug.js';
import type { Bindings } from './internal/bindings.js';
import type { TypeGpuTransform } from './internal/renderer.js';
import { reuseOrCreateTextPropertySnapshot, reuseOrCreateTextStyleSnapshot } from '../config/text-property.js';
import { GlyphInputError, glyphInputError, PostCommitError, validatingInput } from '../glyph-error.js';
import { sameConstraintSizes } from '../text-anchor.js';

export type TypeGpuFontSelection = FontFaceSelection<
  | typeof bitmap
  | typeof msdf
  | typeof slug
  | RasterFormatRequest<typeof bitmap>
  | RasterFormatRequest<typeof msdf>
  | RasterFormatRequest<typeof slug>
  | undefined
>;
export interface TypeGpuTextOptions<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly font: Selection;
  readonly text: string;
  readonly style?: Omit<TextStyle, 'decoration'> & { readonly decoration?: never };
  readonly layout?: ParagraphLayout;
  readonly constraints?: Constraints;
  readonly rasterPixelRatio?: number;
  /** Pixel coordinates relative to the upper-left corner of the viewport. */
  readonly position?: readonly [number, number];
  /** See {@link TypeGpuText.onLayout}. */
  readonly onLayout?: TypeGpuLayoutCallback<Selection>;
  /** See {@link TypeGpuText.onError}. */
  readonly onError?: (error: unknown) => void;
}

/** A layout callback: the text and what its `measure()` returns. */
export type TypeGpuLayoutCallback<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> = (
  text: TypeGpuText<Selection>,
  layout: ParagraphLayoutSummary,
) => void;
export type TypeGpuTextUpdate<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> = Partial<
  Omit<TypeGpuTextOptions<Selection>, 'onLayout' | 'onError'>
>;
type TypeGpuSemanticTextOptions<Selection extends TypeGpuFontSelection> = Omit<
  TypeGpuTextOptions<Selection>,
  'position' | 'style' | 'onLayout' | 'onError'
> & { readonly style?: TextStyle };
type TypeGpuSemanticTextKey = Exclude<keyof TypeGpuTextOptions, 'position' | 'onLayout' | 'onError'>;
const semanticUpdateKeys = {
  font: 'font',
  text: 'text',
  style: 'style',
  layout: 'layout',
  constraints: 'constraints',
  rasterPixelRatio: 'rasterPixelRatio',
} as const satisfies { readonly [Key in TypeGpuSemanticTextKey]: Key };

function ownedSemanticState<Selection extends TypeGpuFontSelection>(
  previous: TypeGpuSemanticTextOptions<Selection> | undefined,
  next: TypeGpuSemanticTextOptions<Selection>,
): TypeGpuSemanticTextOptions<Selection> {
  return Object.freeze({
    ...next,
    ...(next.style === undefined
      ? {}
      : {
          style: validatingInput(['style'], () =>
            reuseOrCreateTextStyleSnapshot(previous?.style, next.style!, 'TypeGPU text style'),
          ),
        }),
    ...(next.layout === undefined
      ? {}
      : {
          layout: validatingInput(['layout'], () =>
            reuseOrCreateTextPropertySnapshot(previous?.layout, next.layout!, 'TypeGPU text layout'),
          ),
        }),
    ...(next.constraints === undefined
      ? {}
      : {
          constraints: validatingInput(['constraints'], () =>
            reuseOrCreateTextPropertySnapshot(previous?.constraints, next.constraints!, 'TypeGPU text constraints'),
          ),
        }),
  });
}

/** Retained text. Create with a configured TypeGPU handle's createText(). */
export interface TypeGpuText<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly disposed: boolean;
  /**
   * The error that keeps this text from being drawn, or `undefined`: the engine refused its last preparation.
   * It clears when the text's input changes. Siblings are unaffected.
   */
  readonly error: unknown;
  /**
   * Called with this text and what `measure()` returns, after the text is first prepared and whenever that
   * summary changes, inside `glyph.prepare()` or `glyph.shape()` and before anything is published. It may read
   * anything and write positions; writing a layout input of any text throws `GlyphLayoutPhaseError`.
   */
  onLayout: TypeGpuLayoutCallback<Selection> | undefined;
  /** Receives this text's refusal once, and any exception its layout callback throws. */
  onError: ((error: unknown) => void) | undefined;
  update(update: TypeGpuTextUpdate<Selection>): void;
  measure(): ParagraphLayoutSummary;
  glyphs(): GlyphLayoutInspection;
  /** Synchronously reads indexed glyph data and returns the callback's result. The view expires when the callback exits; repeated unchanged reads may retain one private canonical snapshot. */
  readGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result;
  /** Where the caret of a position is drawn, in Text-local coordinates (+X right, +Y down), anchor included. Throws `TextOffsetError` for an offset that is not on a grapheme boundary of the text. */
  caret(position: TextPosition): TextCaret;
  /** The caret stop nearest a point in Text-local coordinates; the point may be between lines or outside the text. */
  hitTest(point: LayoutPoint): TextPosition;
  /** Moves a position one unit: `forward`/`backward` logically, `left`/`right` visually across bidi runs, `up`/`down` by line toward `goalX`. */
  move(position: TextPosition, direction: TextDirection, unit: TextUnit, goalX?: number): TextMovement;
  /** The grapheme, word, sentence or line that contains a position. */
  boundary(position: TextPosition, unit: TextUnit): TextRange;
  /** The rectangles covering `[start, end)`: one per run of the range that is contiguous on its line. */
  rangeRects(start: number, end: number): readonly LayoutBox[];
  /** Replaces UTF-16 code units `[start, end)` with `insert`; both offsets must be grapheme boundaries of the current text. */
  replace(start: number, end: number, insert: string): void;
  dispose(): void;
}

/** @internal Private host publication hooks; the application sees only text. */
export interface TypeGpuTextPublication<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly text: TypeGpuText<Selection>;
  prepare(): void;
  /** Runs the layout callback if the summary is new; its exception is reported, never thrown. */
  layout(): void;
  accepted(): void;
  rejected(): void;
}

/** @internal Construct a private publication owner; the public root exposes only its text. */
export function createText<Selection extends TypeGpuFontSelection>(
  fonts: GlyphHandleFonts,
  services: GlyphRootServices<Bindings, void, void>,
  transform: TypeGpuTransform,
  options: TypeGpuTextOptions<Selection>,
  onDispose: () => void,
): TypeGpuTextPublication<Selection> {
  assertNoDecoration(options.style);
  const {
    position: _initialPosition,
    onLayout: initialOnLayout,
    onError: initialOnError,
    ...initialSemanticState
  } = options;
  let onLayout = initialOnLayout;
  let onError = initialOnError;
  let notifiedLayout: ParagraphLayoutSummary | undefined;
  let reportedRefusal: unknown;
  validatePosition(options.position);
  let state = ownedSemanticState<Selection>(undefined, initialSemanticState);
  let positionX = options.position?.[0] ?? 0;
  let positionY = options.position?.[1] ?? 0;
  const positionValue: [number, number] = [positionX, positionY];
  let font = fonts.acquire(options.font);
  let anchorX = 0;
  let anchorY = 0;
  let pendingAnchorX = 0;
  let pendingAnchorY = 0;
  let pendingAnchorNeedsMeasure = false;
  let hasAuthoredAnchor = state.constraints?.anchor !== undefined;
  let semanticRevision = 0;
  let pendingSemantic = true;
  let preparedRevision = -1;
  let preparedAnchorX = 0;
  let preparedAnchorY = 0;
  let controller: GlyphTextController<FontFaceRasterOf<Selection>, object, TypeGpuTransform>;
  let disposed = false;
  let acquiredController: typeof controller | undefined;
  try {
    writePosition(transform, positionValue, positionX, positionY);
    controller = services.createText(coreTextState(state, font, transform));
    acquiredController = controller;
    controller.keepMeasured = onLayout !== undefined;
    // An anchor is resolved from the batch preparation, so constructing a text never enters the engine.
    pendingAnchorNeedsMeasure = hasAuthoredAnchor;
  } catch (error) {
    try {
      acquiredController?.dispose();
    } finally {
      font.dispose();
    }
    throw error;
  }
  function assertActive(): void {
    if (disposed) throw new Error('TypeGPU text is disposed');
  }
  function applyUpdate(update: TypeGpuTextUpdate<Selection>): void {
    assertActive();
    const [nextPositionX, nextPositionY] = updatedPosition(update, positionX, positionY);
    if (!hasSemanticUpdate(update)) {
      if (nextPositionX !== positionX || nextPositionY !== positionY) {
        writePosition(transform, positionValue, nextPositionX + anchorX, nextPositionY + anchorY);
        positionX = nextPositionX;
        positionY = nextPositionY;
      }
      return;
    }
    const { position: _position, ...semanticUpdate } = update;
    const previousState = state;
    const nextInput = { ...previousState, ...semanticUpdate };
    assertNoDecoration(nextInput.style);
    const next = ownedSemanticState(previousState, nextInput);
    const wasPendingSemantic = pendingSemantic;
    // Only a re-anchoring of published text is placed at once; both reads answer from the prepared layout.
    const placesNow = isAnchorOnlyChange(previousState, next) && !wasPendingSemantic;
    const previousMeasurement = placesNow ? controller.measure() : undefined;
    const nextFont = next.font === previousState.font ? font : fonts.acquire(next.font);
    let failure: PostCommitError | undefined;
    try {
      controller.update(coreTextState(next, nextFont, transform));
    } catch (error) {
      if (error instanceof PostCommitError) failure = error;
      else {
        if (nextFont !== font) nextFont.dispose();
        throw error;
      }
    }
    // The controller has adopted this update, including a PostCommitError from its dirt callback.
    // Transfer the font lease and desired state before any requested query or host write can fail.
    const previousFont = font;
    font = nextFont;
    state = next;
    hasAuthoredAnchor = next.constraints?.anchor !== undefined;
    semanticRevision += 1;
    pendingSemantic = true;
    pendingAnchorNeedsMeasure = hasAuthoredAnchor;
    try {
      const nextMeasurement: ParagraphLayoutSummary | undefined = placesNow ? controller.measure() : undefined;
      if (nextMeasurement !== undefined || !hasAuthoredAnchor) {
        pendingAnchorX = nextMeasurement?.anchorOffset.x ?? 0;
        pendingAnchorY = nextMeasurement?.anchorOffset.y ?? 0;
        pendingAnchorNeedsMeasure = false;
      }
      const placementOnly = failure === undefined && keepsLayoutExtent(previousMeasurement, nextMeasurement);
      const appliedAnchorX = placementOnly ? pendingAnchorX : anchorX;
      const appliedAnchorY = placementOnly ? pendingAnchorY : anchorY;
      if (nextPositionX !== positionX || nextPositionY !== positionY || placementOnly) {
        writePosition(transform, positionValue, nextPositionX + appliedAnchorX, nextPositionY + appliedAnchorY);
        positionX = nextPositionX;
        positionY = nextPositionY;
      }
      if (placementOnly) {
        anchorX = pendingAnchorX;
        anchorY = pendingAnchorY;
        pendingSemantic = false;
      }
    } finally {
      if (nextFont !== previousFont) previousFont.dispose();
    }
    if (failure !== undefined) throw failure;
  }
  const text: TypeGpuText<Selection> = {
    get disposed() {
      return disposed;
    },
    get error() {
      return disposed ? undefined : controller.refusal;
    },
    get onLayout() {
      return onLayout;
    },
    set onLayout(value) {
      assertLayoutCallback(value);
      const began = onLayout === undefined && value !== undefined;
      onLayout = value;
      if (began && !disposed) {
        // A callback installed on text that is already drawn is told its current layout by the next shape().
        try {
          services.invalidate();
        } catch {
          // Inside a publication or the layout phase the root cannot be invalidated; the next change runs it.
        }
      }
      if (value === undefined) notifiedLayout = undefined;
      if (!disposed) controller.keepMeasured = value !== undefined;
    },
    get onError() {
      return onError;
    },
    set onError(value) {
      onError = value;
    },
    update(update) {
      try {
        applyUpdate(update);
      } catch (error) {
        throw updateInputError(update, error);
      }
    },
    measure() {
      assertActive();
      return controller.measure();
    },
    glyphs() {
      assertActive();
      return controller.inspect();
    },
    readGlyphs(read) {
      assertActive();
      return controller.readGlyphs(read);
    },
    caret(position) {
      assertActive();
      return controller.editing.caret(position);
    },
    hitTest(point) {
      assertActive();
      return controller.editing.hitTest(point);
    },
    move(position, direction, unit, goalX) {
      assertActive();
      return controller.editing.move(position, direction, unit, goalX);
    },
    boundary(position, unit) {
      assertActive();
      return controller.editing.boundary(position, unit);
    },
    rangeRects(start, end) {
      assertActive();
      return controller.editing.rangeRects(start, end);
    },
    replace(start, end, insert) {
      assertActive();
      if (typeof insert !== 'string') throw new GlyphInputError(['insert'], 'replace() insert must be a string');
      const range = controller.editing.beginReplace(start, end, insert);
      // TypeGPU text is plain: there are no spans to rebase.
      applyUpdate({ text: replaceInText(state.text, [], range, insert).text } as TypeGpuTextUpdate<Selection>);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        controller.dispose();
      } finally {
        font.dispose();
        // Accepted draws may still reference this transform until the next shape().
        onDispose();
      }
    },
  };
  return {
    text,
    layout() {
      if (disposed || onLayout === undefined || controller.refusal !== undefined) return;
      const layout = controller.preparedMeasurement();
      if (layout === undefined || sameLayout(notifiedLayout, layout)) return;
      notifiedLayout = layout;
      try {
        onLayout(text, layout);
      } catch (error) {
        reportTextError(onError, error);
      }
    },
    prepare() {
      const refusal = disposed ? undefined : controller.refusal;
      if (refusal !== reportedRefusal) {
        reportedRefusal = refusal;
        if (refusal !== undefined) reportTextError(onError, refusal);
      }
      // A text the engine refused has no layout to anchor; it draws nothing until its input changes.
      if (pendingAnchorNeedsMeasure && controller.refusal === undefined) {
        const offset = controller.measure().anchorOffset;
        pendingAnchorX = offset.x;
        pendingAnchorY = offset.y;
        pendingAnchorNeedsMeasure = false;
      }
      preparedRevision = pendingSemantic ? semanticRevision : -1;
      if (preparedRevision >= 0) {
        preparedAnchorX = pendingAnchorX;
        preparedAnchorY = pendingAnchorY;
      }
    },
    accepted() {
      const acceptedRevision = preparedRevision;
      if (disposed || acceptedRevision < 0) {
        preparedRevision = -1;
        return;
      }
      if (anchorX !== preparedAnchorX || anchorY !== preparedAnchorY) {
        try {
          writePosition(transform, positionValue, positionX + preparedAnchorX, positionY + preparedAnchorY);
        } catch (error) {
          // The renderer has accepted this revision; retry its host placement on the next explicit shape().
          services.invalidate();
          throw error;
        }
        anchorX = preparedAnchorX;
        anchorY = preparedAnchorY;
      }
      if (semanticRevision === acceptedRevision) pendingSemantic = false;
      preparedRevision = -1;
    },
    rejected() {
      preparedRevision = -1;
    },
  };
}
/** A value the validators did not place names the one property this update wrote. */
function updateInputError(update: unknown, error: unknown): unknown {
  const keys = typeof update === 'object' && update !== null ? Object.keys(update) : [];
  return glyphInputError(keys.length === 1 ? keys : [], error);
}

function assertLayoutCallback(value: unknown): void {
  if (value !== undefined && typeof value !== 'function')
    throw new TypeError('TypeGPU text onLayout must be a function');
}

function coreTextState<Selection extends TypeGpuFontSelection>(
  next: TypeGpuSemanticTextOptions<Selection>,
  selected: Font<FontFaceRasterOf<Selection>>,
  transform: TypeGpuTransform,
) {
  return {
    font: selected,
    text: next.text,
    transform,
    ...(next.style === undefined ? {} : { style: next.style }),
    ...(next.layout === undefined ? {} : { layout: next.layout }),
    ...(next.constraints === undefined ? {} : { constraints: next.constraints }),
    ...(next.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: next.rasterPixelRatio }),
  };
}

function assertNoDecoration(style: Pick<TextStyle, 'decoration'> | undefined): void {
  if (style?.decoration !== undefined) {
    throw new GlyphInputError(['style', 'decoration'], 'TypeGPU text decoration lines are not supported');
  }
}

/** The position an update asks for: its own when it names `position` (absent means the origin), else the current one. */
function updatedPosition<Selection extends TypeGpuFontSelection>(
  update: TypeGpuTextUpdate<Selection>,
  x: number,
  y: number,
): readonly [x: number, y: number] {
  if (!Object.hasOwn(update, 'position')) return [x, y];
  validatePosition(update.position);
  return [update.position?.[0] ?? 0, update.position?.[1] ?? 0];
}

/** Whether `next` differs from `previous` only by its constraints' anchor. */
function isAnchorOnlyChange<Selection extends TypeGpuFontSelection>(
  previous: TypeGpuSemanticTextOptions<Selection>,
  next: TypeGpuSemanticTextOptions<Selection>,
): boolean {
  return (
    previous.constraints?.anchor !== next.constraints?.anchor &&
    previous.font === next.font &&
    previous.text === next.text &&
    previous.style === next.style &&
    previous.layout === next.layout &&
    Object.is(previous.rasterPixelRatio, next.rasterPixelRatio) &&
    sameConstraintSizes(previous.constraints, next.constraints)
  );
}

/** Whether two measurements of one text keep its lines and extent, so only its placement moved. */
function keepsLayoutExtent(
  previous: ParagraphLayoutSummary | undefined,
  next: ParagraphLayoutSummary | undefined,
): boolean {
  return (
    previous !== undefined &&
    next !== undefined &&
    previous.lines === next.lines &&
    previous.width === next.width &&
    previous.height === next.height
  );
}

function sameLayout(previous: ParagraphLayoutSummary | undefined, next: ParagraphLayoutSummary): boolean {
  return (
    previous !== undefined &&
    (previous === next ||
      (previous.width === next.width &&
        previous.height === next.height &&
        previous.lineCount === next.lineCount &&
        previous.glyphCount === next.glyphCount &&
        previous.anchorOffset.x === next.anchorOffset.x &&
        previous.anchorOffset.y === next.anchorOffset.y))
  );
}

/** Tells a text's handler, or the host's global error reporting when it has none; never throws. */
function reportTextError(handler: ((error: unknown) => void) | undefined, error: unknown): void {
  try {
    if (handler !== undefined) handler(error);
    else (globalThis as { reportError?: (error: unknown) => void }).reportError?.(error);
  } catch {
    // A handler cannot replace the failure it is told about.
  }
}

function validatePosition(position: readonly [number, number] = [0, 0]): void {
  if (position.length !== 2 || !position.every(Number.isFinite))
    throw new GlyphInputError(['position'], 'TypeGPU text position must contain two finite coordinates');
}

function writePosition(transform: TypeGpuTransform, value: [number, number], x: number, y: number): void {
  value[0] = x;
  value[1] = y;
  transform.position.write(value);
}

function hasSemanticUpdate<Selection extends TypeGpuFontSelection>(update: TypeGpuTextUpdate<Selection>): boolean {
  return (
    Object.hasOwn(update, semanticUpdateKeys.font) ||
    Object.hasOwn(update, semanticUpdateKeys.text) ||
    Object.hasOwn(update, semanticUpdateKeys.style) ||
    Object.hasOwn(update, semanticUpdateKeys.layout) ||
    Object.hasOwn(update, semanticUpdateKeys.constraints) ||
    Object.hasOwn(update, semanticUpdateKeys.rasterPixelRatio)
  );
}
