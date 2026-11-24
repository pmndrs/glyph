import type { ParagraphLayoutSummary } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { GUIDE, Label, Outline, Segment } from '../layout-kit/kit';

/**
 * Every `anchor.y` token, drawn where it falls on a two-line paragraph in a
 * box taller than its text. Grey lines come from the resolved box; gold
 * lines come from the first line's font metrics, except `last-baseline`.
 * Each position is read from `measure()`.
 */
export const HEIGHT = 3.7;

type Reference = readonly [label: string, y: number, fromBox: boolean];

function references(layout: ParagraphLayoutSummary): readonly Reference[] {
  return [
    ['top', 0, true],
    ['cap-height-top', layout.capHeightTop, false],
    ['x-height-top', layout.xHeightTop, false],
    ['first-baseline, alphabetic-baseline', layout.firstBaseline, false],
    ['ideographic-baseline', layout.ideographicBaseline, false],
    ['middle', layout.height / 2, true],
    ['last-baseline', layout.lastBaseline, false],
    ['bottom', layout.height, true],
  ];
}

export default function LayoutAnchorReferences() {
  const inter = useMsdf(INTER);
  const [layout, setLayout] = useState<ParagraphLayoutSummary | undefined>(undefined);

  return (
    <group position={[-4.7, HEIGHT / 2, 0]}>
      <Text
        font={inter}
        style={{ fontSize: 1.15, lineHeight: 1.25, color: PAPER }}
        constraints={{ height: { mode: 'exact', size: HEIGHT } }}
        onLayout={(_text, next) => setLayout(next)}
      >
        {'Glyph\nbox'}
      </Text>
      {layout !== undefined && (
        <>
          <Outline box={[0, 0, layout.width, layout.height]} />
          {references(layout).map(([label, y, fromBox]) => (
            <group key={label}>
              <Segment from={[0, y]} to={[5.6, y]} color={fromBox ? GUIDE : ACCENT} thickness={0.012} />
              <Label at={[5.8, y]} anchor={{ y: 'middle' }} color={fromBox ? PAPER_DIM : ACCENT}>
                {label}
              </Label>
            </group>
          ))}
        </>
      )}
    </group>
  );
}
