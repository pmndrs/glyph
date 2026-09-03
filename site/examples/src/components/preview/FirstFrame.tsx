import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';

/** Reports the first rendered frame of a mounted scene, once. */
export function FirstFrame({ onFrame }: { readonly onFrame: () => void }) {
  const reported = useRef(false);
  useFrame(() => {
    if (reported.current) return;
    reported.current = true;
    onFrame();
  });
  return null;
}
