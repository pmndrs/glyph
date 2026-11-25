import { Pixi3DRenderer, zeroAnchor } from './internal/renderer.js';
import { Pixi3DTextSnapshot } from './detached.js';
import type {
  BorrowedGlyphLayout,
  Constraints,
  Font,
  FontFaceRasterOf,
  FontFaceSelection,
  GlyphHandleFonts,
  GlyphKey,
  LayoutBox,
  LayoutPoint,
  TextFlow,
  GlyphLayoutInspection,
  GlyphRootServices,
  GlyphTextController,
  ParagraphLayout,
  ParagraphLayoutSummary,
  RasterFormatRequest,
  TextCaret,
  TextDirection,
  TextMovement,
  TextPosition,
  TextRange,
  TextStyle,
  TextInput,
  TextUnit,
} from '../index.js';
import { bitmap } from '../raster/bitmap.js';
import { msdf } from '../raster/msdf.js';
import { slug } from '../raster/slug.js';
import { Box, Container3D, type Destroy3DOptions, Mesh3D } from '@pixi/3d';
import { createGlyphPlacements } from '../glyph-placement.js';
import { GlyphInputError, glyphInputError, validatingInput } from '../glyph-error.js';
import type { RenderFailures } from '../render-failures.js';
import { replaceInText } from '../text-editing.js';

import type { Pixi3DBindings, Pixi3DRootBoundary } from './internal/bindings.js';
import { isPixi3DTextMaterial, type Pixi3DTextMaterial } from './material.js';

export type Pixi3DFontSelection = FontFaceSelection<
  typeof bitmap | typeof msdf | typeof slug | RasterFormatRequest<typeof bitmap | typeof msdf | typeof slug> | undefined
>;

export interface Pixi3DTextOptions<Selection extends Pixi3DFontSelection = Pixi3DFontSelection> {
  readonly font: Selection;
  readonly text: TextInput<FontFaceRasterOf<Selection>>;
  /** Construction-fixed Pixi3D shader bits and their independently mutable material data. */
  readonly material?: Pixi3DTextMaterial;
  readonly style?: TextStyle;
  readonly layout?: ParagraphLayout;
  readonly constraints?: Constraints;
  readonly flow?: TextFlow | undefined;
  readonly rasterPixelRatio?: number;
  /**
   * Rounds each Bitmap glyph quad's corners, and the text's decorations, onto whole physical pixels after the camera
   * projection: sharp at rest, but animated motion moves in whole-pixel steps. MSDF and Slug glyphs ignore it. Off by
   * default and fixed at construction; an unsnapped text compiles the materials it did before the option existed.
   */
  readonly pixelSnapping?: boolean;
}

export type Pixi3DTextUpdate<Selection extends Pixi3DFontSelection = Pixi3DFontSelection> = Partial<
  Omit<Pixi3DTextOptions<Selection>, 'material' | 'pixelSnapping'>
>;

/** One desired glyph in logical Text-local space (+X right, +Y down), including anchor placement. Native Container3D coordinates use +Y up. */
export interface Pixi3DGlyphMeasurement {
  readonly key: GlyphKey;
  readonly index: number;
  readonly cluster: number;
  readonly line: number;
  readonly x: number;
  readonly y: number;
  readonly advance: number;
  readonly ink: LayoutBox;
  readonly bounds: LayoutBox;
}

export class Pixi3DText<Selection extends Pixi3DFontSelection = Pixi3DFontSelection> extends Container3D {
  readonly #fonts: GlyphHandleFonts;
  readonly #services: GlyphRootServices<Pixi3DBindings, void, Pixi3DRootBoundary>;
  #controller: GlyphTextController<FontFaceRasterOf<Selection>, Pixi3DBindings['materialInput'], Pixi3DText>;
  #font: Font<FontFaceRasterOf<Selection>>;
  readonly #material: Pixi3DTextMaterial | undefined;
  readonly #pixelSnapping: boolean;
  #state: Pixi3DTextOptions<Selection>;
  #disposed = false;
  #preparedAnchor: LayoutPoint = zeroAnchor;
  #acceptedAnchor: LayoutPoint = zeroAnchor;
  /** The refusal this text last deferred to its root's next accepted `glyph.shape()`. */
  #deferredRefusal: unknown;

