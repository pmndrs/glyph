import { createFontStack, type FontSelection, type LoadedFont } from '@pmndrs/text';
import { Text, useFont } from '@pmndrs/text/r3f';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { msdf } from '@pmndrs/text/three/msdf';
import { slug } from '@pmndrs/text/three/slug';
import { useThree, type ThreeEvent } from '@react-three/fiber/webgpu';
import { useMemo } from 'react';

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

const bitmapLatinRequest = {
  input: { baked: latinFontUrl },
  raster: { technique: bitmap, options: { strikes: [32] } },
} as const;
const bitmapIconRequest = {
  input: { baked: iconFontUrl },
  raster: { technique: bitmap, options: { strikes: [32] } },
} as const;
const msdfLatinRequest = {
  input: { baked: latinFontUrl },
  raster: { technique: msdf },
} as const;
const msdfIconRequest = {
  input: { baked: iconFontUrl },
  raster: { technique: msdf },
} as const;
const slugLatinRequest = {
  input: { baked: latinFontUrl },
  raster: { technique: slug },
} as const;
const slugIconRequest = {
  input: { baked: iconFontUrl },
  raster: { technique: slug },
} as const;

export function TechniqueScene({ onTechniqueChange, technique }: TechniqueSceneProps) {
  const viewport = useThree((state) => state.viewport);
  const buttonFont = useFont(msdfLatinRequest);

  return (
    <group position={[-viewport.width / 2, viewport.height / 2, 0]}>
      <TechniqueCopy technique={technique} />
      <TechniqueButtons font={buttonFont} onTechniqueChange={onTechniqueChange} selected={technique} />
    </group>
  );
}

function TechniqueCopy({ technique }: { readonly technique: Technique }) {
  switch (technique) {
    case 'bitmap':
      return <BitmapCopy />;
    case 'msdf':
      return <MsdfCopy />;
    case 'slug':
      return <SlugCopy />;
  }
}

function BitmapCopy() {
  const latin = useFont(bitmapLatinRequest);
  const icons = useFont(bitmapIconRequest);
  const font = useMemo(() => createFontStack(latin, icons), [icons, latin]);
  return <Copy TextComponent={BitmapText} font={font} />;
}

function MsdfCopy() {
  const latin = useFont(msdfLatinRequest);
  const icons = useFont(msdfIconRequest);
  const font = useMemo(() => createFontStack(latin, icons), [icons, latin]);
  return <Copy TextComponent={MsdfText} font={font} />;
}

function SlugCopy() {
  const latin = useFont(slugLatinRequest);
  const icons = useFont(slugIconRequest);
  const font = useMemo(() => createFontStack(latin, icons), [icons, latin]);
  return <Copy TextComponent={SlugText} font={font} />;
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
