import { useThree } from '@react-three/fiber/webgpu';
import { useMemo } from 'react';
import type { PerspectiveCamera } from 'three';

import type { PillControlState } from './pill-control-material';
import { ScreenPill } from './screen-pill';
import { cameraUnitsPerPixel, showcaseUiLayout } from './ui-layout';

const PANEL_DISTANCE = 1;

export function DenseModeExit({
  accent,
  hovered,
  pressed,
  visible,
}: {
  accent: string;
  hovered: boolean;
  pressed: boolean;
  visible: boolean;
}) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const layout = useMemo(() => showcaseUiLayout(size.width, size.height), [size.height, size.width]);
  const units = cameraUnitsPerPixel(size.height, camera.fov, PANEL_DISTANCE);
  const control = layout.denseExit;
  const state: PillControlState = pressed ? 'pressed' : hovered ? 'hovered' : 'idle';

  return (
    <group
      name="showcase-dense-exit"
      position={[-size.width * units * 0.5, size.height * units * 0.5, -PANEL_DISTANCE]}
      scale={units}
    >
      <ScreenPill accent={accent} label="Go Back" rectangle={control} state={state} visible={visible} />
    </group>
  );
}
