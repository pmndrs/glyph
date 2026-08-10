import { createFontStack } from '@pmndrs/text';
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
const BUTTON_WIDTH = 112;
const BUTTON_HEIGHT = 44;
const BUTTON_LABEL_SIZE = 16;
const BUTTON_GAP = 16;
const BUTTON_STEP = BUTTON_WIDTH + BUTTON_GAP;
const BUTTON_TOP_INSET = 48;
const pillPoint = uv().sub(0.5).mul(vec2(BUTTON_WIDTH, BUTTON_HEIGHT));
const pillDistance = vec2(
  pillPoint.x
    .abs()
    .sub((BUTTON_WIDTH - BUTTON_HEIGHT) / 2)
    .max(0),
  pillPoint.y,
)
  .length()
  .sub(BUTTON_HEIGHT / 2);
const pillEdge = fwidth(pillDistance);
const pillOpacity = float(1).sub(smoothstep(pillEdge.negate(), pillEdge, pillDistance));
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
  const [hoveredTechnique, setHoveredTechnique] = useState<Technique | null>(null);
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

      <TextGroup name="technique-controls" position={[0, viewport.height / 2 - BUTTON_TOP_INSET, 0]}>
        {techniques.map((buttonTechnique, index) => (
          <group key={buttonTechnique} position={[(index - (techniques.length - 1) / 2) * BUTTON_STEP, 0, 0]}>
            <mesh
              onClick={(event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation();
                setTechnique(buttonTechnique);
              }}
              onPointerEnter={() => {
                setHoveredTechnique(buttonTechnique);
                document.body.style.cursor = 'pointer';
              }}
              onPointerLeave={() => {
                setHoveredTechnique(null);
                document.body.style.cursor = 'default';
              }}
              position={[0, 0, -1]}
            >
              <planeGeometry args={[BUTTON_WIDTH, BUTTON_HEIGHT]} />
              <meshBasicNodeMaterial
                alphaTest={0.001}
                color={
                  technique === buttonTechnique
                    ? '#1a3a56'
                    : hoveredTechnique === buttonTechnique
                      ? '#172536'
                      : '#101621'
                }
                opacity={0.92}
                opacityNode={pillOpacity}
                transparent
              />
            </mesh>
            <Text
              contentBox={{ align: 'center', width: { mode: 'exact', size: BUTTON_WIDTH }, wrap: 'none' }}
              font={msdfLatin}
              paint={{
                color:
                  technique === buttonTechnique
                    ? '#7dd3fc'
                    : hoveredTechnique === buttonTechnique
                      ? '#c5d7ed'
                      : '#8b96ad',
              }}
              position={[-BUTTON_WIDTH / 2, BUTTON_HEIGHT / 2, 0]}
              style={{
                fontSize: BUTTON_LABEL_SIZE,
                letterSpacing: 0.8,
                lineHeight: BUTTON_HEIGHT / BUTTON_LABEL_SIZE,
              }}
            >
              {buttonTechnique.toUpperCase()}
            </Text>
          </group>
        ))}
      </TextGroup>
    </>
  );
}
