import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';

import { INTER } from '../../../fonts';
import { splitCurrentWord } from '../../../lib/typewriter';
import { ACCENT, PAPER_DIM } from '../../../theme';

/** The passage so far, its current word accented, a caret while it is still being typed. */
export function PassageLine({ typed, done }: { readonly typed: string; readonly done: boolean }) {
  const inter = useMsdf(INTER);
  const { before, current } = splitCurrentWord(typed);
  return (
    <Text
      font={inter}
      style={{ fontSize: 0.26, color: PAPER_DIM, lineHeight: 1.3 }}
      layout={{ wrap: 'word', align: 'start' }}
      constraints={{ width: { mode: 'exact', size: 7.5 } }}
      position={[-5.2, -2.25, 0.5]}
    >
      {before}
      <Text style={{ color: ACCENT }}>{current}</Text>
      <Text style={{ color: PAPER_DIM }}>{done ? '' : '|'}</Text>
    </Text>
  );
}
