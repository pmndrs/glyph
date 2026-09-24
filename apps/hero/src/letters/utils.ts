import { getSlugGlyphCurves } from '@pmndrs/glyph';
import type { SlugFont } from '../loading/fonts';
import type { Glyphs, Text } from '@pmndrs/glyph/three';
import { mat4, vec3 } from 'math';
import { Body } from '../physics/traits';
import type { TitleBodies } from './traits';
import { Matrix4, ShapePath, ShapeUtils, type Vector2 } from 'three/webgpu';

/** Invisible convex prisms extruded from a glyph outline and centered on its ink box. */
export interface Solid {
  /** Each prism is a flat `[x, y, z, ...]` list of the six corners of one triangle through the thickness. */
  readonly prisms: readonly (readonly number[])[];
}

/**
 * Triangulates the rendered glyph at `fontSize` per em and extrudes each triangle through `thickness`.
 */
export function solidOf(font: SlugFont, glyphId: number, fontSize: number, thickness: number): Solid {
  const outline = new ShapePath();
  let endX = NaN;
  let endY = NaN;
  let startX = NaN;
  let startY = NaN;

  for (const [x0, y0, x1, y1, x2, y2] of getSlugGlyphCurves(font, glyphId)) {
    if (x0 !== endX || y0 !== endY) {
      outline.moveTo(x0 * fontSize, y0 * fontSize);
      startX = x0;
      startY = y0;
    }

    outline.quadraticCurveTo(x1 * fontSize, y1 * fontSize, x2 * fontSize, y2 * fontSize);
    endX = x2;
    endY = y2;

    if (startX === x2 && startY === y2) {
      outline.currentPath!.closePath();
      endX = NaN;
      endY = NaN;
    }
  }

  const shapes = outline.toShapes();
  const points = shapes.map((shape) => shape.extractPoints(3));

  // Centred on the ink box: the body's origin is the letter's centre, as the paragraph measures it.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const { shape } of points) {
    for (const point of shape) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX)) throw new Error(`no outline for glyph ${glyphId}`);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const prisms: number[][] = [];
  const half = thickness / 2;

  for (const { shape: contour, holes } of points) {
    // Triangulation removes duplicate closing points before assigning vertex indices.
    const triangles = ShapeUtils.triangulateShape(contour, holes);
    const vertices: Vector2[] = [...contour, ...holes.flat()];

    for (const triangle of triangles) {
      const p = vertices[triangle[0] ?? -1];
      const q = vertices[triangle[1] ?? -1];
      const r = vertices[triangle[2] ?? -1];

      if (p === undefined || q === undefined || r === undefined) continue;

      if (Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2 < 1e-4) continue;

      const prism: number[] = [];

      for (const z of [-half, half]) {
        for (const corner of [p, q, r]) prism.push(corner.x - centerX, corner.y - centerY, z);
      }

      prisms.push(prism);
    }
  }

  return { prisms };
}

/** Full glyph records plus prefix centering, owned for the lifetime of the mounted line. */
export function createRetainedLine(source: Pick<Text<never>, 'text' | 'glyphs' | 'breakApart' | 'parent' | 'visible'>) {
  const layout = source.glyphs();
  const full = source.text;
  const prefixOffsets = new Float32Array(full.length + 1);
  const [glyphs, decorations] = source.breakApart();
  decorations?.dispose();
  source.parent?.add(glyphs);
  source.visible = false;

  try {
    for (let count = 1; count < full.length; count++) {
      source.text = full.slice(0, count);
      prefixOffsets[count] = source.glyphs().x[0]! - layout.x[0]!;
    }
  } catch (error) {
    glyphs.dispose();
    throw error;
  } finally {
    source.text = full;
  }

  const records = glyphs.measurements.map((glyph) => {
    const original = mat4.create();
    glyph.originalMatrix.toArray(original);
    const bounds = glyph.localInkBounds;

    return {
      index: glyph.index,
      cluster: glyphs.glyphAt(glyph.index)!.cluster,
      original,
      center: vec3.fromValues(
        (bounds.min.x + bounds.max.x) / 2,
        (bounds.min.y + bounds.max.y) / 2,
        (bounds.min.z + bounds.max.z) / 2,
      ),
      empty: bounds.isEmpty(),
    };
  });

  return {
    glyphs,
    records,
    prefixOffsets,
    count: -1,
    transform: mat4.create(),
    draw: new Matrix4(),
    hidden: new Matrix4().makeScale(0, 0, 0),
  };
}

export type RetainedLine = ReturnType<typeof createRetainedLine>;

/** Show a centred prefix without shaping, React updates, or allocation. */
export function showLine(line: RetainedLine, count: number): void {
  if (count === line.count) return;

  line.count = count;
  const shift = line.prefixOffsets[count]!;

  for (let index = 0; index < line.records.length; index++) {
    const glyph = line.records[index]!;

    if (glyph.cluster >= count) line.glyphs.setMatrixAt(glyph.index, line.hidden);
    else {
      mat4.copy(line.transform, glyph.original);
      line.transform[12] += shift;
      line.glyphs.setMatrixAt(glyph.index, line.draw.fromArray(line.transform));
    }
  }
}

export function resetLine(line: RetainedLine, count: number): void {
  line.count = -1;
  line.glyphs.visible = true;
  showLine(line, count);
}

export function disposeLine(line: { glyphs: Glyphs }): void {
  line.glyphs.dispose();
}

const letterScale = vec3.create();
const letterBody = mat4.create();
const letterMatrix = mat4.create();

/** Publish a letter's simulated pose, scaled by how far the hole has grown it, into the title's matrix stream. */
export function writeLetter(state: TitleBodies, index: number): void {
  const piece = state.pieces[index]!;
  const body = piece.entity.get(Body)!;
  const grow = state.grow[index]!;
  vec3.set(letterScale, grow, grow, 1);
  mat4.fromRotationTranslationScale(letterBody, body.rotation, body.position, letterScale);
  mat4.multiply(letterMatrix, state.inverse, letterBody);
  mat4.multiply(letterMatrix, letterMatrix, piece.offset);
  state.matrices.set(letterMatrix, index * 16);
}
