import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/raster/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { ATTEMPTS, PERIOD, SENTINEL, WIDTH } from './config';

/**
 * Throw at the door. Every tick tries one malformed update on the paragraph
 * and prints what came back: the error's name and message, or the fact that
 * nothing was thrown. The paragraph above is the proof that the state was
 * validated whole and left alone; the line under everything reads
 * `commitState()` and `error` back from the same object.
 */
interface Outcome {
  readonly label: string;
  readonly result: string;
  readonly threw: boolean;
}

export default function Errors() {
  const inter = useMsdf(INTER);
  const ref = useRef<ThreeText<typeof msdf>>(null);
  const [outcomes, setOutcomes] = useState<readonly Outcome[]>([]);
  const [state, setState] = useState('');
  const step = useRef(-1);

  useFrame(({ elapsed }) => {
    const text = ref.current;
    if (text === null) return;
    const index = Math.floor(elapsed / PERIOD);
    if (index === step.current) return;
    step.current = index;
    const attempt = ATTEMPTS[index % ATTEMPTS.length];
    if (attempt === undefined) return;
    let outcome: Outcome;
    try {
      attempt.apply(text);
      outcome = { label: attempt.label, result: 'nothing thrown: the update was accepted', threw: false };
    } catch (error) {
      const result = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      outcome = { label: attempt.label, result, threw: true };
    }
    setOutcomes((previous) => [...previous.slice(-1), outcome]);
    const commit = text.commitState();
    const revision = commit.status === 'committed' ? `committed at revision ${commit.revision}` : commit.status;
    setState(`commitState() ${revision}; text.error is ${text.error === undefined ? 'undefined' : 'set'}`);
  });

  return (
    <group position={[-WIDTH / 2, 2.3, 0]}>
      <Text
        ref={ref}
        font={inter}
        style={{ fontSize: 0.4, color: PAPER, lineHeight: 1.35 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: WIDTH } }}
      >
        {SENTINEL}
      </Text>
      {outcomes.map((outcome, index) => (
        <group key={`${index}-${outcome.label}`} position={[0, -1.5 - index * 1.3, 0]}>
          <Text font={inter} style={{ fontSize: 0.3, color: PAPER_DIM }} layout={{ wrap: 'none' }}>
            {`text.${outcome.label}`}
          </Text>
          <Text
            font={inter}
            style={{ fontSize: 0.3, color: outcome.threw ? ACCENT : '#ff6b6b', lineHeight: 1.3 }}
            layout={{ wrap: 'word' }}
            constraints={{ width: { mode: 'exact', size: WIDTH } }}
            position={[0, -0.42, 0]}
          >
            {outcome.result}
          </Text>
        </group>
      ))}
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, -4.75, 0]}
      >
        {state}
      </Text>
    </group>
  );
}
