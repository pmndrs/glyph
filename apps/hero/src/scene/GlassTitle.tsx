import { Text } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import { Box3 } from 'three/webgpu';

import { TITLE } from '../content';
import type { Faces, MsdfFont } from '../fonts';
import { stainedGlassLetters, titleOrigin } from '../materials/ink';
import { setTitleWidth } from './metrics';
import { requestReplay } from './replay';
import { triggerShockwave } from './shockwave';

const FONT_SIZE = 4.4;
/** Wide exact box so `align: 'center'` centres the word on the origin. */
const LAYOUT_WIDTH = 60;
/** Each pane follows the same lift and rebound, 35 ms after its neighbour. */
const STAGGER = 0.035;
const LIFT_SCALE = 34;
const LIFT_SECONDS = 0.45;
const ARRIVE_AT = LIFT_SECONDS + 0.2;
const SETTLED_SECONDS = ARRIVE_AT + 0.38;
const ALL_SETTLED = SETTLED_SECONDS + (stainedGlassLetters.length - 1) * STAGGER;
const titleInk = new Box3();

function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

/** Original eased approach, with a small compression at contact and a gentle return to full size. */
function revealScale(time: number): number {
  if (time <= 0 || time >= SETTLED_SECONDS) return 1;
  if (time <= LIFT_SECONDS) return LIFT_SCALE ** easeInOutSine(time / LIFT_SECONDS);
  if (time <= ARRIVE_AT) {
    const remaining = 1 - (time - LIFT_SECONDS) / (ARRIVE_AT - LIFT_SECONDS);
    return LIFT_SCALE ** (remaining ** 4);
  }
  const settle = (time - ARRIVE_AT) / (SETTLED_SECONDS - ARRIVE_AT);
  return 1 - Math.sin(settle * Math.PI) * (1 - settle) ** 2 * 0.1;
}

export function GlassTitle({ faces, field }: { readonly faces: Faces; readonly field: MsdfFont }) {
  const elapsed = useRef(ALL_SETTLED);
  const landed = useRef(stainedGlassLetters.length);
  const word = useRef<ThreeText<never> | null>(null);
  /** Published once: the box is in the Text's own space, so the reveal's scale never enters into it. */
  const reported = useRef(false);

  useEffect(() => {
    titleOrigin.value.set(LAYOUT_WIDTH / 2, -FONT_SIZE / 2, 0);
    const restart = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select, button') !== null)
      ) {
        return;
      }
      event.preventDefault();
      if (event.repeat) return;
      elapsed.current = 0;
      landed.current = 0;
      // Announced before the word has moved, so everything keyed to the reveal clears on the input, not on impact.
      requestReplay();
    };
    window.addEventListener('keydown', restart);
    return () => {
      window.removeEventListener('keydown', restart);
    };
  }, []);

  useFrame(
    (_, delta) => {
      if (!reported.current) {
        const object = word.current;
        // Ink only after a layout has committed; measuring a pending one forces it to be built again.
        if (object !== null && object.commitState().status === 'committed') {
          const ink = object.computeBoundingBox();
          if (ink.max.x > ink.min.x) {
            const glyphs = object.measureGlyphs();
            if (glyphs === undefined) return;
            for (const [index, pane] of stainedGlassLetters.entries()) {
              glyphs[index]?.localInkBounds.getCenter(pane.pivot.value);
            }
            reported.current = true;
            setTitleWidth(ink.max.x - ink.min.x);
          }
        }
      }

      elapsed.current = Math.min(ALL_SETTLED, elapsed.current + Math.min(delta, 0.1));
      for (const [index, pane] of stainedGlassLetters.entries()) {
        const time = elapsed.current >= ALL_SETTLED ? SETTLED_SECONDS : elapsed.current - index * STAGGER;
        pane.scale.value = revealScale(time);
        pane.height.value = Math.max(0, Math.log(pane.scale.value) / Math.log(LIFT_SCALE));
        const settle = Math.max(0, Math.min(1, (time - ARRIVE_AT) / (SETTLED_SECONDS - ARRIVE_AT)));
        const approach = Math.max(0, Math.min(1, time / ARRIVE_AT));
        const direction = index % 2 === 0 ? 1 : -1;
        const lean =
          time < ARRIVE_AT ? Math.sin((approach * Math.PI) / 2) : Math.cos(settle * Math.PI * 3) * (1 - settle) ** 3;
        const drift =
          time < ARRIVE_AT
            ? Math.sin(approach * Math.PI) * 0.06
            : Math.sin(settle * Math.PI * 3) * (1 - settle) ** 3 * 0.025;
        pane.angle.value = lean * 0.025 * direction;
        pane.sway.value = drift * direction;
        if (index >= landed.current && time >= ARRIVE_AT) {
          const object = word.current;
          if (object === null || object.commitState().status !== 'committed') continue;
          const glyph = object.measureGlyphs()?.[index];
          if (glyph === undefined) continue;
          object.updateWorldMatrix(true, false);
          titleInk.copy(glyph.localInkBounds).applyMatrix4(object.matrixWorld);
          triggerShockwave([(titleInk.min.x + titleInk.max.x) / 2, (titleInk.min.y + titleInk.max.y) / 2, 0]);
          landed.current = index + 1;
        }
      }
    },
    { id: 'hero-title-motion' },
  );

  return (
    <group>
      <Text
        constraints={{ width: { mode: 'exact', size: LAYOUT_WIDTH } }}
        font={field}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-LAYOUT_WIDTH / 2, FONT_SIZE / 2, -0.05]}
        style={{ fontSize: FONT_SIZE, lineHeight: 1 }}
      >
        {stainedGlassLetters.map(({ letter, shadow }) => (
          <Text key={letter} material={shadow}>
            {letter}
          </Text>
        ))}
      </Text>
      <Text
        constraints={{ width: { mode: 'exact', size: LAYOUT_WIDTH } }}
        font={faces[TITLE.face]}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-LAYOUT_WIDTH / 2, FONT_SIZE / 2, 0]}
        ref={word}
        style={{ color: '#ffffff', fontSize: FONT_SIZE, lineHeight: 1 }}
      >
        {stainedGlassLetters.map(({ letter, material }) => (
          <Text key={letter} material={material}>
            {letter}
          </Text>
        ))}
      </Text>
    </group>
  );
}
