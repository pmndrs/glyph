import { Constraints, type TextAnchor, type ParagraphLayoutSummary, type LineFontMetrics } from '@pmndrs/glyph';

const boxes = Constraints.create({
  centered: { anchor: { x: 'center', y: 'middle' } },
  baseline: { anchor: { x: 'left', y: 'first-baseline' } },
});
const baseline = { anchor: { ...boxes.centered.anchor, y: 'first-baseline' } } satisfies Constraints;
const combined = Constraints.create({ composed: [boxes.centered, baseline] });
const anchor: TextAnchor = { x: 'right', y: 'x-height-top' };
declare const measured: ParagraphLayoutSummary;
const fontMetrics: LineFontMetrics = measured.fontMetrics;
const offset = measured.anchorOffset;
void [combined, anchor, fontMetrics.capHeight, fontMetrics.xHeight, measured.alphabeticBaseline, offset.x];

// @ts-expect-error Token names follow metric names; top-baseline is not firstBaseline.
const invalid: Constraints = { anchor: { y: 'top-baseline' } };
// @ts-expect-error Block anchors do not belong to the inline axis.
const wrongAxis: Constraints = { anchor: { x: 'first-baseline' } };
// @ts-expect-error Anchors are semantic references, not an ambiguous numeric tuple.
const tuple: Constraints = { anchor: [0, 0] };
void [invalid, wrongAxis, tuple];
