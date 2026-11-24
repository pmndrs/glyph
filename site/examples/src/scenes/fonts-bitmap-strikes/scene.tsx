import type { Font, msdf } from '@pmndrs/glyph';
import { Text, useBitmap, useMsdf } from '@pmndrs/glyph/react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useRef } from 'react';
import type { Group } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * A pixel face baked at three strikes, on a pixel-unit stage. Top: two rows
 * drift sideways by fractions of a pixel; the one without `pixelSnapping`
 * smears as it crosses pixel boundaries, the snapped one stays on the grid.
 * Below: one row per size, each saying which strike drew it. A size that is
 * a strike is a one-to-one copy of the baked pixels; any other size is the
 * nearest strike resampled.
 */
export const VT323 = new URL('../../../../docs/assets/fonts/vt323-bitmap.font.glb', import.meta.url).href;
export const VT323_STRIKES = { strikes: [16, 24, 32] } as const;
const SIZES = [16, 20, 24, 28, 32, 48] as const;

/** The strike nearest `fontSize * rasterPixelRatio`; a tie keeps the smaller one. */
function nearestStrike(fontSize: number, rasterPixelRatio: number): number {
  const target = fontSize * rasterPixelRatio;
  let nearest: number = VT323_STRIKES.strikes[0];
  for (const strike of VT323_STRIKES.strikes) {
    if (Math.abs(strike - target) < Math.abs(nearest - target)) nearest = strike;
  }
  return nearest;
}

export default function FontsBitmapStrikes() {
  const { width, height, dpr } = useThree((state) => state.viewport);
  const pixel = useBitmap(VT323, VT323_STRIKES);
  const inter = useMsdf(INTER);
  const drifting = useRef<(Group | null)[]>([]);

  useFrame(({ elapsed }) => {
    // Three pixels each way, slowly: most frames land between pixels.
    const offset = Math.sin(elapsed * 0.6) * 3;
    for (const group of drifting.current) if (group) group.position.x = offset;
  });

  // Two columns when the frame is wide enough, one otherwise; the content is centred vertically in a tall frame.
  const wide = width >= 760;
  const top = Math.min(height / 2 - 20, 130);
  const snapLeft = wide ? -width / 2 + Math.max(24, width * 0.08) : -width / 2 + 24;
  const ladderLeft = wide ? 24 : snapLeft;
  const SNAP_BLOCK = 22 + 32 + 8 + 16 + 28;
  const ladderTop = wide ? top : top - 2 * SNAP_BLOCK - 8;
  const ladder = ladderRows(ladderTop - 22, -height / 2 + 12, dpr);

  return (
    <>
      {([false, true] as const).map((snapped, index) => {
        const y = top - index * SNAP_BLOCK;
        return (
          <group key={String(snapped)}>
            <Label font={inter} x={snapLeft} y={y} color={snapped ? ACCENT : PAPER_DIM}>
              {`pixelSnapping ${snapped ? 'on' : 'off'}`}
            </Label>
            <group
              ref={(node) => {
                drifting.current[index] = node;
              }}
            >
              {([32, 16] as const).map((size) => (
                <Text
                  key={size}
                  font={pixel}
                  rasterPixelRatio={dpr}
                  pixelSnapping={snapped}
                  style={{ fontSize: size, color: PAPER, lineHeight: 1 }}
                  layout={{ wrap: 'none' }}
                  position={[snapLeft, size === 32 ? y - 22 : y - 62, 0]}
                >
                  {size === 32 ? 'Sharp pixels 0123456789' : 'The quick brown fox jumps over the lazy dog'}
                </Text>
              ))}
            </group>
          </group>
        );
      })}
      <Label font={inter} x={ladderLeft} y={ladderTop} color={PAPER_DIM}>
        {`strikes 16, 24, 32 at rasterPixelRatio ${dpr}`}
      </Label>
      {ladder.map(({ size, strike, exact, y }) => (
        <Text
          key={size}
          font={pixel}
          rasterPixelRatio={dpr}
          pixelSnapping
          style={{ fontSize: size, color: exact ? PAPER : PAPER_DIM, lineHeight: 1 }}
          layout={{ wrap: 'none' }}
          position={[ladderLeft, y, 0]}
        >
          {`${size} px: strike ${strike}${exact ? '' : ', resampled'}`}
        </Text>
      ))}
    </>
  );
}

/** The ladder rows that fit between `top` and `bottom`, each with the strike that draws it. */
function ladderRows(top: number, bottom: number, rasterPixelRatio: number) {
  const rows: { size: number; strike: number; exact: boolean; y: number }[] = [];
  let y = top;
  for (const size of SIZES) {
    if (y - size < bottom) break;
    const strike = nearestStrike(size, rasterPixelRatio);
    rows.push({ size, strike, exact: strike === size * rasterPixelRatio, y });
    y -= size + 10;
  }
  return rows;
}

function Label({
  font,
  x,
  y,
  color,
  children,
}: {
  readonly font: Font<typeof msdf>;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly children: string;
}) {
  return (
    <Text
      font={font}
      style={{ fontSize: 12, color, letterSpacing: 0.4 }}
      layout={{ wrap: 'none' }}
      position={[x, y, 0]}
    >
      {children}
    </Text>
  );
}
