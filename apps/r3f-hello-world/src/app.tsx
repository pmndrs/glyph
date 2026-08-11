import { createFontStack, type LoadedFont } from '@pmndrs/text';
import { Text, TextGroup, useFont } from '@pmndrs/text/react';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { msdf } from '@pmndrs/text/three/msdf';
import { slug } from '@pmndrs/text/three/slug';
import { useThree, type ThreeEvent } from '@react-three/fiber/webgpu';
import { Activity, useMemo, useState } from 'react';
import { float, fwidth, smoothstep, uv, vec2 } from 'three/tsl';

import iconFontUrl from '../assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../assets/inter-latin.font.glb?url';

type Technique = 'bitmap' | 'msdf' | 'slug';

const WORLD_ICON = '\uf0ac';
const techniques = ['bitmap', 'msdf', 'slug'] as const;
const button = { gap: 16, height: 44, labelSize: 16, topInset: 48, width: 112 } as const;

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
  return (
    <>
      <group name="world-text">
        {techniques.map((worldTechnique) => (
          <Activity key={worldTechnique} mode={technique === worldTechnique ? 'visible' : 'hidden'}>
            <TextGroup name={`world-${worldTechnique}`}>
              <Text
                contentBox={{ align: 'center', width: { mode: 'exact', size: viewport.width }, wrap: 'none' }}
                font={fonts[worldTechnique]}
                paint={{ color: '#f4f7ff' }}
                position={[-viewport.width / 2, 32, 0]}
                style={{ fontSize: 64, lineHeight: 1 }}
              >
                Hello world {WORLD_ICON}
              </Text>
            </TextGroup>
          </Activity>
        ))}
      </group>

      <TextGroup name="technique-controls" position={[0, viewport.height / 2 - button.topInset, 0]}>
        {techniques.map((buttonTechnique, index) => (
          <Button
            active={technique === buttonTechnique}
            font={msdfLatin}
            key={buttonTechnique}
            onClick={() => setTechnique(buttonTechnique)}
            position={[(index - (techniques.length - 1) / 2) * (button.width + button.gap), 0, 0]}
            technique={buttonTechnique}
          />
        ))}
      </TextGroup>
    </>
  );
}

interface ButtonProps {
  readonly active: boolean;
  readonly font: LoadedFont<typeof msdf>;
  readonly onClick: () => void;
  readonly position: [number, number, number];
  readonly technique: Technique;
}

function Button({ active, font, onClick, position, technique }: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const node = useMemo(() => pillNode(button.width, button.height), []);
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
        <planeGeometry args={[button.width, button.height]} />
        <meshBasicNodeMaterial
          alphaTest={0.001}
          color={active ? '#1a3a56' : hovered ? '#172536' : '#101621'}
          opacity={0.92}
          opacityNode={node}
          transparent
        />
      </mesh>
      <Text
        contentBox={{ align: 'center', width: { mode: 'exact', size: button.width }, wrap: 'none' }}
        font={font}
        paint={{ color: active ? '#7dd3fc' : hovered ? '#c5d7ed' : '#8b96ad' }}
        position={[-button.width / 2, button.height / 2, 0]}
        style={{ fontSize: button.labelSize, letterSpacing: 0.8, lineHeight: button.height / button.labelSize }}
      >
        {technique.toUpperCase()}
      </Text>
    </group>
  );
}

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
