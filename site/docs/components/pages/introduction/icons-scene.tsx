import { Text, useFont } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { Group } from 'three';

import iconMap from '../../../assets/fonts/font-awesome-icons.json';
import type { GlyphSceneProps } from '../../explainer';
import { ICON_FONT } from './fonts';
import { paragraphOriginForInkCenter, paragraphTopFromCenter } from './scene-layout';
import { useSceneReady } from './use-scene-ready';

const iconCodePoints: Readonly<Record<string, number>> = iconMap.icons;
const ICONS = iconMap.names.slice(0, 5).map((name) => String.fromCodePoint(iconCodePoints[name]!));
const ICON_COLORS = ['#fb7185', '#f472b6', '#c084fc', '#818cf8', '#38bdf8'] as const;

export function IconsScene({ onReady }: GlyphSceneProps) {
  const font = useFont(ICON_FONT.input, ICON_FONT.raster.technique, ICON_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const fontSize = Math.min(viewport.width * 0.09, 1.15);
  const group = useRef<Group>(null);
  const text = useRef<ThreeText<typeof msdf>>(null);
  const ready = useRef(false);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.rotation.z = Math.sin(elapsed.current * 1.1) * 0.04;
    if (!ready.current && text.current?.commitState().status === 'committed') {
      const ink = text.current.measure().inkBounds;
      if (ink !== undefined) {
        const origin = paragraphOriginForInkCenter(ink);
        text.current.position.set(origin.x, origin.y, 0);
        ready.current = true;
      }
    }
  });
  useSceneReady(onReady);
  return (
    <group ref={group}>
      <Text
        ref={text}
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(fontSize), 0]}
        style={{ fontSize, letterSpacing: fontSize * 0.42 }}
      >
        {ICONS.map((icon, index) => (
          <Text key={icon} style={{ color: ICON_COLORS[index]! }}>
            {icon}
          </Text>
        ))}
      </Text>
    </group>
  );
}
