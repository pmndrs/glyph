import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Box3DModule } from 'box3d.js';

import { buildGlyphCollider, type GlyphCollider } from './glyph-colliders';
import { GlyphPhysicsWorld, loadBox3d, PIXELS_PER_METER, STEP_SECONDS, type BodyPose } from './glyph-physics-world';
import { breakApartParagraph } from './test-support/outlined-paragraph';

const FONT_SIZE = 40;
/** Chord tolerance in em; the same value the shape tests use. */
const TOLERANCE_EM = 0.002;

let b3: Box3DModule;
const worlds: GlyphPhysicsWorld[] = [];

interface Specimen {
  readonly collider: GlyphCollider;
  /** The true outline as fine line segments in outline space (em, y down). */
  readonly segments: readonly { x0: number; x1: number; y0: number; y1: number }[];
}

async function specimen(character: string): Promise<Specimen> {
  const paragraph = await breakApartParagraph('inter', character, FONT_SIZE);
  try {
    const collider = buildGlyphCollider(paragraph.glyphs.outlineAt(0), TOLERANCE_EM);
    const segments: Specimen['segments'][number][] = [];
    for (const contour of paragraph.text.glyphs().outlineAt(0)) {
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
    return { collider, segments };
  } finally {
    paragraph.dispose();
  }
}

/** X coordinates, in em, where the horizontal line at outline-space `y` crosses the true outline, ascending. */
function crossings(segments: Specimen['segments'], y: number): number[] {
  const xs: number[] = [];
  for (const { x0, x1, y0, y1 } of segments) {
    if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
  }
  return xs.sort((left, right) => left - right);
}

function world(): GlyphPhysicsWorld {
  const created = new GlyphPhysicsWorld(b3);
  worlds.push(created);
  return created;
}

/** First hit of a ray along +x at world height `worldY` pixels, from `fromX` pixels, as an x in pixels, or undefined. */
function castRight(physics: GlyphPhysicsWorld, fromX: number, worldY: number): number | undefined {
  const origin: [number, number, number] = [fromX / PIXELS_PER_METER, worldY / PIXELS_PER_METER, 0];
  const result = b3.b3World_CastRayClosest(physics.world, origin, [20, 0, 0], b3.b3DefaultQueryFilter());
  return result.hit ? (origin[0] + 20 * result.fraction) * PIXELS_PER_METER : undefined;
}

beforeAll(async () => {
  b3 = await loadBox3d();
}, 60_000);

afterAll(() => {
  for (const created of worlds) created.dispose();
});

describe('Box3D colliders built from glyph outlines', () => {
  it.each(['o', 'e', 'A', 'B', '8', 'g'])(
    'a ray into %s first hits where the outline starts, and a ray from a counter hits the counter wall',
    async (character) => {
      const { collider, segments } = await specimen(character);
      const physics = world();
      physics.addGlyph(collider, FONT_SIZE, 0, 0);
      const { maxY, minY } = collider.bounds!;
      // Allowance: the chord tolerance, plus Box3D's linear slop (5 mm, which is 0.1 px at 20 px per metre) and rounding.
      const allowance = TOLERANCE_EM * FONT_SIZE + 0.2;
      let compared = 0;
      for (let step = 1; step < 24; step += 1) {
        const emY = minY + ((maxY - minY) * step) / 24;
        const xs = crossings(segments, emY);
        if (xs.length === 0) continue;
        const worldY = -emY * FONT_SIZE;
        // From far left: the first hit is the outline's leftmost crossing.
        const outer = castRight(physics, -4 * FONT_SIZE, worldY);
        expect(outer, `${character} outer hit at ${emY.toFixed(3)}`).toBeDefined();
        expect(Math.abs(outer! - xs[0]! * FONT_SIZE)).toBeLessThanOrEqual(allowance);
        // From just inside each gap between filled spans (a counter), the first hit is the span's next wall.
        for (let index = 1; index + 1 < xs.length; index += 2) {
          const gapStart = xs[index]!;
          const gapEnd = xs[index + 1]!;
          if ((gapEnd - gapStart) * FONT_SIZE < 1) continue;
          const hit = castRight(physics, ((gapStart + gapEnd) / 2) * FONT_SIZE, worldY);
          expect(hit, `${character} counter hit at ${emY.toFixed(3)}`).toBeDefined();
          expect(Math.abs(hit! - gapEnd * FONT_SIZE)).toBeLessThanOrEqual(allowance);
          compared += 1;
        }
      }
      // Glyphs with a counter must have exercised the counter rays at least once.
      expect(compared > 0 || !['o', 'e', 'B', '8', 'A'].includes(character)).toBe(true);
    },
    60_000,
  );

  it('creates a hull for every convex piece of every printable ASCII glyph', async () => {
    const paragraph = await breakApartParagraph(
      'inter',
      Array.from({ length: 94 }, (_, i) => String.fromCodePoint(0x21 + i)).join(''),
      24,
    );
    try {
      const physics = world();
      const { glyphs } = paragraph;
      for (let index = 0; index < glyphs.count; index += 1) {
        if (!glyphs.glyphAt(index).drawn) continue;
        physics.addGlyph(buildGlyphCollider(glyphs.outlineAt(index), 0.2 / 24), 24, index * 30, 0);
      }
      // Contextual ligatures can fuse neighbours, so the body count is the shaped glyph count, not the character count.
      expect(physics.bodyCount).toBe(glyphs.count);
      expect(physics.bodyCount).toBeGreaterThan(85);
      expect(physics.skippedPieces).toBe(0);
    } finally {
      paragraph.dispose();
    }
  }, 60_000);

  it('drops glyphs onto a floor and rests them above it, identically on every run', async () => {
    const paragraph = await breakApartParagraph('inter', 'Boxygo8', 32);
    try {
      const colliders = Array.from({ length: paragraph.glyphs.count }, (_, index) =>
        buildGlyphCollider(paragraph.glyphs.outlineAt(index), 0.2 / 32),
      );
      const run = (): BodyPose[] => {
        const physics = world();
        physics.setBounds({ floorY: -200, left: -50, right: 400 }, 8);
        colliders.forEach((collider, index) => physics.addGlyph(collider, 32, index * 34, 0));
        for (let step = 0; step < 8 / STEP_SECONDS; step += 1) physics.step();
        return colliders.map((_, index) => physics.pose(index, { angle: 0, x: 0, y: 0 }));
      };
      const first = run();
      expect(run()).toEqual(first);
      colliders.forEach((collider, index) => {
        const pose = first[index]!;
        // The lowest point of the rotated outline sits on the floor, within the contact slop, never through it.
        let lowest = Infinity;
        for (const piece of collider.pieces) {
          for (let vertex = 0; vertex < piece.length; vertex += 2) {
            const x = piece[vertex]! * 32;
            const y = -piece[vertex + 1]! * 32;
            lowest = Math.min(lowest, pose.y + x * Math.sin(pose.angle) + y * Math.cos(pose.angle));
          }
        }
        expect(lowest).toBeGreaterThanOrEqual(-200 - 1);
        expect(lowest).toBeLessThanOrEqual(-200 + 1.5);
      });
    } finally {
      paragraph.dispose();
    }
  }, 60_000);

  it('restarts every glyph at its pen position', async () => {
    const { collider } = await specimen('o');
    const physics = world();
    physics.setBounds({ floorY: -200, left: -50, right: 400 }, 8);
    physics.addGlyph(collider, FONT_SIZE, 12, -3);
    for (let step = 0; step < 90; step += 1) physics.step();
    expect(physics.pose(0, { angle: 0, x: 0, y: 0 }).y).toBeLessThan(-30);
    physics.restart();
    const pose = physics.pose(0, { angle: 1, x: 0, y: 0 });
    expect(pose.x).toBeCloseTo(12, 3);
    expect(pose.y).toBeCloseTo(-3, 3);
    expect(pose.angle).toBeCloseTo(0, 6);
  });
});
