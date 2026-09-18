import { Text } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { mat4, vec3 } from 'math';

import { FEATURE_LINE } from '../content';
import type { MsdfFont } from '../fonts';
import { createFlight, departureAt, flight } from './departure';
import { hole } from './hole';
import { latestShockwave } from './shockwave';
import { titleWidth } from './metrics';
import { replayCount } from './replay';
import { heroReady, usePreparation } from '../startup';
import { type RetainedLine, createRetainedLine, disposeLine, showLine, resetLine } from './retained-line';

/** Starting size, only ever reduced: the line is fitted to the title's width, never stretched past it. */
const FONT_SIZE = 0.42;
/** Size steps the fit snaps to, so it lands a little under the target and tracking makes up the rest. */
const SIZE_STEP = 0.005;
/** Wide exact box so `align: 'center'` centres the line on the origin, as the title does. */
const LAYOUT_WIDTH = 60;
/**
 * White stroke over the icon field, without which the letters break up. Weight is a fraction of the em, so it holds
 * when the fit changes the size. The baked field encodes +/-0.1875em (FEATURE_FIELD.pixelRange 24 over emSize 64);
 * past that the distance saturates and the outline floods the whole glyph cell, so this stays well inside it.
 */
const OUTLINE_EM = 0.12;
/** Tightens the gaps either side of the separators, as a fraction of the fitted size. Applied during the measuring
 * pass too, so the width the tracking is fitted against already accounts for it. */
const WORD_SPACING_EM = -0.08;
const LINE_Y = -2.65;

/** Seconds after the title lands before the first character. */
const START_DELAY = 0.55;
/**
 * The cadence, counted in frames rather than seconds. A seconds-per-character rate is almost never a whole number of
 * frame intervals, so the letter count beats between two and three frames per character — a fifty percent swing in
 * the gap, which reads as stutter however even the clock is. Counting frames makes every letter land on the same
 * beat. It does tie the rate to the refresh rate, which is the right trade for something captured frame by frame.
 */
const FRAMES_PER_CHARACTER = 3;

