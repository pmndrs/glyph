import { describe, expect, it } from 'vitest';
import { mat4 } from 'math';
import { Group, Matrix4 } from 'three/webgpu';
import { createWorld } from 'koota';
import type { Glyphs } from '@pmndrs/glyph/three';
import { Time } from '../time/traits';
import { Viewport } from '../hero/traits';
import { Pointer } from '../input/traits';
import { Collapse } from '../black-hole/traits';
import { buildLayout, createLattice, iconPaperActions } from './actions';
import { IconPaper, Impacts } from './traits';
import { advanceMorph, moveIconPaper, simulate, syncIconViews } from './systems';
import { cellMatrix } from './utils';
import type { IconLayoutOptions } from './traits';

const layer: IconLayoutOptions = {
  rows: 2,
  columns: 3,
  cell: 2,
  iconSize: 0.8,
  depth: -6,
  speed: 3.2,
  colour: '#ffffff',
  opacity: 1,
  motifs: 3,
  offset: 0,
  rowOffset: 0,
  seed: 17,
  response: 1,
  waveDelay: 0,
  waveSpeed: 15,
  waveImpulse: 146,
};

describe('icon paper motion', () => {
  it('composes the same XYZ transforms as Three, including glyph centering during a flip and collapse', () => {
    const layout = buildLayout(layer);
    const state = createLattice(layout, layer.motifs, layer.seed);
    const expected = new Group();
    const baseline = new Matrix4().makeTranslation(-0.3, 0.4, 0);
    const out = mat4.create();
    const index = 0;
    state.morph.motif = layout.motifOfCell[index]!;
    state.morph.start = 100;
    const now = 100 + (layout.cells[index]!.delay + 0.08) * 1000;
    state.x[index] = 2 - layout.restX[index]!;
    state.y[index] = -layout.restY[index]!;
    state.vx[index] = 3;
    state.vy[index] = 4;
    state.departAt[index] = 0;
    state.hole.time = 0.6;
    const grow = 1 + 1.6 / 4.35;
    const stretch = 1.225;
    expected.position.set(2, 0, 0);
    expected.rotation.set(0, Math.PI / 4, Math.atan2(4, 3));
    expected.scale.set(grow * stretch, grow / Math.sqrt(stretch), 1);
    expected.updateMatrix();
    expected.matrix.multiply(baseline);
    cellMatrix(out, state, layout, index, -0.3, 0.8, now);

    for (let lane = 0; lane < 16; lane++) expect(out[lane]).toBeCloseTo(expected.matrix.elements[lane]!, 12);
  });

  it('keeps resting cells still and confines a pointer disturbance', () => {
    const layout = buildLayout(layer);
    const state = createLattice(layout, layer.motifs, layer.seed);
    simulate(state, layout, 1 / 60, layer, 100);
    expect([...state.x, ...state.y]).toEqual(Array(layout.cells.length * 2).fill(0));
    Object.assign(state.pointer, { active: true, strength: 1, x: -1, y: 0 });

    for (let frame = 0; frame < 240; frame++) simulate(state, layout, 1 / 60, layer, (frame * 1000) / 60);

    expect(state.x.some((value) => Math.abs(value) > 0.01)).toBe(true);

    for (const value of [...state.x, ...state.y]) expect(Math.abs(value)).toBeLessThanOrEqual(2.4);
  });

  it("lets play's hole bend the sheet round itself without taking it, and springs back when it closes", () => {
    const layout = buildLayout(layer);
    const state = createLattice(layout, layer.motifs, layer.seed);
    Object.assign(state.hole, { x: 0, y: 0, horizon: 0.5, pull: 0.3, time: -1 });
    const index = layout.restX.findIndex((x, cell) => x > 0 && layout.restY[cell]! > 0);
    const restAngle = Math.atan2(layout.restY[index]!, layout.restX[index]!);
    const restDistance = Math.hypot(layout.restX[index]!, layout.restY[index]!);

    for (let frame = 0; frame < 240; frame++) simulate(state, layout, 1 / 60, layer, (frame * 1000) / 60);

    const x = layout.restX[index]! + state.x[index]!;
    const y = layout.restY[index]! + state.y[index]!;
    // The cell leans in and round the hole, held short of it by its springs, and none is swallowed.
    expect(Math.hypot(x, y)).toBeLessThan(restDistance);
    expect(Math.hypot(x, y)).toBeGreaterThan(state.hole.horizon);
    expect(Math.atan2(y, x)).toBeLessThan(restAngle - 0.05);
    expect([...state.swallowed].every((value) => value === 0)).toBe(true);

    state.hole.pull = 0;

    for (let frame = 0; frame < 240; frame++) simulate(state, layout, 1 / 60, layer, 4000 + (frame * 1000) / 60);

    for (const value of [...state.x, ...state.y]) expect(Math.abs(value)).toBeLessThan(0.02);
  });

  it('swaps a motif only at edge-on and keeps its choices distinct over repeated changes', () => {
    const layout = buildLayout(layer);
    const state = createLattice(layout, layer.motifs, layer.seed);
    advanceMorph(state, layout, 100);

    for (let cycle = 0; cycle < 12; cycle++) {
      const now = state.nextSwap;
      const before = [...state.selected];
      advanceMorph(state, layout, now);
      const motif = state.morph.motif;
      const to = state.morph.to;
      expect([...state.selected]).toEqual(before);
      advanceMorph(state, layout, now + 820.01);

      for (let index = 0; index < layout.cells.length; index++) {
        expect(state.selected[index]).toBe(layout.motifOfCell[index] === motif ? to : before[index]);
      }

      expect(new Set(state.motifGlyphs).size).toBe(layer.motifs);
    }
  });
});

describe('icon paper uploads', () => {
  it('writes every cell once, then nothing while the sheet is still, and again when the pointer disturbs it', () => {
    const world = createWorld(Time, Viewport, Pointer, Collapse, Impacts);
    iconPaperActions(world).spawnIconPaper();
    world.set(Viewport, { width: 18, height: 10, cameraZ: 16, aspect: 1.8 });
    let writes = 0;
    const glyphs = { setMatrixAt: () => writes++ } as unknown as Glyphs;
    let cells = 0;

    for (const entity of world.query(IconPaper)) {
      const count = entity.get(IconPaper)!.layout!.cells.length;
      cells += count;
      iconPaperActions(world).mountIconView(entity, {
        group: new Group(),
        glyphs,
        baselines: new Float64Array(count * 11),
        hidden: new Matrix4().makeScale(0, 0, 0),
        matrix: new Matrix4(),
        written: new Float64Array(count * 16).fill(Number.NaN),
      });
    }

    const frame = (now: number) => {
      world.set(Time, { now, delta: 1 / 60, elapsed: now / 1000 });
      moveIconPaper(world);
      syncIconViews(world);
    };

    try {
      frame(0);
      expect(writes).toBe(cells);
      writes = 0;

      for (let step = 1; step <= 30; step++) frame(step * (1000 / 60));

      expect(writes).toBe(0);
      world.set(Pointer, { x: 0, y: 0, present: true, strength: 1 });

      for (let step = 31; step <= 40; step++) frame(step * (1000 / 60));

      expect(writes).toBeGreaterThan(0);
    } finally {
      world.destroy();
    }
  });
});
