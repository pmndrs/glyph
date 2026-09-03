import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { OrthographicCamera, PerspectiveCamera } from 'three/webgpu';

import type { StageOptions } from '../../../../examples/src/catalog';
import { GROUND, WORLD_WIDTH } from '../../../../examples/src/theme';

export const FOV = 32;

/**
 * What every example stands on inside a pooled root: the dark ground, a
 * camera that keeps `WORLD_WIDTH` units across the frame, lights when a scene
 * asks for them, and the readiness signal the root waits for. It commits only
 * once the scene's fonts have loaded, because it sits inside the same
 * Suspense boundary as the scene.
 */
export function ExampleStage({
  options,
  onReady,
  children,
}: {
  readonly options: StageOptions;
  readonly onReady: () => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      <color args={[GROUND]} attach="background" />
      {options.orthographic ? <PixelCamera /> : <FitWidth />}
      {options.lit && <StudioLights />}
      {children}
      <Ready onReady={onReady} />
    </>
  );
}

function Ready({ onReady }: { readonly onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

/** Keeps `WORLD_WIDTH` units visible across the frame whatever its aspect. */
export function FitWidth() {
  useFrame(({ camera, size }) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const aspect = size.width / Math.max(size.height, 1);
    // Visible height at distance d is 2·d·tan(fov/2); width is that times aspect.
    const distance = WORLD_WIDTH / 2 / Math.tan((FOV / 2) * (Math.PI / 180)) / aspect;
    if (camera.fov !== FOV || Math.abs(camera.position.z - distance) > 1e-3) {
      camera.fov = FOV;
      camera.position.z = distance;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/**
 * A pixel-unit orthographic camera: `fontSize` is then a frame pixel at DPR 1.
 * The root outlives the scene — a pooled root hosts one scene after another —
 * so the camera it replaced is put back when this scene unmounts.
 */
function PixelCamera() {
  const set = useThree((state) => state.set);
  const get = useThree((state) => state.get);
  const size = useThree((state) => state.size);
  const [camera] = useState(() => {
    const created = new OrthographicCamera(-1, 1, 1, -1, -1_000, 1_000);
    created.position.z = 10;
    return created;
  });
  useLayoutEffect(() => {
    const previous = get().camera;
    set({ camera });
    return () => set({ camera: previous });
  }, [camera, get, set]);
  useLayoutEffect(() => {
    camera.left = -size.width / 2;
    camera.right = size.width / 2;
    camera.top = size.height / 2;
    camera.bottom = -size.height / 2;
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function StudioLights() {
  return (
    <>
      <ambientLight color="#e7ecf6" intensity={0.6} />
      <directionalLight color="#f2f6ff" intensity={3.2} position={[3, 4, 4]} />
      <directionalLight color="#8fa6cc" intensity={0.5} position={[-5, -2, 3]} />
      <directionalLight color="#cfe0ff" intensity={1.2} position={[-4, 5, -4]} />
    </>
  );
}
