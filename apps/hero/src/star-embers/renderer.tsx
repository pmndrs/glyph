import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useRef } from 'react';
import type { Group } from 'three/webgpu';
import { jitter } from '../random';
import type { SlugFont } from '../view/hooks';
import { heroReady, textPrepared, usePreparation } from '../view/startup';
import { emberMaterial, uEmberAge, uEmberBloom } from './materials';
import { StarEmbers, STAR_SYMBOLS, EMBER_SECONDS } from './traits';

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
export function StarEmbersRenderer({ font }: { readonly font: SlugFont }) {
  const world = useWorld();
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('star-embers', () => groups.current.length === PARTICLES.length && groups.current.every(textPrepared));

  useFrame(() => {
    if (!heroReady()) return;

    const since = world.get(StarEmbers)!.age;
    uEmberAge.value = since;
    uEmberBloom.value = since < 0 ? 0.18 : 0.75;

    for (const particle of PARTICLES) {
      const group = groups.current[particle.index];

      if (group === null || group === undefined) continue;

      const age = since - particle.delay;

      // Keep the text mounted and shaped before emission. A near-zero transform hides its prewarmed draw.
      if (age < 0 || age >= EMBER_SECONDS) {
        group.scale.setScalar(0.0001);
        continue;
      }

      const travel = 1 - Math.exp(-age * 9);
      const size = particle.size * Math.min(1, age / 0.035) * (1 - (age / EMBER_SECONDS) ** 1.4 * 0.8);
      group.position.set(particle.reachX * travel, particle.reachY * travel - age * age * 0.25, 8);
      group.rotation.z = particle.angle * 0.3 + age * particle.spin;
      group.scale.setScalar(size);
    }
  });

  return (
    <group name="star-embers">
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
              font={font}
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
