import type { TextAnchor } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import type { Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER } from '../../theme';
import { Dot, GUIDE, Label, Outline, Segment } from '../layout-kit/kit';

/**
 * The same two lines under three anchors. The gold dot is the object's
 * position; the anchor names the point of the paragraph box that sits on it.
 * Each text rocks about its position, so the anchor is also the pivot. The
 * grey outline is the measured box, translated by `measure().anchorOffset`.
 */
export const ANCHORS = [
  { x: 'left', y: 'top' },
  { x: 'center', y: 'middle' },
  { x: 'right', y: 'last-baseline' },
] as const satisfies readonly TextAnchor[];

export const COLUMNS = [-4.3, 0, 4.3] as const;
/** Where each caption is centred; the outer two sit inward of their text so all three fit the frame. */
const CAPTIONS = [-3.6, 0, 3.6] as const;

type Placed = readonly [x: number, y: number, width: number, height: number];

export default function LayoutAnchor() {
  const inter = useMsdf(INTER);
  const pivots = useRef<(Group | null)[]>([]);
  const [boxes, setBoxes] = useState<readonly Placed[]>(ANCHORS.map(() => [0, 0, 0, 0]));

  useFrame(({ elapsed }) => {
    for (const pivot of pivots.current) {
      if (pivot !== null) pivot.rotation.z = Math.sin(elapsed * 0.8) * 0.22;
    }
  });

  return (
    <>
      {ANCHORS.map((anchor, column) => {
        const x = COLUMNS[column]!;
        return (
          <group key={anchor.y} position={[x, 0, 0]}>
            <Label at={[CAPTIONS[column]! - x, -2.2]} anchor={{ x: 'center' }} size={0.18}>
              {`x: '${anchor.x}', y: '${anchor.y}'`}
            </Label>
            <Segment from={[-0.5, 0]} to={[0.5, 0]} />
            <Segment from={[0, -0.5]} to={[0, 0.5]} />
            <Dot at={[0, 0]} color={ACCENT} />
            <group
              ref={(group) => {
                pivots.current[column] = group;
              }}
            >
              <Outline box={boxes[column]!} color={GUIDE} />
              <Text
                font={inter}
                style={{ fontSize: 0.62, lineHeight: 1.15, color: PAPER }}
                constraints={{ anchor }}
                onLayout={(_text, layout) => {
                  const placed: Placed = [layout.anchorOffset.x, layout.anchorOffset.y, layout.width, layout.height];
                  setBoxes((current) => current.map((box, index) => (index === column ? placed : box)));
                }}
              >
                {'Anchor\npoint'}
              </Text>
            </group>
          </group>
        );
      })}
    </>
  );
}
