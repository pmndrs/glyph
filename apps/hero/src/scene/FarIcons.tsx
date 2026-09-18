import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Group } from 'three/webgpu';

import { ICON_CODE_POINTS, type IconName } from '../content';
import type { Faces } from '../fonts';
import { ink } from '../materials/ink';

const COUNT = 40;
const ICONS = Object.keys(ICON_CODE_POINTS) as IconName[];
const COLORS = ['#24344f', '#2b2f4a', '#1f3f46', '#33304a'] as const;
const WIDTH = 4;

/** Deterministic [0, 1) hash so the far field is laid out identically on every run. */
function hash(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.545_3;
  return value - Math.floor(value);
}

const FIELD = Array.from({ length: COUNT }, (_, index) => ({
  id: `far-${String(index)}`,
  icon: ICONS[index % ICONS.length] ?? 'ankh',
  position: [(hash(index) - 0.5) * 70, (hash(index + 97) - 0.5) * 36, -26 - hash(index + 193) * 20] as const,
  roll: (hash(index + 311) - 0.5) * 0.8,
  size: 0.9 + hash(index + 419) * 1.6,
  color: COLORS[index % COLORS.length] ?? '#3d5a8a',
}));

/**
 * A far field of icons behind every word, batched in one TextGroup. The layer drifts slowly as a whole, so camera
 * parallax and the drift together keep the deep background moving. No physics: the break never touches it.
 */
export function FarIcons({ faces }: { readonly faces: Faces }) {
  const layer = useRef<Group>(null);
  useFrame(({ elapsed }) => {
    const group = layer.current;
    if (group === null) return;
    group.position.x = Math.sin(elapsed * 0.05) * 3;
    group.position.y = Math.sin(elapsed * 0.037) * 1.2;
    group.rotation.z = Math.sin(elapsed * 0.02) * 0.05;
  });

  return (
    <group ref={layer}>
      <TextGroup name="far-icons">
        {FIELD.map(({ id, icon, position, roll, size, color }) => (
          <group key={id} position={position} rotation-z={roll}>
            <Text
              constraints={{ width: { mode: 'exact', size: WIDTH } }}
              font={faces.icons}
              layout={{ align: 'center', wrap: 'none' }}
              material={ink}
              position={[-WIDTH / 2, size / 2, 0]}
              style={{ color, fontSize: size, lineHeight: 1 }}
            >
              {String.fromCodePoint(ICON_CODE_POINTS[icon])}
            </Text>
          </group>
        ))}
      </TextGroup>
    </group>
  );
}
