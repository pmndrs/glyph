import { mat4, vec3 } from 'math';
import { Text } from '@pmndrs/glyph/react';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { Matrix4, type Group } from 'three/webgpu';
import type { Faces } from '../fonts';
import { pattern } from '../materials/ink';
import { departureAt } from './departure';
import { HORIZON, hole, type HoleState } from './hole';
import { replayCount } from './replay';
import { shockwaves } from './shockwave';
import { heroReady, usePreparation } from '../startup';
import {
  PATTERN_ANGLE,
  GLYPHS,
  POINTER_FADE,
  FIELD_OF_VIEW,
  buildLayout,
  createLattice,
  advanceMorph,
  cellMatrix,
  simulate,
  type IconLayoutOptions,
  type Layout,
  type LatticeState,
} from './icon-lattice';
export { PATTERN_ANGLE } from './icon-lattice';
export interface IconLayer extends IconLayoutOptions {
  readonly faces: Faces;
}

/**
 * One monogram layer: icons on a lattice, the sheet rotated and scrolled so it runs forever, and the lattice itself a
 * mass–spring net that an impact — or the pointer — pushes around. Cells carry a motif, so a change sweeps every icon
 * of that type, each taking its new glyph as it turns edge-on.
 */
export function IconPattern(layer: IconLayer) {
  const { faces, iconSize, depth, speed, opacity, motifs, response } = layer;
  const layout = useMemo(() => buildLayout(layer), [layer]);
  const count = layout.cells.length;

  const source = useRef<ThreeText<never> | null>(null);
  // Eleven immutable glyph choices per cell. Only the selected record has a nonzero transform, so swaps never
  // reshape text, rebuild a batch, or create a draw mesh while the film is running.
  const pool = useRef<Glyphs | undefined>(undefined);
  const baselines = useRef(useMemo(() => new Float64Array(count * GLYPHS.length), [count]));
  const hidden = useRef(new Matrix4().makeScale(0, 0, 0));
  const matrix = useRef(new Matrix4());
  usePreparation(`icons:${depth}`, () => pool.current !== undefined);
  useEffect(
    () => () => {
      pool.current?.dispose();
      pool.current = undefined;
    },
    [],
  );
  const sheet = useRef<Group>(null);
  const offset = useRef(0);
  const pointerStrength = useRef(0);
  const simulation = useRef(useMemo(() => createLattice(layout, motifs, layer.seed), [layout, motifs, layer.seed]));
  const camera = useThree((three) => three.camera);

  useEffect(() => {
    const moved = () => {
      pointerStrength.current = 1;
    };
    const left = () => {
      pointerStrength.current = 0;
    };
    window.addEventListener('pointermove', moved, { passive: true });
    window.addEventListener('pointerleave', left, { passive: true });
    return () => {
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerleave', left);
    };
  }, []);

  useFrame(({ pointer }, delta) => {
    const state = simulation.current;
    const group = sheet.current;
    if (group === null) return;
    if (pool.current === undefined) {
      const text = source.current;
      if (text === null || text.commitState().status !== 'committed') return;
      const [copies, decorations] = text.breakApart();
      decorations?.dispose();
      text.parent?.add(copies);
      text.visible = false;
      copies.name = `icon-pattern-${depth}`;
      pool.current = copies;
      for (let index = 0; index < copies.count; index++) {
        copies.setMatrixAt(index, hidden.current);
        baselines.current[index] = -copies.glyphAt(index)!.advance / 2;
      }
    }
    const copies = pool.current;
    const step = heroReady() ? Math.min(delta, 0.05) : 0;

    // The conveyor keeps trying to carry the sheet; growing gravity gradually wins over that motion.
    const collapse = hole();
    offset.current += step * speed * (1 - 0.7 * collapse.pull);
    if (collapse.beat === 'closed') offset.current %= layout.loop;
    group.position.x = -offset.current;

    group.updateWorldMatrix(true, false);
    group.matrixWorld.toArray(state.world);
    mat4.invert(state.inverse, state.world);
    collectWaves(state, layer.waveDelay);
    // Movement sets the strength; stillness lets it fall away within a fraction of a second.
    pointerStrength.current *= Math.exp(-step / POINTER_FADE);
    if (pointerStrength.current < 0.01) pointerStrength.current = 0;
    state.pointer.strength = pointerStrength.current * response;
    trackPointer(camera.position.z, pointer, state, response);
    trackHole(camera.position.z, collapse, state, layout);
    const now = performance.now();
    simulate(state, layout, step, layer, now);
    if (heroReady()) advanceMorph(state, layout, now);
    for (let index = 0; index < count; index++) {
      const selected = state.selected[index]!;
      const previous = state.previous[index]!;
      if (selected !== previous) {
        copies.setMatrixAt(index * GLYPHS.length + previous, hidden.current);
        state.previous[index] = selected;
      }
      const record = index * GLYPHS.length + selected;
      if (state.swallowed[index] === 1) copies.setMatrixAt(record, hidden.current);
      else {
        cellMatrix(state.matrix, state, layout, index, baselines.current[record]!, iconSize, now);
        copies.setMatrixAt(record, matrix.current.fromArray(state.matrix));
      }
    }
  });

  return (
    <group position={[0, 0, depth]} rotation-z={PATTERN_ANGLE}>
      <group ref={sheet}>
        <Text
          ref={source}
          font={faces.icons}
          layout={{ wrap: 'none' }}
          material={pattern}
          style={{ fontSize: iconSize, lineHeight: 1, opacity }}
        >
          {layout.cells.map((entry) => (
            <Text key={entry.key} style={{ color: entry.colour }}>
              {GLYPHS.join('')}
            </Text>
          ))}
        </Text>
      </group>
    </group>
  );
}

