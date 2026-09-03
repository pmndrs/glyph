import { Canvas } from '@react-three/fiber/webgpu';
import type { ReactNode } from 'react';
import { AgXToneMapping, NoToneMapping } from 'three/webgpu';

import { GROUND } from '../../theme';
import { FOV, FitWidth } from './FitWidth';

/**
 * What every example stands on: the canvas, a camera, the dark ground, and
 * lights when a scene asks for them. A scene file is then only the text it
 * demonstrates.
 *
 * Perspective by default, with the camera pulled back each frame so that
 * `WORLD_WIDTH` units always span the viewport — scenes are authored in that
 * fixed width and stay whole in a docs iframe, a phone, or a wide monitor.
 * `orthographic` gives a pixel-unit stage for size ladders where a "px" has to
 * mean a device pixel.
 */
export interface StageOptions {
  /** Pixel-unit orthographic camera; `fontSize` is then in canvas pixels. */
  readonly orthographic?: boolean;
  /** Add a studio light rig and film-like tone mapping for PBR materials. */
  readonly lit?: boolean;
}

export function Stage({
  orthographic = false,
  lit = false,
  children,
}: StageOptions & { readonly children: ReactNode }) {
  return (
    <Canvas
      camera={
        orthographic
          ? { near: -1_000, far: 1_000, position: [0, 0, 10] }
          : { fov: FOV, near: 0.1, far: 100, position: [0, 0, 12] }
      }
      orthographic={orthographic}
      // The examples are small; a clamped DPR keeps the post targets modest on
      // a retina display without softening text at 1x.
      dpr={[1, 1.5]}
      fallback={<div className="fallback">WebGPU or WebGL2 is required to render this example.</div>}
      renderer={{ toneMapping: lit ? AgXToneMapping : NoToneMapping }}
    >
      <color args={[GROUND]} attach="background" />
      {!orthographic && <FitWidth />}
      {lit && (
        <>
          <ambientLight color="#e7ecf6" intensity={0.6} />
          <directionalLight color="#f2f6ff" intensity={3.2} position={[3, 4, 4]} />
          <directionalLight color="#8fa6cc" intensity={0.5} position={[-5, -2, 3]} />
          <directionalLight color="#cfe0ff" intensity={1.2} position={[-4, 5, -4]} />
        </>
      )}
      {children}
    </Canvas>
  );
}
