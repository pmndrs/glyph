import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { TextGroup as ThreeTextGroup } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../stage';

/**
 * Many labels on one root. A `TextGroup` is a scene parent — it moves and
 * hides its children — while batching is the root's job: every label here
 * already shares one planner, and the draw count in the centre is what the
 * plan emitted for the whole ring.
 */
const COUNT = 48;
const LABELS = Array.from({ length: COUNT }, (_, index) => `label ${String(index + 1).padStart(2, '0')}`);

export default function Groups() {
  const inter = useMsdf(INTER);
  const renderer = useThree((state) => state.renderer);
  const ring = useRef<ThreeTextGroup>(null);
  const elapsed = useRef(0);
  const sampled = useRef(0);
  const [draws, setDraws] = useState(0);

  // Own the counter's reset so the sample always covers exactly one frame,
  // whichever end of `render()` the renderer would otherwise reset it at.
  useEffect(() => {
    renderer.info.autoReset = false;
    return () => {
      renderer.info.autoReset = true;
    };
  }, [renderer]);

  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (ring.current !== null) ring.current.rotation.z = elapsed.current * 0.08;
    const info = renderer.info.render;
    const calls = 'drawCalls' in info ? info.drawCalls : info.calls;
    if (elapsed.current - sampled.current > 0.5) {
      sampled.current = elapsed.current;
      if (calls !== draws) setDraws(calls);
    }
    renderer.info.reset();
  });

  return (
    <>
      <TextGroup ref={ring} renderOrder={1}>
        {LABELS.map((label, index) => {
          const angle = (index / COUNT) * Math.PI * 2;
          const radius = 2.4;
          return (
            <Text
              key={label}
              font={inter}
              style={{ fontSize: 0.16, color: index % 6 === 0 ? ACCENT : PAPER }}
              layout={{ align: 'center', wrap: 'none' }}
              constraints={{ width: { mode: 'exact', size: 1.2 } }}
              position={[Math.cos(angle) * radius - 0.6, Math.sin(angle) * radius + 0.08, 0]}
              rotation={[0, 0, angle]}
            >
              {label}
            </Text>
          );
        })}
      </TextGroup>
      <Text
        font={inter}
        style={{ fontSize: 0.22, color: PAPER_DIM }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 4 } }}
        position={[-2, 0.12, 0]}
      >
        {`${COUNT} labels · ${draws} draw calls`}
      </Text>
    </>
  );
}
