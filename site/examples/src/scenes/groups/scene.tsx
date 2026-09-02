import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { TextGroup as ThreeTextGroup } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { plannedDraws } from '../../lib/planned-draws';
import { ACCENT, PAPER, PAPER_DIM } from '../../stage';

/**
 * Many labels in one `TextGroup`. The group is a scene parent — it moves and
 * hides its children as one — and it is also the batching boundary: the plan
 * folds its children into a few draws, and the count in the centre is the
 * number of draw meshes it left under the root.
 */
const COUNT = 48;
const LABELS = Array.from({ length: COUNT }, (_, index) => `label ${String(index + 1).padStart(2, '0')}`);

export default function Groups() {
  const inter = useMsdf(INTER);
  const ring = useRef<ThreeTextGroup>(null);
  const [draws, setDraws] = useState(0);

  useFrame(({ scene, elapsed }) => {
    if (ring.current !== null) ring.current.rotation.z = elapsed * 0.08;
    const planned = plannedDraws(scene);
    if (planned !== draws) setDraws(planned);
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
        {`${COUNT} labels, ${draws} draws`}
      </Text>
    </>
  );
}
