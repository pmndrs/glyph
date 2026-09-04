import { Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { MSDF_FONT } from '../fonts';
import { createFadingTextMaterial } from './fading-text-material';
import { createPillControlMaterial, pillControlVisual, type PillControlState } from './pill-control-material';
import type { ScreenRect } from './ui-layout';

export const SCREEN_UI_FADE_SPEED = 22;

export function ScreenPill({
  accent,
  label,
  rectangle,
  restFillOpacity = 0.95,
  state,
  visible,
}: {
  accent: string;
  label: string;
  rectangle: ScreenRect;
  restFillOpacity?: number;
  state: PillControlState;
  visible: boolean;
}) {
  const font = useFont(MSDF_FONT.src, { format: MSDF_FONT.format });
  const pill = useMemo(
    () => createPillControlMaterial(rectangle.width, rectangle.height),
    [rectangle.height, rectangle.width],
  );
  const textFade = useMemo(() => createFadingTextMaterial(0), []);
  const visual = pillControlVisual(state, accent, restFillOpacity);
  const opacity = useRef(0);
  useLayoutEffect(() => pill.setSize(rectangle.width, rectangle.height), [pill, rectangle.height, rectangle.width]);
  useLayoutEffect(() => pill.setState(state, accent, restFillOpacity), [accent, pill, restFillOpacity, state]);
  useEffect(() => () => pill.material.dispose(), [pill]);
  useFrame((_frame, delta) => {
    opacity.current += ((visible ? 1 : 0) - opacity.current) * (1 - Math.exp(-SCREEN_UI_FADE_SPEED * delta));
    pill.setOpacity(opacity.current);
    textFade.setOpacity(opacity.current);
  });

  return (
    <>
      <mesh position={[rectangle.x + rectangle.width / 2, -rectangle.y - rectangle.height / 2, 0.01]} renderOrder={950}>
        <planeGeometry args={[rectangle.width, rectangle.height]} />
        <primitive attach="material" object={pill.material} />
      </mesh>
      <TextGroup material={textFade.material} renderOrder={1000}>
        <Text
          constraints={{ width: { mode: 'exact', size: rectangle.width } }}
          font={font}
          layout={{ align: 'center', wrap: 'none' }}
          position={[rectangle.x, -rectangle.y - 8, 0.02]}
          style={{ color: visual.textColor, fontSize: 15 }}
        >
          {label}
        </Text>
      </TextGroup>
    </>
  );
}
