import type { HoleState } from '../black-hole/traits';
import { createFlight, departureAt, flight } from '../black-hole/utils';
import { type RetainedLine, createRetainedLine, disposeLine, showLine, resetLine } from '../view/utils';
import { mat4, vec3 } from 'math';
import { useWorld } from 'koota/react';
import { Title, Typing } from './traits';
import { typographyActions } from './actions';
import { Text } from '@pmndrs/glyph/react';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Box3, Vector3, Matrix4 } from 'three/webgpu';
import { FEATURE_LINE } from './utils/content';
import { heroReady, usePreparation } from '../view/startup';
import type { SlugFont, MsdfFont } from '../view/hooks';
import { stainedGlassLetters, titleOrigin } from './materials';
import { solidOf } from './utils/outline';
import type { Letter, TitleBodies } from './traits';

/**
 * How deep each letter's invisible solid reaches: enough that the robot meets it squarely, never drives over it.
 */
const SOLID_THICKNESS = 0.8;
const FONT_SIZE = 4.4;
/** Wide exact box so `align: 'center'` centres the word on the origin. */
const LAYOUT_WIDTH = 60;
const titleInk = new Box3();
const inkCenter = new Vector3();

/**
 * Each glass glyph follows a rigid body after the title commits. Space lifts and drops the letters, and the
 * robot pushes them along the floor.
 */
export function GlassTitle({ font }: { readonly font: SlugFont }) {
  const world = useWorld();
  const draw = useRef(new Matrix4());
  const camera = useThree((state) => state.camera);
  const word = useRef<ThreeText<never> | null>(null);
  /** Published once: the box is in the Text's own space, so the reveal's scale never enters into it. */
  const reported = useRef(false);
  /** The broken-apart paragraph and the bodies its glyphs follow, built once the layout has been measured. */
  const glyphs = useRef<Glyphs | undefined>(undefined);
  const bodies = useRef<TitleBodies | undefined>(undefined);
  usePreparation('title', () => bodies.current !== undefined);

  useEffect(() => {
    titleOrigin.value.set(LAYOUT_WIDTH / 2, -FONT_SIZE / 2, 0);
  }, []);

  useEffect(() => {
    const title = world.queryFirst(Title)!;
    const object = word.current;

    return () => {
      typographyActions(world).disposeTitle(title);

      bodies.current = undefined;
      reported.current = false;
      glyphs.current?.removeFromParent();
      glyphs.current?.dispose();
      glyphs.current = undefined;

      if (object !== null) object.visible = true;
    };
  }, [world]);

  useFrame(
    () => {
      if (reported.current) {
        const state = bodies.current!;
        const copies = glyphs.current!;

        for (let index = 0; index < state.pieces.length; index++) {
          copies.setMatrixAt(state.pieces[index]!.letter.index, draw.current.fromArray(state.matrices, index * 16));
        }

        return;
      }

      const object = word.current;

      // Measure ink only after layout commits to avoid a second layout build.
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
      const layout = object.glyphs();

      for (const measurement of copies.measurements) {
        if (measurement.localInkBounds.isEmpty()) continue;

        const solid = solidOf(
          font,
          layout.glyphIds[measurement.index]!,
          layout.glyphFontSizes[measurement.index]!,
          SOLID_THICKNESS,
        );

        // The body sits where the paragraph placed the letter's ink, in world space.
        titleInk.copy(measurement.localInkBounds).applyMatrix4(copies.matrixWorld);
        titleInk.getCenter(inkCenter);
        letters.push({
          home: [inkCenter.x, inkCenter.y, inkCenter.z],
          solid,
          index: measurement.index,
          original: mat4.copy(mat4.create(), measurement.originalMatrix.elements),
        });
      }

      glyphs.current = copies;
      bodies.current = typographyActions(world).prepareTitle(
        mat4.copy(mat4.create(), copies.matrixWorld.elements),
        letters,
        camera.position.z,
        SOLID_THICKNESS,
        ink.max.x - ink.min.x,
      );

      // Development-only handle for inspecting the smash from DevTools.
      if (import.meta.env.DEV) Object.assign(globalThis, { heroTitle: bodies.current });

      reported.current = true;
    },
    { id: 'hero-title-motion' },
  );

  return (
    <group>
      <Text
        constraints={{ width: { mode: 'exact', size: LAYOUT_WIDTH } }}
        font={font}
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

/** Starting size, only ever reduced: the line is fitted to the title's width, never stretched past it. */
const FEATURE_FONT_SIZE = 0.42;
/** Size steps the fit snaps to, so it lands a little under the target and tracking makes up the rest. */
const SIZE_STEP = 0.005;
/** Wide exact box so `align: 'center'` centres the line on the origin, as the title does. */
const FEATURE_LAYOUT_WIDTH = 60;

export function FeatureLine({ field, collapse }: { readonly field: MsdfFont; readonly collapse: HoleState }) {
  const text = useRef<ThreeText<never> | null>(null);
  const world = useWorld();
  const typing = world.queryFirst(Typing)!;
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

      if (collapse.beat === 'closed' && collapsed.current) {
        collapsed.current = false;

        if (line.current !== undefined) resetLine(line.current, typing.get(Typing)!.count);
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
        const width = world.queryFirst(Title)!.get(Title)!.width;

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
        const fontSize = Math.floor((FEATURE_FONT_SIZE * target) / natural / SIZE_STEP) * SIZE_STEP;
        const fitted = (natural * fontSize) / FEATURE_FONT_SIZE;
        setFit({ fontSize, letterSpacing: (target - fitted) / (glyphs - 1) });

        return;
      }

      if (line.current === undefined) {
        if (object === null || object.commitState().status !== 'committed') return;

        line.current = createRetainedLine(object);
        showLine(line.current, FEATURE_LINE.length);
      }

      if (!heroReady()) return;

      showLine(line.current, typing.get(Typing)!.count);
    },
    { fps: 60 },
  );

  return (
    <group>
      <Text
        constraints={{ width: { mode: 'exact', size: FEATURE_LAYOUT_WIDTH } }}
        font={field}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-FEATURE_LAYOUT_WIDTH / 2, -2.65, 0]}
        ref={text}
        style={{
          color: '#1c1f25',
          fontSize: fit?.fontSize ?? FEATURE_FONT_SIZE,
          letterSpacing: fit?.letterSpacing ?? 0,
          wordSpacing: -0.08 * (fit?.fontSize ?? FEATURE_FONT_SIZE),
          lineHeight: 1,
          // Hidden for the measuring pass only: the whole line is laid out to be sized, before a letter is shown.
          opacity: fit === undefined ? 0 : 1,
          outline: { color: '#ffffff', width: 0.12 * (fit?.fontSize ?? FEATURE_FONT_SIZE) },
        }}
      >
        {FEATURE_LINE}
      </Text>
    </group>
  );
}
