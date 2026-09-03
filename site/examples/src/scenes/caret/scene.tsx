import type { GlyphCaret, LayoutBox } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/raster/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import { type Mesh, Vector3 } from 'three/webgpu';

import { INTER } from '../../fonts';
import { pointerToWorld, useSceneInputs } from '../../lib/inputs';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { BLINK, CARET_WIDTH, FONT_SIZE, PASSAGE, SEED_WORD, TOP, WIDTH } from './config';

/**
 * A caret and a selection from pointer input. The host hands the scene its
 * pointer events in frame pixels; each becomes a world point on the text's
 * plane, then a paragraph-local one — y flipped, paragraph space is y-down —
 * and `caretAt` answers with the nearest cluster edge. `selectionRects`
 * covers the range from the anchor to the head, one box per line.
 */
interface Placement {
  readonly caret: GlyphCaret;
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
  const world = useRef(new Vector3());

  useFrame(({ camera, elapsed, size }) => {
    const text = ref.current;
    if (text === null) return;
    const place = (caret: GlyphCaret, from: number) => {
      setPlacement({ caret, rects: text.selectionRects(from, caret.offset) ?? [] });
      placedAt.current = elapsed;
    };

    // Until the reader touches it: one word selected, the caret at its end. The
    // queries answer `undefined` until the renderer has accepted the text.
    if (!seeded.current) {
      const start = PASSAGE.indexOf(SEED_WORD);
      const end = text.selectionRects(start, start + SEED_WORD.length)?.at(-1);
      const caret = end === undefined ? undefined : text.caretAt(end.x + end.width, end.y + end.height / 2);
      if (caret !== undefined) {
        seeded.current = true;
        anchor.current = start;
        place(caret, start);
      }
    }

    for (const input of inputs?.drain() ?? []) {
      if (input.type === 'pointerup' || input.type === 'pointercancel' || input.type === 'pointerleave') {
        dragging.current = false;
        continue;
      }
      if (input.x === undefined || input.y === undefined) continue;
      if (input.type === 'pointermove' && !dragging.current) continue;
      const point = pointerToWorld(input.x, input.y, size, camera, world.current);
      const local = text.worldToLocal(point);
      const caret = text.caretAt(local.x, -local.y);
      if (caret === undefined) continue;
      if (input.type === 'pointerdown') {
        anchor.current = caret.offset;
        dragging.current = true;
        seeded.current = true;
      }
      place(caret, anchor.current ?? caret.offset);
    }

    const mesh = caretMesh.current;
    if (mesh !== null) mesh.visible = (elapsed - placedAt.current) % BLINK < BLINK * 0.6;
  });

  const summary =
    placement === undefined
      ? 'waiting for the first accepted frame'
      : `caret at offset ${placement.caret.offset}, line ${placement.caret.line + 1}; ${placement.rects.length} selection rectangle${placement.rects.length === 1 ? '' : 's'}`;

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
      {placement?.rects.map((rect, index) => (
        // Paragraph space is y-down from the box's top-left; the group's origin is that corner.
        <mesh key={index} position={[rect.x + rect.width / 2, -(rect.y + rect.height / 2), -0.01]}>
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
