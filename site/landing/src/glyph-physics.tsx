import { Canvas } from '@react-three/fiber/webgpu';
import { Suspense, useCallback, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { GlyphPhysicsScene } from '../../docs/components/introduction-glyph';
import { GlyphInputStream } from '../../docs/components/glyph-channel';
import './glyph-physics.css';

function DirectGlyphPhysics() {
  const inputs = useMemo(() => new GlyphInputStream(), []);
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('autopulse')) return;
    const timer = window.setTimeout(() => inputs.push({ type: 'pointerdown', x: 405, y: 204 }), 2_500);
    return () => window.clearTimeout(timer);
  }, [inputs]);
  const pointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      inputs.push({ type: 'pointerdown', x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    },
    [inputs],
  );

  return (
    <main className="physics-stage" onPointerDownCapture={pointerDown}>
      <Canvas
        camera={{ far: 100, fov: 35, near: 0.01, position: [0, 0, 7] }}
        dpr={[1, 2]}
        fallback={<p className="physics-fallback">WebGPU or WebGL2 is required for this demo.</p>}
        frameloop="always"
      >
        <color args={['#070b14']} attach="background" />
        <Suspense fallback={null}>
          <GlyphPhysicsScene inputs={inputs} onReady={() => undefined} scene="physics" />
        </Suspense>
      </Canvas>
    </main>
  );
}

const root = document.querySelector('#root');
if (root === null) throw new Error('glyph physics root is missing');
createRoot(root).render(<DirectGlyphPhysics />);
