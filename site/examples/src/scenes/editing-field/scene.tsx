import type { msdf } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import type { Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { useSceneInputs } from '../../lib/inputs';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { BLINK, CARET_WIDTH, DOUBLE_CLICK, FONT_SIZE, INITIAL, PADDING, TOP, WIDTH } from './config';
import {
  collapsed,
  drag,
  geometry,
  ordered,
  press,
  pressKey,
  selectWord,
  type FieldGeometry,
  type Selection,
} from './field';
import { pointerToTextLocal } from './pointer';

/**
 * An editable field. The text answers where things are (`hitTest`, `caret`, `rangeRects`, `move`, `boundary`)
 * and applies one exact edit (`replace`); the selection, the caret mesh and the keys are this component's.
 * The host hands the scene its pointer and key events; a plain app listens on its canvas instead.
 */
interface View extends FieldGeometry {
  readonly height: number;
  readonly status: string;
}

export default function EditingField() {
  const inter = useMsdf(INTER);
  const inputs = useSceneInputs();
  const ref = useRef<ThreeText<typeof msdf>>(null);
  const caretMesh = useRef<Mesh>(null);
  const [value, setValue] = useState(INITIAL);
  const [view, setView] = useState<View | undefined>(undefined);
  const selection = useRef<Selection | undefined>(undefined);
  const dragging = useRef(false);
  const lastPress = useRef({ at: -1, offset: -1 });
  const shownAt = useRef(0);

  useFrame(({ camera, elapsed, size }) => {
    const text = ref.current;
    if (text === null) return;
    const show = (next: Selection) => {
      selection.current = next;
      const [start, end] = ordered(next);
      setValue(text.text); // React's copy of the string follows the edit `replace` made.
      setView({
        ...geometry(text, next),
        height: text.measure().height,
        status:
          start === end
            ? `caret at offset ${next.focus.offset} of ${text.text.length}`
            : `selection ${start} to ${end} of ${text.text.length}`,
      });
      shownAt.current = elapsed;
    };

    // Until the reader touches it: the caret at the end, where typing continues the sentence.
    let current = selection.current;
    if (current === undefined) {
      current = collapsed({ offset: text.text.length, affinity: 'upstream' });
      show(current);
    }

    for (const input of inputs?.drain() ?? []) {
      if (input.type === 'keydown' && input.value !== undefined) {
        const next = pressKey(text, current, input.value);
        if (next !== current) show((current = next));
        continue;
      }
      if (input.type === 'pointerup' || input.type === 'pointercancel' || input.type === 'pointerleave') {
        dragging.current = false;
        continue;
      }
      if (input.x === undefined || input.y === undefined) continue;
      if (input.type !== 'pointerdown' && !(input.type === 'pointermove' && dragging.current)) continue;
      const point = pointerToTextLocal(text, input.x, input.y, size, camera);
      if (input.type === 'pointermove') {
        show((current = drag(text, current, point)));
        continue;
      }
      const pressed = press(text, point);
      const again = elapsed - lastPress.current.at < DOUBLE_CLICK && lastPress.current.offset === pressed.focus.offset;
      lastPress.current = { at: elapsed, offset: pressed.focus.offset };
      dragging.current = !again;
      show((current = again ? selectWord(text, pressed.focus) : pressed));
    }

    const mesh = caretMesh.current;
    if (mesh !== null) mesh.visible = (elapsed - shownAt.current) % BLINK < BLINK * 0.6;
  });

  const height = view?.height ?? FONT_SIZE * 1.4;
  return (
    <group position={[-WIDTH / 2, TOP, 0]}>
      {/* The field's box: the paragraph box grown by a padding, so it follows the text as lines come and go. */}
      <mesh position={[WIDTH / 2, -height / 2, -0.03]}>
        <planeGeometry args={[WIDTH + PADDING * 2, height + PADDING * 2]} />
        <meshBasicNodeMaterial color="#12151c" />
      </mesh>
      {view?.rects.map((rect) => (
        // Text-local boxes are y-down from the paragraph's top-left corner, which is this group's origin.
        <mesh key={`${rect.x},${rect.y}`} position={[rect.x + rect.width / 2, -(rect.y + rect.height / 2), -0.01]}>
          <planeGeometry args={[rect.width, rect.height]} />
          <meshBasicNodeMaterial color={ACCENT} transparent opacity={0.28} />
        </mesh>
      ))}
      <Text
        ref={ref}
        font={inter}
        style={{ fontSize: FONT_SIZE, color: PAPER, lineHeight: 1.4 }}
        layout={{ wrap: 'word' }}
        constraints={{ width: { mode: 'exact', size: WIDTH } }}
      >
        {value}
      </Text>
      {view !== undefined && (
        <mesh ref={caretMesh} position={[view.caret.x, -(view.caret.y + view.caret.height / 2), 0.01]}>
          <planeGeometry args={[CARET_WIDTH, view.caret.height]} />
          <meshBasicNodeMaterial color={ACCENT} />
        </mesh>
      )}
      <Text
        font={inter}
        style={{ fontSize: 0.24, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[0, -height - PADDING - 0.25, 0]}
      >
        {view?.status ?? 'waiting for the text'}
      </Text>
    </group>
  );
}
