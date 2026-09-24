import './styles.css';

import { Text } from '@pmndrs/glyph/react';
import { createPortal } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import { type Group, OrthographicCamera, Scene } from 'three/webgpu';
import type { SlugFont } from '../loading/fonts';
import { textPrepared, usePreparation, usePreparationStatus } from '../loading/prepare';
import { uiActions } from './actions';
import { BUTTON_HEIGHT, BUTTON_WIDTH, FRAME_MARGIN, LABEL, LABEL_SIZE } from './content';
import { createFrameMaterial, labelMaterial, uPlayHover, uPlayReveal, uPlayTime } from './materials';

const scene = new Scene();
scene.name = 'play-button-sheet';
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

/** The button's own sheet and camera, rendered by the hero's post pass after the scene has gone black. */
export const playSheet = { scene, camera };

/** A framed pixel "Play" over black, drawn in with shaders once the embers have gone out. */
export function PlayButtonRenderer({ font }: { readonly font: SlugFont }) {
  const world = useWorld();
  const group = useRef<Group>(null);
  const frame = useMemo(() => createFrameMaterial(), []);
  usePreparation('play-button', () => textPrepared(group.current));

  useEffect(() => {
    uiActions(world).mountPlayButtonView({
      camera,
      reveal: uPlayReveal,
      hover: uPlayHover,
      time: uPlayTime,
      root: document.documentElement,
    });

    return () => {
      uiActions(world).unmountPlayButtonView();
      delete document.documentElement.dataset.heroHover;
    };
  }, [world]);

  useEffect(() => () => frame.dispose(), [frame]);

  return createPortal(
    <group ref={group} name="play-button">
      <mesh material={frame}>
        <planeGeometry args={[BUTTON_WIDTH + 2 * FRAME_MARGIN, BUTTON_HEIGHT + 2 * FRAME_MARGIN]} />
      </mesh>
      <Text
        constraints={{ width: { mode: 'exact', size: BUTTON_WIDTH } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        material={labelMaterial}
        position={[-BUTTON_WIDTH / 2, LABEL_SIZE * 0.62, 0.01]}
        style={{ color: '#ffffff', fontSize: LABEL_SIZE, letterSpacing: 0.02, lineHeight: 1 }}
      >
        {LABEL}
      </Text>
    </group>,
    scene,
  );
}

/** Covers preparation frames. Failures stay visible instead of starting a partially prepared recording. */
export function HeroLoading() {
  const { phase: current, failure } = usePreparationStatus();

  return (
    <output
      className="hero-loading"
      data-ready={current === 'ready'}
      aria-label={current === 'failed' ? undefined : 'Loading scene'}
      aria-hidden={current === 'ready'}
    >
      {current === 'failed' ? (
        `Unable to prepare scene: ${failure}`
      ) : (
        <svg viewBox="0 0 42.5 42.5" aria-hidden="true">
          <path d="M15 0h27.5v27.5h-12.5v-15h-15z M0 15h12.5v12.5h-12.5z M15 15h12.5v12.5h-12.5z M15 30h12.5v12.5h-12.5z" />
        </svg>
      )}
    </output>
  );
}
