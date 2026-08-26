import { Text, useFont } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import { Environment, Lightformer, Stats } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef, useState } from 'react';
import { normalize, positionLocal, uniform, vec3 } from 'three/tsl';
import { DirectionalLight, DoubleSide, MeshPhysicalNodeMaterial, NormalBlending, Vector2 } from 'three/webgpu';

import fontUrl from '../assets/playwrite-glyph.font.glb?url';
import { Chorus } from './chorus';
import { live } from './controls';
import { useDebugVisible } from './debug-visibility';
import { publishMarkBottom } from './anchor';
import { Effects } from './effects';
import { shake } from './drift';
import { trackKey } from './lens';

const FONT = { input: { baked: fontUrl }, raster: { technique: slug } } as const;
useFont.preload(FONT);

/** Decomposed on purpose: `y` + U+0308, so the mark proves its own mark attachment. */
const WORDMARK = 'glÿph';

/**
 * The normal has to ride a coordinate continuous across the paragraph.
 * `renderCoordinate` is per-glyph em space, so driving from it gives every
 * letter its own identical sweep and the word reads as separate lit tiles.
 * `positionLocal` is paragraph-local, so the highlight travels through the
 * joins the way a cursive stroke should. Both uniforms are layout units and
 * follow the viewport while the material is built once.
 */
const curvature = uniform(0.4);
const inkCentre = uniform(new Vector2());
const inkSpan = uniform(new Vector2(1, 1));
const metalness = uniform(0.82);
const roughness = uniform(0.13);
const emissive = uniform(0.008);

