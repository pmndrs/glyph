import type { LayoutBox, TextCaret, TextPosition, msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import type { Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { useSceneInputs } from '../../lib/inputs';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { pointerToTextLocal } from '../editing-field/pointer';
import { BLINK, CARET_WIDTH, FONT_SIZE, PASSAGE, SEED_WORD, TOP, WIDTH } from './config';

/**
 * A caret and a selection from pointer input. The host hands the scene its
 * pointer events in frame pixels; each becomes a point on the text's plane in
 * Text-local coordinates — y flipped, Text-local space is y-down — and
 * `hitTest` answers with the nearest caret stop, `caret` with where to draw
 * it. `rangeRects` covers the range from the anchor to the head, one box
 * per run of the range on its line.
 */
interface Placement {
  readonly position: TextPosition;
  readonly caret: TextCaret;
  readonly rects: readonly LayoutBox[];
}

export default function Caret() {
  const inter = useMsdf(INTER);
  const inputs = useSceneInputs();
  const ref = useRef<ThreeText<typeof msdf>>(null);
  const caretMesh = useRef<Mesh>(null);
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);
  const anchor = useRef<number | undefined>(undefined);
  const dragging = useRef(false);
  const seeded = useRef(false);
  const placedAt = useRef(0);

  useFrame(({ camera, elapsed, size }) => {
    const text = ref.current;
    if (text === null) return;
    // Every query prepares the text first, so none of them waits for a frame.
    const place = (position: TextPosition, from: number) => {
      const start = Math.min(from, position.offset);
      const end = Math.max(from, position.offset);
      setPlacement({
        position,
        caret: text.caret(position),
        rects: start === end ? [] : text.rangeRects(start, end),
      });
      placedAt.current = elapsed;
    };

    // Until the reader touches it: one word selected, the caret at its end.
    if (!seeded.current) {
      const start = PASSAGE.indexOf(SEED_WORD);
      seeded.current = true;
      anchor.current = start;
      place({ offset: start + SEED_WORD.length, affinity: 'upstream' }, start);
    }

    for (const input of inputs?.drain() ?? []) {
      if (input.type === 'pointerup' || input.type === 'pointercancel' || input.type === 'pointerleave') {
        dragging.current = false;
        continue;
      }
      if (input.x === undefined || input.y === undefined) continue;
      if (input.type === 'pointermove' && !dragging.current) continue;
      const position = text.hitTest(pointerToTextLocal(text, input.x, input.y, size, camera));
      if (input.type === 'pointerdown') {
        anchor.current = position.offset;
        dragging.current = true;
      }
      place(position, anchor.current ?? position.offset);
    }

    const mesh = caretMesh.current;
    if (mesh !== null) mesh.visible = (elapsed - placedAt.current) % BLINK < BLINK * 0.6;
  });

  const summary =
    placement === undefined
      ? 'waiting for the text'
      : `caret at offset ${placement.position.offset} (${placement.position.affinity}), line ${placement.caret.line + 1}; ${placement.rects.length} selection rectangle${placement.rects.length === 1 ? '' : 's'}`;

  return (
    <group position={[-WIDTH / 2, TOP, 0]}>
      <Text
        ref={ref}
        font={inter}
        style={{ fontSize: FONT_SIZE, color: PAPER, lineHeight: 1.4 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: WIDTH } }}
      >
        {PASSAGE}
      </Text>
      {placement?.rects.map((rect) => (
        // Paragraph space is y-down from the box's top-left; the group's origin is that corner.
        <mesh key={`${rect.x},${rect.y}`} position={[rect.x + rect.width / 2, -(rect.y + rect.height / 2), -0.01]}>
          <planeGeometry args={[rect.width, rect.height]} />
          <meshBasicNodeMaterial color={ACCENT} transparent opacity={0.28} />
        </mesh>
      ))}
      {placement !== undefined && (
        <mesh
          ref={caretMesh}
          position={[placement.caret.rect.x, -(placement.caret.rect.y + placement.caret.rect.height / 2), 0.01]}
        >
          <planeGeometry args={[CARET_WIDTH, placement.caret.rect.height]} />
          <meshBasicNodeMaterial color={ACCENT} />
        </mesh>
      )}
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, -3.95, 0]}
      >
        {summary}
      </Text>
    </group>
  );
}
