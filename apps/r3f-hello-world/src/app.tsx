import type { Font } from '@pmndrs/glyph';
import { Text, TextGroup } from '@pmndrs/glyph/react';
import { useBitmap } from '@pmndrs/glyph/react/bitmap';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useSlug } from '@pmndrs/glyph/react/slug';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import { useThree, type ThreeEvent } from '@react-three/fiber/webgpu';
import { Activity, useState } from 'react';
import { float, fwidth, smoothstep, uv, vec2 } from 'three/tsl';

import iconFontUrl from '../assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../assets/inter-latin.font.glb?url';

type RasterFormatName = 'bitmap' | 'msdf' | 'slug';

const WORLD_ICON = '\uf0ac';
const RASTER_FORMATS = ['bitmap', 'msdf', 'slug'] as const;
const COLORS = { bitmap: '#f59e0b', msdf: '#fb7185', slug: '#ff4dc4' } as const;

// Multiple raster formats can be baked into one glb, or each format can be baked into its own glb.
const latinFont = latinFontUrl;

// This icon font only bakes a few glyphs from the full Font Awesome set. You can bake any subset of glyphs into a glb.
const iconFont = iconFontUrl;
const bitmapOptions = { strikes: [32] } as const;

// Preload the initial scene's raster formats before React first requests them.
useBitmap.preload(latinFont, bitmapOptions);
useMsdf.preload(latinFont);
useSlug.preload(latinFont);
useBitmap.preload(iconFont, bitmapOptions);
useMsdf.preload(iconFont);
useSlug.preload(iconFont);

export function App() {
  const viewport = useThree((state) => state.viewport);
  const [activeFormat, setActiveFormat] = useState<RasterFormatName>('msdf');

  const bitmapLatin = useBitmap(latinFont, bitmapOptions);
  const msdfLatin = useMsdf(latinFont);
  const slugLatin = useSlug(latinFont);
  const bitmapIcons = useBitmap(iconFont, bitmapOptions);
  const msdfIcons = useMsdf(iconFont);
  const slugIcons = useSlug(iconFont);

  const fonts = [
    { font: bitmapLatin, icon: bitmapIcons, format: 'bitmap' },
    { font: msdfLatin, icon: msdfIcons, format: 'msdf' },
    { font: slugLatin, icon: slugIcons, format: 'slug' },
  ] as const;

  return (
    <>
      <ButtonGroup active={activeFormat} font={slugLatin} onSelect={setActiveFormat} />
      <group name="world-text">
        {fonts.map(({ font, icon, format }) => (
          <Activity key={format} mode={activeFormat === format ? 'visible' : 'hidden'}>
            {/* A nested Text is an inline run: it inherits the paragraph's font and text style unless it
                overrides them, and carries no transform of its own because it is not an object in the scene. */}
            <Text
              constraints={{ width: { mode: 'exact', size: viewport.width } }}
              font={font}
              layout={{ align: 'center', wrap: 'none' }}
              name={`font-${format}`}
              position={[-viewport.width / 2, 32, 0]}
              style={{ color: '#f4f7ff', fontSize: 64, lineHeight: 1 }}
            >
              Hello world{' '}
              <Text font={icon} style={{ color: COLORS[format] }}>
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
  active: RasterFormatName;
  font: Font<typeof bitmap | typeof msdf | typeof slug>;
  onSelect: (format: RasterFormatName) => void;
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
    <TextGroup name="format-controls" position={[0, top, 0]}>
      {RASTER_FORMATS.map((format, index) => (
        <Button
          active={active === format}
          font={font}
          format={format}
          key={format}
          onClick={() => onSelect(format)}
          position={[(index - (RASTER_FORMATS.length - 1) / 2) * gap, 0, 0]}
        />
      ))}
    </TextGroup>
  );
}

interface ButtonProps {
  active: boolean;
  font: Font<typeof bitmap | typeof msdf | typeof slug>;
  onClick: () => void;
  position: [number, number, number];
  format: RasterFormatName;
  height?: number;
  labelSize?: number;
  width?: number;
}

/** Mesh based button that includes a Text node */
function Button({ active, font, format, onClick, position, height = 44, labelSize = 16, width = 112 }: ButtonProps) {
  const [hovered, setHovered] = useState(false);

  const color = COLORS[format];
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
        constraints={{ width: { mode: 'exact', size: width } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-width / 2, height / 2, 0]}
        style={{
          color,
          fontSize: labelSize,
          letterSpacing: 0.8,
          lineHeight: height / labelSize,
        }}
      >
        {format.toUpperCase()}
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
