import { type Font, parse } from 'opentype.js';
import { ShapePath, ShapeUtils, type Vector2 } from 'three/webgpu';

/** Invisible convex prisms extruded from a glyph outline and centered on its ink box. */
export interface Solid {
  /** Each prism is a flat `[x, y, z, ...]` list of the six corners of one triangle through the thickness. */
  readonly prisms: readonly (readonly number[])[];
}

/** Fetches and parses a font file. The outlines come straight from the source the title face was baked from. */
export async function loadFont(url: string): Promise<Font> {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`could not load ${url}: ${response.status} ${response.statusText}`);

  return parse(await response.arrayBuffer());
}

/**
 * Triangulates one character of `font` at `fontSize` per em and extrudes each triangle through `thickness`, so
 * the physics meets the letter exactly where glyph draws it.
 */
export function solidOf(font: Font, character: string, fontSize: number, thickness: number): Solid {
  const outline = new ShapePath();

  // opentype.js hands back canvas coordinates, y downwards. The scene's y is up.
  for (const command of font.charToGlyph(character).getPath(0, 0, fontSize).commands) {
    const x = command.x ?? 0;
    const y = -(command.y ?? 0);

    switch (command.type) {
      case 'M':
        outline.moveTo(x, y);
        break;
      case 'L':
        outline.lineTo(x, y);
        break;
      case 'Q':
        outline.quadraticCurveTo(command.x1 ?? 0, -(command.y1 ?? 0), x, y);
        break;
      case 'C':
        outline.bezierCurveTo(command.x1 ?? 0, -(command.y1 ?? 0), command.x2 ?? 0, -(command.y2 ?? 0), x, y);
        break;
      case 'Z':
        break;
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

  if (!Number.isFinite(minX)) throw new Error(`no outline for ${JSON.stringify(character)}`);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const prisms: number[][] = [];
  const half = thickness / 2;

  for (const { shape: contour, holes } of points) {
    const vertices: Vector2[] = [...contour, ...holes.flat()];

    for (const triangle of ShapeUtils.triangulateShape(contour, holes)) {
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
