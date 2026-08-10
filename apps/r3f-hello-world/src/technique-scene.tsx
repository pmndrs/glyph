import { createFontStack, type FontSelection, type LoadedFont } from '@pmndrs/text';
import { Text, useFont } from '@pmndrs/text/r3f';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { msdf } from '@pmndrs/text/three/msdf';
import { slug } from '@pmndrs/text/three/slug';
import { useThree, type ThreeEvent } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import type { Group, InstancedBufferGeometry, Mesh } from 'three/webgpu';

import iconFontUrl from '../assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../assets/inter-latin.font.glb?url';

export type Technique = 'bitmap' | 'msdf' | 'slug';

interface TechniqueSceneProps {
  readonly onTechniqueChange: (technique: Technique) => void;
  readonly technique: Technique;
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
  const bitmapFont = useMemo(() => createFontStack(bitmapLatin, bitmapIcons), [bitmapIcons, bitmapLatin]);
  const msdfFont = useMemo(() => createFontStack(msdfLatin, msdfIcons), [msdfIcons, msdfLatin]);
  const slugFont = useMemo(() => createFontStack(slugLatin, slugIcons), [slugIcons, slugLatin]);
  const root = useRef<Group>(null);

  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('R3F hello-world canvas is missing');
    canvas.dataset.exampleReady = 'false';
    const frame = requestAnimationFrame(() => {
      const copy = root.current?.getObjectByName('r3f-example-copy');
      let draws = 0;
      let records = 0;
      copy?.traverse((object) => {
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
    <group ref={root} position={[-viewport.width / 2, viewport.height / 2, 0]}>
      <TechniqueCopy bitmapFont={bitmapFont} msdfFont={msdfFont} slugFont={slugFont} technique={technique} />
      <TechniqueButtons font={msdfLatin} onTechniqueChange={onTechniqueChange} selected={technique} />
    </group>
  );
}

function TechniqueCopy({
  bitmapFont,
  msdfFont,
  slugFont,
  technique,
}: {
  readonly bitmapFont: FontSelection<typeof bitmap>;
  readonly msdfFont: FontSelection<typeof msdf>;
  readonly slugFont: FontSelection<typeof slug>;
  readonly technique: Technique;
}) {
  switch (technique) {
    case 'bitmap':
      return <Copy TextComponent={BitmapText} font={bitmapFont} />;
    case 'msdf':
      return <Copy TextComponent={MsdfText} font={msdfFont} />;
    case 'slug':
      return <Copy TextComponent={SlugText} font={slugFont} />;
  }
}

function Copy<TechniqueType extends typeof bitmap | typeof msdf | typeof slug>({
  TextComponent,
  font,
}: {
  readonly TextComponent: typeof Text<TechniqueType>;
  readonly font: FontSelection<TechniqueType>;
}) {
  return (
    <TextComponent
      font={font}
      name="r3f-example-copy"
      paint={{ color: '#f4f7ff' }}
      position={[48, -92, 0]}
      style={{ fontSize: 64, lineHeight: 1 }}
    >
      Hello world {WORLD_ICON}
    </TextComponent>
  );
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
