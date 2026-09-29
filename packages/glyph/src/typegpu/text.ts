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
  /** Reads indexed glyph data through a callback-scoped view; repeated unchanged reads may retain one private canonical snapshot. */
  withGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result;
  dispose(): void;
}

export function createText<Selection extends TypeGpuFontSelection>(
  fonts: GlyphHandleFonts,
  services: GlyphRootServices<Bindings, void, void>,
  transform: TypeGpuTransform,
  options: TypeGpuTextOptions<Selection>,
  onDispose: () => void,
): TypeGpuText<Selection> {
  if (options.style?.decoration !== undefined) throw new TypeError('TypeGPU text decoration lines are not supported');
  const { position: _initialPosition, ...initialSemanticState } = options;
  let state: TypeGpuSemanticTextOptions<Selection> = initialSemanticState;
  validatePosition(options.position);
  let positionX = options.position?.[0] ?? 0;
  let positionY = options.position?.[1] ?? 0;
  const positionValue: [number, number] = [positionX, positionY];
  let font = fonts.acquire(options.font);
  let controller: GlyphTextController<FontFaceRasterOf<Selection>, object, TypeGpuTransform>;
  let disposed = false;
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
  } catch (error) {
    font.dispose();
    throw error;
  }
  function assertActive(): void {
    if (disposed) throw new Error('TypeGPU text is disposed');
  }
  return {
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
          writePosition(transform, positionValue, nextPositionX, nextPositionY);
          positionX = nextPositionX;
          positionY = nextPositionY;
        }
        return;
      }
      const { position: _position, ...semanticUpdate } = update;
      const next = { ...state, ...semanticUpdate };
      if (next.style?.decoration !== undefined) throw new TypeError('TypeGPU text decoration lines are not supported');
      const nextFont = next.font === state.font ? font : fonts.acquire(next.font);
      try {
        controller.update(coreState(next, nextFont));
      } catch (error) {
        if (nextFont !== font) nextFont.dispose();
        throw error;
      }
      if (nextPositionX !== positionX || nextPositionY !== positionY) {
        writePosition(transform, positionValue, nextPositionX, nextPositionY);
        positionX = nextPositionX;
        positionY = nextPositionY;
      }
      if (nextFont !== font) font.dispose();
      font = nextFont;
      state = next;
    },
    measure() {
      assertActive();
      return controller.measure();
    },
    glyphs() {
      assertActive();
      return controller.inspect();
    },
    withGlyphs(read) {
      assertActive();
      return controller.withGlyphs(read);
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
}
function validatePosition(position: readonly [number, number] = [0, 0]): void {
  if (position.length !== 2 || !position.every(Number.isFinite))
    throw new RangeError('TypeGPU text position must contain two finite coordinates');
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
