import type { GlyphOutlineContour } from '@pmndrs/glyph';

/** Quads for an outline's curves, handles and points, in em units with y up, as flat attribute arrays. */
export interface OutlineQuads {
  positions: number[];
  uvs: number[];
  /** Per vertex: how far along its contour, and what it is (0 curve, 1 handle, 2 on-curve point, 3 control point). */
  strokes: number[];
  indices: number[];
}

/** Steps a quadratic is drawn in. */
const STEPS = 14;

/**
 * Build the drawing of an outline: each curve as a ribbon `width` em wide, a handle from each end of a quadratic to
 * its control point, a dot on every on-curve point and a ring on every control point.
 */
export function outlineQuads(outline: readonly GlyphOutlineContour[], width: number): OutlineQuads {
  const quads: OutlineQuads = { positions: [], uvs: [], strokes: [], indices: [] };

  for (const contour of outline) {
    for (const [index, [x0, y0, cx, cy, x1, y1, isLine]] of contour.entries()) {
      const from = index / contour.length;
      const span = 1 / contour.length;
      const steps = isLine ? 1 : STEPS;
      let previousX = x0;
      let previousY = y0;

      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const u = 1 - t;
        const x = isLine ? x1 : u * u * x0 + 2 * u * t * cx + t * t * x1;
        const y = isLine ? y1 : u * u * y0 + 2 * u * t * cy + t * t * y1;
        ribbon(quads, previousX, previousY, x, y, width, from + span * t, 0);
        previousX = x;
        previousY = y;
      }

      dot(quads, x0, y0, width * 3.2, from, 2);

      if (!isLine) {
        ribbon(quads, x0, y0, cx, cy, width * 0.5, from, 1);
        ribbon(quads, cx, cy, x1, y1, width * 0.5, from, 1);
        dot(quads, cx, cy, width * 3.6, from, 3);
      }
    }
  }

  return quads;
}

function ribbon(
  quads: OutlineQuads,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  along: number,
  kind: number,
): void {
  const length = Math.hypot(x1 - x0, y1 - y0);

  if (length < 1e-6) return;

  // Half the width to either side, and as much past each end, so consecutive pieces overlap into a round join.
  const nx = (-(y1 - y0) / length) * width * 0.5;
  const ny = ((x1 - x0) / length) * width * 0.5;
  const ex = ((x1 - x0) / length) * width * 0.25;
  const ey = ((y1 - y0) / length) * width * 0.25;
  quad(
    quads,
    [x0 - ex + nx, y0 - ey + ny, x0 - ex - nx, y0 - ey - ny, x1 + ex - nx, y1 + ey - ny, x1 + ex + nx, y1 + ey + ny],
    along,
    kind,
  );
}

function dot(quads: OutlineQuads, x: number, y: number, size: number, along: number, kind: number): void {
  const half = size / 2;
  quad(quads, [x - half, y + half, x - half, y - half, x + half, y - half, x + half, y + half], along, kind);
}

/** One quad from four corners given as outline points (y down), wound for a y-up world. */
function quad(quads: OutlineQuads, corners: readonly number[], along: number, kind: number): void {
  const base = quads.positions.length / 3;
  const uvs = [0, 1, 0, 0, 1, 0, 1, 1];

  for (let corner = 0; corner < 4; corner++) {
    quads.positions.push(corners[corner * 2]!, -corners[corner * 2 + 1]!, 0);
    quads.uvs.push(uvs[corner * 2]!, uvs[corner * 2 + 1]!);
    quads.strokes.push(along, kind);
  }

  quads.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
