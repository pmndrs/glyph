import type { Font, ParagraphLayoutSummary, msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { Frame, Rule } from './Frame';

const PASSAGE = 'Every line reports its box, its baseline and the heights of its primary face.';
const WIDTH = 6.4;
const LEFT = -5;
const TOP = 2.4;
const BOX = '#454d5d';
const REFERENCE = '#6f8fd8';

/**
 * `measure().lines` drawn over the paragraph it describes. Each line has a box (`baseline - ascent`, tall
 * `lineHeight`), a baseline, and the cap-height and x-height tops of its primary face; all of them are
 * distances down from the paragraph box's top edge.
 */
export default function InspectLineMetrics() {
  const inter = useMsdf(INTER);
  const [summary, setSummary] = useState<ParagraphLayoutSummary | undefined>(undefined);

  return (
    <group position={[LEFT, TOP, 0]}>
      <Text
        font={inter}
        style={{ fontSize: 0.62, color: PAPER, lineHeight: 1.7 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: WIDTH } }}
        // The summary arrives before the frame that draws the text, and again whenever it changes.
        onLayout={(_text, layout) => setSummary(layout)}
      >
        {PASSAGE}
      </Text>
      {summary?.lines.map((line) => (
        <group key={line.index}>
          <Frame x={0} y={line.baseline - line.ascent} width={summary.width} height={line.lineHeight} color={BOX} />
          <Rule x={0} y={line.capHeightTop} width={line.advance} color={REFERENCE} thickness={0.008} />
          <Rule x={0} y={line.xHeightTop} width={line.advance} color={REFERENCE} thickness={0.008} />
          <Rule x={0} y={line.baseline} width={line.advance} color={ACCENT} />
          <Note font={inter} x={WIDTH + 0.25} y={line.baseline - line.ascent + 0.05} color={PAPER_DIM}>
            {`lines[${line.index}]: text ${line.textStart} to ${line.textEnd}`}
          </Note>
          <Note font={inter} x={WIDTH + 0.25} y={line.baseline - line.ascent + 0.37} color={ACCENT}>
            {`baseline ${line.baseline.toFixed(2)}`}
          </Note>
          <Note font={inter} x={WIDTH + 0.25} y={line.baseline - line.ascent + 0.69} color={PAPER_DIM}>
            {`ascent ${line.ascent.toFixed(2)} + descent ${line.descent.toFixed(2)}`}
          </Note>
        </group>
      ))}
      {summary !== undefined && (
        <>
          <Note font={inter} x={0} y={summary.height + 0.3} color={BOX_LABEL}>
            grey: line box (lineHeight)
          </Note>
          <Note font={inter} x={3.1} y={summary.height + 0.3} color={ACCENT}>
            gold: baseline
          </Note>
          <Note font={inter} x={5} y={summary.height + 0.3} color={REFERENCE}>
            blue: capHeightTop, xHeightTop
          </Note>
        </>
      )}
    </group>
  );
}

const BOX_LABEL = '#7b8496';

/** A caption whose top-left corner is at layout `(x, y)`. */
function Note({
  font,
  x,
  y,
  color,
  children,
}: {
  readonly font: Font<typeof msdf>;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly children: string;
}) {
  return (
    <Text
      font={font}
      style={{ fontSize: 0.2, color, letterSpacing: 0.02 }}
      layout={{ wrap: 'none' }}
      position={[x, -y, 0]}
    >
      {children}
    </Text>
  );
}
