import { areaPaths, FillRule, union, type Paths64 } from 'clipper2-ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GlyphOutlineContour } from '@pmndrs/glyph';

import {
  buildGlyphCollider,
  emToWorld,
  flattenOutline,
  flattenToleranceEm,
  GlyphColliderCache,
  polygonArea,
  type GlyphCollider,
} from './glyph-colliders';
import { breakApartParagraph, outlinedFont, type OutlinedFontFixture } from './test-support/outlined-paragraph';

type OutlinedParagraph = Awaited<ReturnType<typeof breakApartParagraph>>;

/** Chord tolerance the shape tests build with: tight enough that the area bounds below are meaningful. */
const TOLERANCE_EM = 0.002;

interface Segment {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

/**
 * The true outline sampled finely, read through the owned `outlineAt` tuples: a different decode path from the borrowed
 * views the builder consumes, and a different flattener from the builder's, so neither can mask the other's mistake.
 */
function fineSegments(contours: readonly GlyphOutlineContour[]): Segment[] {
  const segments: Segment[] = [];
  for (const contour of contours) {
    for (const [x0, y0, cx, cy, x1, y1, isLine] of contour) {
      const steps = isLine ? 1 : 32;
      let previousX = x0;
      let previousY = y0;
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
        const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
        segments.push({ x0: previousX, x1: x, y0: previousY, y1: y });
        previousX = x;
        previousY = y;
      }
    }
  }
  return segments;
}

/** The nonzero winding number of the outline around a point, by crossing count with signed direction. */
function windingNumber(segments: readonly Segment[], x: number, y: number): number {
  let winding = 0;
  for (const { x0, x1, y0, y1 } of segments) {
    if (y0 <= y) {
      if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) winding += 1;
    } else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) {
      winding -= 1;
    }
  }
  return winding;
}

function distanceToBoundary(segments: readonly Segment[], x: number, y: number): number {
  let nearest = Infinity;
  for (const { x0, x1, y0, y1 } of segments) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / length));
    nearest = Math.min(nearest, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return nearest;
}

function perimeter(segments: readonly Segment[]): number {
  return segments.reduce((total, { x0, x1, y0, y1 }) => total + Math.hypot(x1 - x0, y1 - y0), 0);
}

function insidePolygon(polygon: Float64Array, x: number, y: number, margin = 0): boolean {
  for (let index = 0; index < polygon.length; index += 2) {
    const next = (index + 2) % polygon.length;
    const ex = polygon[next]! - polygon[index]!;
    const ey = polygon[next + 1]! - polygon[index + 1]!;
    // Counter-clockwise pieces keep the interior on the left of every edge.
    if (ex * (y - polygon[index + 1]!) - ey * (x - polygon[index]!) < -margin) return false;
  }
  return true;
}

function isConvexCounterClockwise(polygon: Float64Array): boolean {
  const count = polygon.length / 2;
  for (let index = 0; index < count; index += 1) {
    const a = polygon.subarray(2 * index, 2 * index + 2);
    const b = polygon.subarray(2 * ((index + 1) % count), 2 * ((index + 1) % count) + 2);
    const c = polygon.subarray(2 * ((index + 2) % count), 2 * ((index + 2) % count) + 2);
    if ((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!) < 0) return false;
  }
  return count >= 3;
}

interface Specimen {
  readonly collider: GlyphCollider;
  readonly fine: readonly Segment[];
}

const SPECIMENS: readonly (readonly [OutlinedFontFixture, string])[] = [
  ['inter', 'o'],
  ['inter', 'e'],
  ['inter', 'A'],
  ['inter', 'B'],
  ['inter', 'i'],
  ['inter', '8'],
  ['inter', 'g'],
  ['dancing-script', 'a'],
  ['dancing-script', 'B'],
  ['dancing-script', 'g'],
  ['dancing-script', '8'],
  ['source-serif-4', 'R'],
  ['source-serif-4', 'g'],
  ['source-serif-4', '&'],
];

