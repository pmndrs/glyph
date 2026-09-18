import { Text } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, useState } from 'react';
import { Box3, Mesh, MeshBasicNodeMaterial, PlaneGeometry } from 'three/webgpu';

import { FEATURE_LINE } from '../content';
import type { MsdfFont } from '../fonts';
import { latestShockwave } from './shockwave';
import { titleWidth } from './metrics';
import { replayCount } from './replay';

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
/** Padding around the typed ink, as a fraction of the fitted size, and how much ground the band keeps. */
const BAND_PAD_X = 0.22;
const BAND_PAD_Y = 0.34;
const BAND_OPACITY = 0;
/** Tightens the gaps either side of the separators, as a fraction of the fitted size. Applied during the measuring
 * pass too, so the width the tracking is fitted against already accounts for it. */
const WORD_SPACING_EM = -0.08;
const LINE_Y = -2;

/** One unit quad, scaled each commit to the typed ink: a selection band that grows with the line. */
const BAND_GEOMETRY = new PlaneGeometry(1, 1);
const BAND_MATERIAL = new MeshBasicNodeMaterial({
  color: '#7c8fae',
  depthWrite: false,
  opacity: BAND_OPACITY,
  transparent: true,
});
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
  const [typed, setTyped] = useState(0);
  const wave = useRef(0);
  const replay = useRef(replayCount());
  const start = useRef(Number.POSITIVE_INFINITY);
  /** Frames since typing began; the cadence is counted in these, not in seconds. */
  const beat = useRef(0);
  // The last committed revision whose ink we measured: re-reading an uncommitted layout forces it to be rebuilt.
  const measured = useRef(-1);
  /** Set once the full line has been measured against the title and the size and tracking are settled. */
  const [fit, setFit] = useState<{ fontSize: number; letterSpacing: number } | undefined>(undefined);
  const fitRevision = useRef(-1);
  const box = useRef(new Box3());
  const span = useRef(new Box3());
  const band = useRef<Mesh | null>(null);

  useFrame(() => {
    const object = text.current;

    // Fit first: the line renders its whole text, unseen, until it knows what size and tracking match the title.
    if (fit === undefined) {
      const target = (titleWidth() ?? 0) - 0.1;
      if (object === null || target === undefined) return;
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

    // Clear on the input itself: the impact that restarts the typing is still a beat away.
    const replays = replayCount();
    if (replays !== replay.current) {
      replay.current = replays;
      start.current = Number.POSITIVE_INFINITY;
      beat.current = 0;
      measured.current = -1;
      setTyped(0);
      if (band.current !== null) band.current.visible = false;
    }

    const shock = latestShockwave();
    if (shock !== undefined && shock.id !== wave.current) {
      // The title landing is the cue, so a replay restarts the typing with it.
      wave.current = shock.id;
      start.current = shock.at + START_DELAY * 1000;
      beat.current = 0;
      measured.current = -1;
      setTyped(0);
      if (band.current !== null) band.current.visible = false;
    }

    if (performance.now() < start.current) return;
    beat.current += 1;
    const count = Math.min(Math.floor(beat.current / FRAMES_PER_CHARACTER), FEATURE_LINE.text.length);
    if (count !== typed) setTyped(count);

    // Everything below only sizes the band. `measureGlyphs` allocates a measurement per glyph — two vectors, a
    // matrix, two boxes and a quad each — so with the band off it is several hundred objects every third frame for
    // a result nothing draws.
    if (object === null || count === 0 || BAND_OPACITY <= 0) return;
    // Ink is only read once a layout has committed — measuring a pending one makes it lay out again, every frame.
    const state = object.commitState();
    if (state.status !== 'committed' || state.revision === measured.current) return;
    const glyphs = object.measureGlyphs();
    if (glyphs === undefined) return;
    measured.current = state.revision;
    object.updateWorldMatrix(true, false);
    span.current.makeEmpty();
    for (const glyph of glyphs) {
      const ink = box.current.copy(glyph.localInkBounds).applyMatrix4(object.matrixWorld);
      span.current.union(ink);
    }

    const plate = band.current;
    if (plate !== null && !span.current.isEmpty()) {
      const size = fit.fontSize;
      const width = span.current.max.x - span.current.min.x + size * BAND_PAD_X * 2;
      const height = span.current.max.y - span.current.min.y + size * BAND_PAD_Y * 2;
      plate.scale.set(width, height, 1);
      plate.position.set(
        (span.current.min.x + span.current.max.x) / 2,
        (span.current.min.y + span.current.max.y) / 2,
        -0.02,
      );
      plate.visible = true;
    }
  });

  return (
    <>
      <mesh geometry={BAND_GEOMETRY} material={BAND_MATERIAL} ref={band} visible={false} />
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
        {fit === undefined ? FEATURE_LINE.text : FEATURE_LINE.text.slice(0, typed)}
      </Text>
    </>
  );
}
