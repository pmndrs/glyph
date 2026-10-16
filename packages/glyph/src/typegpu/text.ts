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
import type { bitmap } from '../raster/bitmap.js';
import type { msdf } from '../raster/msdf.js';
import type { slug } from '../raster/slug.js';
import type { Bindings } from './internal/bindings.js';
import type { TypeGpuTransform } from './internal/renderer.js';
import { PostCommitError } from '../glyph-error.js';

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
}
export type TypeGpuTextUpdate<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> = Partial<
  TypeGpuTextOptions<Selection>
>;
type TypeGpuSemanticTextOptions<Selection extends TypeGpuFontSelection> = Omit<
  TypeGpuTextOptions<Selection>,
  'position'
>;
type TypeGpuSemanticTextKey = Exclude<keyof TypeGpuTextOptions, 'position'>;
const semanticUpdateKeys = {
  font: 'font',
  text: 'text',
  style: 'style',
  layout: 'layout',
  constraints: 'constraints',
  rasterPixelRatio: 'rasterPixelRatio',
} as const satisfies { readonly [Key in TypeGpuSemanticTextKey]: Key };

/** Retained text. Create with a configured TypeGPU handle's createText(). */
export interface TypeGpuText<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly disposed: boolean;
  update(update: TypeGpuTextUpdate<Selection>): void;
  measure(): ParagraphLayoutSummary;
  glyphs(): GlyphLayoutInspection;
  /** Synchronously reads indexed glyph data and returns the callback's result. The view expires when the callback exits; repeated unchanged reads may retain one private canonical snapshot. */
  readGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result;
  dispose(): void;
}