const specimens = new Map<string, Specimen>();
const paragraphs: OutlinedParagraph[] = [];

/** Reads one character's outline twice: borrowed (builder input) and owned (oracle input). */
async function specimen(fixture: OutlinedFontFixture, character: string): Promise<Specimen> {
  const paragraph = await breakApartParagraph(fixture, character, 100);
  paragraphs.push(paragraph);
  const collider = buildGlyphCollider(paragraph.glyphs.outlineAt(0), TOLERANCE_EM);
  return { collider, fine: fineSegments(paragraph.text.glyphs().outlineAt(0)) };
}

beforeAll(async () => {
  for (const [fixture, character] of SPECIMENS)
    specimens.set(`${fixture}:${character}`, await specimen(fixture, character));
}, 120_000);

afterAll(() => {
  for (const paragraph of paragraphs) paragraph.dispose();
});

function specimenOf(fixture: OutlinedFontFixture, character: string): Specimen {
  const found = specimens.get(`${fixture}:${character}`);
  if (found === undefined) throw new Error(`missing specimen ${fixture}:${character}`);
  return found;
}

describe('glyph collider fidelity', () => {
  it.each(SPECIMENS)('%s %s: every piece is a convex counter-clockwise polygon', (fixture, character) => {
    const { collider } = specimenOf(fixture, character);
    expect(collider.pieces.length).toBeGreaterThan(0);
    for (const piece of collider.pieces) expect(isConvexCounterClockwise(piece)).toBe(true);
  });

  it.each(SPECIMENS)(
    '%s %s: piece area matches the nonzero-filled outline within the chord tolerance',
    (fixture, character) => {
      const { collider, fine } = specimenOf(fixture, character);
      // The oracle area is the grid estimate of the winding-number fill; the builder's area comes from its pieces. A
      // chord deviates from its curve by at most the tolerance, so the two differ by at most tolerance * perimeter.
      const bounds = collider.bounds!;
      const cells = 200;
      const cell = (Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + 0.1) / cells;
      const minX = bounds.minX - 0.05;
      const minY = bounds.minY - 0.05;
      let inside = 0;
      for (let row = 0; row < cells; row += 1) {
        for (let column = 0; column < cells; column += 1) {
          if (windingNumber(fine, minX + (column + 0.5) * cell, minY + (row + 0.5) * cell) !== 0) inside += 1;
        }
      }
      const oracleArea = inside * cell * cell;
      const allowance = TOLERANCE_EM * perimeter(fine) + 4 * cell * perimeter(fine) * 0.25;
      expect(Math.abs(collider.area - oracleArea)).toBeLessThanOrEqual(allowance);
      // The pieces tile the region without overlap, so their areas sum to the union.
      expect(collider.area).toBeCloseTo(
        collider.pieces.reduce((total, piece) => total + polygonArea(piece), 0),
        12,
      );
    },
  );

  it.each(SPECIMENS)(
    '%s %s: every sample away from the boundary is classified like the outline',
    (fixture, character) => {
      const { collider, fine } = specimenOf(fixture, character);
      const bounds = collider.bounds!;
      const cells = 80;
      const width = bounds.maxX - bounds.minX + 0.1;
      const height = bounds.maxY - bounds.minY + 0.1;
      let checked = 0;
      for (let row = 0; row < cells; row += 1) {
        for (let column = 0; column < cells; column += 1) {
          const x = bounds.minX - 0.05 + ((column + 0.5) / cells) * width;
          const y = bounds.minY - 0.05 + ((row + 0.5) / cells) * height;
          // Within the tolerance of the boundary either answer is legitimate; everywhere else they must agree.
          if (distanceToBoundary(fine, x, y) <= TOLERANCE_EM * 1.5) continue;
          checked += 1;
          const covering = collider.pieces.filter((piece) => insidePolygon(piece, x, y)).length;
          const filled = windingNumber(fine, x, y) !== 0;
          expect(covering, `${fixture} ${character} at ${x.toFixed(4)}, ${y.toFixed(4)}`).toBe(filled ? 1 : 0);
        }
      }
      expect(checked).toBeGreaterThan(cells * cells * 0.5);
    },
  );

  it.each(SPECIMENS)('%s %s: every piece lies within the outline bounds', (fixture, character) => {
    const { collider, fine } = specimenOf(fixture, character);
    const xs = fine.flatMap(({ x0, x1 }) => [x0, x1]);
    const ys = fine.flatMap(({ y0, y1 }) => [y0, y1]);
    const slack = 1 / 32_768;
    for (const piece of collider.pieces) {
      for (let index = 0; index < piece.length; index += 2) {
        expect(piece[index]!).toBeGreaterThanOrEqual(Math.min(...xs) - slack);
        expect(piece[index]!).toBeLessThanOrEqual(Math.max(...xs) + slack);
        expect(piece[index + 1]!).toBeGreaterThanOrEqual(Math.min(...ys) - slack);
        expect(piece[index + 1]!).toBeLessThanOrEqual(Math.max(...ys) + slack);
      }
    }
  });

  it.each([
    ['inter', 'o', 1],
    ['inter', 'e', 1],
    ['inter', 'A', 1],
    ['inter', 'B', 2],
    ['inter', '8', 2],
    ['inter', 'i', 0],
    ['dancing-script', '8', 2],
    ['source-serif-4', '&', 2],
  ] as const)('%s %s: has %i enclosed counters and no piece enters them', (fixture, character, expectedCounters) => {
    const { collider, fine } = specimenOf(fixture, character);
    const { maxX, maxY, minX, minY } = collider.bounds!;
    const cells = 90;
    const columns = cells + 2;
    const pointAt = (column: number, row: number): [number, number] => [
      minX + ((column - 0.5) / cells) * (maxX - minX),
      minY + ((row - 0.5) / cells) * (maxY - minY),
    ];
    // A counter is a connected run of unfilled cells that never reaches the padded border of the grid.
    const label = new Int32Array(columns * columns).fill(-1);
    const unfilled = (column: number, row: number): boolean => {
      const [x, y] = pointAt(column, row);
      return windingNumber(fine, x, y) === 0;
    };
    let components = 0;
    const exterior = new Set<number>();
    for (let start = 0; start < columns * columns; start += 1) {
      const startColumn = start % columns;
      const startRow = Math.floor(start / columns);
      if (label[start] !== -1 || !unfilled(startColumn, startRow)) continue;
      const stack = [start];
      label[start] = components;
      let touchesBorder = false;
      while (stack.length > 0) {
        const current = stack.pop()!;
        const column = current % columns;
        const row = Math.floor(current / columns);
        if (column === 0 || row === 0 || column === columns - 1 || row === columns - 1) touchesBorder = true;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nextColumn = column + dx;
          const nextRow = row + dy;
          if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= columns) continue;
          const next = nextRow * columns + nextColumn;
          if (label[next] === -1 && unfilled(nextColumn, nextRow)) {
            label[next] = components;
            stack.push(next);
          }
        }
      }
      if (touchesBorder) exterior.add(components);
      components += 1;
    }
    const counters = components - exterior.size;
    expect(counters).toBe(expectedCounters);
    for (let cell = 0; cell < label.length; cell += 1) {
      const component = label[cell]!;
      if (component === -1 || exterior.has(component)) continue;
      const [x, y] = pointAt(cell % columns, Math.floor(cell / columns));
      if (distanceToBoundary(fine, x, y) <= TOLERANCE_EM * 1.5) continue;
      expect(collider.pieces.some((piece) => insidePolygon(piece, x, y))).toBe(false);
    }
  });

  it('leaves the centre of o empty and fills its ring', () => {
    const { collider } = specimenOf('inter', 'o');
    const { maxX, maxY, minX, minY } = collider.bounds!;
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    expect(collider.pieces.some((piece) => insidePolygon(piece, centreX, centreY))).toBe(false);
    // The ring's left and top strokes, a few hundredths of an em inside the outer edge.
    expect(collider.pieces.some((piece) => insidePolygon(piece, minX + 0.03, centreY))).toBe(true);
    expect(collider.pieces.some((piece) => insidePolygon(piece, centreX, minY + 0.03))).toBe(true);
  });
});

