import { Text, useFont } from '@pmndrs/glyph/react';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import { Environment, Lightformer } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef, useState } from 'react';
import { normalize, positionLocal, uniform, vec3 } from 'three/tsl';
import { DirectionalLight, DoubleSide, MeshPhysicalNodeMaterial, NormalBlending, Vector2 } from 'three/webgpu';

import fontUrl from '../assets/playwrite-glyph.font.glb?url';
import { useLook } from './controls';
import { Effects } from './effects';
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
  const look = useLook();

  // Only `envMapIntensity` is a plain material field rather than a node, so it
  // is the one dial that costs a rebuild; everything else rides a uniform and
  // updates live.
  const hero = useMemo(
    () =>
      defineTextMaterial((context) => {
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
        material.envMapIntensity = look.envIntensity;
        return material;
      }),
    [look.envIntensity],
  );

  const width = viewport.width;
  const fontSize = Math.min(width * look.measure, viewport.height * 0.62);

  // A three-point rig rather than one lamp. Directional lights carry parallel
  // rays, so the specular is even across the word instead of exploding wherever
  // a point light happens to sit closest — which is what was blowing the frame
  // out. The key travels; fill and rim hold still and do the shaping.
  const key = useRef<DirectionalLight>(null);

  const [lineBox, setLineBox] = useState(0);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    curvature.value = look.curvature;
    metalness.value = look.metalness;
    roughness.value = look.roughness;
    emissive.value = look.emissive;

    const summary = mark.current?.measureLayout();
    if (summary && summary.contentHeight > 0) {
      if (summary.contentHeight !== lineBox) setLineBox(summary.contentHeight);
      // positionLocal runs from the box's top-left with +Y down, so the ink sits
      // in x = [0, width] and y = [-height, 0].
      inkCentre.value.set(width / 2, -summary.contentHeight / 2);
      inkSpan.value.set(Math.max(summary.contentWidth, 1) / 2, Math.max(summary.contentHeight, 1) / 2);
    }

    elapsed.current += delta;
    const t = elapsed.current * look.keySpeed;
    const keyX = Math.cos(t) * look.keyRadius;
    const keyY = Math.sin(t * 0.7) * look.keyRadius * look.keyElevation;
    key.current?.position.set(keyX, keyY, 4);
    trackKey(keyX, keyY, viewport.width, viewport.height, look.aberrationPeak, look.aberrationFalloff);
  });

  return (
    <>
      <ambientLight intensity={look.ambient} />
      <directionalLight color="#f2f6ff" intensity={look.keyIntensity} ref={key} />
      <directionalLight color="#8fa6cc" intensity={look.fillIntensity} position={[-5, -2, 3]} />
      <directionalLight
        color="#cfe0ff"
        intensity={look.rimIntensity}
        position={[Math.cos(look.rimAngle) * 6, Math.sin(look.rimAngle) * 6, -4]}
      />

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
        <Lightformer color="#dfe8ff" intensity={0.6} position={[-4, 2, 4]} scale={[7, 3, 1]} />
        <Lightformer color="#aebfe0" intensity={0.3} position={[4, -1, 3]} scale={[5, 5, 1]} />
        <Lightformer color="#ffffff" intensity={0.4} position={[0, 5, -2]} scale={[10, 2, 1]} />
      </Environment>

      <Effects />
    </>
  );
}
