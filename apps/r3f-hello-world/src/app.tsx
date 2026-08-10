import { createFontStack, type AnyRasterTechnique } from '@pmndrs/text';
import { Text, TextGroup, useFont } from '@pmndrs/text/r3f';
import type { TextGroup as ThreeTextGroup } from '@pmndrs/text/three';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { msdf } from '@pmndrs/text/three/msdf';
import { slug } from '@pmndrs/text/three/slug';
import { useThree, type ThreeEvent } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { InstancedBufferGeometry, Mesh } from 'three/webgpu';

import iconFontUrl from '../assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../assets/inter-latin.font.glb?url';

type Technique = 'bitmap' | 'msdf' | 'slug';

const WORLD_ICON = '\uf0ac';
const techniques = ['bitmap', 'msdf', 'slug'] as const;
const latinRequest = {
  input: { baked: latinFontUrl },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
} as const;
const iconRequest = {
  input: { baked: iconFontUrl },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
} as const;

export function App() {
  const viewport = useThree((state) => state.viewport);
  const [technique, setTechnique] = useState<Technique>('msdf');
  const [bitmapLatin, msdfLatin, slugLatin] = useFont(latinRequest);
  const [bitmapIcons, msdfIcons, slugIcons] = useFont(iconRequest);
  const fonts = useMemo(
    () => ({
      bitmap: createFontStack(bitmapLatin, bitmapIcons),
      msdf: createFontStack(msdfLatin, msdfIcons),
      slug: createFontStack(slugLatin, slugIcons),
    }),
    [bitmapIcons, bitmapLatin, msdfIcons, msdfLatin, slugIcons, slugLatin],
  );
  const worldLayer = useRef<ThreeTextGroup>(null);

  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('R3F hello-world canvas is missing');
    canvas.dataset.exampleReady = 'false';
    const frame = requestAnimationFrame(() => {
      let draws = 0;
      let records = 0;
      worldLayer.current?.traverse((object) => {
        const mesh = object as Mesh<InstancedBufferGeometry>;
        if (mesh.isMesh !== true || mesh.userData.pmndrsTextRunStart === undefined) return;
        draws += 1;
        records += mesh.geometry.instanceCount;
      });
      canvas.dataset.exampleTechnique = technique;
      canvas.dataset.exampleDraws = String(draws);
      canvas.dataset.exampleRecords = String(records);
      canvas.dataset.exampleReady = draws === 2 && records === 11 ? 'true' : 'false';
    });
    return () => cancelAnimationFrame(frame);
  }, [technique]);

  return (
    <>
      <TextGroup ref={worldLayer} compositing="independent" position={[-viewport.width / 2, viewport.height / 2, 0]}>
        <Text<AnyRasterTechnique>
          font={fonts[technique]}
          paint={{ color: '#f4f7ff' }}
          position={[48, -92, 0]}
          style={{ fontSize: 64, lineHeight: 1 }}
        >
          Hello world {WORLD_ICON}
        </Text>
      </TextGroup>

      <TextGroup compositing="independent" position={[-viewport.width / 2, viewport.height / 2, 0]}>
        <group position={[48, -200, 0]}>
          {techniques.map((buttonTechnique, index) => (
            <group key={buttonTechnique} position={[index * 128, 0, 0]}>
              <mesh
                onClick={(event: ThreeEvent<MouseEvent>) => {
                  event.stopPropagation();
                  setTechnique(buttonTechnique);
                }}
                onPointerEnter={() => {
                  document.body.style.cursor = 'pointer';
                }}
                onPointerLeave={() => {
                  document.body.style.cursor = 'default';
                }}
                position={[48, 0, -1]}
              >
                <planeGeometry args={[112, 44]} />
                <meshBasicMaterial
                  color={technique === buttonTechnique ? '#182b42' : '#101621'}
                  opacity={0.92}
                  transparent
                />
              </mesh>
              <Text
                font={msdfLatin}
                paint={{ color: technique === buttonTechnique ? '#7dd3fc' : '#8b96ad' }}
                style={{ fontSize: 22, lineHeight: 1 }}
              >
                {buttonTechnique.toUpperCase()}
              </Text>
            </group>
          ))}
        </group>
      </TextGroup>
    </>
  );
}
