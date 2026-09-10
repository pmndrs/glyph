import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { float, normalize, positionLocal, uniform, vec2, vec3 } from 'three/tsl';
import { DoubleSide, MeshPhysicalNodeMaterial, NormalBlending, PMREMGenerator, Renderer } from 'three/webgpu';

import { INTER } from '../../fonts';
import { MetalBloom } from './components/MetalBloom';
import { RefractiveShards } from './components/RefractiveShards';

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
  material.metalnessNode = float(0.88);
  material.roughnessNode = float(0.16);
  material.clearcoat = 0.3;
  material.clearcoatRoughness = 0.12;
  material.envMapIntensity = 1.35;
  return material;
});

export default function Materials() {
  const inter = useMsdf(INTER);
  const key = useRef<import('three/webgpu').DirectionalLight>(null);
  const flare = useRef<import('three/webgpu').PointLight>(null);

  useFrame(({ elapsed }) => {
    const t = elapsed * 0.5;
    key.current?.position.set(Math.cos(t) * 5, Math.sin(t * 0.7) * 2.5, 4);
    flare.current?.position.set(Math.cos(t * 0.7) * 3.4, 1.65 + Math.sin(t) * 0.35, 2.2);
  });

  return (
    <>
      <MetalBloom />
      <directionalLight ref={key} color="#f2f6ff" intensity={4.2} />
      <pointLight ref={flare} color="#67e8f9" intensity={9} distance={8} decay={2} />
      <pointLight color="#f0abfc" intensity={5} distance={7} decay={2} position={[-3.4, -1.2, 2.4]} />
      <RoomEnvironmentMap />
      <RefractiveShards />
      <mesh position={[0, 1.65, -0.8]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicNodeMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <Text
        font={inter}
        material={lit}
        style={{ fontSize: 1.5, color: '#dce8ff' }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 9 } }}
        position={[-4.5, 0.72, 0]}
        onError={console.error}
      >
        Metal
      </Text>
    </>
  );
}

/** A generated room, prefiltered once per renderer: a few kilobytes of code instead of a downloaded HDRI. */
function RoomEnvironmentMap() {
  const renderer = useThree((state) => state.renderer);
  const environment = useMemo(() => {
    if (!(renderer instanceof Renderer)) return null; // the WebGPU entry always is; the type is a union
    const pmrem = new PMREMGenerator(renderer);
    const room = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    return room;
  }, [renderer]);
  useEffect(() => () => environment?.dispose(), [environment]);
  return environment === null ? null : <primitive attach="environment" object={environment.texture} />;
}
