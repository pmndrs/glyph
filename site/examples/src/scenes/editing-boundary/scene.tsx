import type { LayoutBox, TextPosition, TextRange, msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';

import { INTER } from '../../fonts';
import { useSceneInputs } from '../../lib/inputs';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { pointerToTextLocal } from '../editing-field/pointer';

const PASSAGE =
  'Point at a word. The engine answers with the word, the sentence and the line that contain the position. Double click selects the first; a triple click, the second.';
const WIDTH = 8.6;
const FONT_SIZE = 0.46;
const TOP = 2.35;
/** Shown before the pointer arrives. */
const SEED = PASSAGE.indexOf('sentence') + 3;

interface Ranges {
  readonly offset: number;
  readonly word: TextRange;
  readonly sentence: TextRange;
  readonly line: TextRange;
  readonly wordRects: readonly LayoutBox[];
  readonly sentenceRects: readonly LayoutBox[];
  readonly lineRects: readonly LayoutBox[];
}

/**
 * `boundary(position, unit)` under the pointer, for three units at once. Each range goes to `rangeRects`:
 * the line is the faint band, the sentence the tint over it, the word the bright box.
 */
export default function EditingBoundary() {
  const inter = useMsdf(INTER);
  const inputs = useSceneInputs();
  const ref = useRef<ThreeText<typeof msdf>>(null);
  const [ranges, setRanges] = useState<Ranges | undefined>(undefined);

  useFrame(({ camera, size }) => {
    const text = ref.current;
    if (text === null) return;
    const show = (position: TextPosition) => {
      if (ranges?.offset === position.offset) return;
      const word = text.boundary(position, 'word');
      const sentence = text.boundary(position, 'sentence');
      const line = text.boundary(position, 'line');
      setRanges({
        offset: position.offset,
        word,
        sentence,
        line,
        wordRects: text.rangeRects(word.start, word.end),
        sentenceRects: text.rangeRects(sentence.start, sentence.end),
        lineRects: text.rangeRects(line.start, line.end),
      });
    };
    if (ranges === undefined) show({ offset: SEED, affinity: 'downstream' });
    for (const input of inputs?.drain() ?? []) {
      if (input.x === undefined || input.y === undefined) continue;
      if (input.type !== 'pointermove' && input.type !== 'pointerdown') continue;
      show(text.hitTest(pointerToTextLocal(text, input.x, input.y, size, camera)));
    }
  });

  const span = (range: TextRange) => `${range.start} to ${range.end}`;
  return (
    <group position={[-WIDTH / 2, TOP, 0]}>
      {ranges !== undefined && (
        <>
          <Boxes rects={ranges.lineRects} color={PAPER} opacity={0.09} z={-0.03} />
          <Boxes rects={ranges.sentenceRects} color={ACCENT} opacity={0.16} z={-0.02} />
          <Boxes rects={ranges.wordRects} color={ACCENT} opacity={0.5} z={-0.01} />
        </>
      )}
      <Text
        ref={ref}
        font={inter}
        style={{ fontSize: FONT_SIZE, color: PAPER, lineHeight: 1.45 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: WIDTH } }}
      >
        {PASSAGE}
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.24, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, -4.25, 0]}
      >
        {ranges === undefined
          ? 'waiting for the text'
          : `offset ${ranges.offset}: word ${span(ranges.word)}, sentence ${span(ranges.sentence)}, line ${span(ranges.line)}`}
      </Text>
    </group>
  );
}

function Boxes({
  rects,
  color,
  opacity,
  z,
}: {
  readonly rects: readonly LayoutBox[];
  readonly color: string;
  readonly opacity: number;
  readonly z: number;
}) {
  return (
    <>
      {rects.map((rect) => (
        // Text-local boxes are y-down from the paragraph's top-left corner, which is the group's origin.
        <mesh key={`${rect.x},${rect.y}`} position={[rect.x + rect.width / 2, -(rect.y + rect.height / 2), z]}>
          <planeGeometry args={[rect.width, rect.height]} />
          <meshBasicNodeMaterial color={color} transparent opacity={opacity} />
        </mesh>
      ))}
    </>
  );
}
