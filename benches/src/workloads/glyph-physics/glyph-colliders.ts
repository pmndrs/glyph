import earcut from 'earcut';
import { Clipper64, ClipType, FillRule, PolyTree64, type Path64, type Paths64, type PolyPath64 } from 'clipper2-ts';
import type { GlyphOutlineContour } from '@pmndrs/glyph';

/**
 * Convex collider pieces built from a glyph outline.
 *
 * Pipeline, once per `fontHandle:glyphId`: flatten every quadratic to a fixed em-space chord tolerance, resolve the
 * contours under the font's nonzero fill rule (Clipper2 union, so holes are holes and overlapping contours merge),
 * triangulate each resolved region with its holes (earcut), then merge adjacent triangles into convex pieces
 * (Hertel-Mehlhorn). Everything stays in the outline's own space: em units, y down, origin at the glyph's pen position.
 * The one flip into a y-up world lives in `emToWorld`.
 */

/** One closed polyline as `x, y` pairs in em units with y down; the closing point is implicit, not repeated. */
export type EmPolyline = Float64Array;

/** Em units are quantised to this many steps per em before Clipper2 runs on integers: 2^-16 em, far below any tolerance. */
const CLIPPER_STEPS_PER_EM = 65_536;

/** A piece smaller than this area (em^2) is a numerical sliver that no physics hull can represent. */
const MINIMUM_PIECE_AREA_EM2 = 1e-7;

export interface GlyphCollider {
  /** The flattened source contours before fill resolution, for comparing the collider against the glyph. */
  readonly contours: readonly EmPolyline[];
  /** Counter-clockwise (in the outline's y-down numbers) convex polygons whose union is the nonzero-filled outline. */
  readonly pieces: readonly EmPolyline[];
  /** Sum of the piece areas in em^2. The pieces do not overlap. */
  readonly area: number;
  /** Bounds of every piece in em units, or `undefined` when the glyph has no fill. */
  readonly bounds: EmBounds | undefined;
}

export interface EmBounds {
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
}

/**
 * Flattens every contour to a polyline whose chords stay within `tolerance` em of the curve. Lines are kept as single
 * segments; a quadratic with second difference `d = p0 - 2*control + p1` splits into `ceil(sqrt(|d| / (4 * tolerance)))`
 * equal parameter steps, which bounds the chord error by `|d| / (4 * n^2)`. Vertices lie on the curve, so a flattened
 * convex arc sits inside the true outline by at most `tolerance`.
 */
export function flattenOutline(outline: readonly GlyphOutlineContour[], tolerance: number): EmPolyline[] {
  const contours: EmPolyline[] = [];
  for (const contour of outline) {
    const coordinates: number[] = [];
    for (const [x0, y0, cx, cy, x1, y1, isLine] of contour) {
      if (coordinates.length === 0) coordinates.push(x0, y0);
      if (isLine) {
        coordinates.push(x1, y1);
        continue;
      }
      const deviation = Math.hypot(x0 - 2 * cx + x1, y0 - 2 * cy + y1);
      const steps = Math.max(1, Math.ceil(Math.sqrt(deviation / (4 * tolerance))));
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        const u = 1 - t;
        coordinates.push(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
      }
      coordinates.push(x1, y1);
    }
    // A closed contour's last curve ends where its first began; the polyline closes implicitly.
    coordinates.length -= 2;
    if (coordinates.length >= 6) contours.push(Float64Array.from(coordinates));
  }
  return contours;
}

/** One connected filled region: an outer boundary and the holes cut from it, as integer Clipper2 paths. */
interface ResolvedRegion {
  readonly holes: Path64[];
  readonly outer: Path64;
}

/**
 * Resolves contours under the nonzero fill rule: Clipper2 unions every contour with its winding preserved, so a
 * clockwise inner contour inside a counter-clockwise outer one is a hole, two overlapping same-wound contours merge,
 * and an island inside a hole becomes its own region. Hole membership comes from the resulting nesting, never from the
 * sign of a contour's winding.
 */
function resolveNonZero(contours: readonly EmPolyline[]): ResolvedRegion[] {
  const subject: Paths64 = contours.map((contour) => {
    const path: Path64 = [];
    for (let index = 0; index < contour.length; index += 2) {
      path.push({
        x: Math.round(contour[index]! * CLIPPER_STEPS_PER_EM),
        y: Math.round(contour[index + 1]! * CLIPPER_STEPS_PER_EM),
      });
    }
    return path;
  });
  const clipper = new Clipper64();
  clipper.addSubject(subject);
  const tree = new PolyTree64();
  clipper.execute(ClipType.Union, FillRule.NonZero, tree);
  const regions: ResolvedRegion[] = [];
  const visit = (node: PolyPath64): void => {
    const polygon = node.poly;
    if (polygon !== null && !node.isHole) {
      const holes: Path64[] = [];
      for (let index = 0; index < node.count; index += 1) {
        const hole = node.child(index);
        if (hole.poly !== null) holes.push(hole.poly);
      }
      regions.push({ holes, outer: polygon });
    }
    for (let index = 0; index < node.count; index += 1) visit(node.child(index));
  };
  visit(tree);
  return regions;
}