describe('every printable ASCII glyph', () => {
  const printable = Array.from({ length: 95 }, (_, index) => String.fromCodePoint(0x20 + index)).join('');

  it.each(['inter', 'dancing-script', 'source-serif-4'] as const)(
    '%s: pieces are convex, disjoint-by-area, and conserve the nonzero-filled area',
    async (fixture) => {
      const paragraph = await breakApartParagraph(fixture, printable, 48);
      try {
        const scale = 65_536;
        let built = 0;
        const { glyphs } = paragraph;
        for (let index = 0; index < glyphs.count; index += 1) {
          const outline = glyphs.outlineAt(index);
          if (outline.length === 0) continue;
          const collider = buildGlyphCollider(outline, TOLERANCE_EM);
          // Clipper's own nonzero union of the same flattened contours: outers count positive, holes negative.
          const resolved: Paths64 = union(
            collider.contours.map((contour) =>
              Array.from({ length: contour.length / 2 }, (_, vertex) => ({
                x: Math.round(contour[2 * vertex]! * scale),
                y: Math.round(contour[2 * vertex + 1]! * scale),
              })),
            ),
            FillRule.NonZero,
          );
          const resolvedArea = Math.abs(areaPaths(resolved)) / (scale * scale);
          expect(collider.area, `${fixture} glyph ${String(index)}`).toBeCloseTo(resolvedArea, 6);
          for (const piece of collider.pieces) expect(isConvexCounterClockwise(piece)).toBe(true);
          built += 1;
        }
        expect(built).toBeGreaterThan(80);
      } finally {
        paragraph.dispose();
      }
    },
    60_000,
  );
});

