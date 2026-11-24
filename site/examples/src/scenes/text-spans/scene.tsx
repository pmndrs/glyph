import { Text, useMsdf, useSlug } from '@pmndrs/glyph/react';

import { INTER, PLAYWRITE } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * One paragraph, seven spans. Each nested `<Text>` names the one thing it
 * changes and inherits the rest from the paragraph: color, size, spacing, a
 * decoration, opacity, a second font, and a span nested inside a span. The
 * paragraph is still shaped and wrapped as one unit, so the line breaks do
 * not care where the spans are.
 */
export const BLUE = '#70d6ff';

export default function Spans() {
  const inter = useMsdf(INTER);
  const script = useSlug(PLAYWRITE);

  return (
    <>
      <Text
        font={inter}
        style={{ fontSize: 0.15, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[-4.4, 2.35, 0]}
      >
        {'one <Text>, seven nested <Text> spans'}
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.4, color: PAPER, lineHeight: 1.5 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: 8.8 } }}
        position={[-4.4, 1.95, 0]}
      >
        A span can change the <Text style={{ color: ACCENT }}>color</Text>, the{' '}
        <Text style={{ fontSize: 0.58 }}>size</Text>, the <Text style={{ letterSpacing: 0.12 }}>spacing</Text>, add a{' '}
        <Text style={{ decoration: { underline: true, color: BLUE } }}>decoration</Text>, fade to{' '}
        <Text style={{ opacity: 0.35 }}>a lower opacity</Text>, or switch the font to{' '}
        <Text font={script} style={{ fontSize: 0.62 }}>
          glyph
        </Text>
        . Spans nest:{' '}
        <Text style={{ color: BLUE }}>
          the outer span is blue and <Text style={{ decoration: { underline: true, color: BLUE } }}>the inner one</Text>{' '}
          inherits it
        </Text>
        .
      </Text>
    </>
  );
}
