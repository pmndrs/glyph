import type { GlyphLayoutInspection } from '@pmndrs/glyph';

export interface OutlineGeometry {
  /** `x, y, z` triples, two per straight piece, in the text's local space (+Y up). */
  readonly segments: Float32Array;
  /** Where each curve starts: a point on the outline. */
  readonly onCurve: readonly (readonly [x: number, y: number])[];
  /** The control point of each quadratic curve; lines have none worth drawing. */
  readonly controls: readonly (readonly [x: number, y: number])[];
  readonly contourCount: number;
  readonly curveCount: number;
}

/**
 * Every glyph's contours as line pieces. A curve tuple is in em units, y-down, relative to the glyph's pen
 * position, so a point is placed at `x[i] + px * glyphFontSizes[i]`, `y[i] + py * glyphFontSizes[i]`; the
 * result is negated in y for three.js.
 */
export function outlineGeometry(layout: GlyphLayoutInspection, steps: number): OutlineGeometry {
  const segments: number[] = [];
  const onCurve: [number, number][] = [];
  const controls: [number, number][] = [];
  let contourCount = 0;
  let curveCount = 0;
  for (let index = 0; index < layout.glyphCount; index += 1) {
    const penX = layout.x[index]!;
    const penY = layout.y[index]!;
    const size = layout.glyphFontSizes[index]!;
    const place = (px: number, py: number): [number, number] => [penX + px * size, -(penY + py * size)];
    for (const contour of layout.outlineAt(index)) {
      contourCount += 1;
      for (const [x0, y0, cx, cy, x1, y1, isLine] of contour) {
        curveCount += 1;
        onCurve.push(place(x0, y0));
        if (!isLine) controls.push(place(cx, cy));
        const pieces = isLine ? 1 : steps;
        let previous = place(x0, y0);
        for (let piece = 1; piece <= pieces; piece += 1) {
          const t = piece / pieces;
          const u = 1 - t;
          // A quadratic Bezier: start, control, end.
          const next = place(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
          segments.push(previous[0], previous[1], 0, next[0], next[1], 0);
          previous = next;
        }
      }
    }
  }
  return { segments: new Float32Array(segments), onCurve, controls, contourCount, curveCount };
}
