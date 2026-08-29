import type {
  AnyRasterTechnique,
  AxisConstraint,
  Constraints,
  GlyphLayoutInspection,
  Paragraph,
  ParagraphLayout,
  ParagraphUpdate,
} from '@pmndrs/glyph';

export const YogaMeasureMode = Object.freeze({ Undefined: 0, Exactly: 1, AtMost: 2 });

type YogaMeasureModeValue = (typeof YogaMeasureMode)[keyof typeof YogaMeasureMode];
type Inset = readonly [top: number, right: number, bottom: number, left: number];
type Size = readonly [width: number, height: number];

/**
 * The current-uikit-shaped fixture over the real framework-neutral `Paragraph`.
 *
 * The host varies only axis constraints per probe -- stable paragraph layout lives in the
 * paragraph and changes through `update()` -- exactly the split a retained layout engine
 * needs. Measurement never materializes positioned arrays; the final resolved content box
 * is the only call that does.
 */
export function createUikitLayoutFixture<Technique extends AnyRasterTechnique>(
  paragraph: Paragraph<Technique>,
  layout: ParagraphLayout = {},
) {
  let currentLayout: ParagraphLayout = { ...layout };
  let dirtyCount = 1;
  let paintRevision = 0;
  let rasterRevision = 0;
  const calls = { measure: 0, layout: 0 };

  function customLayouting() {
    calls.measure += 1;
    const natural = paragraph.measure();
    return {
      // Intrinsic widths ride the natural measurement itself: no second query at zero width.
      minWidth: natural.minContentWidth,
      minHeight: natural.height,
      firstBaseline: natural.firstBaseline,
      measure(width: number, widthMode: YogaMeasureModeValue, height: number, heightMode: YogaMeasureModeValue) {
        calls.measure += 1;
        const metrics = paragraph.measure({
          width: mapYogaAxis(width, widthMode, 'width'),
          height: mapYogaAxis(height, heightMode, 'height'),
        });
        return {
          width: roundUpToPointScale(metrics.width),
          height: roundUpToPointScale(metrics.height),
        };
      },
    };
  }

  return {
    calls,
    get dirtyCount() {
      return dirtyCount;
    },
    get paintRevision() {
      return paintRevision;
    },
    get rasterRevision() {
      return rasterRevision;
    },
    get layout(): ParagraphLayout {
      return currentLayout;
    },
    get paragraph(): Paragraph<Technique> {
      return paragraph;
    },
    customLayouting,
    resolveYogaLeaf(width: number, widthMode: YogaMeasureModeValue, height: number, heightMode: YogaMeasureModeValue) {
      if (widthMode === YogaMeasureMode.Exactly && heightMode === YogaMeasureMode.Exactly) {
        return {
          width: roundUpToPointScale(validYogaSize(width, 'width')),
          height: roundUpToPointScale(validYogaSize(height, 'height')),
          measured: false,
        };
      }
      return { ...customLayouting().measure(width, widthMode, height, heightMode), measured: true };
    },
    layoutResolvedBox(
      size: Size,
      padding: Inset,
      border: Inset,
    ): {
      readonly contentBox: { readonly width: number; readonly height: number };
      readonly layout: GlyphLayoutInspection;
      readonly centeredX: Float32Array;
      readonly centeredY: Float32Array;
    } {
      const [outerWidth, outerHeight] = size;
      const [paddingTop, paddingRight, paddingBottom, paddingLeft] = padding;
      const [borderTop, borderRight, borderBottom, borderLeft] = border;
      const contentWidth = validContentSize(
        outerWidth - paddingLeft - paddingRight - borderLeft - borderRight,
        'width',
      );
      const contentHeight = validContentSize(
        outerHeight - paddingTop - paddingBottom - borderTop - borderBottom,
        'height',
      );
      calls.layout += 1;
      const constraints: Constraints = {
        width: { mode: 'exact', size: contentWidth },
        height: { mode: 'exact', size: contentHeight },
      };
      const layout = paragraph.glyphs(constraints);
      const contentLeft = -outerWidth / 2 + borderLeft + paddingLeft;
      const contentTop = outerHeight / 2 - borderTop - paddingTop;
      return {
        contentBox: { width: contentWidth, height: contentHeight },
        layout,
        centeredX: Float32Array.from(layout.x, (value) => value + contentLeft),
        centeredY: Float32Array.from(layout.y, (value) => contentTop - value),
      };
    },
    updateParagraph(input: ParagraphUpdate<Technique>) {
      paragraph.update(input);
      dirtyCount += 1;
    },
    updateParagraphLayout(layoutUpdate: ParagraphLayout) {
      currentLayout = { ...currentLayout, ...layoutUpdate };
      paragraph.update({ layout: currentLayout });
      dirtyCount += 1;
    },
    updatePaint() {
      paintRevision += 1;
    },
    updateRaster() {
      rasterRevision += 1;
    },
  };
}

function mapYogaAxis(value: number, mode: YogaMeasureModeValue, name: string): AxisConstraint {
  if (mode === YogaMeasureMode.Undefined) return { mode: 'unconstrained' };
  const size = validYogaSize(value, name);
  if (mode === YogaMeasureMode.AtMost) return { mode: 'at-most', size };
  if (mode === YogaMeasureMode.Exactly) return { mode: 'exact', size };
  throw new RangeError(`unsupported Yoga ${name} measure mode`);
}

function validYogaSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Yoga ${name} must be finite and nonnegative when constrained`);
  }
  return value;
}

function validContentSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`resolved content ${name} must be finite and nonnegative`);
  }
  return value;
}

function roundUpToPointScale(value: number): number {
  return Math.ceil(value * 100) / 100;
}
