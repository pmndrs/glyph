import { Text, TextGroup, useFont } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { SRGBColorSpace, type PerspectiveCamera } from 'three';

import { MSDF_FONT } from '../fonts';
import { createFadingTextMaterial } from './fading-text-material';
import type { ShowcaseInteraction } from './interaction-state';
import type { PillControlState } from './pill-control-material';
import type { ShowcaseObject } from './showcase-objects';
import { createRoundedPanelMaterial } from './rounded-panel-material';
import { SCREEN_UI_FADE_SPEED, ScreenPill } from './screen-pill';
import { cameraUnitsPerPixel, showcaseUiLayout } from './ui-layout';

const PANEL_DISTANCE = 1;

export type ShowcaseControl = 'dense-exit' | 'launch';

export function ShowcaseInfoPanel({
  hoveredControl,
  interaction,
  pressedControl,
  selected,
}: {
  hoveredControl: ShowcaseControl | undefined;
  interaction: ShowcaseInteraction;
  pressedControl: ShowcaseControl | undefined;
  selected: ShowcaseObject | undefined;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const msdfFont = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const layout = useMemo(() => showcaseUiLayout(size.width, size.height), [size.height, size.width]);
  const units = cameraUnitsPerPixel(size.height, camera.fov, PANEL_DISTANCE);
  const rounded = useMemo(
    () => createRoundedPanelMaterial(layout.panel.width, layout.panel.height),
    [layout.panel.height, layout.panel.width],
  );
  const textFade = useMemo(() => createFadingTextMaterial(0), []);
  const opacity = useRef(0);
  useLayoutEffect(() => {
    rounded.setSize(layout.panel.width, layout.panel.height);
  }, [layout.panel.height, layout.panel.width, rounded]);
  useEffect(() => () => rounded.material.dispose(), [rounded]);
  useFrame((_state, delta) => {
    const target = selected !== undefined && interaction.phase !== 'closing' ? 1 : 0;
    opacity.current += (target - opacity.current) * (1 - Math.exp(-SCREEN_UI_FADE_SPEED * delta));
    rounded.setOpacity(opacity.current);
    textFade.setOpacity(opacity.current);
  });
  if (selected === undefined) return null;

  const panel = layout.panel;
  const content = layout.content;
  const controlState: PillControlState =
    pressedControl === 'launch' ? 'pressed' : hoveredControl === 'launch' ? 'hovered' : 'idle';
  return (
    <group
      name="showcase-screen-ui"
      position={[-size.width * units * 0.5, size.height * units * 0.5, -PANEL_DISTANCE]}
      scale={units}
    >
      <mesh position={[panel.x + panel.width / 2, -panel.y - panel.height / 2, 0]} renderOrder={900}>
        <planeGeometry args={[panel.width, panel.height]} />
        <primitive attach="material" object={rounded.material} />
      </mesh>
      <TextGroup compositing="ordered" material={textFade.material} name="showcase-panel-text" renderOrder={1000}>
        <Text
          constraints={{ width: { mode: 'exact', size: content.width } }}
          font={msdfFont}
          layout={{ align: 'start', wrap: 'none' }}
          position={[content.x, -content.y + 5, 0.02]}
          style={{ color: '#fff7ed', fontSize: 42 }}
        >
          {selected.label}
        </Text>
        <Text
          constraints={{ width: { mode: 'exact', size: content.width } }}
          font={msdfFont}
          layout={{ align: 'start', wrap: 'word' }}
          position={[content.x, -content.y - 54, 0.02]}
          style={{ color: '#e2e8f0', fontSize: 15, lineHeight: 1.35 }}
        >
          {selected.description}
        </Text>
      </TextGroup>
      <ScreenPill
        accent={`#${selected.color.getHexString(SRGBColorSpace)}`}
        label="Run"
        rectangle={layout.launch}
        restFillOpacity={0}
        state={controlState}
        visible={interaction.phase !== 'closing'}
      />
    </group>
  );
}
