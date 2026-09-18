import { Text } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useMemo, useRef, useState } from 'react';
import type { Group, Texture } from 'three/webgpu';

import type { Faces } from '../typography/fonts';
import { screenMaterial, uWordInverse, uWordOrigin, uWordSize, uWordUvScale } from './materials';
import { FLOOR_Y } from './Floor';
import { advance, START, textOf } from './wordCycle';

const FONT_SIZE = 3.0;
/** Wide exact box so `align: 'center'` centres the word on the paragraph origin. */
const LAYOUT_WIDTH = 60;

/** Fixed video window in word space. Letterforms reveal the video without changing its framing. */
const WINDOW_WIDTH = 18;

export function VideoWord({ faces, video }: { readonly faces: Faces; readonly video: Texture }) {
  const text = useRef<ThreeText<never> | null>(null);
  const word = useRef<Group>(null);
  const beat = useRef(START);
  const [shown, setShown] = useState(() => textOf(START));
  const measured = useRef(-1);
  /** Advance typing only after the requested text has committed, so each cluster is visible. */
  const onScreen = useRef(true);
  /** Exclude the layout commit cost from the next typing interval. */
  const settling = useRef(false);
  /** Lowest ink per word, keyed by cycle position, so the shared height is an average and not a running guess. */
  const extents = useRef(new Map<number, number>());
  const settled = useRef<number | undefined>(undefined);
  const material = useMemo(() => screenMaterial(video), [video]);

  useFrame((_, delta) => {
    // World back into the word's own space, every frame: the group is what the uv is anchored to, and an orbiting
    // camera changes nothing about it.
    const group = word.current;
    if (group !== null) {
      group.updateWorldMatrix(true, false);
      uWordInverse.value.copy(group.matrixWorld).invert();
    }

    // The schedule runs on the clock, and only moves once what it last asked for is actually on screen.
    const spend = settling.current ? 0 : delta;
    settling.current = false;
    if (onScreen.current) {
      beat.current = advance(beat.current, spend);
      const next = textOf(beat.current);
      if (next.text !== shown.text || next.word !== shown.word) {
        setShown(next);
        // An empty line lays out nothing, so there is no commit to wait for.
        onScreen.current = next.text === '';
      }
    }

    // Apply the average word height between words to keep typing vertically stable.
    const rig = word.current;
    if (rig !== null && shown.text === '' && settled.current !== undefined) {
      rig.position.y = FLOOR_Y + 0.06 - (settled.current + FONT_SIZE / 2);
    }

    const object = text.current;
    if (object === null) return;
    // Measure ink only after layout commits to avoid a second layout build.
    const state = object.commitState();
    if (state.status !== 'committed') return;
    if (!onScreen.current) settling.current = true;
    onScreen.current = true;
    if (state.revision === measured.current) return;
    const ink = object.computeBoundingBox();
    if (ink.max.x <= ink.min.x) return;
    // Center the video window in word space. Its fixed width and line-box height keep framing stable while
    // scripts and prefixes change.
    uWordOrigin.value.set(-WINDOW_WIDTH / 2, -FONT_SIZE / 2);
    uWordSize.value.set(WINDOW_WIDTH, FONT_SIZE);
    // Record this word's resting extents once it is whole, and average across every word seen so far.
    if (shown.text === shown.word.text) extents.current.set(shown.index, ink.min.y);
    const seen = [...extents.current.values()];
    if (seen.length > 0) {
      settled.current = seen.reduce((sum, low) => sum + low, 0) / seen.length;
    }
    // Cover: take the largest centred region of the clip whose shape matches the word's box.
    const frame = video.image as { videoWidth?: number; videoHeight?: number } | undefined;
    const clipWidth = frame?.videoWidth ?? 0;
    const clipHeight = frame?.videoHeight ?? 0;
    if (clipWidth > 0 && clipHeight > 0) {
      const ratio = clipWidth / clipHeight / (WINDOW_WIDTH / FONT_SIZE);
      uWordUvScale.value.set(ratio > 1 ? 1 / ratio : 1, ratio > 1 ? 1 : ratio);
      measured.current = state.revision;
    }
  });

  return (
    <group position={[-2.15, 0.175, 1.2]} ref={word} rotation-y={0.62}>
      <Text
        castShadow
        constraints={{ width: { mode: 'exact', size: LAYOUT_WIDTH } }}
        font={faces[shown.word.face]}
        layout={{ align: 'center', wrap: 'none' }}
        material={material}
        position={[-LAYOUT_WIDTH / 2, FONT_SIZE / 2, 0]}
        ref={text}
        style={{ color: '#ffffff', fontSize: FONT_SIZE, lineHeight: 1 }}
      >
        {shown.text}
      </Text>
    </group>
  );
}