/**
 * Takes every impact published since the last frame into the sheet's own space, where the lattice lives. A batch that
 * arrives together — the title's letters — has its strength divided across the batch, so a five-letter word disturbs
 * the sheet about as hard as one impact did, but in the shape of the word.
 */
function collectWaves(state: LatticeState, delay: number): void {
  const pending = shockwaves();
  let batch = 0;
  for (let index = 0; index < pending.length; index += 1) if ((pending[index]?.id ?? 0) > state.seenWave) batch += 1;
  if (batch === 0) return;
  const scale = 1 / Math.sqrt(batch);
  for (let index = 0; index < pending.length; index += 1) {
    const shock = pending[index];
    if (shock === undefined || shock.id <= state.seenWave) continue;

    vec3.transformMat4(state.projected, shock.world, state.inverse);
    // Deeper layers answer a beat later, so the impact travels through the stack instead of striking it flat.
    const wave = state.waves[state.waveCursor]!;
    state.waveCursor = (state.waveCursor + 1) % state.waves.length;
    wave.start = shock.at + delay * 1000;
    wave.x = state.projected[0];
    wave.y = state.projected[1];
    wave.scale = scale;
  }
  for (let index = 0; index < pending.length; index++) state.seenWave = Math.max(state.seenWave, pending[index]!.id);
}

/** Projects the pointer onto this layer's plane and stores it in sheet space. */
function trackPointer(cameraZ: number, pointer: { x: number; y: number }, state: LatticeState, response: number): void {
  const target = state.pointer;
  if (response <= 0) {
    target.active = false;
    return;
  }
  const depth = state.world[14];
  const distance = cameraZ - depth;
  const halfHeight = Math.tan((FIELD_OF_VIEW * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * (globalThis.innerWidth / Math.max(globalThis.innerHeight, 1));
  vec3.set(state.projected, pointer.x * halfWidth, pointer.y * halfHeight, depth);
  vec3.transformMat4(state.projected, state.projected, state.inverse);
  target.x = state.projected[0];
  target.y = state.projected[1];
  target.active = true;
}

/**
 * Brings the black hole into sheet space. It sits on the camera's axis, so on this sheet it is where the sheet
 * crosses that axis, with a horizon widened by the sheet's distance from the camera. A replay gives the hole's
 * catch back and puts every cell home.
 */
function trackHole(cameraZ: number, state: HoleState, lattice: LatticeState, layout: Layout): void {
  const replays = replayCount();
  if (replays !== lattice.replays) {
    lattice.replays = replays;
    lattice.swallowed.fill(0);
    lattice.x.fill(0);
    lattice.y.fill(0);
    lattice.vx.fill(0);
    lattice.vy.fill(0);
  }
  lattice.hole.pull = state.pull;
  lattice.hole.time = state.time;
  if (state.beat === 'closed') {
    lattice.departAt.fill(Number.NaN);
    return;
  }
  // The pop takes whatever is left.
  if (state.beat === 'black') lattice.swallowed.fill(1);
  const depth = lattice.world[14];
  vec3.set(lattice.projected, state.x, state.y, depth);
  vec3.transformMat4(lattice.projected, lattice.projected, lattice.inverse);
  lattice.hole.x = lattice.projected[0];
  lattice.hole.y = lattice.projected[1];
  lattice.hole.horizon = (state.horizon * (cameraZ - depth)) / cameraZ;
  // The moment the hole opens, every cell is given its turn: nearer ones first, with some jitter.
  if (Number.isNaN(lattice.departAt[0] ?? Number.NaN)) {
    // Use visible world distance, not the repeated offscreen lattice's extent. The field reaches a new
    // band of the viewport as gravity builds, consistently at both sheet depths.
    const reachOnSheet = (HORIZON * 9 * (cameraZ - depth)) / cameraZ;
    for (let index = 0; index < lattice.departAt.length; index += 1) {
      lattice.departAt[index] = departureAt(
        Math.hypot(
          lattice.hole.x - (layout.restX[index]! + lattice.x[index]!),
          lattice.hole.y - (layout.restY[index]! + lattice.y[index]!),
        ) / reachOnSheet,
        index,
      );
    }
  }
}