export function FeatureLine({ field }: { readonly field: MsdfFont }) {
  const text = useRef<ThreeText<never> | null>(null);
  const typed = useRef(FEATURE_LINE.text.length);
  const wave = useRef(0);
  const replay = useRef(replayCount());
  const start = useRef(Number.POSITIVE_INFINITY);
  /** Frames since typing began; the cadence is counted in these, not in seconds. */
  const beat = useRef(0);
  /** Set once the full line has been measured against the title and the size and tracking are settled. */
  const [fit, setFit] = useState<{ fontSize: number; letterSpacing: number } | undefined>(undefined);
  const fitRevision = useRef(-1);
  const line = useRef<RetainedLine | undefined>(undefined);
  const collapsed = useRef(false);
  usePreparation('feature', () => line.current !== undefined);
  const scratch = useRef(
    useMemo(
      () => ({
        transform: mat4.create(),
        rotation: mat4.create(),
        pivot: mat4.create(),
        world: mat4.create(),
        inverse: mat4.create(),
        center: vec3.create(),
        scale: vec3.create(),
        flight: createFlight(),
      }),
      [],
    ),
  );

  useEffect(
    () => () => {
      if (line.current !== undefined) disposeLine(line.current);
      line.current = undefined;
    },
    [],
  );

  useFrame(
    () => {
      const object = text.current;
      const collapse = hole();
      if (collapse.beat === 'closed' && collapsed.current) {
        collapsed.current = false;
        if (line.current !== undefined) resetLine(line.current, typed.current);
      }
      if (collapse.beat !== 'closed' && line.current !== undefined) {
        collapsed.current = true;
        const copies = line.current.glyphs;
        if (copies !== undefined) {
          copies.visible = collapse.beat === 'open';
          copies.updateWorldMatrix(true, false);
          const work = scratch.current;
          copies.matrixWorld.toArray(work.world);
          mat4.invert(work.inverse, work.world);
          const records = line.current.records;
          for (let index = 0; index < records.length; index++) {
            const glyph = records[index]!;
            if (glyph.empty) continue;
            vec3.transformMat4(work.center, glyph.center, work.world);
            const x = work.center[0] - collapse.x;
            const y = work.center[1] - collapse.y;
            const pose = flight(work.flight, collapse.time, departureAt(Math.abs(x) / 12, glyph.index), 0.8);
            const cosine = Math.cos(pose.turn);
            const sine = Math.sin(pose.turn);
            work.center[0] = collapse.x + (x * cosine - y * sine) * pose.radius;
            work.center[1] = collapse.y + (x * sine + y * cosine) * pose.radius;
            vec3.transformMat4(work.center, work.center, work.inverse);
            mat4.fromTranslation(work.transform, work.center);
            mat4.fromZRotation(work.rotation, pose.turn);
            mat4.multiply(work.transform, work.transform, work.rotation);
            vec3.set(work.scale, pose.size * pose.stretch, pose.size / pose.stretch, 1);
            mat4.scale(work.transform, work.transform, work.scale);
            vec3.set(work.center, -glyph.center[0], -glyph.center[1], 0);
            mat4.fromTranslation(work.pivot, work.center);
            mat4.multiply(work.transform, work.transform, work.pivot);
            mat4.multiply(work.transform, work.transform, glyph.original);
            copies.setMatrixAt(glyph.index, line.current.draw.fromArray(work.transform));
          }
        }
        return;
      }

      // Fit first: the line renders its whole text, unseen, until it knows what size and tracking match the title.
      if (fit === undefined) {
        const width = titleWidth();
        if (object === null || width === undefined) return;
        const target = width - 0.1;
        const state = object.commitState();
        if (state.status !== 'committed' || state.revision === fitRevision.current) return;
        fitRevision.current = state.revision;
        const ink = object.computeBoundingBox();
        const natural = ink.max.x - ink.min.x;
        const glyphs = object.measureGlyphs()?.length ?? 0;
        if (natural <= 0 || glyphs < 2) return;
        // Step down to the nearest size that still fits, then open the tracking to take up the slack exactly.
        const fontSize = Math.floor((FONT_SIZE * target) / natural / SIZE_STEP) * SIZE_STEP;
        const fitted = (natural * fontSize) / FONT_SIZE;
        setFit({ fontSize, letterSpacing: (target - fitted) / (glyphs - 1) });
        return;
      }

      if (line.current === undefined) {
        if (object === null || object.commitState().status !== 'committed') return;
        line.current = createRetainedLine(object);
        showLine(line.current, FEATURE_LINE.text.length);
      }
      if (!heroReady()) return;

      // Clear on the input itself: the impact that restarts the typing is still a beat away.
      const replays = replayCount();
      if (replays !== replay.current) {
        replay.current = replays;
        start.current = Number.POSITIVE_INFINITY;
        beat.current = 0;
        typed.current = 0;
        showLine(line.current, 0);
      }

      const shock = latestShockwave();
      if (shock !== undefined && shock.id !== wave.current) {
        // The title landing is the cue, so a replay restarts the typing with it.
        wave.current = shock.id;
        start.current = shock.at + START_DELAY * 1000;
        beat.current = 0;
        typed.current = 0;
        showLine(line.current, 0);
      }

      if (performance.now() < start.current) return;
      beat.current += 1;
      const count = Math.min(Math.floor(beat.current / FRAMES_PER_CHARACTER), FEATURE_LINE.text.length);
      typed.current = count;
      showLine(line.current, count);
    },
    { fps: 60 },
  );

  return (
    <group>
      <Text
        constraints={{ width: { mode: 'exact', size: LAYOUT_WIDTH } }}
        font={field}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-LAYOUT_WIDTH / 2, LINE_Y, 0]}
        ref={text}
        style={{
          color: '#1c1f25',
          fontSize: fit?.fontSize ?? FONT_SIZE,
          letterSpacing: fit?.letterSpacing ?? 0,
          wordSpacing: WORD_SPACING_EM * (fit?.fontSize ?? FONT_SIZE),
          lineHeight: 1,
          // Hidden for the measuring pass only: the whole line is laid out to be sized, before a letter is shown.
          opacity: fit === undefined ? 0 : 1,
          outline: { color: '#ffffff', width: OUTLINE_EM * (fit?.fontSize ?? FONT_SIZE) },
        }}
      >
        {FEATURE_LINE.text}
      </Text>
    </group>
  );
}
