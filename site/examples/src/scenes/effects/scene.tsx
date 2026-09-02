import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useState } from 'react';

import { INTER } from '../../fonts';

/**
 * Outline and shadow come from the MSDF field itself — `outlineCoverage` and
 * `shadowCoverage` are nodes the format already computes — so they cost no
 * second draw. Colour animates through style; the material is untouched.
 *
 * A style colour is `#rrggbb`, `#rrggbbaa`, or a linear RGBA tuple — not an
 * arbitrary CSS colour — so the hue is turned into hex here.
 */
export default function Effects() {
  const inter = useMsdf(INTER);
  const [color, setColor] = useState('#ffd166');

  useFrame(({ elapsed }) => {
    setColor(hueHex((elapsed * 24) % 360));
  });

  return (
    <>
      <Text
        font={inter}
        style={{ fontSize: 0.9, color: '#e7ecf6', outline: { color: '#0a0c12', width: 0.05 } }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 9 } }}
        position={[-4.5, 1.9, 0]}
      >
        outline
      </Text>
      <Text
        font={inter}
        style={{ fontSize: 0.9, color: '#e7ecf6', shadow: { color: [0, 0, 0, 0.7], offset: [0.06, -0.06] } }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 9 } }}
        position={[-4.5, 0.6, 0]}
      >
        shadow
      </Text>
      <Text
        font={inter}
        style={{
          fontSize: 0.9,
          color,
          outline: { color: '#0a0c12', width: 0.03 },
          shadow: { color: [0, 0, 0, 0.5], offset: [0.04, -0.04] },
        }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 9 } }}
        position={[-4.5, -0.7, 0]}
      >
        animated
      </Text>
    </>
  );
}

/** A saturated, light hue as `#rrggbb` (HSL 90% / 68%). */
export function hueHex(hue: number): string {
  const s = 0.9;
  const l = 0.68;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = c;
  let g = x;
  let b = 0;
  switch (Math.floor(hue / 60) % 6) {
    case 1:
      [r, g, b] = [x, c, 0];
      break;
    case 2:
      [r, g, b] = [0, c, x];
      break;
    case 3:
      [r, g, b] = [0, x, c];
      break;
    case 4:
      [r, g, b] = [x, 0, c];
      break;
    case 5:
      [r, g, b] = [c, 0, x];
      break;
    default:
      break;
  }
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