/** @internal Private host publication hooks; the application sees only text. */
export interface TypeGpuTextPublication<Selection extends TypeGpuFontSelection = TypeGpuFontSelection> {
  readonly text: TypeGpuText<Selection>;
  prepare(): void;
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
  if (options.style?.decoration !== undefined) throw new TypeError('TypeGPU text decoration lines are not supported');
  const { position: _initialPosition, ...initialSemanticState } = options;
  let state: TypeGpuSemanticTextOptions<Selection> = initialSemanticState;
  validatePosition(options.position);
  let positionX = options.position?.[0] ?? 0;
  let positionY = options.position?.[1] ?? 0;
  const positionValue: [number, number] = [positionX, positionY];
  let font = fonts.acquire(options.font);
  let anchorX = 0;
  let anchorY = 0;
  let pendingAnchorX = 0;
  let pendingAnchorY = 0;
  let hasAuthoredAnchor = options.constraints?.anchor !== undefined;
  let semanticRevision = 0;
  let pendingSemantic = true;
  let prepared: { revision: number; x: number; y: number } | undefined;
  let controller: GlyphTextController<FontFaceRasterOf<Selection>, object, TypeGpuTransform>;
  let disposed = false;
  let acquiredController: typeof controller | undefined;
  const coreState = (next: TypeGpuSemanticTextOptions<Selection>, selected: Font<FontFaceRasterOf<Selection>>) => ({
    font: selected,
    text: next.text,
    transform,
    ...(next.style === undefined ? {} : { style: next.style }),
    ...(next.layout === undefined ? {} : { layout: next.layout }),
    ...(next.constraints === undefined ? {} : { constraints: next.constraints }),
    ...(next.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: next.rasterPixelRatio }),
  });
  try {
    writePosition(transform, positionValue, positionX, positionY);
    controller = services.createText(coreState(state, font));
    acquiredController = controller;
    if (state.constraints?.anchor !== undefined) {
      const offset = controller.measure().anchorOffset;
      anchorX = offset.x;
      anchorY = offset.y;
      pendingAnchorX = anchorX;
      pendingAnchorY = anchorY;
      writePosition(transform, positionValue, positionX + anchorX, positionY + anchorY);
    }
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
  const text: TypeGpuText<Selection> = {
    get disposed() {
      return disposed;
    },
    update(update) {
      assertActive();
      const updatesPosition = Object.hasOwn(update, 'position');
      if (updatesPosition) validatePosition(update.position);
      const nextPositionX = updatesPosition ? (update.position?.[0] ?? 0) : positionX;
      const nextPositionY = updatesPosition ? (update.position?.[1] ?? 0) : positionY;
      if (!hasSemanticUpdate(update)) {
        if (nextPositionX !== positionX || nextPositionY !== positionY) {
          writePosition(transform, positionValue, nextPositionX + anchorX, nextPositionY + anchorY);
          positionX = nextPositionX;
          positionY = nextPositionY;
        }
        return;
      }
      const { position: _position, ...semanticUpdate } = update;
      const next = { ...state, ...semanticUpdate };
      if (next.style?.decoration !== undefined) throw new TypeError('TypeGPU text decoration lines are not supported');
      const anchorsPresent = next.constraints?.anchor !== undefined || hasAuthoredAnchor;
      const previousMeasurement = anchorsPresent ? controller.measure() : undefined;
      const nextFont = next.font === state.font ? font : fonts.acquire(next.font);
      let nextMeasurement: ParagraphLayoutSummary | undefined;
      let failure: unknown;
      try {
        controller.update(coreState(next, nextFont));
      } catch (error) {
        if (error instanceof PostCommitError) failure = error;
        else {
          if (nextFont !== font) nextFont.dispose();
          throw error;
        }
      }
      if (anchorsPresent) {
        try {
          nextMeasurement = controller.measure();
        } catch (error) {
          if (failure === undefined) failure = error;
        }
      }
      const nextOffset =
        nextMeasurement?.anchorOffset ?? (anchorsPresent ? { x: pendingAnchorX, y: pendingAnchorY } : { x: 0, y: 0 });
      // The controller owns cache invalidation. Reused lines prove that only placement changed,
      // including when a caller supplies new objects or mutates an earlier authored object.
      const placementOnly =
        !pendingSemantic &&
        previousMeasurement !== undefined &&
        nextMeasurement !== undefined &&
        previousMeasurement.lines === nextMeasurement.lines &&
        previousMeasurement.width === nextMeasurement.width &&
        previousMeasurement.height === nextMeasurement.height;
      semanticRevision += 1;
      pendingAnchorX = nextOffset.x;
      pendingAnchorY = nextOffset.y;
      pendingSemantic = !placementOnly;
      const appliedAnchorX = placementOnly ? pendingAnchorX : anchorX;
      const appliedAnchorY = placementOnly ? pendingAnchorY : anchorY;
      const previousFont = font;
      font = nextFont;
      state = next;
      hasAuthoredAnchor = next.constraints?.anchor !== undefined;
      let positionFailure: unknown;
      let positionFailed = false;
      if (nextPositionX !== positionX || nextPositionY !== positionY || placementOnly) {
        try {
          writePosition(transform, positionValue, nextPositionX + appliedAnchorX, nextPositionY + appliedAnchorY);
          positionX = nextPositionX;
          positionY = nextPositionY;
          anchorX = appliedAnchorX;
          anchorY = appliedAnchorY;
        } catch (error) {
          positionFailure = error;
          positionFailed = true;
          if (placementOnly) pendingSemantic = true;
        }
      }
      if (nextFont !== previousFont) {
        try {
          previousFont.dispose();
        } catch (error) {
          if (failure === undefined) failure = error;
        }
      }
      if (positionFailed) throw positionFailure;
      if (failure !== undefined) throw failure;
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
    prepare() {
      prepared = pendingSemantic ? { revision: semanticRevision, x: pendingAnchorX, y: pendingAnchorY } : undefined;
    },
    accepted() {
      const accepted = prepared;
      prepared = undefined;
      if (disposed || accepted === undefined) return;
      if (anchorX !== accepted.x || anchorY !== accepted.y) {
        writePosition(transform, positionValue, positionX + accepted.x, positionY + accepted.y);
        anchorX = accepted.x;
        anchorY = accepted.y;
      }
      if (semanticRevision === accepted.revision) pendingSemantic = false;
    },
    rejected() {
      prepared = undefined;
    },
  };
}
function validatePosition(position: readonly [number, number] = [0, 0]): void {
  if (position.length !== 2 || !position.every(Number.isFinite))
    throw new RangeError('TypeGPU text position must contain two finite coordinates');
}

function writePosition(transform: TypeGpuTransform, value: [number, number], x: number, y: number): void {
  const previousX = value[0];
  const previousY = value[1];
  value[0] = x;
  value[1] = y;
  try {
    transform.position.write(value);
  } catch (error) {
    value[0] = previousX;
    value[1] = previousY;
    throw error;
  }
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
