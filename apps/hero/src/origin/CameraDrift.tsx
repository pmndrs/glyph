import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import { Vector3 } from 'three/webgpu';

/** Drift around the last camera pose chosen with the controls. Pause drift during dragging and zooming. */

export function CameraDrift() {
  const base = useRef<Vector3 | undefined>(undefined);
  const held = useRef(false);
  const settle = useRef(0);

  useEffect(() => {
    // Pointer and wheel input suspend drift during both dragging and zooming.
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
    const turn = (state.elapsed / 23) * Math.PI * 2;
    camera.position.set(
      anchor.x + Math.sin(turn) * 0.14,
      anchor.y + Math.sin(turn * 0.63) * 0.07,
      anchor.z + Math.cos(turn * 0.81) * 0.05,
    );
  });

  return null;
}
