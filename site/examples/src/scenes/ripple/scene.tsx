import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { passageAt, passageFrame, splitCurrentWord } from '../../lib/typewriter';
import { PAPER, PAPER_DIM } from '../../theme';
import { COLUMN, FONT_SIZE, LINE_HEIGHT } from './config';
import { rippleInk } from './materials';

/**
 * Live text through a vertex transform.
 *
 * The passage types itself out: every character restates the paragraph, which reshapes it, breaks
 * its lines again, and hands the renderer a different set of glyphs. Meanwhile the material walks
 * a sine along the reading direction and lifts each glyph as the crest reaches it. Neither knows
 * about the other — the wave is a function of position and time on the GPU, so it costs the same
 * whether the text is still or being retyped a character at a time, and the letters that arrive
 * mid-crest simply appear already riding it.
 */
export default function Ripple() {
  const inter = useMsdf(INTER);
  const [frame, setFrame] = useState({ passage: 0, shown: 0 });

  useFrame(({ elapsed }) => {
    const next = passageFrame(elapsed);
    if (next.passage !== frame.passage || next.shown !== frame.shown) setFrame(next);
  });

  const passage = passageAt(frame.passage);
  const typed = passage.slice(0, frame.shown);
  const { before, current } = splitCurrentWord(typed);

  return (
    <Text
      font={inter}
      material={rippleInk}
      style={{ fontSize: FONT_SIZE, color: PAPER, lineHeight: LINE_HEIGHT }}
      layout={{ wrap: 'word', align: 'center' }}
      constraints={{ width: { mode: 'exact', size: COLUMN.width } }}
      position={[...COLUMN.position]}
    >
      {before}
      <Text style={{ color: PAPER }}>{current}</Text>
      <Text style={{ color: PAPER_DIM }}>{frame.shown < passage.length ? '|' : ''}</Text>
    </Text>
  );
}
