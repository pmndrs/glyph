import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/raster/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import type { Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { typistFrame } from '../../lib/typewriter';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { FONT_SIZE, LINES, RATES, runsOf } from './config';

/**
 * A keystroke is a whole new document. Each tick restates the line as nested
 * runs — the state word coloured, the numbers in the accent — and the text
 * derives the one scalar-aligned replace from the previous string. The runs
 * keep their identity across the edit; the counter under the line reads the
 * committed revision back from `commitState()`.
 */
export default function Editing() {
  const inter = useMsdf(INTER);
  const ref = useRef<ThreeText<typeof msdf>>(null);
  const caret = useRef<Mesh>(null);
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState('');
  const shown = useRef('');
  const keystrokes = useRef(0);
  const reported = useRef('');

  useFrame(({ elapsed }) => {
    const frame = typistFrame(LINES, elapsed, RATES);
    const next = (LINES[frame.line] ?? '').slice(0, frame.shown);
    if (next !== shown.current) {
      shown.current = next;
      keystrokes.current += 1;
      setTyped(next);
    }
    const text = ref.current;
    if (text === null) return;
    const commit = text.commitState();
    const revision = commit.status === 'committed' ? `revision ${commit.revision}` : commit.status;
    const line = `${keystrokes.current} keystrokes, ${keystrokes.current} calls to set(), ${revision}`;
    if (line !== reported.current) {
      reported.current = line;
      setStatus(line);
    }
    const mesh = caret.current;
    if (mesh !== null) {
      // Cheap: an unchanged paragraph answers from the retained summary.
      const measured = text.measure();
      mesh.position.set(measured.contentWidth + 0.06, -measured.contentHeight / 2, 0);
      mesh.visible = elapsed % 1 < 0.6;
    }
  });

  const runs = runsOf(typed);
  return (
    <group position={[-4.7, 0.55, 0]}>
      <Text ref={ref} font={inter} style={{ fontSize: FONT_SIZE, color: PAPER }} layout={{ wrap: 'none' }}>
        {runs.length === 0
          ? ' '
          : runs.map((run, index) =>
              run.color === undefined ? (
                run.text
              ) : (
                <Text key={index} style={{ color: run.color }}>
                  {run.text}
                </Text>
              ),
            )}
      </Text>
      <mesh ref={caret}>
        <planeGeometry args={[0.05, FONT_SIZE * 1.1]} />
        <meshBasicNodeMaterial color={ACCENT} />
      </mesh>
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, -1.15, 0]}
      >
        {status}
      </Text>
    </group>
  );
}
