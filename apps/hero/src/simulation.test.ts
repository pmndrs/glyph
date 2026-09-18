import { describe, expect, it } from 'vitest';
import { mat4 } from 'math';
import { Group, Matrix4 } from 'three/webgpu';
import Box3D from 'box3d.js/inline';
import {
  advanceMorph,
  buildLayout,
  cellMatrix,
  createLattice,
  simulate,
  type IconLayoutOptions,
} from './field/lattice';
import { createRobotMotion, layPath, poseAt, RUN_SECONDS } from './robot/motion';
import { createDust, stepDust, COUNT } from './robot/dust';
import { ROBOT_HALF_EXTENTS } from './robot/traits';
import { createTitleWorld, destroyTitleWorld, holdLetter, releaseLetter, stepTitleWorld } from './typography/physics';

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

describe('retained lattice', () => {
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
    expect(cellMatrix(out, state, layout, index, -0.3, 0.8, now)).toBe(out);
    for (let lane = 0; lane < 16; lane++) expect(out[lane]).toBeCloseTo(expected.matrix.elements[lane]!, 12);
  });

  it('keeps resting cells still and confines a pointer disturbance with fixed storage', () => {
    const layout = buildLayout(layer);
    const state = createLattice(layout, layer.motifs, layer.seed);
    const positions = state.x;
    simulate(state, layout, 1 / 60, layer, 100);
    expect([...state.x, ...state.y]).toEqual(Array(layout.cells.length * 2).fill(0));
    Object.assign(state.pointer, { active: true, strength: 1, x: -1, y: 0 });
    for (let frame = 0; frame < 240; frame++) simulate(state, layout, 1 / 60, layer, (frame * 1000) / 60);
    expect(state.x).toBe(positions);
    expect(state.x.some((value) => Math.abs(value) > 0.01)).toBe(true);
    for (const value of [...state.x, ...state.y]) expect(Math.abs(value)).toBeLessThanOrEqual(2.4);
  });

  it('swaps a motif only at edge-on and keeps its choices distinct over repeated changes', () => {
    const layout = buildLayout(layer);
    const state = createLattice(layout, layer.motifs, layer.seed);
    advanceMorph(state, layout, 100);
    const selected = state.selected;
    for (let cycle = 0; cycle < 12; cycle++) {
      const now = state.nextSwap;
      const before = [...state.selected];
      advanceMorph(state, layout, now);
      const motif = state.morph.motif;
      const to = state.morph.to;
      expect([...state.selected]).toEqual(before);
      advanceMorph(state, layout, now + 820.01);
      expect(state.selected).toBe(selected);
      for (let index = 0; index < layout.cells.length; index++) {
        expect(state.selected[index]).toBe(layout.motifOfCell[index] === motif ? to : before[index]);
      }
      expect(new Set(state.motifGlyphs).size).toBe(layer.motifs);
    }
  });
});

describe('robot motion and dust', () => {
  it('arrives at the authored stop, looks up, and leaves beyond the viewport using the same pose record', () => {
    const state = createRobotMotion();
    for (const run of [0, 1, 2, 10]) {
      expect(layPath(state.path, 20, 12, run)).toBe(state.path);
      poseAt(state.pose, 0, state.path);
      expect(state.pose.x < -10 || state.pose.y < -6).toBe(true);
      expect(poseAt(state.pose, 4, state.path)).toBe(state.pose);
      expect(state.pose.x).toBeCloseTo(-0.4, 12);
      expect(state.pose.y).toBeCloseTo(0.3, 12);
      expect(state.pose.look).toBe(1);
      poseAt(state.pose, RUN_SECONDS, state.path);
      expect(state.pose.x > 10 || state.pose.y > 6).toBe(true);
    }
  });

  it('copies borrowed robot positions, emits by distance, fades, and does not emit across teleports', () => {
    const state = createDust();
    const footprint = { x: 0, y: 0, z: 0, heading: 0, halfExtents: ROBOT_HALF_EXTENTS };
    const slot = state.particles[0]!;
    const position = slot.position;
    stepDust(state, 1 / 60, footprint);
    footprint.x = 0.36;
    stepDust(state, 1 / 60, footprint);
    expect(state.emitted).toBe(4);
    expect(slot.age).toBe(0);
    expect(slot.position).toBe(position);
    footprint.x = 10;
    stepDust(state, 1 / 60, footprint);
    expect(state.emitted).toBe(4);
    for (let frame = 0; frame < 120; frame++) stepDust(state, 1 / 60, undefined);
    expect(state.particles.every((particle) => particle.age >= particle.life)).toBe(true);
    expect(state.particles).toHaveLength(COUNT);
    expect(state.particles[0]).toBe(slot);
  });
});

it('copies held targets and reports a physical landing once using retained event buffers', async () => {
  const b3 = await Box3D();
  const state = createTitleWorld(
    b3,
    [
      {
        position: [0, 0, 0.5],
        prisms: [
          [
            -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
            0.5, 0.5, 0.5, 0.5, 0.5,
          ],
        ],
      },
    ],
    0,
    ROBOT_HALF_EXTENTS,
  );
  try {
    const poses = state.poses;
    const landed = state.landed;
    const pose = { x: 0, y: 0, z: 4, yaw: 0.2 };
    holdLetter(state, 0, pose);
    pose.z = 100;
    stepTitleWorld(state, 1 / 60, undefined);
    expect(state.poses[2]).toBe(4);
    releaseLetter(state, 0, [0, 0, -10], 0);
    let landings = 0;
    for (let frame = 0; frame < 240; frame++) {
      stepTitleWorld(state, 1 / 60, undefined);
      landings += state.landedCount;
    }
    expect(landings).toBe(1);
    expect(state.poses[2]).toBeCloseTo(0.5, 1);
    expect(state.poses).toBe(poses);
    expect(state.landed).toBe(landed);
  } finally {
    destroyTitleWorld(state);
  }
});
