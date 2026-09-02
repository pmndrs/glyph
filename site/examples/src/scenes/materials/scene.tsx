import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { Environment, Lightformer } from '@react-three/drei';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import { float, normalize, positionLocal, uniform, vec2, vec3 } from 'three/tsl';
import { DoubleSide, MeshPhysicalNodeMaterial, NormalBlending } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * Lit text. The factory keeps the base contract the default sets, then swaps
 * the node material for a physical one whose colour and opacity come from the
 * MSDF coverage. The normal leans with paragraph-local position — measured
 * ink, not per-glyph em space, so the word lights as one surface.
 */
const inkCentre = uniform(vec2(0, 0));
const inkSpan = uniform(vec2(1, 1));
const curvature = uniform(0.9);

const lit = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.msdf') return context.createDefaultMaterial();

  const material = new MeshPhysicalNodeMaterial({
    blending: NormalBlending,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
  });
  const lean = positionLocal.xy.sub(inkCentre).div(inkSpan).mul(curvature);
  material.positionNode = context.position;
  material.normalNode = normalize(vec3(lean.x, lean.y, 1));
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.opacity;
  material.metalnessNode = float(0.62);
  material.roughnessNode = float(0.38);
  material.envMapIntensity = 0.5;
  return material;
});

export default function Materials() {
  const inter = useMsdf(INTER);
  const key = useRef<import('three/webgpu').DirectionalLight>(null);
  const elapsed = useRef(0);

  useFrame((_state, delta) => {
    elapsed.current += delta;
    const t = elapsed.current * 0.5;
    key.current?.position.set(Math.cos(t) * 5, Math.sin(t * 0.7) * 2.5, 4);
  });

  return (
    <>
      <directionalLight ref={key} color="#f2f6ff" intensity={3.4} />
      <Environment frames={1} resolution={256}>
        <color args={['#05060a']} attach="background" />
        <Lightformer form="rect" intensity={1.2} position={[-3, 3, -4]} scale={[6, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.8} position={[4, -1, -4]} scale={[2, 6, 1]} target={[0, 0, 0]} />
      </Environment>
      <Text
        font={inter}
        material={lit}
        style={{ fontSize: 1.5, color: '#e7ecf6' }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 9 } }}
        position={[-4.5, 0.75, 0]}
        onError={console.error}
      >
        Metal
      </Text>
    </>
  );
}