describe('outline flattening', () => {
  it('keeps every line of H as one segment', async () => {
    const paragraph = await breakApartParagraph('inter', 'H', 100);
    try {
      const owned = paragraph.text.glyphs().outlineAt(0);
      const flattened = flattenOutline(paragraph.glyphs.outlineAt(0), 0.01);
      expect(owned.every((contour) => contour.every((curve) => curve[6]))).toBe(true);
      expect(flattened.map((polyline) => polyline.length / 2)).toEqual(owned.map((contour) => contour.length));
    } finally {
      paragraph.dispose();
    }
  });

  it('spends more vertices on a tighter tolerance', async () => {
    const paragraph = await breakApartParagraph('inter', 'O', 100);
    try {
      const vertices = (tolerance: number): number =>
        flattenOutline(paragraph.glyphs.outlineAt(0), tolerance).reduce(
          (total, polyline) => total + polyline.length / 2,
          0,
        );
      expect(vertices(0.02)).toBeLessThan(vertices(0.005));
      expect(vertices(0.005)).toBeLessThan(vertices(0.001));
    } finally {
      paragraph.dispose();
    }
  });

  it('scales the tolerance with the rendered size inside fixed limits', () => {
    expect(flattenToleranceEm(24)).toBeCloseTo(0.2 / 24, 12);
    expect(flattenToleranceEm(2)).toBe(0.02);
    expect(flattenToleranceEm(10_000)).toBe(0.0015);
  });
});

describe('collider cache', () => {
  it('builds one collider per distinct glyph, shares it across placements, and gives blanks none', async () => {
    const paragraph = await breakApartParagraph('inter', 'o o o', 24);
    try {
      const cache = new GlyphColliderCache(TOLERANCE_EM);
      const colliders = Array.from({ length: paragraph.glyphs.count }, (_, index) =>
        cache.get(paragraph.glyphs.outlineAt(index)),
      );
      expect(colliders).toHaveLength(5);
      expect(colliders[1]).toBeUndefined();
      expect(colliders[3]).toBeUndefined();
      expect(colliders[0]).toBeDefined();
      expect(colliders[2]).toBe(colliders[0]);
      expect(colliders[4]).toBe(colliders[0]);
      expect(cache.size).toBe(1);
    } finally {
      paragraph.dispose();
    }
  });
});

