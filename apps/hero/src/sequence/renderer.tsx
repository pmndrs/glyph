import { Text, TextGroup } from '@pmndrs/glyph/react';
import { emberMaterial } from './embers';
import { STAR_SYMBOLS } from './symbols';
import type { Faces } from '../typography/fonts';
import { jitter } from './departure';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';
import { atan, color, float, mix, smoothstep, uniform, uv, vec2 } from 'three/tsl';
import { AdditiveBlending, type Group, MeshBasicNodeMaterial } from 'three/webgpu';

import { BURST_SECONDS, HOLE_CENTER, PAPER_FROM, PAPER_UNTIL, type HoleState } from './motion';
import {
  uHoleCenter,
  uHoleHorizon,
  uHoleBend,
  uHoleBlackout,
  uHoleCollapse,
  uHoleBurst,
  uHoleBloom,
  uHoleSpin,
  uHoleShake,
  uHoleCamera,
} from './uniforms';
import { useWorld } from 'koota/react';
import { Sequence } from './traits';
import { clamp } from 'math';
import { easing } from 'math/time';
import { heroReady, textPrepared, usePreparation } from '../view/startup';

/** The horizon's radius on the hole's own plane, as a fraction of the plane's half size. */
const HORIZON_ON_PLANE = 0.42;

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

/** After the robot leaves, the hole pulls in the scene and fades to black. Space replays the sequence. */
export function BlackHole() {
  const world = useWorld();
  const materials = useMemo(() => buildMaterials(), []);
  const camera = useThree((state) => state.camera);
  const hole = useRef<Group>(null);

  useFrame(
    () => {
      if (!heroReady()) return;

      uHoleCamera.value = camera.position.z;
      const state = world.get(Sequence)!.hole;
      syncHoleUniforms(state);
      const group = hole.current;

      if (group === null) return;

      group.visible = state.beat === 'open';
      uPresence.value = state.presence;
      uHeat.value = state.pull;
      const size = Math.max(state.horizon / HORIZON_ON_PLANE, 0.001);
      group.scale.set(size, size, 1);
    },
    { fps: 60 },
  );

  return (
    <>
      <group position={[HOLE_CENTER[0], HOLE_CENTER[1], 5]} ref={hole} visible={false}>
        <mesh material={materials.core} renderOrder={40}>
          <planeGeometry args={[2, 2]} />
        </mesh>
        <mesh material={materials.light} position={[0, 0, 0.01]} renderOrder={41} rotation={[0, 0, -0.15]}>
          <planeGeometry args={[2, 2]} />
        </mesh>
      </group>
      <mesh frustumCulled={false} material={materials.black} position={[0, 0, 7]} renderOrder={60}>
        <planeGeometry args={[60, 60]} />
      </mesh>
    </>
  );
}

/** GPU publication is a view concern. Simulation only changes the sequence trait. */
export function syncHoleUniforms(current: HoleState): void {
  uHoleCenter.value.set(current.x, current.y);
  uHoleHorizon.value = Math.max(current.horizon, 0.001);
  uHoleBend.value = current.pull;
  uHoleBlackout.value = current.blackout;
  uHoleCollapse.value = easing.cubicIn(clamp((current.time - PAPER_FROM) / (PAPER_UNTIL - PAPER_FROM), 0, 1));
  uHoleBurst.value = current.sincePop ?? -1;
  uHoleBloom.value = current.sincePop === undefined ? 0.18 : 0.75;
  const t = Math.max(0, current.time);
  uHoleSpin.value = t * 1.2 + 3 * t ** 3;
  const shake = current.beat === 'open' ? 0.003 * current.pull * (1 - uHoleCollapse.value) : 0;
  uHoleShake.value.set(Math.sin(t * 71) * shake, Math.cos(t * 93) * shake);
}

const COLORS = ['#fff0ac', '#ffd0dc', '#cbbcff', '#b9e6ff'];
const PARTICLES = Array.from({ length: 16 }, (_, index) => ({
  index,
  symbol: STAR_SYMBOLS[index % STAR_SYMBOLS.length]!,
  color: COLORS[index % COLORS.length]!,
  angle: index * 2.39996 + jitter(index) * 0.4,
  reachX: Math.cos(index * 2.39996 + jitter(index) * 0.4) * (0.75 + jitter(index + 43) * 1.15),
  reachY: Math.sin(index * 2.39996 + jitter(index) * 0.4) * (0.75 + jitter(index + 43) * 1.15),
  size: 0.18 + jitter(index + 71) * 0.14,
  delay: jitter(index + 91) * 0.045,
  spin: (jitter(index + 121) - 0.5) * 5,
}));

/** Pastel Unicode stars flare over the black sheet, then linger as softly glowing embers. */
export function GlyphBurst({ faces }: { readonly faces: Faces }) {
  const world = useWorld();
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('burst', () => groups.current.length === PARTICLES.length && groups.current.every(textPrepared));

  useFrame(() => {
    if (!heroReady()) return;

    const since = world.get(Sequence)!.hole.sincePop;

    for (const particle of PARTICLES) {
      const group = groups.current[particle.index];

      if (group === null || group === undefined) continue;

      const age = (since ?? -1) - particle.delay;

      // Keep the text mounted and shaped before emission. A near-zero transform hides its prewarmed draw.
      if (age < 0 || age >= BURST_SECONDS) {
        group.scale.setScalar(0.0001);
        continue;
      }

      const travel = 1 - Math.exp(-age * 9);
      const size = particle.size * Math.min(1, age / 0.035) * (1 - (age / BURST_SECONDS) ** 1.4 * 0.8);
      group.position.set(particle.reachX * travel, particle.reachY * travel - age * age * 0.25, 8);
      group.rotation.z = particle.angle * 0.3 + age * particle.spin;
      group.scale.setScalar(size);
    }
  });

  return (
    <group name="hole-glyph-burst">
      <TextGroup renderOrder={70}>
        {PARTICLES.map(({ index, symbol, color: tint }) => (
          <group
            key={index}
            ref={(group) => {
              groups.current[index] = group;
            }}
            scale={0.0001}
          >
            <Text
              constraints={{ width: { mode: 'exact', size: 2 } }}
              font={faces.stars}
              layout={{ align: 'center', wrap: 'none' }}
              material={emberMaterial}
              position={[-1, 0.5, 0]}
              style={{ color: tint, fontSize: 1, lineHeight: 1 }}
            >
              {symbol}
            </Text>
          </group>
        ))}
      </TextGroup>
    </group>
  );
}
