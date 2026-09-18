import { trait } from 'koota';
import { vec3 } from 'math';
import { createHoleState } from './motion';

/** One clock and input sample for every domain. Dimensions describe the floor plane. */
export const Frame = trait(() => ({
  ready: false,
  now: 0,
  delta: 0,
  elapsed: 0,
  width: 1,
  height: 1,
  cameraZ: 16,
  aspect: 1,
  pointer: { x: 0, y: 0, strength: 0 },
}));

export const Sequence = trait(() => ({
  replays: 0,
  openedAt: undefined as number | undefined,
  held: undefined as number | undefined,
  hole: createHoleState(),
  impacts: Array.from({ length: 16 }, () => ({ id: 0, at: 0, world: vec3.create() })),
  nextImpact: 1,
  latestImpact: -1,
}));
