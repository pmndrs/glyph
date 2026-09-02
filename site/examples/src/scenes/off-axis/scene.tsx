import { Text } from '@pmndrs/glyph/react';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { PAPER } from '../../stage';

/**
 * A paragraph read from an angle. Text is geometry in the scene, so the
 * camera's perspective applies to it like anything else. Slug is the format
 * to reach for here: it evaluates the outline per pixel, so a grazing angle
 * costs nothing in edge quality, where a texture-backed format is sampling a
 * stretched atlas.
 */
export default function OffAxis() {
  const inter = useSlug(INTER);
  const panel = useRef<Group>(null);
  const elapsed = useRef(0);

  useFrame((_state, delta) => {
    elapsed.current += delta;
    const p = elapsed.current * 0.55;
    const node = panel.current;
    if (node === null) return;
    node.rotation.set(
      -0.08 + Math.sin(p * 0.83) * 0.18,
      0.62 + Math.sin(p + Math.PI / 2) * 0.2,
      Math.sin(p * 0.47) * 0.06,
    );
    node.position.z = -(1.2 + Math.sin(p * 0.61) * 0.5);
  });

  return (
    <group ref={panel} position={[0.8, 0, 0]}>
      <Text
        font={inter}
        style={{ fontSize: 0.52, color: PAPER, lineHeight: 1.3 }}
        layout={{ wrap: 'word', align: 'center' }}
        constraints={{ width: { mode: 'exact', size: 7.5 } }}
        position={[-3.75, 1.7, 0]}
      >
        Render <Text style={{ color: '#a855f7' }}>shaped</Text> text directly in your{' '}
        <Text style={{ color: '#22d3ee' }}>canvas</Text>, without the DOM. It{' '}
        <Text style={{ color: '#34d399' }}>reflows</Text> at runtime and uses the scene camera and depth.{' '}
        <Text style={{ color: '#f59e0b' }}>Bitmap</Text>, <Text style={{ color: '#fb7185' }}>MSDF</Text>,{' '}
        <Text style={{ color: '#ff4dc4' }}>Slug</Text>.
      </Text>
    </group>
  );
}
