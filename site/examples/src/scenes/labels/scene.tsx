import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useRef, type ReactNode } from 'react';
import { Fog, type Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, GROUND, PAPER, PAPER_DIM } from '../../stage';

/**
 * Annotations on things that move. Each label is a child of the body it names,
 * turned to face the camera every frame, and depth-tested so a nearer body
 * hides it. The scene's fog dims what recedes — a text material is a node
 * material, so fog applies to it like anything else.
 */
const inScene = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  material.depthTest = true;
  return material;
});

const BODIES = [
  { name: 'Io', period: '1.77 d', color: '#f4d68a', radius: 0.3, orbit: 1.6, speed: 0.9, phase: 0 },
  { name: 'Europa', period: '3.55 d', color: '#9fc4ff', radius: 0.26, orbit: 2.5, speed: 0.55, phase: 2.1 },
  { name: 'Ganymede', period: '7.15 d', color: '#c9b8a8', radius: 0.42, orbit: 3.6, speed: 0.34, phase: 4.2 },
] as const;

const TILT = 0.5;

export default function Labels() {
  const inter = useMsdf(INTER);
  const system = useRef<Group>(null);
  const elapsed = useRef(0);

  useFrame(({ camera, scene }, delta) => {
    elapsed.current += delta;
    // The stage moves the camera to fit the viewport; keep the fog band where the bodies are.
    if (scene.fog instanceof Fog) {
      scene.fog.near = camera.position.z - 1;
      scene.fog.far = camera.position.z + 6.5;
    }
    const group = system.current;
    if (group === null) return;
    for (const [index, body] of BODIES.entries()) {
      const node = group.children[index];
      if (node === undefined) continue;
      const angle = body.phase + elapsed.current * body.speed;
      node.position.set(
        Math.cos(angle) * body.orbit,
        Math.sin(angle) * body.orbit * Math.sin(TILT),
        Math.sin(angle) * body.orbit * Math.cos(TILT),
      );
    }
  });

  return (
    <>
      <fog args={[GROUND, 10, 20]} attach="fog" />
      <mesh>
        <sphereGeometry args={[0.8, 48, 32]} />
        <meshStandardNodeMaterial color="#7a5a1e" emissive={ACCENT} emissiveIntensity={0.6} roughness={0.6} />
      </mesh>
      <Billboard offset={1.05}>
        <Text
          font={inter}
          material={inScene}
          style={{ fontSize: 0.3, color: PAPER }}
          layout={{ align: 'center', wrap: 'none' }}
          constraints={{ width: { mode: 'exact', size: 3 } }}
          position={[-1.5, 0.3, 0]}
        >
          Jupiter
        </Text>
      </Billboard>
      <group ref={system}>
        {BODIES.map((body) => (
          <group key={body.name}>
            <mesh>
              <sphereGeometry args={[body.radius, 32, 24]} />
              <meshStandardNodeMaterial color={body.color} roughness={0.7} />
            </mesh>
            <Billboard offset={body.radius + 0.12}>
              <Text
                font={inter}
                material={inScene}
                style={{ fontSize: 0.24, color: PAPER, lineHeight: 1.15 }}
                layout={{ align: 'center', wrap: 'none' }}
                constraints={{ width: { mode: 'exact', size: 3 } }}
                position={[-1.5, 0.55, 0]}
              >
                {body.name}
                {'\n'}
                <Text style={{ fontSize: 0.17, color: PAPER_DIM }}>{body.period}</Text>
              </Text>
            </Billboard>
          </group>
        ))}
      </group>
    </>
  );
}

/** A group that always faces the camera, lifted `offset` above its parent's origin. */
function Billboard({ offset, children }: { readonly offset: number; readonly children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    group.current?.quaternion.copy(camera.quaternion);
  });
  return (
    <group ref={group} position={[0, offset, 0]}>
      {children}
    </group>
  );
}
