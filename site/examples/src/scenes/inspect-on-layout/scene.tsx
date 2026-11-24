import type { Font, msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import type { Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { PAPER, PAPER_DIM } from '../../theme';

const MESSAGES = [
  'Saved',
  'Three files changed',
  'The panel is sized in onLayout, before the frame that draws this text.',
  'Longer text wraps, and the panel grows with it: one callback, no frame of lag.',
] as const;
/** Seconds each message stays. */
const HOLD = 1.8;
const MAX_WIDTH = 4;
const PADDING = 0.28;
const PANEL = '#1c2536';

/**
 * A panel that always fits its text. On the right, `onLayout` receives the summary `measure()` returns
 * before the frame that draws the text, and scales the panel from it. On the left the same text sits on a
 * panel of fixed size, which fits one message at best.
 */
export default function InspectOnLayout() {
  const inter = useMsdf(INTER);
  const [message, setMessage] = useState(0);
  const [size, setSize] = useState('');
  const panel = useRef<Mesh>(null);

  useFrame(({ elapsed }) => {
    const next = Math.floor(elapsed / HOLD) % MESSAGES.length;
    if (next !== message) setMessage(next);
  });

  return (
    <>
      <group position={[-4.7, 1.7, 0]}>
        <Heading font={inter}>a panel of fixed size</Heading>
        <mesh position={[1.4, -0.45, -0.02]}>
          <planeGeometry args={[2.8 + PADDING * 2, 0.9 + PADDING * 2]} />
          <meshBasicNodeMaterial color={PANEL} />
        </mesh>
        <Message font={inter}>{MESSAGES[message]!}</Message>
      </group>
      <group position={[0.6, 1.7, 0]}>
        <Heading font={inter}>{`sized in onLayout: ${size}`}</Heading>
        {/* A unit plane: the callback writes its scale and position, which are not layout inputs. */}
        <mesh ref={panel} position={[0, 0, -0.02]} scale={[0, 0, 1]}>
          <planeGeometry args={[1, 1]} />
          <meshBasicNodeMaterial color={PANEL} />
        </mesh>
        <Text
          font={inter}
          style={{ fontSize: 0.36, color: PAPER, lineHeight: 1.4 }}
          layout={{ wrap: 'word' }}
          constraints={{ width: { mode: 'at-most', size: MAX_WIDTH } }}
          onLayout={(_text, layout) => {
            const mesh = panel.current;
            if (mesh === null) return;
            // The paragraph box hangs down from the text's origin: +Y is down in layout, up in three.js.
            mesh.scale.set(layout.width + PADDING * 2, layout.height + PADDING * 2, 1);
            mesh.position.set(layout.width / 2, -layout.height / 2, -0.02);
            setSize(`${layout.width.toFixed(2)} x ${layout.height.toFixed(2)}`);
          }}
        >
          {MESSAGES[message]!}
        </Text>
      </group>
    </>
  );
}

function Heading({ font, children }: { readonly font: Font<typeof msdf>; readonly children: string }) {
  return (
    <Text
      font={font}
      style={{ fontSize: 0.22, color: PAPER_DIM, letterSpacing: 0.02 }}
      layout={{ wrap: 'none' }}
      position={[-PADDING, 0.85, 0]}
    >
      {children}
    </Text>
  );
}

function Message({ font, children }: { readonly font: Font<typeof msdf>; readonly children: string }) {
  return (
    <Text
      font={font}
      style={{ fontSize: 0.36, color: PAPER, lineHeight: 1.4 }}
      layout={{ wrap: 'word' }}
      constraints={{ width: { mode: 'at-most', size: MAX_WIDTH } }}
    >
      {children}
    </Text>
  );
}
