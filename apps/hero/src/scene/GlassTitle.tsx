import { Text } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef } from 'react';
import { Box3, type Group } from 'three/webgpu';

import { TITLE } from '../content';
import type { Faces, MsdfFont } from '../fonts';
import { sdfShadow, stainedGlassLetters } from '../materials/ink';
import { setTitleWidth } from './metrics';
import { requestReplay } from './replay';
import { triggerShockwave } from './shockwave';

const FONT_SIZE = 4.4;
/** Wide exact box so `align: 'center'` centres the word on the origin. */
const LAYOUT_WIDTH = 60;
/**
 * The slam, as explicit keyframes: lift towards the camera, down to resting size, past it, and back. Overshoot is a fraction of
 * the final size, not of the arrival distance — springing straight from 34x to 1x makes the undershoot enormous and
 * the word all but vanishes before it recovers.
 */
const LIFT_SCALE = 34;
const LIFT_SECONDS = 0.45;
/** Resting size is reached here; this is the moment the lattice is struck. */
const ARRIVE_AT = LIFT_SECONDS + 0.2;
const OVERSHOOT_AT = LIFT_SECONDS + 0.28;
const OVERSHOOT_SCALE = 0.86;
const SETTLED_SECONDS = LIFT_SECONDS + 0.45;

function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
}

function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

/** Scale at `time` seconds into the lift and slam. */
function revealScale(time: number): number {
  if (time >= SETTLED_SECONDS) return 1;
  if (time <= LIFT_SECONDS) {
    return LIFT_SCALE ** easeInOutSine(time / LIFT_SECONDS);
  }
  if (time <= ARRIVE_AT) {
    // Logarithmic: equal steps read as equal size changes, so the approach does not stall while it is huge.
    return LIFT_SCALE ** (1 - easeOutQuart((time - LIFT_SECONDS) / (ARRIVE_AT - LIFT_SECONDS)));
  }
  if (time <= OVERSHOOT_AT) {
    return 1 + (OVERSHOOT_SCALE - 1) * easeInOutSine((time - ARRIVE_AT) / (OVERSHOOT_AT - ARRIVE_AT));
  }
  return (
    OVERSHOOT_SCALE + (1 - OVERSHOOT_SCALE) * easeInOutSine((time - OVERSHOOT_AT) / (SETTLED_SECONDS - OVERSHOOT_AT))
  );
}

/**
 * One offset shadow, down and to the right. Its edge is as hard as the letter's: `shadowCoverage` is the same
 * half-pixel clamp applied to a displaced sample, and the distance field a real falloff would read is not published
 * (pmndrs/glyph#179). Stacking copies to fake softness only reads as duplicate letters, so it carries alone.
 */
const titleInk = new Box3();

const SHADOW_OFFSET = [0.05, -0.07] as const;
const SHADOW_OPACITY = 0.38;

export function GlassTitle({ faces, field }: { readonly faces: Faces; readonly field: MsdfFont }) {
  const group = useRef<Group>(null);
  const elapsed = useRef(SETTLED_SECONDS);
  const landed = useRef(true);
  const word = useRef<ThreeText<never> | null>(null);
  /** Published once: the box is in the Text's own space, so the reveal's scale never enters into it. */
  const reported = useRef(false);

  useEffect(() => {
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
      landed.current = false;
      // Announced before the word has moved, so everything keyed to the reveal clears on the input, not on impact.
      requestReplay();
    };
    window.addEventListener('keydown', restart);
    return () => {
      window.removeEventListener('keydown', restart);
    };
  }, []);

  useFrame((_, delta) => {
    if (!reported.current) {
      const object = word.current;
      // Ink only after a layout has committed; measuring a pending one forces it to be built again.
      if (object !== null && object.commitState().status === 'committed') {
        const ink = object.computeBoundingBox();
        if (ink.max.x > ink.min.x) {
          reported.current = true;
          setTitleWidth(ink.max.x - ink.min.x);
        }
      }
    }

    const title = group.current;
    if (title === null) return;
    elapsed.current += Math.min(delta, 0.1);
    const time = elapsed.current;

    title.scale.setScalar(revealScale(time));
    if (!landed.current && time >= ARRIVE_AT) {
      // Resting size reached: this is the impact the lattices react to, once per letter so the sheets are struck
      // in the shape of the word rather than shoved from a single point at its centre.
      landed.current = true;
      const object = word.current;
      const glyphs =
        object !== null && object.commitState().status === 'committed' ? object.measureGlyphs() : undefined;
      if (object === null || glyphs === undefined || glyphs.length === 0) {
        triggerShockwave([0, 0, 0]);
      } else {
        object.updateWorldMatrix(true, false);
        for (const glyph of glyphs) {
          const ink = titleInk.copy(glyph.localInkBounds).applyMatrix4(object.matrixWorld);
          triggerShockwave([(ink.min.x + ink.max.x) / 2, (ink.min.y + ink.max.y) / 2, 0]);
        }
      }
    }
  });

  return (
    <group ref={group}>
      <Text
        constraints={{ width: { mode: 'exact', size: LAYOUT_WIDTH } }}
        font={field}
        layout={{ align: 'center', wrap: 'none' }}
        material={sdfShadow}
        position={[-LAYOUT_WIDTH / 2, FONT_SIZE / 2, -0.05]}
        style={{
          color: '#2d323b',
          fontSize: FONT_SIZE,
          lineHeight: 1,
          opacity: SHADOW_OPACITY,
          shadow: { color: '#2d323b', offset: SHADOW_OFFSET },
        }}
      >
        {TITLE.text}
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
