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
/**
 * How far the set of words floats above the floor, measured from the average of their ink.
 *
 * Every word sits at the same height. Seating each one on its own ink instead looks correct in a still frame and is
 * wrong in motion: these scripts disagree about their vertical extents, so the word jumps between languages — and
 * worse, a word's ink box changes *while it types*, the moment a descender or a headline appears, so it re-seats
 * mid-word. One height for all of them, averaged so the set as a whole sits where a single word would, is steadier
 * than anything per-word can be.
 */
const FLOAT_ABOVE_FLOOR = 0.06;

/**
 * One rotation, about Y, and nothing else. Positive swings the near edge toward the camera: rotating about Y by a
 * positive angle sends the -x side (the G) to +z, which is where the viewer is. Pitch and roll were doing nothing
 * but tipping the word off the floor and skewing its baseline.
 */
const YAW = 0.62;

/**
 * The window the clip is shown through, fixed in the word's own space and centred on its origin.
 *
 * Stretching the clip across the live ink box — which is what this did — re-frames the video on every keystroke,
 * because every added cluster changes the box it is being fitted to. The picture jumps while the word grows. A fixed
 * window makes the letters a mask over a still-running video instead: the clip holds its framing and the letterforms
 * travel across it. Wide enough for the longest word, so no letter samples past the edge and clamps into a band.
 */
const WINDOW_WIDTH = 18;

export function VideoWord({ faces, video }: { readonly faces: Faces; readonly video: Texture }) {
  const text = useRef<ThreeText<never> | null>(null);
  const word = useRef<Group>(null);
  const beat = useRef(START);
  const [shown, setShown] = useState(() => textOf(START));
  const measured = useRef(-1);
  /**
   * Whether the text the schedule last asked for is actually on screen.
   *
   * Changing the text queues a layout, and the layout commits on the *following* frame. Without this gate a step
   * spends its first frame still showing the previous word, and a step short enough can be over before its own text
   * has ever been drawn. Holding the clock until the commit lands means every cluster is seen, whatever the layout
   * costs that frame.
   */
  const onScreen = useRef(true);
  /**
   * Set on the frame a layout commits, so the next frame's delta — which is mostly the cost of that layout — is not
   * charged to the beat. The first time a script appears its glyphs have to be rastered, and that one frame is long
   * enough to spend a whole cluster's budget, so the word types unevenly until the atlas is warm.
   */
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

    // Re-seat only in the gap between words. The average moves as new languages are measured during the first
    // pass; applying it mid-word would be the jitter this is meant to remove.
    const rig = word.current;
    if (rig !== null && shown.text === '' && settled.current !== undefined) {
      rig.position.y = FLOOR_Y + FLOAT_ABOVE_FLOOR - (settled.current + FONT_SIZE / 2);
    }

    const object = text.current;
    if (object === null) return;
    // Ink only after a layout has committed; measuring a pending one forces it to be built again.
    const state = object.commitState();
    if (state.status !== 'committed') return;
    if (!onScreen.current) settling.current = true;
    onScreen.current = true;
    if (state.revision === measured.current) return;
    const ink = object.computeBoundingBox();
    if (ink.max.x <= ink.min.x) return;
    // `align: 'center'` puts the ink around x = LAYOUT_WIDTH / 2 and the Text's own translation takes that back off
    // again, so in the group's space every word is centred on the origin and the window is a rectangle around zero.
    // Its height is the line box rather than the ink, which is what keeps it the same window for scripts that sit
    // differently in the line.
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
    <group position={[-2.15, 0.175, 1.2]} ref={word} rotation-y={YAW}>
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
