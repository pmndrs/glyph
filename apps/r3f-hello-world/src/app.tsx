import { type LoadedFont } from '@pmndrs/text';
import { Text, TextGroup, useFont } from '@pmndrs/text/react';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { msdf } from '@pmndrs/text/three/msdf';
import { slug } from '@pmndrs/text/three/slug';
import { useThree, type ThreeEvent } from '@react-three/fiber/webgpu';
import { Activity, useState } from 'react';
import { float, fwidth, smoothstep, uv, vec2 } from 'three/tsl';

import iconFontUrl from '../assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../assets/inter-latin.font.glb?url';

type Technique = 'bitmap' | 'msdf' | 'slug';

const WORLD_ICON = '\uf0ac';
const TECHNIQUES = ['bitmap', 'msdf', 'slug'] as const;
const COLORS = { bitmap: '#f59e0b', msdf: '#fb7185', slug: '#ff4dc4' } as const;

// Multiple techniques can be baked into a single glb, or alternatively you can bake each technique into its own glb.
const latinFontRequest = {
  input: { baked: latinFontUrl },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
} as const;

// This icon font only bakes a few glyphs from the full Font Awesome set. You can bake any subset of glyphs into a glb.
const iconFontRequest = {
  input: { baked: iconFontUrl },
  rasters: [{ technique: bitmap, options: { strikes: [32] } }, { technique: msdf }, { technique: slug }],
} as const;

// You can preload font assets to reduce loading waterfalls.
// This is especially useful for fonts that are used in the initial scene.
useFont.preload(latinFontRequest);
useFont.preload(iconFontRequest);

export function App() {
  const viewport = useThree((state) => state.viewport);
  const [activeTechnique, setActiveTechnique] = useState<Technique>('msdf');

  const [bitmapLatin, msdfLatin, slugLatin] = useFont(latinFontRequest);
  const [bitmapIcons, msdfIcons, slugIcons] = useFont(iconFontRequest);

  const fonts = [
    { font: bitmapLatin, icon: bitmapIcons, technique: 'bitmap' },
    { font: msdfLatin, icon: msdfIcons, technique: 'msdf' },
    { font: slugLatin, icon: slugIcons, technique: 'slug' },
  ] as const;

  return (
    <>
      <ButtonGroup active={activeTechnique} font={slugLatin} onSelect={setActiveTechnique} />
      <group name="world-text">
        {fonts.map(({ font, icon, technique }) => (
          <Activity key={technique} mode={activeTechnique === technique ? 'visible' : 'hidden'}>
            {/* Text can be nested creating inner spans for rich text or to combine different fonts */}
            <Text
              contentBox={{
                align: 'center',
                width: { mode: 'exact', size: viewport.width },
                wrap: 'none',
              }}
              font={font}
              name={`font-${technique}`}
              paint={{ color: '#f4f7ff' }}
              position={[-viewport.width / 2, 32, 0]}
              style={{ fontSize: 64, lineHeight: 1 }}
            >
              Hello world{' '}
              <Text font={icon} paint={{ color: COLORS[technique] }}>
                {WORLD_ICON}
              </Text>
            </Text>
          </Activity>
        ))}
      </group>
    </>
  );
}

interface ButtonGroupProps {
  active: Technique;
  font: LoadedFont<typeof bitmap | typeof msdf | typeof slug>;
  onSelect: (technique: Technique) => void;
  gap?: number;
  padding?: number;
}

/** A group of buttons that use a TextGroup to batch text instances */
function ButtonGroup({ active, font, onSelect, gap = 128, padding = 48 }: ButtonGroupProps) {
  const { height } = useThree((state) => state.viewport);
  const top = height / 2 - padding;

  return (
    // TextGroup can be used to hint text instances to batch.
    // The planner will attempt to optimize rendering, but not all text can be batched into a single draw.
    <TextGroup name="technique-controls" position={[0, top, 0]}>
      {TECHNIQUES.map((technique, index) => (
        <Button
          active={active === technique}
          font={font}
          key={technique}
          onClick={() => onSelect(technique)}
          position={[(index - (TECHNIQUES.length - 1) / 2) * gap, 0, 0]}
          technique={technique}
        />
      ))}
    </TextGroup>
  );
}

interface ButtonProps {
  active: boolean;
  font: LoadedFont<typeof bitmap | typeof msdf | typeof slug>;
  onClick: () => void;
  position: [number, number, number];
  technique: Technique;
  height?: number;
  labelSize?: number;
  width?: number;
}

/** Mesh based button that includes a Text node */
function Button({ active, font, onClick, position, technique, height = 44, labelSize = 16, width = 112 }: ButtonProps) {
  const [hovered, setHovered] = useState(false);

  const color = COLORS[technique];
  const background = active ? '#1a3a56' : hovered ? '#172536' : '#101621';

  return (
    <group position={position}>
      <mesh
        onClick={(event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onClick();
        }}
        onPointerEnter={() => {
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerLeave={() => {
          setHovered(false);
          document.body.style.cursor = 'default';
        }}
        position={[0, 0, -1]}
      >
        <planeGeometry args={[width, height]} />
        <meshBasicNodeMaterial
          alphaTest={0.001}
          color={background}
          opacity={0.92}
          opacityNode={pillNode(width, height)}
          transparent
        />
      </mesh>
      <Text
        contentBox={{
          align: 'center',
          width: { mode: 'exact', size: width },
          wrap: 'none',
        }}
        font={font}
        paint={{ color }}
        position={[-width / 2, height / 2, 0]}
        style={{
          fontSize: labelSize,
          letterSpacing: 0.8,
          lineHeight: height / labelSize,
        }}
      >
        {technique.toUpperCase()}
      </Text>
    </group>
  );
}

/** Pill TSL shader node for pill button meshes */
function pillNode(width: number, height: number) {
  const point = uv().sub(0.5).mul(vec2(width, height));
  const distance = vec2(
    point.x
      .abs()
      .sub((width - height) / 2)
      .max(0),
    point.y,
  )
    .length()
    .sub(height / 2);
  const edge = fwidth(distance);
  return float(1).sub(smoothstep(edge.negate(), edge, distance));
}
