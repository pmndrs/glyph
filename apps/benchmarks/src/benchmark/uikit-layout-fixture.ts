import type {
  Paragraph,
  ParagraphAxisConstraint,
  ParagraphConstraints,
  ParagraphInput,
  ParagraphLayout,
} from '@pmndrs/text';

export const YogaMeasureMode = Object.freeze({ Undefined: 0, Exactly: 1, AtMost: 2 });

type YogaMeasureModeValue = (typeof YogaMeasureMode)[keyof typeof YogaMeasureMode];
type Inset = readonly [top: number, right: number, bottom: number, left: number];
type Size = readonly [width: number, height: number];

export function createUikitLayoutFixture(paragraph: Paragraph, policy: ParagraphConstraints = {}) {
  let currentPolicy = { ...policy };
  let dirtyCount = 1;
  let paintRevision = 0;
  let rasterRevision = 0;
  const calls = { measure: 0, layout: 0 };

  const measuredParagraph = {
    measure(constraints?: ParagraphConstraints) {
      calls.measure += 1;
      return paragraph.measure(constraints);
    },
    layout(constraints?: ParagraphConstraints) {
      calls.layout += 1;
      return paragraph.layout(constraints);
    },
  };

  function customLayouting() {
    const natural = measuredParagraph.measure(currentPolicy);
    const minimum = measuredParagraph.measure({
      ...currentPolicy,
      width: { mode: 'at-most', size: 0 },
    });
    return {
      minWidth: minimum.contentWidth,
      minHeight: natural.height,
      firstBaseline: natural.firstBaseline,
      measure(width: number, widthMode: YogaMeasureModeValue, height: number, heightMode: YogaMeasureModeValue) {
        const result = measuredParagraph.measure({
          ...currentPolicy,
          width: mapYogaAxis(width, widthMode, 'width'),
          height: mapYogaAxis(height, heightMode, 'height'),
        });
        return {
          width: roundUpToPointScale(result.width),
          height: roundUpToPointScale(result.height),
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
      readonly layout: ParagraphLayout;
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
      const layout = measuredParagraph.layout({
        ...currentPolicy,
        width: { mode: 'exactly', size: contentWidth },
        height: { mode: 'exactly', size: contentHeight },
      });
      const contentLeft = -outerWidth / 2 + borderLeft + paddingLeft;
      const contentTop = outerHeight / 2 - borderTop - paddingTop;
      return {
        contentBox: { width: contentWidth, height: contentHeight },
        layout,
        centeredX: Float32Array.from(layout.x, (value) => value + contentLeft),
        centeredY: Float32Array.from(layout.y, (value) => contentTop - value),
      };
    },
    updateParagraph(input: ParagraphInput) {
      paragraph.update(input);
      dirtyCount += 1;
    },
    updateShapingPolicy(policyUpdate: ParagraphConstraints) {
      currentPolicy = { ...currentPolicy, ...policyUpdate };
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

function mapYogaAxis(value: number, mode: YogaMeasureModeValue, name: string): ParagraphAxisConstraint {
  if (mode === YogaMeasureMode.Undefined) return { mode: 'unconstrained' };
  const size = validYogaSize(value, name);
  if (mode === YogaMeasureMode.AtMost) return { mode: 'at-most', size };
  if (mode === YogaMeasureMode.Exactly) return { mode: 'exactly', size };
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