/** Triangles of one region as indices into its flattened `x, y` vertex array, counter-clockwise. */
interface TriangulatedRegion {
  readonly triangles: number[];
  readonly vertices: Float64Array;
}

function triangulateRegion(region: ResolvedRegion): TriangulatedRegion {
  const coordinates: number[] = [];
  const holeStarts: number[] = [];
  const append = (path: Path64): void => {
    for (const point of path) coordinates.push(point.x, point.y);
  };
  append(region.outer);
  for (const hole of region.holes) {
    holeStarts.push(coordinates.length / 2);
    append(hole);
  }
  const vertices = Float64Array.from(coordinates);
  const triangles = earcut(vertices, holeStarts, 2);
  const oriented: number[] = [];
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index]!;
    const b = triangles[index + 1]!;
    const c = triangles[index + 2]!;
    const turn = cross(vertices, a, b, c);
    // A zero-area triangle covers nothing and would only hand the merge a degenerate neighbour.
    if (turn > 0) oriented.push(a, b, c);
    else if (turn < 0) oriented.push(a, c, b);
  }
  return { triangles: oriented, vertices };
}

/** Twice the signed area of `a, b, c`: positive when they turn counter-clockwise in the stored numbers. */
function cross(vertices: Float64Array, a: number, b: number, c: number): number {
  const ax = vertices[2 * a]!;
  const ay = vertices[2 * a + 1]!;
  return (vertices[2 * b]! - ax) * (vertices[2 * c + 1]! - ay) - (vertices[2 * b + 1]! - ay) * (vertices[2 * c]! - ax);
}

interface MergeCandidate {
  readonly a: number;
  readonly b: number;
  readonly lengthSquared: number;
}

/**
 * Hertel-Mehlhorn: starts from the triangulation and removes every diagonal whose removal leaves both end vertices
 * convex. Longest diagonals go first so the surviving pieces are the fat ones; ties break on vertex index, so the same
 * glyph always yields the same pieces. The result has at most four times the minimum number of convex pieces.
 */
function mergeConvexPieces({ triangles, vertices }: TriangulatedRegion): number[][] {
  const vertexCount = vertices.length / 2;
  const rings: (number[] | undefined)[] = [];
  const edgeOwner = new Map<number, number>();
  const edgeKey = (from: number, to: number): number => from * vertexCount + to;
  const claim = (ring: readonly number[], id: number): void => {
    for (let index = 0; index < ring.length; index += 1) {
      edgeOwner.set(edgeKey(ring[index]!, ring[(index + 1) % ring.length]!), id);
    }
  };
  for (let index = 0; index < triangles.length; index += 3) {
    const ring = [triangles[index]!, triangles[index + 1]!, triangles[index + 2]!];
    rings.push(ring);
    claim(ring, rings.length - 1);
  }
  const candidates: MergeCandidate[] = [];
  for (const [key] of edgeOwner) {
    const from = Math.floor(key / vertexCount);
    const to = key % vertexCount;
    if (from < to && edgeOwner.has(edgeKey(to, from))) {
      const dx = vertices[2 * from]! - vertices[2 * to]!;
      const dy = vertices[2 * from + 1]! - vertices[2 * to + 1]!;
      candidates.push({ a: from, b: to, lengthSquared: dx * dx + dy * dy });
    }
  }
  candidates.sort((left, right) => right.lengthSquared - left.lengthSquared || left.a - right.a || left.b - right.b);
  for (const { a, b } of candidates) {
    const first = edgeOwner.get(edgeKey(a, b));
    const second = edgeOwner.get(edgeKey(b, a));
    if (first === undefined || second === undefined || first === second) continue;
    const merged = mergeAcross(vertices, rings[first]!, rings[second]!, a, b);
    if (merged === undefined) continue;
    rings[first] = merged;
    rings[second] = undefined;
    claim(merged, first);
  }
  return rings.filter((ring): ring is number[] => ring !== undefined);
}

/**
 * Joins `first` (holding the edge a to b) and `second` (holding b to a) into one ring, or returns `undefined` when the
 * join would be reflex at `a` or `b`. Collinear joins are allowed, so a straight stem stays one piece.
 */
