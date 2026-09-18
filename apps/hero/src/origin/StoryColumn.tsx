import { Text, TextGroup } from '@pmndrs/glyph/react';

import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Group } from 'three/webgpu';

import type { Faces } from '../typography/fonts';
import { storyMaterial } from './materials';
import { ORIGIN_STORY } from './content';

/**
 * The origin story, justified into one column on the right. It has to finish above the floor plane: the reflector is
 * a solid horizontal surface, so any line that stacks below it is simply occluded, which silently ate the last
 * paragraph before the type was tightened to fit.
 *
 * It billboards, so the copy stays square to the camera while the scene orbits around it. The paragraph is still
 * honest geometry, laid out and justified by the same engine as everything else; it just refuses to be read at an
 * angle.
 */
const COLUMN_WIDTH = 4.9;
const COLUMN_X = 1.95;
const COLUMN_TOP = 2.5;
const FONT_SIZE = 0.184;
const LINE_HEIGHT = 1.4;
/** The gap between paragraphs, as a multiple of the line box. */
const PARAGRAPH_GAP = 0.62;
/** Rough characters per line at this measure; only used to stack the paragraphs, never to lay them out. */
const CHARACTERS_PER_LINE = 50;

/**
 * Where each paragraph starts, stacked from the top. Computed once at module scope from constant copy: doing it while
 * rendering means carrying a running total across the map, which is a reassignment the compiler rightly rejects.
 */
const PLACED = ORIGIN_STORY.reduce<{ text: string; top: number }[]>((placed, text) => {
  const previous = placed.at(-1);
  const top =
    previous === undefined
      ? COLUMN_TOP
      : previous.top -
        Math.ceil(previous.text.length / CHARACTERS_PER_LINE) * FONT_SIZE * LINE_HEIGHT -
        FONT_SIZE * PARAGRAPH_GAP;
  placed.push({ text, top });
  return placed;
}, []);

export function StoryColumn({ faces }: { readonly faces: Faces }) {
  const plate = useRef<Group>(null);
  const camera = useThree((state) => state.camera);

  /**
   * Viewport aligned, not billboarded. A billboard *looks at* the camera's position, so a column standing off to one
   * side swings to aim at it and picks up perspective skew — the tilt that got worse the higher the camera went.
   * Copying the camera's orientation instead makes the page parallel to the image plane, which is what reads as
   * screen space. It is still ordinary geometry sitting in the scene, lit and reflected like everything else.
   */
  useFrame(() => {
    const group = plate.current;
    if (group !== null) group.quaternion.copy(camera.quaternion);
  });

  return (
    <group position={[COLUMN_X + COLUMN_WIDTH / 2 - 1.6, 0, 3]} ref={plate}>
      <TextGroup name="origin-story">
        {PLACED.map((paragraph) => (
          // Each paragraph is its own Text, so the space between them is not a blank justified line.
          <Text
            constraints={{ width: { mode: 'exact', size: COLUMN_WIDTH } }}
            font={faces['geist-medium']}
            key={paragraph.text.slice(0, 24)}
            layout={{ align: 'justify', wrap: 'word' }}
            material={storyMaterial}
            position={[-COLUMN_WIDTH / 2, paragraph.top, 0]}
            style={{ color: '#aab4c8', fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT }}
          >
            {paragraph.text}
          </Text>
        ))}
      </TextGroup>
    </group>
  );
}
