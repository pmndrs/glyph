import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { atan, color, float, mix, smoothstep, uniform, uv, vec2 } from 'three/tsl';
import { AdditiveBlending, type Group, MeshBasicNodeMaterial } from 'three/webgpu';

import {
  dismissCollapse,
  HOLE_CENTER,
  hole as holeState,
  holdCollapse,
  requestCollapse,
  tickCollapse,
  uHoleBlackout,
  uHoleCamera,
  uHoleSpin,
} from './hole';
import { replayCount } from './replay';
import { heroReady } from '../startup';

/** The hole sits in front of the title; the black sheet covers everything at the end. The lens over the whole
 * frame is the post-processing pass's. */
const HOLE_Z = 5;
const BLACK_Z = 7;
/** The horizon's radius on the hole's own plane, as a fraction of the plane's half size. */
const HORIZON_ON_PLANE = 0.42;
/** Planes big enough to cover the view at their depth. */
const COVER = 60;

/** The hole's own drawing, driven from the beat once a frame. */
const uPresence = uniform(0);
const uHeat = uniform(0);

function buildMaterials() {
  const point = uv().sub(0.5).mul(2);
  const radius = point.length();
  // The accretion disk: a squashed ring, swirling with the spin, hotter as the pull builds.
  const diskPoint = point.mul(vec2(1, 3.2));
  const diskRadius = diskPoint.length();
  const angle = atan(diskPoint.y, diskPoint.x);
  const swirl = angle.mul(3).sub(diskRadius.mul(18)).add(uHoleSpin).sin().mul(0.24).add(0.76);
  const disk = diskRadius.sub(0.62).pow(2).mul(-60).exp().mul(swirl);
  const photonRing = radius
    .sub(HORIZON_ON_PLANE + 0.02)
    .pow(2)
    .mul(-3400)
    .exp();
  const halo = radius
    .sub(HORIZON_ON_PLANE + 0.03)
    .max(0)
    .mul(-7)
    .exp()
    .mul(0.12);
  const glow = uHeat.mul(1.6).add(1);

  const core = new MeshBasicNodeMaterial({ color: '#000000', transparent: true, depthWrite: false });
  core.opacityNode = float(1)
    .sub(smoothstep(HORIZON_ON_PLANE - 0.02, HORIZON_ON_PLANE, radius))
    .mul(uPresence);
  core.toneMapped = false;

  const light = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  light.colorNode = mix(color('#ffa36a'), color('#b6adff'), point.y.mul(2).add(0.5).clamp())
    .mul(disk.mul(0.8).add(halo))
    .mul(glow)
    .add(color('#fff5dc').mul(photonRing).mul(glow).mul(1.3));
  light.opacityNode = smoothstep(HORIZON_ON_PLANE, HORIZON_ON_PLANE + 0.04, radius)
    .mul(float(1).sub(smoothstep(0.7, 1, radius)))
    .mul(uPresence);
  light.toneMapped = false;

  const black = new MeshBasicNodeMaterial({ color: '#000000', transparent: true, depthTest: false, depthWrite: false });
  black.opacityNode = uHoleBlackout;
  black.toneMapped = false;

  return { core, light, black };
}

/**
 * The black hole that ends the piece: opens once the robot has left, pulls every glyph in through the lattices'
 * springs, the title's bodies and the shaders' warp, then pops and leaves the frame black until Space replays.
 */
export function BlackHole() {
  const materials = useMemo(() => buildMaterials(), []);
  const camera = useThree((state) => state.camera);
  const hole = useRef<Group>(null);
  const replay = useRef(replayCount());

  useEffect(() => {
    // Development-only handle for opening and inspecting the beat from DevTools.
    if (!import.meta.env.DEV) return;
    Object.assign(globalThis, {
      heroHole: { open: requestCollapse, dismiss: dismissCollapse, hold: holdCollapse, state: holeState },
    });
  }, []);

  useFrame(
    () => {
      if (!heroReady()) return;
      // A replay clears the black and closes the hole; the robot's next exit opens it again.
      const replays = replayCount();
      if (replays !== replay.current) {
        replay.current = replays;
        dismissCollapse();
      }
      uHoleCamera.value = camera.position.z;
      const state = tickCollapse(performance.now());
      const group = hole.current;
      if (group === null) return;
      group.visible = state.beat === 'open';
      uPresence.value = state.presence;
      uHeat.value = state.pull;
      const size = Math.max(state.horizon / HORIZON_ON_PLANE, 0.001);
      group.scale.set(size, size, 1);
    },
    { phase: 'start' },
  );

  return (
    <>
      <group position={[HOLE_CENTER[0], HOLE_CENTER[1], HOLE_Z]} ref={hole} visible={false}>
        <mesh material={materials.core} renderOrder={40}>
          <planeGeometry args={[2, 2]} />
        </mesh>
        <mesh material={materials.light} position={[0, 0, 0.01]} renderOrder={41} rotation={[0, 0, -0.15]}>
          <planeGeometry args={[2, 2]} />
        </mesh>
      </group>
      <mesh frustumCulled={false} material={materials.black} position={[0, 0, BLACK_Z]} renderOrder={60}>
        <planeGeometry args={[COVER, COVER]} />
      </mesh>
    </>
  );
}
