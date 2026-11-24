import type { Font, TextCaret, TextPosition, msdf, slug } from '@pmndrs/glyph';
import { Text, useMsdf, useSlug } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { AMIRI, BOUNDARY, FONT_SIZE, PASSAGE } from './config';

/** Seconds the walking caret rests on each stop. */
const STEP = 0.6;

interface Walk {
  readonly width: number;
  readonly split: TextCaret;
  readonly stops: readonly { readonly position: TextPosition; readonly caret: TextCaret }[];
}

/**
 * One offset, two places. Offset 4 is where the Latin run ends and the Arabic run starts: `downstream` puts
 * the caret on the Arabic letter's leading edge, at the right of its run, and `secondary` is where `upstream`
 * would draw it. Below, `move(position, 'right', 'grapheme')` walks the line in x order while the offsets run
 * backward through the Arabic.
 */
export default function EditingBidiCaret() {
  // Both fonts load before the first commit: a font that suspended later would unmount the scene.
  const inter = useMsdf(INTER);
  const amiri = useSlug(AMIRI);
  const ref = useRef<ThreeText<typeof slug>>(null);
  const [walk, setWalk] = useState<Walk | undefined>(undefined);
  const [at, setAt] = useState(0);

  useFrame(({ elapsed }) => {
    const text = ref.current;
    if (text === null) return;
    if (walk === undefined) {
      setWalk({
        width: text.measure().width,
        split: text.caret({ offset: BOUNDARY, affinity: 'downstream' }),
        stops: walkRight(text),
      });
      return;
    }
    const next = Math.floor(elapsed / STEP) % walk.stops.length;
    if (next !== at) setAt(next);
  });

  const left = walk === undefined ? -3 : -walk.width / 2;
  const stop = walk?.stops[at];
  const secondary = walk?.split.secondary;
  return (
    <>
      <group position={[left, 2.3, 0]}>
        <Text ref={ref} font={amiri} style={{ fontSize: FONT_SIZE, color: PAPER }} layout={{ wrap: 'none' }}>
          {PASSAGE}
        </Text>
        {walk !== undefined && (
          <>
            <Bar x={walk.split.rect.x} y={walk.split.rect.y} height={walk.split.rect.height} color={ACCENT} />
            <Label font={inter} x={-1.6} y={0.4} color={ACCENT}>
              {`caret({ offset: ${BOUNDARY}, affinity: 'downstream' }): rect (gold), level ${walk.split.level}`}
            </Label>
            {secondary !== undefined && (
              <>
                <Bar x={secondary.x} y={secondary.y} height={secondary.height} color={PAPER_DIM} />
                <Label font={inter} x={-1.6} y={-(secondary.y + secondary.height) - 0.08} color={PAPER_DIM}>
                  .secondary (grey): where the upstream side of the same offset is drawn
                </Label>
              </>
            )}
          </>
        )}
      </group>
      <group position={[left, -0.5, 0]}>
        <Text font={amiri} style={{ fontSize: FONT_SIZE, color: PAPER }} layout={{ wrap: 'none' }}>
          {PASSAGE}
        </Text>
        {stop !== undefined && (
          <>
            <Bar x={stop.caret.rect.x} y={stop.caret.rect.y} height={stop.caret.rect.height} color={ACCENT} />
            <Label font={inter} x={-1.6} y={-stop.caret.rect.y - stop.caret.rect.height - 0.08} color={PAPER_DIM}>
              {`move(position, 'right', 'grapheme'): offset ${stop.position.offset} (${stop.position.affinity}), level ${stop.caret.level}`}
            </Label>
          </>
        )}
      </group>
    </>
  );
}

/** Every caret stop from the left edge to the right edge, in the order the right arrow visits them. */
function walkRight(text: ThreeText<typeof slug>): Walk['stops'] {
  const stops: { position: TextPosition; caret: TextCaret }[] = [];
  let position: TextPosition = { offset: 0, affinity: 'downstream' };
  let moved = true;
  while (moved) {
    stops.push({ position, caret: text.caret(position) });
    const next = text.move(position, 'right', 'grapheme').position;
    moved = next.offset !== position.offset || next.affinity !== position.affinity;
    position = next;
  }
  return stops;
}

/** A caret rectangle is Text-local and y-down; the group's origin is the paragraph's top-left corner. */
function Bar({
  x,
  y,
  height,
  color,
}: {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly color: string;
}) {
  return (
    <mesh position={[x, -(y + height / 2), 0.01]}>
      <planeGeometry args={[0.04, height]} />
      <meshBasicNodeMaterial color={color} />
    </mesh>
  );
}

function Label({
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
      style={{ fontSize: 0.22, color, letterSpacing: 0.02 }}
      layout={{ wrap: 'none' }}
      position={[x, y, 0]}
    >
      {children}
    </Text>
  );
}
