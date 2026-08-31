import { Text, useFont } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import { Environment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { Suspense, lazy, useMemo, useRef } from 'react';
import { normalize, positionLocal, uniform, vec3 } from 'three/tsl';
import { DirectionalLight, DoubleSide, MeshPhysicalNodeMaterial, NormalBlending, Vector2 } from 'three/webgpu';

import fontUrl from '../assets/playwrite-glyph.font.glb?url';
import { Chorus } from './chorus';
import { live } from './look';

// `import.meta.env.DEV` is a build-time constant, so in production this folds to
// `null` and the `import()` below becomes unreachable — the counter and drei's
// stats dependency never reach the bundle.
const DevStats = import.meta.env.DEV ? lazy(() => import('./dev/stats')) : null;
import { publishMarkBottom } from './anchor';
import { Effects } from './effects';
import { envelope, shake } from './drift';
import { trackKey } from './lens';

useFont.preload(fontUrl, slug);

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
  const font = useFont(fontUrl, slug);
  const viewport = useThree((state) => state.viewport);
  const camera = useThree((state) => state.camera);

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

  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    if (built.current) built.current.envMapIntensity = live.envIntensity;
    curvature.value = live.curvature;
    metalness.value = live.metalness;
    roughness.value = live.roughness;
    emissive.value = live.emissive;

    // Ink, not the advance box.
    //
    // `contentWidth`/`contentHeight` are advance extents — the space the text
    // claims — and they are the right numbers for a host laying out boxes. They
    // are the wrong ones for centring, because a cursive face overhangs its
    // advances and Playwrite's line box is far taller than its ink: centring on
    // it left the mark low and put the controls through the tails of g, y and p.
    // `inkBounds` is the union of the positioned glyphs' outlines, which is what
    // the eye actually sees, so no descender allowance has to be guessed at.
    const summary = mark.current?.measure();
    const ink = summary?.inkBounds;
    if (summary && ink !== undefined && ink.height > 0) {
      // Paragraph space runs +Y down from the box top-left, so placing the
      // object at the ink centre puts that centre on the origin.
      // Set on the object, not through the prop. The measurement arrives inside
      // the frame loop, and a prop can only change by re-rendering the scene —
      // which is a needless render, and a frame late. Through a ref it was worse
      // than late: nothing re-read it until an unrelated resize forced a render.
      mark.current?.position.set(-(ink.x + ink.width / 2), ink.y + ink.height / 2, 0);
      // A paragraph is 'pending' on the frame it is authored and 'committed' on
      // the next, so the first frame has no measurement to place it by — not
      // because the value is missing, but because there is no layout yet. Drawing
      // that frame puts the mark at its unplaced origin and then snaps it. It
      // stays hidden until it has been measured once instead.
      if (mark.current !== null) mark.current.visible = true;

      inkCentre.value.set(ink.x + ink.width / 2, -(ink.y + ink.height / 2));
      inkSpan.value.set(Math.max(ink.width, 1) / 2, Math.max(ink.height, 1) / 2);

      // With the ink centred on the origin its lowest point is exactly half its
      // height below, so the controls need no allowance beyond the gap itself.
      const below = ink.height / 2 + fontSize * live.markGap;
      publishMarkBottom(0.5 + below / Math.max(viewport.height, 1e-3));
    }

    elapsed.current += delta;

    // Each axis runs on its own clock as well as its own noise. Sharing one
    // rate is the other half of what made the sway diagonal: decorrelated
    // sequences sampled at the same speed still turn over together. The
    // multipliers are deliberately unrelated so the axes never come back into
    // step, and the aim runs slower than the body because a head turns less
    // often than it drifts.
    const t = elapsed.current * live.shakeSpeed;
    const breathe = envelope(t, 17);
    const reach = live.shakeAmount * breathe;

    // Frame-rate independent: the coefficient comes from the elapsed time and
    // the time constant, so the same damping holds at 30fps and at 120. Each
    // axis settles a little differently, which keeps the filter itself from
    // imposing a rhythm the noise no longer has.
    const ease = (from: number, to: number, scale: number) =>
      from + (to - from) * (1 - Math.exp(-delta / Math.max(live.shakeDamping * scale, 1e-3)));

    const eye = eased.current;
    eye.x = ease(eye.x, shake(t * 1.0, 0) * reach, 1);
    eye.y = ease(eye.y, shake(t * 0.79, 101) * reach * 0.7, 1.23);
    eye.z = ease(eye.z, 6 + shake(t * 0.61, 211) * reach * 0.25, 1.51);
    eye.aimX = ease(eye.aimX, shake(t * 0.47, 307) * live.shakeAim * breathe, 1.37);
    eye.aimY = ease(eye.aimY, shake(t * 0.38, 401) * live.shakeAim * breathe * 0.7, 1.61);

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
      {DevStats !== null && (
        <Suspense fallback={null}>
          <DevStats />
        </Suspense>
      )}

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
        constraints={{ width: { mode: 'exact', size: width } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        material={hero}
        ref={mark}
        style={{ color: '#e7ecf6', fontSize }}
        visible={false}
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
