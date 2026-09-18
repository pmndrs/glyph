import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Group } from 'three/webgpu';

import { emberMaterial } from '../materials/embers';

import { STAR_SYMBOLS } from '../star-symbols';
import type { Faces } from '../fonts';
import { jitter } from './departure';
import { BURST_SECONDS, hole } from './hole';
import { heroReady, textPrepared, usePreparation } from '../startup';

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
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('burst', () => groups.current.length === PARTICLES.length && groups.current.every(textPrepared));
  useFrame(() => {
    if (!heroReady()) return;
    const since = hole().sincePop;
    for (const particle of PARTICLES) {
      const group = groups.current[particle.index];
      if (group === null || group === undefined) continue;
      const age = (since ?? -1) - particle.delay;
      // Keep the text mounted and shaped before emission; a near-zero transform hides its prewarmed draw.
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
        {PARTICLES.map(({ index, symbol, color }) => (
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
              style={{ color, fontSize: 1, lineHeight: 1 }}
            >
              {symbol}
            </Text>
          </group>
        ))}
      </TextGroup>
    </group>
  );
}
