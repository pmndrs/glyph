import { Text, TextGroup } from '@pmndrs/glyph/react';

import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Group } from 'three/webgpu';

import type { Faces } from '../typography/fonts';
import { storyMaterial } from './materials';
import { ORIGIN_STORY } from './content';

/** A justified column kept above the reflector and parallel to the camera plane. */
const COLUMN_WIDTH = 4.9;
const FONT_SIZE = 0.184;
const LINE_HEIGHT = 1.4;

/** Precompute paragraph positions from fixed copy and estimated line counts. */
const PLACED = ORIGIN_STORY.reduce<{ text: string; top: number }[]>((placed, text) => {
  const previous = placed.at(-1);
  const top =
    previous === undefined
      ? 2.5
      : previous.top - Math.ceil(previous.text.length / 50) * FONT_SIZE * LINE_HEIGHT - FONT_SIZE * 0.62;
  placed.push({ text, top });
  return placed;
}, []);

export function StoryColumn({ faces }: { readonly faces: Faces }) {
  const plate = useRef<Group>(null);
  const camera = useThree((state) => state.camera);

  /** Copy camera orientation to keep the column parallel to the image plane. */
  useFrame(() => {
    const group = plate.current;
    if (group !== null) group.quaternion.copy(camera.quaternion);
  });

  return (
    <group position={[1.95 + COLUMN_WIDTH / 2 - 1.6, 0, 3]} ref={plate}>
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