  constructor(
    fonts: GlyphHandleFonts,
    services: GlyphRootServices<Pixi3DBindings, void, Pixi3DRootBoundary>,
    options: Pixi3DTextOptions<Selection>,
    private readonly releaseMembership?: () => void,
  ) {
    super({ label: 'Glyph Pixi3D Text', hitVolume: 'box' });
    assertTextOptions(options);
    this.#fonts = fonts;
    this.#services = services;
    this.#material = options.material;
    this.#pixelSnapping = options.pixelSnapping === true;
    this.#state = options;
    this.#font = validatingInput(['font'], () => fonts.acquire(options.font));
    try {
      // The core validates style, layout, constraints, flow and text units together; a refusal names no one input.
      this.#controller = validatingInput([], () => services.createText(this.#coreState(options, this.#font)));
    } catch (error) {
      this.#font.dispose();
      throw error;
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * @internal Stage placement before renderer preparation; omitted anchors do not issue a query. A refusal not yet
   * deferred is handed to the root, which throws it once from its accepted publication.
   */
  preparePublication(failures: RenderFailures): void {
    const refusal = this.#controller.refusal;
    if (refusal !== this.#deferredRefusal) {
      this.#deferredRefusal = refusal;
      if (refusal !== undefined) failures.defer(refusal);
    }
    // A text the engine refused has no layout to anchor; it draws nothing until its input changes.
    this.#preparedAnchor =
      refusal !== undefined || this.#state.constraints?.anchor === undefined ? zeroAnchor : this.measure().anchorOffset;
  }
  /** @internal The renderer translates only its owned meshes using accepted placement. */
  get acceptedAnchor(): LayoutPoint {
    return this.#acceptedAnchor;
  }
  /** @internal Root acceptance moves the owned meshes to the prepared anchor without rebuilding them. */
  acceptPublication(): void {
    this.#acceptedAnchor = this.#preparedAnchor;
  }

  get material(): Pixi3DTextMaterial | undefined {
    return this.#material;
  }
  /** @internal The renderer realizes a snapped text's Bitmap and decoration draws with the snap bit. */
  get pixelSnapping(): boolean {
    return this.#pixelSnapping;
  }

  get text(): TextInput<FontFaceRasterOf<Selection>> {
    return this.#state.text;
  }
  set text(value: TextInput<FontFaceRasterOf<Selection>>) {
    this.update({ text: value });
  }
  get font(): Selection {
    return this.#state.font;
  }
  set font(value: Selection) {
    this.update({ font: value });
  }
  get style(): NonNullable<Pixi3DTextOptions<Selection>['style']> {
    return this.#state.style ?? {};
  }
  set style(value: NonNullable<Pixi3DTextOptions<Selection>['style']>) {
    this.update({ style: value });
  }
  get layout(): ParagraphLayout {
    return this.#state.layout ?? {};
  }
  set layout(value: ParagraphLayout) {
    this.update({ layout: value });
  }
  get constraints(): Constraints {
    return this.#state.constraints ?? {};
  }
  set constraints(value: Constraints) {
    this.update({ constraints: value });
  }
  get flow(): TextFlow | undefined {
    return this.#state.flow;
  }
  set flow(value: TextFlow | undefined) {
    this.update({ flow: value });
  }
  get rasterPixelRatio(): number {
    return this.#state.rasterPixelRatio ?? 1;
  }
  set rasterPixelRatio(value: number) {
    this.update({ rasterPixelRatio: value });
  }
  /** GPU geometry bytes referenced by this text; shared buffers count once within this text. */
  get gpuBytes(): number {
    const buffers = new Set<import('pixi.js').Buffer>();
    for (const child of this.children)
      if (child instanceof Mesh3D) {
        for (const attribute of Object.values(child.geometry.attributes)) buffers.add(attribute.buffer);
        if (child.geometry.indexBuffer !== undefined) buffers.add(child.geometry.indexBuffer);
      }
    return [...buffers].reduce((total, buffer) => total + buffer.data.byteLength, 0);
  }

  /** Every value an update refuses is a `GlyphInputError`; one the validators did not place names the property written. */
  update(update: Pixi3DTextUpdate<Selection>): void {
    try {
      this.#applyUpdate(update);
    } catch (error) {
      const keys = typeof update === 'object' && update !== null ? Object.keys(update) : [];
      throw glyphInputError(keys.length === 1 ? keys : [], error);
    }
  }

  #applyUpdate(update: Pixi3DTextUpdate<Selection>): void {
    this.#assertActive();
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new TypeError('Pixi3D text update must be an object');
    }
    if ('material' in update) throw new TypeError('Pixi3D text material is fixed at construction');
    if ('pixelSnapping' in update) throw new TypeError('Pixi3D text pixelSnapping is fixed at construction');
    const next = { ...this.#state, ...update };
    assertTextOptions(next);
    const nextFont = next.font === this.#state.font ? this.#font : this.#fonts.acquire(next.font);
    try {
      this.#controller.update(this.#coreState(next, nextFont));
    } catch (error) {
      if (nextFont !== this.#font) nextFont.dispose();
      throw error;
    }
    if (nextFont !== this.#font) this.#font.dispose();
    this.#font = nextFont;
    const anchorChanged = next.constraints?.anchor !== this.#state.constraints?.anchor;
    this.#state = next;
    if (anchorChanged) this.#services.invalidate();
  }

  /** Allocation-light desired metrics in unanchored paragraph space (top-left, +X right, +Y down).
   * `anchorOffset` describes host placement; it does not shift these metrics or include native transforms.
   */
  measure(): ParagraphLayoutSummary {
    this.#assertActive();
    return this.#controller.measure();
  }

  /** Desired metrics with positioned ink bounds in unanchored paragraph space (+Y down). Positions glyphs for the query without publishing native meshes. */
  measureInk(): ParagraphLayoutSummary {
    this.#assertActive();
    return this.#controller.measureInk();
  }

  /** Desired anchored ink bounds in this Container3D's native local XY space (+X right, +Y up), before its transform or ancestors. Rejected draws may still show older accepted geometry. */
  computeBoundingBox(): Box {
    const measurement = this.measureInk();
    const ink = measurement.inkBounds;
    const offset = measurement.anchorOffset;
    const box = new Box();
    if (ink !== undefined) {
      box.min.set(ink.x + offset.x, -(ink.y + offset.y + ink.height), 0);
      box.max.set(ink.x + offset.x + ink.width, -(ink.y + offset.y), 0);
    }
    return box;
  }
  /** Copies desired glyph positions/boxes in anchored logical Text-local space (+X right, +Y down), before native transforms. Raw glyphs() stays paragraph-local. */
  measureGlyphs(): readonly Pixi3DGlyphMeasurement[] {
    const placements = this.#placements();
    const offset = placements.layout.anchorOffset;
    if (offset.x === 0 && offset.y === 0) return placements.glyphs;
    return Object.freeze(
      placements.glyphs.map((glyph) =>
        Object.freeze({
          ...glyph,
          x: glyph.x + offset.x,
          y: glyph.y + offset.y,
          ink: anchoredBox(glyph.ink, offset),
          bounds: anchoredBox(glyph.bounds, offset),
        }),
      ),
    );
  }
  /** Where the caret of a position is drawn, in anchored logical Text-local space (+Y down), before native transforms. Throws `TextOffsetError` for an offset that is not on a grapheme boundary of the text. */
  caret(position: TextPosition): TextCaret {
    this.#assertActive();
    return this.#controller.editing.caret(position);
  }
  /** The caret stop nearest a point in anchored logical Text-local space; the point may be between lines or outside the text. */
  hitTest(point: LayoutPoint): TextPosition {
    this.#assertActive();
    return this.#controller.editing.hitTest(point);
  }
  /** Moves a position one unit: `forward`/`backward` logically, `left`/`right` visually across bidi runs, `up`/`down` by line toward `goalX`. */
  move(position: TextPosition, direction: TextDirection, unit: TextUnit, goalX?: number): TextMovement {
    this.#assertActive();
    return this.#controller.editing.move(position, direction, unit, goalX);
  }
  /** The grapheme, word, sentence or line that contains a position. */
  boundary(position: TextPosition, unit: TextUnit): TextRange {
    this.#assertActive();
    return this.#controller.editing.boundary(position, unit);
  }
  /** The rectangles covering `[start, end)` in anchored logical Text-local space (+Y down), before native transforms. */
  rangeRects(start: number, end: number): readonly LayoutBox[] {
    this.#assertActive();
    return this.#controller.editing.rangeRects(start, end);
  }
  /**
   * Replaces UTF-16 code units `[start, end)` of the text with `insert`. Both offsets must be grapheme
   * boundaries of the current text, or `TextOffsetError` is thrown and nothing changes. Spans follow the edit:
   * inserted text takes the style of the grapheme before it.
   */
  replace(start: number, end: number, insert: string): void {
    this.#assertActive();
    if (typeof insert !== 'string') throw new GlyphInputError(['insert'], 'replace() insert must be a string');
    const range = this.#controller.editing.beginReplace(start, end, insert);
    const current = this.#state.text;
    const next =
      typeof current === 'string'
        ? replaceInText(current, [], range, insert)
        : replaceInText(current.text, current.spans, range, insert);
    this.update({
      text: (next.spans.length === 0 ? next.text : next) as TextInput<FontFaceRasterOf<Selection>>,
    });
  }
  #placements() {
    const layout = this.glyphs();
    return createGlyphPlacements(layout, plainText(this.#state.text), layout.x, layout.y, []);
  }

  /** Copies desired glyph/line columns in unanchored paragraph space (top-left, +X right, +Y down); native draw acceptance and transforms do not affect the query. */
  glyphs(): GlyphLayoutInspection {
    this.#assertActive();
    return this.#controller.inspect();
  }

  /** Borrows desired unanchored paragraph columns (+X right, +Y down) for the callback, avoiding the full glyph-array copy; the view expires on return. */
  readGlyphs<Result>(read: (glyphs: BorrowedGlyphLayout) => Result): Result {
    this.#assertActive();
    return this.#controller.readGlyphs(read);
  }

  /** Copies drawable desired glyphs into independently transformable children plus a decoration snapshot.
   * Snapshot roots copy this object's local transform and origin; child positions include the captured anchor once.
   * Attach the roots to the same parent for an exact replacement, without adding the anchor again.
   * Each child uses native +Y up and starts at its anchored pen origin, so local rotation/scale pivots there.
   * Queries/copies reflect desired state even after a rejected draw. Resources survive later source edits/disposal;
   * splitting allocates separate meshes and can increase draws. Dispose both returned snapshots independently.
   */
  split(): readonly [glyphs: Pixi3DTextSnapshot, decorations: Pixi3DTextSnapshot | undefined] {
    this.#assertActive();
    const placements = this.#placements();
    const incomplete = new Set(placements.incomplete);
    const drawable = placements.glyphs.filter((glyph) => !incomplete.has(glyph.index));
    if (drawable.length === 0) throw new Error('cannot split text with no drawable glyphs');
    const glyphs = new Pixi3DTextSnapshot();
    const decorations = new Pixi3DTextSnapshot();
    this.updateLocalTransform();
    for (const snapshot of [glyphs, decorations]) {
      snapshot.position.copyFrom(this.position);
      snapshot.scale.copyFrom(this.scale);
      snapshot.rotation.copyFrom(this.rotation);
      snapshot.quaternion.copyFrom(this.quaternion);
      snapshot.origin.copyFrom(this.origin);
    }
    const copy = (
      target: Container3D,
      request: import('../index.js').GlyphCopyRequest,
      owner: Pixi3DTextSnapshot,
      offset: LayoutPoint = placements.layout.anchorOffset,
    ) => {
      const renderer = new Pixi3DRenderer(target, offset);
      try {
        owner.retain(this.#services.copy(this.#controller, request, { boundary: { name: undefined }, renderer }));
      } catch (error) {
        renderer.dispose();
        throw error;
      }
    };
    try {
      for (const glyph of drawable) {
        const target = new Container3D();
        const anchor = placements.layout.anchorOffset;
        target.position.set(glyph.x + anchor.x, -(glyph.y + anchor.y), 0);
        glyphs.addChild(target);
        copy(
          target,
          { kind: 'glyphs', stableIds: new Uint32Array([placements.layout.glyphStableIds[glyph.index]!]) },
          glyphs,
          // Copied geometry retains paragraph coordinates; make its pen the child's local zero.
          { x: -glyph.x, y: -glyph.y },
        );
      }
      copy(decorations, { kind: 'decorations' }, decorations);
      if (decorations.children.length === 0) {
        decorations.dispose();
        return Object.freeze([glyphs, undefined]);
      }
      return Object.freeze([glyphs, decorations]);
    } catch (error) {
      decorations.dispose();
      glyphs.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    // Core rejects disposal during publication before changing its controller or leases.
    this.#controller.dispose();
    this.#disposed = true;
    this.releaseMembership?.();
    this.#font.dispose();
  }

  override destroy(options?: Destroy3DOptions): void {
    this.dispose();
    super.destroy(options);
  }

  #coreState(state: Pixi3DTextOptions<Selection>, font: Font<FontFaceRasterOf<Selection>>) {
    return {
      font,
      text: state.text,
      transform: this,
      ...(state.style === undefined ? {} : { style: state.style }),
      ...(state.layout === undefined ? {} : { layout: state.layout }),
      ...(state.constraints === undefined ? {} : { constraints: state.constraints }),
      ...(state.flow === undefined ? {} : { flow: state.flow }),
      ...(state.rasterPixelRatio === undefined ? {} : { rasterPixelRatio: state.rasterPixelRatio }),
    };
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Pixi3D text is disposed');
  }
}

/** Refuses options with the `GlyphInputError` path Three reports for the same input. */
function assertTextOptions<Selection extends Pixi3DFontSelection>(options: Pixi3DTextOptions<Selection>): void {
  validatingInput([], () => {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('Pixi3D text options must be an object');
    }
  });
  validatingInput(['text'], () => {
    if (typeof options.text === 'string') return;
    if (
      typeof options.text !== 'object' ||
      options.text === null ||
      typeof options.text.text !== 'string' ||
      !Array.isArray(options.text.spans)
    ) {
      throw new TypeError('Pixi3D text content must be a string or formatted text');
    }
  });
  validatingInput(['material'], () => {
    if (options.material !== undefined && !isPixi3DTextMaterial(options.material)) {
      throw new TypeError('Pixi3D text material must be a Pixi3DTextMaterial');
    }
  });
  validatingInput(['pixelSnapping'], () => {
    if (options.pixelSnapping !== undefined && typeof options.pixelSnapping !== 'boolean') {
      throw new TypeError('Pixi3D text pixelSnapping must be a boolean');
    }
  });
}

function plainText(input: string | { readonly text: string }): string {
  return typeof input === 'string' ? input : input.text;
}

function anchoredBox(box: LayoutBox, offset: LayoutPoint): LayoutBox {
  if (offset.x === 0 && offset.y === 0) return box;
  return Object.freeze({ ...box, x: box.x + offset.x, y: box.y + offset.y });
}
