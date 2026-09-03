import { Text } from '@pmndrs/glyph/react';
import { useSlug } from '@pmndrs/glyph/react/slug';
import type { slug } from '@pmndrs/glyph/raster/slug';
import type { Font } from '@pmndrs/glyph';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Matrix4, type Group, type Mesh } from 'three/webgpu';

import { INTER } from '../../fonts';
import { circle, placeOnPath } from '../../lib/paths';
import {
  LIGHTS,
  RINGS,
  RING_INK,
  RING_LETTER_SPACING,
  RING_WOBBLE,
  SPHERE_SPIN,
  ringFit,
  ringLine,
  ringPitch,
  ringSpaces,
  ringSpacing,
  SPHERE,
} from './config';
import { ringInk, sphereMaterial } from './materials';

/**
 * Text in orbit. Two rings of Slug type circle a matte sphere, each shaped
 * once, copied out with `breakApart()` and placed by matrix on a circle —
 * fixed text, so the rings are already whole and casting shadows on the
 * first frame. Two lights, spread apart, so between them most of the
 * sphere's front carries light and a ring crossing it can cast a shadow.
 * Because the ring material masks three's shadow pass with Slug's analytic
 * coverage, the shadows are the letters.
 */
export default function Orbit() {
  const inter = useSlug(INTER);
  const gl = useThree((state) => state.gl);
  const sphere = useMemo(() => sphereMaterial(), []);
  const body = useRef<Mesh>(null);

  // The markings are procedural on the body's own local position, so turning the body turns them
  // with it. Nothing else about a smooth sphere changes under rotation, and the light and its
  // shadows are world-space, so they stay put while the belts drift past underneath.
  useFrame(({ elapsed }) => {
    if (body.current !== null) body.current.rotation.y = elapsed * SPHERE_SPIN;
  });

  useEffect(() => {
    // The renderer is the explainer's, shared with every other scene on the page, and switching
    // its shadow map on is the one thing this scene needs from it. There is no hook that owns
    // that flag to move the write into.
    // oxlint-disable-next-line react-compiler
    gl.shadowMap.enabled = true;
  }, [gl]);

  return (
    <>
      <ambientLight color="#dfe6f5" intensity={0.5} />
      {LIGHTS.map((light) => (
        <directionalLight
          key={light.color}
          castShadow={light.castShadow}
          color={light.color}
          intensity={light.intensity}
          position={[...light.position]}
          {...(light.castShadow && {
            'shadow-mapSize': [4096, 4096] as [number, number],
            'shadow-camera-near': 1,
            'shadow-camera-far': 30,
            'shadow-camera-left': -5,
            'shadow-camera-right': 5,
            'shadow-camera-top': 5,
            'shadow-camera-bottom': -5,
            'shadow-bias': -0.0004,
          })}
        />
      ))}
      <mesh ref={body} position={[...SPHERE.position]} material={sphere} receiveShadow>
        <sphereGeometry args={[SPHERE.radius, 64, 64]} />
      </mesh>
      {RINGS.map((ring) => (
        <Ring key={ring.text} ring={ring} font={inter} />
      ))}
    </>
  );
}

const scratch = new Matrix4();

/**
 * One orbital ring, held at a tilt that breathes, with its letters marching around the circle.
 * The text arrives as a single copy, is measured once it commits, and is then restated with the
 * number of copies that circle actually holds — the shaper's own width, not an estimate of it.
 */
function Ring({ ring, font }: { readonly ring: (typeof RINGS)[number]; readonly font: Font<typeof slug> }) {
  const group = useRef<Group>(null);
  const source = useRef<ThreeText<typeof slug>>(null);
  const path = useMemo(() => circle(ring.radius), [ring.radius]);
  const line = useMemo(() => ringLine(ring), [ring]);
  /** Copies of the phrase; one to start, then however many the circle turned out to hold. */
  const [repeats, setRepeats] = useState(1);
  /** The revision the restated text has to pass before its glyphs are the ones to copy. */
  const awaiting = useRef<number | undefined>(undefined);
  /**
   * One copy's arc, measured once off the first single-copy commit and then left alone. Measuring
   * it again after the restate would read a trailing space trimmed from a longer line and answer
   * slightly differently, and the fit would flip between two counts and never settle.
   */
  const pitch = useRef<number | undefined>(undefined);
  /** The copied glyphs, the word spaces before each source index, and the arc each one grows by. */
  const placed = useRef<{
    readonly glyphs: Glyphs;
    readonly spacesBefore: Int32Array;
    readonly extra: number;
  } | null>(null);

  useFrame(({ elapsed }) => {
    const g = group.current;
    if (g !== null) {
      const [rate, turn] = ring.spin;
      const wobble = 'wobble' in ring ? ring.wobble : RING_WOBBLE;
      g.rotation.set(
        ring.tilt + Math.sin(elapsed * rate + ring.phase) * wobble,
        elapsed * turn,
        Math.cos(elapsed * rate * 0.7 + ring.phase) * wobble * 0.7,
      );
    }
    if (placed.current === null) {
      const paragraph = source.current;
      if (paragraph === null) return;
      const state = paragraph.commitState();
      if (state.status !== 'committed') return;
      if (awaiting.current !== undefined && state.revision <= awaiting.current) return;
      awaiting.current = undefined;
      // `maxContentWidth` is intrinsic, so it reports what the copies want rather than the box
      // they were measured in — but it trims the trailing space, so it only sizes the first fit.
      pitch.current ??= ringPitch(paragraph.measure().maxContentWidth, ring.size);
      const fit = ringFit(path.length, pitch.current, ringSpaces(line), ring.size);
      if (fit.repeats !== repeats) {
        awaiting.current = state.revision;
        setRepeats(fit.repeats);
        return;
      }
      const [glyphs] = paragraph.breakApart();
      glyphs.traverse((object) => {
        object.castShadow = true;
        // Its bounding volume is from the pre-wrap straight line; setMatrixAt moves instances onto
        // the circle every frame without updating it, so frustum culling would judge the wrong box.
        object.frustumCulled = false;
      });
      paragraph.parent?.add(glyphs);
      placed.current = { glyphs, spacesBefore: ringSpacing(line.repeat(repeats)), extra: fit.extra };
    }
    const { glyphs, spacesBefore, extra } = placed.current;
    for (let i = 0; i < glyphs.count; i += 1) {
      const rest = glyphs.measurements[i];
      if (rest === undefined) continue;
      // One shaped unit of advance is one unit of arc, so every glyph keeps what the shaper gave
      // it; the circle is closed by growing the word spaces before it, never the letters.
      const advance = rest.originalMatrix.elements[12] ?? 0;
      const s = advance + (spacesBefore[rest.sourceIndex] ?? 0) * extra + elapsed * ring.speed;
      glyphs.setMatrixAt(i, placeOnPath(path, s, 0, 0, rest.originalMatrix, scratch));
    }
  });

  return (
    <group ref={group} position={[...SPHERE.position]}>
      <Text
        ref={source}
        font={font}
        material={ringInk}
        visible={false}
        style={{ fontSize: ring.size, color: RING_INK, letterSpacing: RING_LETTER_SPACING }}
        layout={{ wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 80 } }}
      >
        {line.repeat(repeats)}
      </Text>
    </group>
  );
}