function mergeAcross(
  vertices: Float64Array,
  first: readonly number[],
  second: readonly number[],
  a: number,
  b: number,
): number[] | undefined {
  const fromB = rotateTo(first, b);
  const fromA = rotateTo(second, a);
  // fromB runs b ... a; fromA runs a ... b. Together they walk the merged boundary once.
  const beforeA = fromB[fromB.length - 2]!;
  const afterB = fromB[1]!;
  const afterA = fromA[1]!;
  const beforeB = fromA[fromA.length - 2]!;
  if (cross(vertices, beforeA, a, afterA) < 0 || cross(vertices, beforeB, b, afterB) < 0) return undefined;
  return [...fromB, ...fromA.slice(1, -1)];
}

/** Rotates a ring so it starts at `vertex`. */
function rotateTo(ring: readonly number[], vertex: number): number[] {
  const start = ring.indexOf(vertex);
  return [...ring.slice(start), ...ring.slice(0, start)];
}

/** Drops vertices that lie exactly on the line through their neighbours; the polygon's shape is unchanged. */
function withoutCollinearVertices(vertices: Float64Array, ring: readonly number[]): number[] {
  return ring.filter((vertex, index) => {
    const previous = ring[(index + ring.length - 1) % ring.length]!;
    const next = ring[(index + 1) % ring.length]!;
    return cross(vertices, previous, vertex, next) !== 0;
  });
}

/**
 * Builds the collider for one outline, as `Glyphs.outlineAt(i)` returns it.
 */
export function buildGlyphCollider(outline: readonly GlyphOutlineContour[], tolerance: number): GlyphCollider {
  const contours = flattenOutline(outline, tolerance);
  const pieces: EmPolyline[] = [];
  let area = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const region of resolveNonZero(contours)) {
    const triangulated = triangulateRegion(region);
    for (const merged of mergeConvexPieces(triangulated)) {
      const ring = withoutCollinearVertices(triangulated.vertices, merged);
      if (ring.length < 3) continue;
      const piece = new Float64Array(ring.length * 2);
      for (const [index, vertex] of ring.entries()) {
        piece[2 * index] = triangulated.vertices[2 * vertex]! / CLIPPER_STEPS_PER_EM;
        piece[2 * index + 1] = triangulated.vertices[2 * vertex + 1]! / CLIPPER_STEPS_PER_EM;
      }
      const pieceArea = polygonArea(piece);
      if (pieceArea < MINIMUM_PIECE_AREA_EM2) continue;
      pieces.push(piece);
      area += pieceArea;
      for (let index = 0; index < piece.length; index += 2) {
        minX = Math.min(minX, piece[index]!);
        maxX = Math.max(maxX, piece[index]!);
        minY = Math.min(minY, piece[index + 1]!);
        maxY = Math.max(maxY, piece[index + 1]!);
      }
    }
  }
  return {
    area,
    bounds: pieces.length === 0 ? undefined : { maxX, maxY, minX, minY },
    contours,
    pieces,
  };
}

/** The unsigned area of a polygon stored as `x, y` pairs. */
export function polygonArea(polygon: ArrayLike<number>): number {
  let twice = 0;
  for (let index = 0; index < polygon.length; index += 2) {
    const next = (index + 2) % polygon.length;
    twice += polygon[index]! * polygon[next + 1]! - polygon[next]! * polygon[index + 1]!;
  }
  return Math.abs(twice) / 2;
}

/**
 * The chord tolerance, in em, that keeps a flattened glyph within `pixelTolerance` CSS pixels of its true outline at
 * `fontSize`, clamped so a very small size does not under-resolve a curve and a very large one does not explode the
 * piece count.
 */
export function flattenToleranceEm(fontSize: number, pixelTolerance = 0.2): number {
  return Math.min(0.02, Math.max(0.0015, pixelTolerance / fontSize));
}

/**
 * Builds one collider per distinct glyph and shares it across every placement. `Glyphs.outlineAt(i)` returns a fresh
 * outer array whose frozen contours are shared by every glyph of the same font and glyph ID, so the first contour's
 * identity is the glyph's identity. A blank glyph has no outline and no collider.
 */
export class GlyphColliderCache {
  readonly #colliders = new Map<GlyphOutlineContour, GlyphCollider>();
  readonly #tolerance: number;

  constructor(tolerance: number) {
    this.#tolerance = tolerance;
  }

  get size(): number {
    return this.#colliders.size;
  }

  get(outline: readonly GlyphOutlineContour[]): GlyphCollider | undefined {
    const identity = outline[0];
    if (identity === undefined) return undefined;
    let collider = this.#colliders.get(identity);
    if (collider === undefined) {
      collider = buildGlyphCollider(outline, this.#tolerance);
      this.#colliders.set(identity, collider);
    }
    return collider;
  }
}

/**
 * Maps an outline-space point (em, y down, origin at the pen position) to a y-up world point in pixels relative to the
 * same origin. This is the only place the y flip and the em-to-pixel scale are applied.
 */
export function emToWorld(x: number, y: number, fontSize: number, target: { x: number; y: number }): void {
  target.x = x * fontSize;
  target.y = -y * fontSize;
}
