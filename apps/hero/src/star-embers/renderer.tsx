import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useWorld } from 'koota/react';
import { useEffect, useRef } from 'react';
import type { Group } from 'three/webgpu';
import type { SlugFont } from '../loading/fonts';
import { textPrepared, usePreparation } from '../loading/prepare';
import { emberMaterial, uEmberAge, uEmberBloom } from './materials';
import { PARTICLES } from './content';
import { starEmberActions } from './actions';

/** Pastel Unicode stars flare over the black sheet, then linger as softly glowing embers. */
export function StarEmbersRenderer({ font }: { readonly font: SlugFont }) {
  const world = useWorld();
  const groups = useRef<(Group | null)[]>([]);
  usePreparation('star-embers', () => groups.current.length === PARTICLES.length && groups.current.every(textPrepared));

  useEffect(() => {
    starEmberActions(world).mountEmberView({
      groups: groups.current,
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