export function Scene() {
  const mark = useRef<ThreeText<typeof slug>>(null);
  const font = useFont(FONT);
  const viewport = useThree((state) => state.viewport);
  const camera = useThree((state) => state.camera);
  const debugVisible = useDebugVisible();

  // Filtered camera state. The noise is sampled as a target and the camera is
  // eased toward it rather than snapped onto it: stacked octaves are continuous
  // but their derivative is not, and reading a target straight onto the
  // transform every frame makes the motion frame-rate dependent besides. A
  // one-pole filter removes both — and the lag it introduces is the point,
  // because a real camera has mass.
  const eased = useRef({ aimX: 0, aimY: 0, x: 0, y: 0, z: 6 });

  // Only `envMapIntensity` is a plain material field rather than a node, so it
  // is the one dial that costs a rebuild; everything else rides a uniform and
  // updates live.
  // Held so the one dial that is a plain material field rather than a node can
  // still be driven live.
  const built = useRef<MeshPhysicalNodeMaterial>(null);

  const hero = useMemo(
    () =>
      defineTextMaterial((context) => {
        // The context is a union now: each known technique carries its own typed
        // `shader`, and a generic arm carries an untyped `outputs` map for
        // techniques this build does not know. Narrowing on the technique is
        // what recovers the typed Slug output, and the fallback is honest rather
        // than a cast.
        if (context.technique !== 'pmndrs.slug') return context.createDefaultMaterial();

        // The technique's own base material is the contract to match: text quads
        // are double-sided and draw in authored order without depth writes, so a
        // front-side depth-tested material is culled outright and renders
        // nothing at all.
        const material = new MeshPhysicalNodeMaterial({
          blending: NormalBlending,
          depthTest: false,
          depthWrite: false,
          side: DoubleSide,
          transparent: true,
        });

        const lean = positionLocal.xy.sub(inkCentre).div(inkSpan).mul(curvature);

        // Required, not optional: the Slug graph's vertex half writes the
        // varying its fragment half integrates, so a material that consumes the
        // coverage must drive its position from the same node.
        material.positionNode = context.position;
        material.normalNode = normalize(vec3(lean.x, lean.y, 1));
        material.colorNode = context.shader.color;
        material.opacityNode = context.shader.opacity;
        material.metalnessNode = metalness;
        material.roughnessNode = roughness;
        material.emissiveNode = context.shader.color.mul(emissive);
        material.envMapIntensity = live.envIntensity;
        built.current = material;
        return material;
      }),
    [],
  );

  const width = viewport.width;
  const fontSize = Math.min(width * live.measure, viewport.height * 0.62);

  // A three-point rig rather than one lamp. Directional lights carry parallel
  // rays, so the specular is even across the word instead of exploding wherever
  // a point light happens to sit closest — which is what was blowing the frame
  // out. The key travels; fill and rim hold still and do the shaping.
  const key = useRef<DirectionalLight>(null);

  const [lineBox, setLineBox] = useState(0);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    if (built.current) built.current.envMapIntensity = live.envIntensity;
    curvature.value = live.curvature;
    metalness.value = live.metalness;
    roughness.value = live.roughness;
    emissive.value = live.emissive;

    const summary = mark.current?.layout();
    if (summary && summary.contentHeight > 0) {
      if (summary.contentHeight !== lineBox) setLineBox(summary.contentHeight);
      // positionLocal runs from the box's top-left with +Y down, so the ink sits
      // in x = [0, width] and y = [-height, 0].
      inkCentre.value.set(width / 2, -summary.contentHeight / 2);
      inkSpan.value.set(Math.max(summary.contentWidth, 1) / 2, Math.max(summary.contentHeight, 1) / 2);

      // Where the controls sit, in screen terms.
      //
      // Measured from the baseline, not the line box. Playwrite's line box is
      // enormous next to its ink — a script face carries huge ascent and
      // descent metrics — so the box bottom lands well below the tails and
      // pushes the controls off the frame. The baseline is exact; how far the
      // descenders hang under it is the one unknown, and it stays a dial until
      // Text can publish ink extents (#113).
      const baseline = summary.contentHeight / 2 - summary.firstBaseline;
      const inkBottom = baseline - fontSize * live.descent;
      // The gap is in ems of the type, so it holds its optical weight as the
      // mark scales with the viewport rather than becoming a hairline on a
      // display and a chasm on a phone.
      const gap = fontSize * live.markGap;
      publishMarkBottom(0.5 - (inkBottom - gap) / Math.max(viewport.height, 1e-3));
    }

    elapsed.current += delta;

    // Parallax by orbiting, not by sliding. A lateral camera move shifts the
    // *nearer* object further across the frame, so translating alone would swing
    // the mark and leave the field behind it almost still — the wrong way round.
    // Keeping the aim near the origin puts the mark on the pivot: it barely
    // moves, while the chorus several units behind it travels.
    //
    // The aim is jittered separately and by a fraction of the body movement.
    // Translation alone reads as a dolly however small it is; it is the tiny
    // rotation riding on top that makes it read as a camera being held rather
    // than a camera being moved.
    const t = elapsed.current * live.shakeSpeed;
    // Frame-rate independent: the coefficient comes from the elapsed time and
    // the time constant, so the same damping holds at 30fps and at 120.
    const alpha = 1 - Math.exp(-delta / Math.max(live.shakeDamping, 1e-3));
    const ease = (from: number, to: number) => from + (to - from) * alpha;

    const eye = eased.current;
    eye.x = ease(eye.x, shake(t, 0) * live.shakeAmount);
    eye.y = ease(eye.y, shake(t, 101) * live.shakeAmount * 0.7);
    eye.z = ease(eye.z, 6 + shake(t, 211) * live.shakeAmount * 0.25);
    eye.aimX = ease(eye.aimX, shake(t * 1.6, 307) * live.shakeAim);
    eye.aimY = ease(eye.aimY, shake(t * 1.6, 401) * live.shakeAim * 0.7);

    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(eye.aimX, eye.aimY, 0);

    const keyT = elapsed.current * live.keySpeed;
    const keyX = Math.cos(keyT) * live.keyRadius;
    const keyY = Math.sin(keyT * 0.7) * live.keyRadius * live.keyElevation;
    key.current?.position.set(keyX, keyY, 4);
    trackKey(keyX, keyY, viewport.width, viewport.height, live.aberrationPeak, live.aberrationFalloff);
  });

  return (
    <>
      {import.meta.env.DEV && debugVisible && <Stats />}

      <ambientLight color="#e7ecf6" intensity={live.ambient} />
      <directionalLight color="#f2f6ff" intensity={live.keyIntensity} ref={key} />
      <directionalLight color="#8fa6cc" intensity={live.fillIntensity} position={[-5, -2, 3]} />
      <directionalLight
        color="#cfe0ff"
        intensity={live.rimIntensity}
        position={[Math.cos(live.rimAngle) * 6, Math.sin(live.rimAngle) * 6, -4]}
      />

      <Chorus />

      <Text
        contentBox={{ align: 'center', width: { mode: 'exact', size: width }, wrap: 'none' }}
        font={font}
        material={hero}
        paint={{ color: '#e7ecf6' }}
        position={[-width / 2, lineBox / 2, 0]}
        ref={mark}
        style={{ fontSize }}
      >
        {WORDMARK}
      </Text>

      {/*
        A studio, built rather than downloaded. drei's `preset="studio"` fetches a
        multi-megabyte HDRI from the drei-assets CDN, which a self-contained Pages
        artifact should not depend on — and a built rig is art-directable besides.
        The shape is a real studio: a large soft key box, a long overhead strip,
        and two vertical side strips. The side strips are what matter on script
        type: chrome reads as chrome because its edges catch a bright vertical,
        and a cursive stroke turning through 360° needs something to catch at
        every angle. Baked once, since none of it moves.
      */}
      <Environment frames={1} resolution={live.envResolution}>
        <color args={['#05060a']} attach="background" />

        {/* Key: broad and soft, upper left. */}
        <Lightformer
          color="#eef3ff"
          form="rect"
          intensity={live.studioKey}
          position={[-5, 3.5, 5]}
          rotation={[0, Math.PI / 7, 0]}
          scale={[8, 5, 1]}
        />

        {/* Ceiling strip, straight overhead. */}
        <Lightformer
          color="#ffffff"
          form="rect"
          intensity={live.studioTop}
          position={[0, 7, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[14, 3, 1]}
        />

        {/* Side strips: the vertical catches that make a curved stroke read as metal. */}
        <Lightformer
          color="#cfe0ff"
          form="rect"
          intensity={live.studioSides}
          position={[7, 0, 2]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[6, 9, 1]}
        />
        <Lightformer
          color="#9fb4d8"
          form="rect"
          intensity={live.studioSides * 0.6}
          position={[-7, -0.5, 2]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[6, 9, 1]}
        />

        {/* A dim ring behind, so the descenders have something to fall off into. */}
        <Lightformer
          color="#6f83a6"
          form="ring"
          intensity={live.studioBack}
          position={[0, -1, -8]}
          scale={[12, 12, 1]}
        />
      </Environment>

      <Effects />
    </>
  );
}
