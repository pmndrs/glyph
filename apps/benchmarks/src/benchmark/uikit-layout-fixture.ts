import type { AxisConstraint, Constraints, GlyphLayoutInspection, ParagraphLayoutSummary } from '@pmndrs/glyph';

export const YogaMeasureMode = Object.freeze({ Undefined: 0, Exactly: 1, AtMost: 2 });

type YogaMeasureModeValue = (typeof YogaMeasureMode)[keyof typeof YogaMeasureMode];
type Inset = readonly [top: number, right: number, bottom: number, left: number];
type Size = readonly [width: number, height: number];

interface MeasurableText {
  constraints: Constraints;
  measure(): ParagraphLayoutSummary;
  glyphs(): GlyphLayoutInspection;
}

/** Exercise Yoga's measure negotiation through an ordinary detached Text. */
export function createUikitLayoutFixture(text: MeasurableText) {
  const calls = { measure: 0, layout: 0 };

  function customLayouting() {
    calls.measure += 1;
    text.constraints = {};
    const natural = text.measure();
    return {
      // Intrinsic widths ride the natural measurement itself: no second query at zero width.
      minWidth: natural.minContentWidth,
      minHeight: natural.height,
      firstBaseline: natural.firstBaseline,
      measure(width: number, widthMode: YogaMeasureModeValue, height: number, heightMode: YogaMeasureModeValue) {
        calls.measure += 1;
        text.constraints = {
          width: mapYogaAxis(width, widthMode, 'width'),
          height: mapYogaAxis(height, heightMode, 'height'),
        };
        const metrics = text.measure();
        return {
          width: roundUpToPointScale(metrics.width),
          height: roundUpToPointScale(metrics.height),
        };
      },
    };
  }

  return {
    calls,
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
      text.constraints = {
        width: { mode: 'exact', size: contentWidth },
        height: { mode: 'exact', size: contentHeight },
      };
      const inspection = text.glyphs();
      const contentLeft = -outerWidth / 2 + borderLeft + paddingLeft;
      const contentTop = outerHeight / 2 - borderTop - paddingTop;
      return {
        contentBox: { width: contentWidth, height: contentHeight },
        layout: inspection,
        centeredX: Float32Array.from(inspection.x, (value) => value + contentLeft),
        centeredY: Float32Array.from(inspection.y, (value) => contentTop - value),
      };
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
