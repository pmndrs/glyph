import { Text } from '@pmndrs/glyph/react';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import Box3D from 'box3d.js/inline';
import { use, useEffect, useMemo, useRef } from 'react';
import { Box3, Vector3 } from 'three/webgpu';

import titleFace from '../../fonts/geist-1.7.2/Geist-Black.ttf?url';
import { TITLE } from '../content';
import { heroReady, usePreparation } from '../startup';
import type { Faces } from '../fonts';
import { stainedGlassLetters, titleOrigin } from '../materials/ink';
import { footprint } from './floor';
import { hole } from './hole';
import { setTitleWidth } from './metrics';
import { loadFont, solidOf } from './outline';
import { requestReplay } from './replay';
import { triggerShockwave } from './shockwave';
import { type Letter, TitleBodies } from './title-bodies';

const box3d = Box3D();
/** The outlines the letters' solids are cut from: the same source the title face was baked from. */
const titleOutlines = loadFont(titleFace);

/** How deep each letter's invisible solid reaches: enough that the robot meets it squarely, never drives over it. */
const SOLID_THICKNESS = 0.8;
const FONT_SIZE = 4.4;
/** Wide exact box so `align: 'center'` centres the word on the origin. */
const LAYOUT_WIDTH = 60;
const titleInk = new Box3();
const inkCenter = new Vector3();

/**
 * The glass title, drawn by glyph's Slug raster with one stained-glass material per pane. Once the paragraph has
 * committed it is broken apart, and each pane's glyph copy follows a rigid body on the floor: the lift and smash
 * on Space, and every push from the robot, happen there.
 */
export function GlassTitle({ faces }: { readonly faces: Faces }) {
  const b3 = use(box3d);
  const font = use(titleOutlines);
  const camera = useThree((state) => state.camera);
  const word = useRef<ThreeText<never> | null>(null);
  /** Each pane's solid for the physics, centred on its ink box. */
  const solids = useMemo(
    () => stainedGlassLetters.map(({ letter }) => solidOf(font, letter, FONT_SIZE, SOLID_THICKNESS)),
    [font],
  );
  /** Published once: the box is in the Text's own space, so the reveal's scale never enters into it. */
  const reported = useRef(false);
  /** The broken-apart paragraph and the bodies its glyphs follow, built once the layout has been measured. */
  const glyphs = useRef<Glyphs | undefined>(undefined);
  const bodies = useRef<TitleBodies | undefined>(undefined);
  usePreparation('title', () => bodies.current !== undefined);

  useEffect(() => {
    titleOrigin.value.set(LAYOUT_WIDTH / 2, -FONT_SIZE / 2, 0);
    const restart = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !heroReady()) return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select, button') !== null)
      ) {
        return;
      }
      event.preventDefault();
      if (event.repeat) return;
      bodies.current?.replay();
      // Announced before the word has moved, so everything keyed to the reveal clears on the input, not on impact.
      requestReplay();
    };
    window.addEventListener('keydown', restart);
    return () => {
      window.removeEventListener('keydown', restart);
    };
  }, []);

  useEffect(
    () => () => {
      bodies.current?.dispose();
      bodies.current = undefined;
      glyphs.current?.removeFromParent();
      glyphs.current?.dispose();
      glyphs.current = undefined;
      if (word.current !== null) word.current.visible = true;
    },
    [],
  );

  useFrame(
    (_, delta) => {
      if (!heroReady()) return;
      const landings = bodies.current?.update(Math.min(delta, 0.1), footprint(), hole());
      // Each letter strikes the lattices where it actually came down, the moment the floor reports it.
      for (const { x, y } of landings ?? []) triggerShockwave([x, y, 0]);
    },
    { phase: 'physics' },
  );

  useFrame(
    () => {
      if (reported.current) return;
      const object = word.current;
      // Ink only after a layout has committed; measuring a pending one forces it to be built again.
      if (object === null || object.commitState().status !== 'committed') return;
      const ink = object.computeBoundingBox();
      if (ink.max.x <= ink.min.x) return;
      for (const [index, pane] of stainedGlassLetters.entries()) {
        object.measureGlyphs()?.[index]?.localInkBounds.getCenter(pane.pivot.value);
      }
      // The paragraph is copied glyph by glyph and hidden: from here on the copies are what is drawn, and each
      // follows its body. Shaping and materials are the paragraph's own.
      const [copies, decorations] = object.breakApart();
      decorations?.dispose();
      object.parent?.add(copies);
      object.visible = false;
      copies.updateWorldMatrix(true, false);
      const letters: Letter[] = [];
      for (const measurement of copies.measurements) {
        const solid = solids[measurement.index];
        if (solid === undefined || measurement.localInkBounds.isEmpty()) continue;
        // The body sits where the paragraph placed the letter's ink, in world space.
        titleInk.copy(measurement.localInkBounds).applyMatrix4(copies.matrixWorld);
        titleInk.getCenter(inkCenter);
        letters.push({
          home: [inkCenter.x, inkCenter.y, inkCenter.z],
          solid,
          index: measurement.index,
          original: measurement.originalMatrix.clone(),
        });
      }
      glyphs.current = copies;
      bodies.current = new TitleBodies(b3, copies, letters, camera.position.z, SOLID_THICKNESS);
      // Development-only handle for inspecting the smash from DevTools.
      if (import.meta.env.DEV) Object.assign(globalThis, { heroTitle: bodies.current });
      reported.current = true;
      setTitleWidth(ink.max.x - ink.min.x);
    },
    { id: 'hero-title-motion' },
  );

  return (
    <group>
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
