import { GlyphProvider, Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * Three providers, two roots, one face. A string names a root on the
 * built-in default handle, and the same string is the same root, so the
 * third provider joins the first. The text with no provider draws on the
 * store's own default root. The line at the bottom is read off the scene:
 * every root attaches one draw object named `@pmndrs/glyph:<root>`, and each
 * planned draw is one child under it.
 */
const ROOT_PREFIX = '@pmndrs/glyph:';
const BLUE = '#70d6ff';

export default function Provider() {
  const inter = useMsdf(INTER);
  const scene = useThree((state) => state.scene);
  const [roots, setRoots] = useState<readonly string[]>([]);
  const reported = useRef('');

  useFrame(() => {
    const found: string[] = [];
    scene.traverse((object) => {
      if (!object.name.startsWith(ROOT_PREFIX)) return;
      const draws = object.children.length;
      found.push(`${object.name.slice(ROOT_PREFIX.length)} with ${draws} draw${draws === 1 ? '' : 's'}`);
    });
    const key = found.join('|');
    if (key === reported.current) return;
    reported.current = key;
    setRoots(found);
  });

  return (
    <>
      <GlyphProvider handle="left">
        <Text font={inter} style={{ fontSize: 0.5, color: ACCENT }} layout={{ wrap: 'none' }} position={[-5.2, 1.9, 0]}>
          handle="left"
        </Text>
      </GlyphProvider>
      <GlyphProvider handle="right">
        <Text font={inter} style={{ fontSize: 0.5, color: BLUE }} layout={{ wrap: 'none' }} position={[0.6, 1.9, 0]}>
          handle="right"
        </Text>
      </GlyphProvider>
      <GlyphProvider handle="left">
        <Text font={inter} style={{ fontSize: 0.5, color: ACCENT }} layout={{ wrap: 'none' }} position={[-5.2, 1.0, 0]}>
          handle="left" again: the same root
        </Text>
      </GlyphProvider>
      <Text font={inter} style={{ fontSize: 0.5, color: PAPER }} layout={{ wrap: 'none' }} position={[-5.2, -0.1, 0]}>
        no provider: this store's default root
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.28, color: PAPER_DIM, lineHeight: 1.45, letterSpacing: 0.02 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: 10.4 } }}
        position={[-5.2, -1.2, 0]}
      >
        {roots.length === 0
          ? 'waiting for the first frame'
          : `${roots.length} roots in one scene, one face loaded once: ${roots.join('; ')}`}
      </Text>
    </>
  );
}
