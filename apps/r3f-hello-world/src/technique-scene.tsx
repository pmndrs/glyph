import { createFontStack, type FontSelection, type LoadedFont } from '@pmndrs/text';
import { Text, TextGroup, useFont } from '@pmndrs/text/r3f';
import type { TextGroup as ThreeTextGroup } from '@pmndrs/text/three';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { msdf } from '@pmndrs/text/three/msdf';
import { slug } from '@pmndrs/text/three/slug';
import { useThree, type ThreeEvent } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import type { InstancedBufferGeometry, Mesh } from 'three/webgpu';

import iconFontUrl from '../assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../assets/inter-latin.font.glb?url';

export type Technique = 'bitmap' | 'msdf' | 'slug';

interface TechniqueSceneProps {
  readonly onTechniqueChange: (technique: Technique) => void;
  readonly technique: Technique;
}

interface CopyFonts {
  readonly bitmap: FontSelection<typeof bitmap>;
  readonly msdf: FontSelection<typeof msdf>;
  readonly slug: FontSelection<typeof slug>;
}

const WORLD_ICON = '\uf0ac';
const BitmapText = Text<typeof bitmap>;
const MsdfText = Text<typeof msdf>;
const SlugText = Text<typeof slug>;

const latinRequest = {
  input: { baked: latinFontUrl },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
} as const;
const iconRequest = {
  input: { baked: iconFontUrl },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
} as const;

export function TechniqueScene({ onTechniqueChange, technique }: TechniqueSceneProps) {
  const viewport = useThree((state) => state.viewport);
  const [bitmapLatin, msdfLatin, slugLatin] = useFont(latinRequest);
  const [bitmapIcons, msdfIcons, slugIcons] = useFont(iconRequest);
  const copyFonts = useMemo<CopyFonts>(
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
        <Copy fonts={copyFonts} technique={technique} />
      </TextGroup>
      <TextGroup compositing="independent" position={[-viewport.width / 2, viewport.height / 2, 0]}>
        <TechniqueButtons font={msdfLatin} onTechniqueChange={onTechniqueChange} selected={technique} />
      </TextGroup>
    </>
  );
}

function Copy({ fonts, technique }: { readonly fonts: CopyFonts; readonly technique: Technique }) {
  const properties = {
    paint: { color: '#f4f7ff' },
    position: [48, -92, 0],
    style: { fontSize: 64, lineHeight: 1 },
  } as const;
  switch (technique) {
    case 'bitmap':
      return (
        <BitmapText {...properties} font={fonts.bitmap}>
          Hello world {WORLD_ICON}
        </BitmapText>
      );
    case 'msdf':
      return (
        <MsdfText {...properties} font={fonts.msdf}>
          Hello world {WORLD_ICON}
        </MsdfText>
      );
    case 'slug':
      return (
        <SlugText {...properties} font={fonts.slug}>
          Hello world {WORLD_ICON}
        </SlugText>
      );
  }
}

function TechniqueButtons({
  font,
  onTechniqueChange,
  selected,
}: {
  readonly font: LoadedFont<typeof msdf>;
  readonly onTechniqueChange: (technique: Technique) => void;
  readonly selected: Technique;
}) {
  return (
    <group position={[48, -200, 0]}>
      {(['bitmap', 'msdf', 'slug'] as const).map((technique, index) => (
        <group key={technique} position={[index * 128, 0, 0]}>
          <mesh
            onClick={(event: ThreeEvent<MouseEvent>) => {
              event.stopPropagation();
              onTechniqueChange(technique);
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
            <meshBasicMaterial color={selected === technique ? '#182b42' : '#101621'} opacity={0.92} transparent />
          </mesh>
          <MsdfText
            font={font}
            paint={{ color: selected === technique ? '#7dd3fc' : '#8b96ad' }}
            style={{ fontSize: 22, lineHeight: 1 }}
          >
            {technique.toUpperCase()}
          </MsdfText>
        </group>
      ))}
    </group>
  );
}
