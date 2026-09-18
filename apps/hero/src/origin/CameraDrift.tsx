import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three/webgpu';

/**
 * A slow idle wander around wherever the camera already is. The base pose is *sampled*, never assumed: whatever
 * framing you set with the controls becomes the centre of the drift, and it is re-sampled every time you let go.
 * Nothing here overrides your composition — it only breathes around it.
 *
 * Drift is suspended while the controls are in use, or the two would fight over the camera every frame.
 */
const DRIFT = new Vector3(0.14, 0.07, 0.05);
/** Seconds for the slowest axis. The others run at ratios that keep the path from visibly repeating. */
const PERIOD = 23;

export function CameraDrift() {
  const base = useRef<Vector3 | undefined>(undefined);
  const held = useRef(false);
  const settle = useRef(0);

  useEffect(() => {
    // Taken from the input rather than from the controls' own events: those are not typed on r3f's `controls`, and
    // this also brackets wheel-zoom, which a drag's start/end pair would miss entirely.
    const begin = () => {
      held.current = true;
    };
    // Re-sample on release: the framing you just chose becomes the new centre.
    const release = () => {
      held.current = false;
      base.current = undefined;
    };
    const zoomed = () => {
      held.current = true;
      window.clearTimeout(settle.current);
      settle.current = window.setTimeout(release, 220);
    };
    window.addEventListener('pointerdown', begin);
    window.addEventListener('pointerup', release);
    window.addEventListener('wheel', zoomed, { passive: true });
    return () => {
      window.clearTimeout(settle.current);
      window.removeEventListener('pointerdown', begin);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('wheel', zoomed);
    };
  }, []);

  useFrame((state) => {
    if (held.current) return;
    const camera = state.camera;
    const anchor = (base.current ??= camera.position.clone());
    const turn = (state.elapsed / PERIOD) * Math.PI * 2;
    camera.position.set(
      anchor.x + Math.sin(turn) * DRIFT.x,
      anchor.y + Math.sin(turn * 0.63) * DRIFT.y,
      anchor.z + Math.cos(turn * 0.81) * DRIFT.z,
    );
  });

  return null;
}
