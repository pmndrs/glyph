import { Text, TextGroup } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';
import { positionWorld, smoothstep } from 'three/tsl';
import { DoubleSide, type Group, MeshBasicNodeMaterial } from 'three/webgpu';

import { createDust, stepDust, COUNT, BASE_Z, RISE } from './robot-dust';
import { jitter } from './departure';
import { ICON_CODE_POINTS } from '../content';
import type { Faces } from '../fonts';
import { footprint } from './floor';
import { heroReady, textPrepared, usePreparation } from '../startup';

const SYMBOLS = Object.values(ICON_CODE_POINTS).map((point) => String.fromCodePoint(point));

const SLOTS = Array.from({ length: COUNT }, (_, index) => ({
  index,
  symbol: SYMBOLS[Math.floor(jitter(index + 17) * SYMBOLS.length)]!,
}));

// Height encodes lifetime, so all particles share one material and fade without re-shaping their text.
const dust = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  const material = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false });
  material.name = 'robot-glyph-dust';
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.coverage.mul(
    smoothstep(BASE_Z + RISE * 0.15, BASE_Z + RISE, positionWorld.z)
      .oneMinus()
      .mul(0.65),
  );
  return material;
});

/** A bounded trail in world space, fed by distance travelled rather than time spent on screen. */
export function RobotDust({ faces }: { readonly faces: Faces }) {
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('dust', () => groups.current.length === COUNT && groups.current.every(textPrepared));
  const simulation = useRef(useMemo(() => createDust(), []));
  useFrame((_, delta) => {
    if (!heroReady()) return;
    const state = simulation.current;
    stepDust(state, Math.min(delta, 0.1), footprint());
    for (let index = 0; index < COUNT; index++) {
      const group = groups.current[index];
      if (group == null) continue;
      const particle = state.particles[index]!;
      group.visible = particle.age < particle.life;
      if (!group.visible) continue;
      group.position.fromArray(particle.position);
      group.rotation.z = particle.roll;
      group.scale.setScalar(particle.size * (1 - (particle.age / particle.life) * 0.55));
    }
  });

  return (
    <TextGroup name="robot-glyph-dust">
      {SLOTS.map(({ index, symbol }) => (
        <group
          key={index}
          name="robot-dust-particle"
          ref={(group) => {
            groups.current[index] = group;
          }}
          visible={false}
        >
          <Text
            constraints={{ width: { mode: 'exact', size: 2 } }}
            font={faces.icons}
            layout={{ align: 'center', wrap: 'none' }}
            material={dust}
            position={[-1, 0.5, 0]}
            style={{ color: '#676779', fontSize: 1, lineHeight: 1 }}
          >
            {symbol}
          </Text>
        </group>
      ))}
    </TextGroup>
  );
}
