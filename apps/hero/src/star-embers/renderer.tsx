import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useWorld } from 'koota/react';
import { useEffect, useRef } from 'react';
import type { Group } from 'three/webgpu';
import { jitter } from '../utils';
import type { SlugFont } from '../hero/fonts';
import { textPrepared, usePreparation } from '../hero/prepare';
import { emberMaterial, uEmberAge, uEmberBloom } from './materials';
import { STAR_SYMBOLS } from './traits';
import { starEmberActions } from './actions';

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

  useEffect(() => {
    starEmberActions(world).mountEmberView({
      groups: groups.current,
      particles: PARTICLES,
      age: uEmberAge,
      bloom: uEmberBloom,
    });

    return () => starEmberActions(world).unmountEmberView();
  }, [world]);

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
