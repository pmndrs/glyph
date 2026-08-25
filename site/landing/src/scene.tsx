import { Text, useFont } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import { Environment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef, useState } from 'react';
import { cos, float, normalize, positionLocal, sin, uniform, vec3 } from 'three/tsl';
import { DoubleSide, MeshPhysicalNodeMaterial, NormalBlending, PointLight, Vector2 } from 'three/webgpu';

import fontUrl from '../assets/playwrite-glyph.font.glb?url';
import { Effects } from './effects';

const FONT = { input: { baked: fontUrl }, raster: { technique: slug } } as const;
useFont.preload(FONT);

/** Decomposed on purpose: `y` + U+0308, so the mark proves its own mark attachment. */
const WORDMARK = 'glÿph';

/**
 * How hard the sheet curves across the word.
 *
 * The coordinate has to be continuous across the whole paragraph. `renderCoordinate`
 * is per-glyph em space, so driving the normal from it gives every letter its own
 * identical sweep and the word reads as separate lit tiles rather than one piece
 * of metal. `positionLocal` is paragraph-local and continuous across glyphs, so
 * the highlight travels through the joins the way a cursive stroke should.
 *
 * Both uniforms are in layout units and follow the viewport, while the material
 * is built once.
 */
const curvature = uniform(0.4);
const inkCentre = uniform(new Vector2());
const inkSpan = uniform(new Vector2(1, 1));

/**
 * Relief along the pen's travel.
 *
 * A hand-written stroke is not a flat ribbon: pressure rises and falls as the
 * pen moves, and where the cursive loops cross, one pass sits proud of the
 * other. The technique draws text without depth writes, so sorting the crossings
 * in the depth buffer would fight the contract. Instead the ribbon is displaced
 * along Z and its normal is bent by the *slope* of that displacement, so the
 * relief is carried by shading and by parallax against the moving key rather
 * than by occlusion. Two octaves, both irrational multiples of the travel, so
 * the undulation never lines up with the letter rhythm and reads as a hand
 * rather than a wave.
 */
const relief = uniform(0.5);

export function Scene() {
  const mark = useRef<ThreeText<typeof slug>>(null);
  const font = useFont(FONT);
  const viewport = useThree((state) => state.viewport);

  // The light is built imperatively so the material can name it: a text draw is
  // its own material, and the lighting has to be handed to it rather than
  // inherited from whatever the scene happens to hold.
  const key = useMemo(() => new PointLight('#ffffff', 9, 0, 0), []);

  const hero = useMemo(
    () =>
      defineTextMaterial((context) => {
        // The technique's own base material is the contract to match: text
        // quads are double-sided and draw in authored order without depth, so a
        // front-side depth-tested material culls them outright. Everything below
        // is added on top of those settings rather than instead of them.
        const material = new MeshPhysicalNodeMaterial({
          blending: NormalBlending,
          depthTest: false,
          depthWrite: false,
          metalness: 0.82,
          roughness: 0.3,
          side: DoubleSide,
          transparent: true,
        });

        const local = positionLocal.xy.sub(inkCentre).div(inkSpan);
        const lean = local.mul(curvature);

        // The field has to be two-dimensional. Driven by x alone the relief is
        // constant down every vertical stroke and reads as banding; skewing it
        // through y makes the crossings — where a descender loop passes the
        // baseline stroke — land at different heights, which is the push and
        // pull of one pass sitting proud of another.
        const wave = float(2.9);
        const detail = float(6.1);
        const travel = local.x.add(local.y.mul(0.55));
        const cross = local.x.mul(0.7).sub(local.y.mul(1.3));

        const height = sin(travel.mul(wave))
          .mul(0.6)
          .add(sin(cross.mul(detail).add(1.7)).mul(0.4));
        // Slope with respect to each axis: the light reads the gradient, not the
        // height, so both partials are carried into the normal.
        const slopeX = cos(travel.mul(wave))
          .mul(wave)
          .mul(0.6)
          .add(cos(cross.mul(detail).add(1.7)).mul(detail).mul(0.4).mul(0.7));
        const slopeY = cos(travel.mul(wave))
          .mul(wave)
          .mul(0.6)
          .mul(0.55)
          .sub(cos(cross.mul(detail).add(1.7)).mul(detail).mul(0.4).mul(1.3));

        material.positionNode = context.position.add(vec3(0, 0, height.mul(relief)));
        material.normalNode = normalize(vec3(lean.x.add(slopeX.mul(0.075)), lean.y.add(slopeY.mul(0.075)), 1));
        material.colorNode = context.shader.color.mul(height.mul(0.07).add(1));
        material.opacityNode = context.shader.opacity;
        material.envMapIntensity = 1.15;
        // A floor, not a glow: enough for bloom to find the lit edges without
        // lifting the whole mark off the ground.
        material.emissiveNode = context.shader.color.mul(0.025);
        return material;
      }),
    [key],
  );

  const width = viewport.width;
  const fontSize = Math.min(width * 0.28, viewport.height * 0.62);

  const [lineBox, setLineBox] = useState(0);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    const summary = mark.current?.measureLayout();
    if (summary && summary.contentHeight > 0) {
      if (summary.contentHeight !== lineBox) setLineBox(summary.contentHeight);
      // positionLocal runs from the box's top-left with +Y down, so the ink sits
      // in x = [0, width] and y = [-height, 0].
      inkCentre.value.set(width / 2, -summary.contentHeight / 2);
      inkSpan.value.set(Math.max(summary.contentWidth, 1) / 2, Math.max(summary.contentHeight, 1) / 2);
      // Relief is a fraction of the type size, so the stroke keeps the same
      // apparent thickness at every viewport.
      relief.value = fontSize * 0.07;
    }

    elapsed.current += delta;
    const t = elapsed.current * 0.35;
    key.position.set(Math.cos(t) * 5, Math.sin(t * 0.7) * 2.4 + 1, 4);
  });

  return (
    <>
      <ambientLight intensity={0.22} />
      <primitive object={key} />

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

      <Environment frames={1} resolution={256}>
        <Lightformer color="#dfe8ff" intensity={1.6} position={[-4, 2, 4]} scale={[7, 3, 1]} />
        <Lightformer color="#aebfe0" intensity={0.8} position={[4, -1, 3]} scale={[5, 5, 1]} />
        <Lightformer color="#ffffff" intensity={1.1} position={[0, 5, -2]} scale={[10, 2, 1]} />
      </Environment>

      <Effects />
    </>
  );
}
