import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import { BufferGeometry, Float32BufferAttribute, type Mesh } from 'three/webgpu';
import { usePreparation } from '../loading/prepare';
import { Letterpress } from '../page/traits';
import { diveActions } from './actions';
import { createOutlineMaterial, diveUniforms } from './materials';
import { outlineQuads } from './utils';

/** The drop cap's outline as light: its curves, its control points and their handles, built from the font's own data. */
export function OutlineRenderer() {
  const world = useWorld();
  const material = useMemo(() => createOutlineMaterial(), []);
  // One collapsed quad until the letters exist, so the mesh always has the attributes its material reads.
  const blank = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(8), 2));
    geometry.setAttribute('stroke', new Float32BufferAttribute(new Float32Array(8), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    return geometry;
  }, []);
  const mesh = useRef<Mesh>(null);
  const built = useRef<number | undefined>(undefined);
  usePreparation('outline', () => built.current !== undefined);

  useEffect(() => {
    diveActions(world).mountDiveView({ group: mesh.current!, uniforms: diveUniforms });

    return () => diveActions(world).unmountDiveView();
  }, [world]);

  useEffect(() => () => material.dispose(), [material]);

  useFrame(
    () => {
      const letters = world.get(Letterpress)!;

      // The first letter's shape, once there are letters, and again if the text under them changed it.
      if (letters.count === 0 || built.current === letters.shape[0]) return;

      const quads = outlineQuads(letters.outlineAt(0), 0.006);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(quads.positions, 3));
      geometry.setAttribute('uv', new Float32BufferAttribute(quads.uvs, 2));
      geometry.setAttribute('stroke', new Float32BufferAttribute(quads.strokes, 2));
      geometry.setIndex(quads.indices);
      mesh.current!.geometry.dispose();
      mesh.current!.geometry = geometry;
      built.current = letters.shape[0];
    },
    { id: 'hero-outline-prepare', fps: 60 },
  );

  return (
    <mesh
      frustumCulled={false}
      geometry={blank}
      material={material}
      name="outline"
      ref={mesh}
      renderOrder={45}
      visible={false}
    />
  );
}
