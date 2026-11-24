import type { LayoutBox, TextPosition, msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

const PASSAGE = 'Move by unit. One call, one step: a grapheme, a word, a sentence or a line.';
const WIDTH = 4.5;
const FONT_SIZE = 0.36;
/** Seconds the caret rests on each stop. */
const STEP = 0.45;

type Field = ThreeText<typeof msdf>;

interface Stop {
  readonly rect: LayoutBox;
  /** The call that produced this stop. */
  readonly call: string;
}

/** Every stop of one unit: each move starts from the position the previous one returned. */
function forwardBy(unit: 'grapheme' | 'word' | 'sentence'): (text: Field) => readonly Stop[] {
  return (text) => {
    const call = `move(position, 'forward', '${unit}')`;
    const stops: Stop[] = [];
    let position: TextPosition = { offset: 0, affinity: 'downstream' };
    let moved = true;
    while (moved) {
      stops.push({ rect: text.caret(position).rect, call });
      const next = text.move(position, 'forward', unit).position;
      moved = next.offset !== position.offset || next.affinity !== position.affinity;
      position = next;
    }
    return stops;
  };
}

/** Line movement: to the line's end, down twice keeping the column in `goalX`, to the line's start, and back up. */
function byLine(text: Field): readonly Stop[] {
  let position: TextPosition = { offset: 9, affinity: 'downstream' };
  let goalX: number | undefined;
  const stops: Stop[] = [{ rect: text.caret(position).rect, call: 'the starting position' }];
  const step = (direction: 'forward' | 'backward' | 'up' | 'down', call: string) => {
    const vertical = direction === 'up' || direction === 'down';
    const moved = text.move(position, direction, 'line', vertical ? goalX : undefined);
    position = moved.position;
    goalX = vertical ? moved.goalX : undefined;
    stops.push({ rect: text.caret(position).rect, call });
  };
  step('forward', "move(position, 'forward', 'line')");
  step('down', "move(position, 'down', 'line')");
  step('down', "move(position, 'down', 'line', goalX)");
  step('backward', "move(position, 'backward', 'line')");
  step('up', "move(position, 'up', 'line')");
  step('up', "move(position, 'up', 'line', goalX)");
  return stops;
}

const CELLS: readonly {
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly walk: (text: Field) => readonly Stop[];
}[] = [
  { title: 'grapheme', x: -5, y: 2.2, walk: forwardBy('grapheme') },
  { title: 'word', x: 0.5, y: 2.2, walk: forwardBy('word') },
  { title: 'sentence', x: -5, y: -0.8, walk: forwardBy('sentence') },
  { title: 'line', x: 0.5, y: -0.8, walk: byLine },
];

/**
 * `move` by each unit. The dim marks are every position a walk visits, the bright caret is the current one,
 * and the caption is the call that put it there.
 */
export default function EditingMovement() {
  return (
    <>
      {CELLS.map((cell) => (
        <Walk key={cell.title} {...cell} />
      ))}
    </>
  );
}

function Walk({
  title,
  x,
  y,
  walk,
}: {
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly walk: (text: Field) => readonly Stop[];
}) {
  const inter = useMsdf(INTER);
  const ref = useRef<Field>(null);
  const [stops, setStops] = useState<readonly Stop[]>([]);
  const [at, setAt] = useState(0);

  useFrame(({ elapsed }) => {
    const text = ref.current;
    if (text === null) return;
    if (stops.length === 0) {
      setStops(walk(text));
      return;
    }
    const next = Math.floor(elapsed / STEP) % stops.length;
    if (next !== at) setAt(next);
  });

  const stop = stops[at];
  return (
    <group position={[x, y, 0]}>
      <Text
        font={inter}
        style={{ fontSize: 0.2, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, 0.72, 0]}
      >
        {`${title}: ${stops.length} stops`}
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.2, color: ACCENT, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, 0.4, 0]}
      >
        {stop?.call ?? ''}
      </Text>
      <Text
        ref={ref}
        font={inter}
        style={{ fontSize: FONT_SIZE, color: PAPER, lineHeight: 1.45 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: WIDTH } }}
      >
        {PASSAGE}
      </Text>
      {stops.map(({ rect }, index) => (
        // A caret rectangle is Text-local and y-down; its x is the stop, its height the line box.
        <mesh key={`${index}:${rect.x},${rect.y}`} position={[rect.x, -(rect.y + rect.height / 2), -0.01]}>
          <planeGeometry args={[0.014, rect.height * 0.8]} />
          <meshBasicNodeMaterial color={PAPER_DIM} transparent opacity={0.45} />
        </mesh>
      ))}
      {stop !== undefined && (
        <mesh position={[stop.rect.x, -(stop.rect.y + stop.rect.height / 2), 0.01]}>
          <planeGeometry args={[0.04, stop.rect.height]} />
          <meshBasicNodeMaterial color={ACCENT} />
        </mesh>
      )}
    </group>
  );
}