describe('outline space to world', () => {
  it('flips y and scales by the font size', () => {
    const target = { x: 0, y: 0 };
    emToWorld(0.5, -0.75, 32, target);
    expect(target).toEqual({ x: 16, y: 24 });
    emToWorld(-0.25, 0.1, 10, target);
    expect(target).toEqual({ x: -2.5, y: -1 });
  });

  it('places every collider exactly where the renderer places its glyph', async () => {
    const fontSize = 40;
    const paragraph = await breakApartParagraph('inter', 'Hg, o8', fontSize);
    try {
      const { glyphs } = paragraph;
      const cache = new GlyphColliderCache(TOLERANCE_EM);
      let placed = 0;
      for (let index = 0; index < glyphs.count; index += 1) {
        const detached = glyphs.glyphAt(index);
        const collider = cache.get(glyphs.outlineAt(index));
        // A blank glyph (the comma's neighbour, the spaces) has no outline, no collider, and no record.
        expect(collider === undefined).toBe(!detached.drawn);
        if (collider === undefined) continue;
        const measurement = glyphs.measurements[index]!;
        const { maxX, maxY, minX, minY } = collider.bounds!;
        const low = { x: 0, y: 0 };
        const high = { x: 0, y: 0 };
        emToWorld(minX, maxY, detached.fontSize, low);
        emToWorld(maxX, minY, detached.fontSize, high);
        // The renderer's own ink box, relative to the glyph's pen position, in the same y-up pixels.
        const ink = measurement.localInkBounds;
        const pen = measurement.drawnOrigin;
        // A flattened chord stays inside the curve by at most the tolerance; the ink box has 1/64 px rounding.
        const slack = TOLERANCE_EM * fontSize + 1 / 32;
        expect(Math.abs(low.x - (ink.min.x - pen.x))).toBeLessThanOrEqual(slack);
        expect(Math.abs(low.y - (ink.min.y - pen.y))).toBeLessThanOrEqual(slack);
        expect(Math.abs(high.x - (ink.max.x - pen.x))).toBeLessThanOrEqual(slack);
        expect(Math.abs(high.y - (ink.max.y - pen.y))).toBeLessThanOrEqual(slack);
        placed += 1;
      }
      expect(placed).toBe(5);
    } finally {
      paragraph.dispose();
    }
  });

  it('addresses glyphs, outlines, and the source layout by one index', async () => {
    const paragraph = await breakApartParagraph('inter', 'Bo dega A8', 32);
    try {
      const { glyphs, text } = paragraph;
      const layout = text.glyphs();
      expect(glyphs.count).toBe(layout.glyphCount);
      for (let index = 0; index < glyphs.count; index += 1) {
        // The detached outline is the source layout's outline at the same index, blanks included.
        expect(glyphs.outlineAt(index)).toEqual(layout.outlineAt(index));
        expect(glyphs.glyphAt(index).drawn).toBe(layout.outlineAt(index).length > 0);
        expect(glyphs.glyphAt(index).index).toBe(index);
      }
      expect(Array.from({ length: glyphs.count }, (_, index) => glyphs.glyphAt(index).drawn)).toEqual([
        true,
        true,
        false,
        true,
        true,
        true,
        true,
        false,
        true,
        true,
      ]);
    } finally {
      paragraph.dispose();
    }
  });
});

describe('outlined fixtures', () => {
  it('bakes every fixture font with outlines', async () => {
    for (const fixture of ['inter', 'dancing-script', 'source-serif-4'] as const) {
      expect(await outlinedFont(fixture)).toBeDefined();
    }
  });
});
