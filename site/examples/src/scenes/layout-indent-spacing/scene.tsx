import type { ParagraphLayout } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Fill, Label, Outline, Segment } from '../layout-kit/kit';

/**
 * Two stacked paragraphs, twice. On the left neither has indent or spacing.
 * On the right each has `firstLineIndent`, `spaceBefore` and `spaceAfter`.
 * The outline is each paragraph's measured box: the spacing is inside it, so
 * stacking by `measure().height` spaces the paragraphs without extra math.
 */
export const PARAGRAPHS = [
  'The first line of a paragraph may start further in than the rest. The indent applies to that one line only.',
  'Space before and space after belong to the paragraph box. The next paragraph starts where this box ends.',
] as const;

export const SPACED = { firstLineIndent: 0.45, spaceBefore: 0.3, spaceAfter: 0.42 } as const satisfies ParagraphLayout;
export const WIDTH = 4.5;

const BAND = '#3b3420';
const STYLE = { fontSize: 0.22, lineHeight: 1.35, color: PAPER } as const;

function Stack({ x, title, layout }: { readonly x: number; readonly title: string; readonly layout: ParagraphLayout }) {
  const inter = useMsdf(INTER);
  const [heights, setHeights] = useState<readonly [number, number]>([0, 0]);
  const before = layout.spaceBefore ?? 0;
  const after = layout.spaceAfter ?? 0;
  const indent = layout.firstLineIndent ?? 0;

  return (
    <group position={[x, 2.25, 0]}>
      <Label at={[0, -0.36]} size={0.19}>
        {title}
      </Label>
      {PARAGRAPHS.map((paragraph, index) => {
        const height = heights[index]!;
        return (
          <group key={paragraph} position={[0, index === 0 ? 0 : -heights[0], 0]}>
            {height > 0 && (
              <>
                {before > 0 && <Fill box={[0, 0, WIDTH, before]} color={BAND} />}
                {after > 0 && <Fill box={[0, height - after, WIDTH, after]} color={BAND} />}
                {before > 0 && (
                  <Label
                    at={[WIDTH - 0.08, before / 2]}
                    size={0.14}
                    color={ACCENT}
                    anchor={{ x: 'right', y: 'middle' }}
                  >
                    spaceBefore
                  </Label>
                )}
                {after > 0 && (
                  <Label
                    at={[WIDTH - 0.08, height - after / 2]}
                    size={0.14}
                    color={ACCENT}
                    anchor={{ x: 'right', y: 'middle' }}
                  >
                    spaceAfter
                  </Label>
                )}
                {indent > 0 && (
                  <Segment
                    from={[0, before + 0.2]}
                    to={[indent - 0.05, before + 0.2]}
                    color={ACCENT}
                    thickness={0.03}
                  />
                )}
                <Outline box={[0, 0, WIDTH, height]} />
              </>
            )}
            <Text
              font={inter}
              style={STYLE}
              layout={layout}
              constraints={{ width: { mode: 'exact', size: WIDTH } }}
              onLayout={(_text, measured) => {
                setHeights((current) => (index === 0 ? [measured.height, current[1]] : [current[0], measured.height]));
              }}
            >
              {paragraph}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

export default function LayoutIndentSpacing() {
  return (
    <>
      <Stack x={-5.1} title="no indent, no spacing" layout={{}} />
      <Stack x={0.5} title="firstLineIndent, spaceBefore, spaceAfter" layout={SPACED} />
    </>
  );
}
