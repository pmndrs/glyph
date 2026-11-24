import type { TextAnchor } from '@pmndrs/glyph';
import { Text, useMsdf } from '@pmndrs/glyph/react';

import { INTER } from '../../fonts';
import { PAPER_DIM } from '../../theme';

/**
 * Guides shared by the paragraph-layout scenes. Every helper takes
 * paragraph-local coordinates (origin top-left, +X right, +Y down) and draws
 * in the parent group's frame, so a guide placed beside a `<Text>` with the
 * default anchor lines up with what `measure()` and `flow` describe.
 */
export type Box = readonly [x: number, y: number, width: number, height: number];
export type Point = readonly [inline: number, block: number];

export const GUIDE = '#4a5365';
export const PANEL = '#0f1218';

const LINE = 0.014;

/** One straight guide between two paragraph-local points. */
export function Segment({
  from,
  to,
  color = GUIDE,
  thickness = LINE,
  z = 0.005,
}: {
  readonly from: Point;
  readonly to: Point;
  readonly color?: string;
  readonly thickness?: number;
  readonly z?: number;
}) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return (
    // A unit plane, scaled: a guide that follows an animated box must not rebuild its geometry every frame.
    <mesh
      position={[(from[0] + to[0]) / 2, -(from[1] + to[1]) / 2, z]}
      rotation={[0, 0, Math.atan2(-dy, dx)]}
      scale={[Math.hypot(dx, dy) + thickness, thickness, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicNodeMaterial color={color} />
    </mesh>
  );
}

/** A closed outline through paragraph-local points. */
export function Ring({
  points,
  color = GUIDE,
  thickness = LINE,
  z = 0.005,
}: {
  readonly points: readonly Point[];
  readonly color?: string;
  readonly thickness?: number;
  readonly z?: number;
}) {
  return (
    <>
      {points.map((point, index) => (
        <Segment
          key={index}
          from={point}
          to={points[(index + 1) % points.length]!}
          color={color}
          thickness={thickness}
          z={z}
        />
      ))}
    </>
  );
}

/** A rectangle outline: `[x, y, width, height]`. */
export function Outline({
  box: [x, y, width, height],
  color = GUIDE,
  thickness = LINE,
}: {
  readonly box: Box;
  readonly color?: string;
  readonly thickness?: number;
}) {
  return (
    <Ring
      points={[
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ]}
      color={color}
      thickness={thickness}
    />
  );
}

/** A filled rectangle behind the text. */
export function Fill({
  box: [x, y, width, height],
  color = PANEL,
  z = -0.01,
}: {
  readonly box: Box;
  readonly color?: string;
  readonly z?: number;
}) {
  return (
    <mesh position={[x + width / 2, -(y + height / 2), z]} scale={[width, height, 1]}>
      <planeGeometry args={[1, 1]} />
      <meshBasicNodeMaterial color={color} />
    </mesh>
  );
}

/** A small disc marking one point, such as the object's position. */
export function Dot({
  at: [x, y],
  color,
  radius = 0.055,
}: {
  readonly at: Point;
  readonly color: string;
  readonly radius?: number;
}) {
  return (
    <mesh position={[x, -y, 0.02]} scale={[radius, radius, 1]}>
      <circleGeometry args={[1, 24]} />
      <meshBasicNodeMaterial color={color} />
    </mesh>
  );
}

/** A small caption whose `anchor` reference sits at the paragraph-local point `at`. */
export function Label({
  at: [x, y],
  size = 0.17,
  color = PAPER_DIM,
  anchor,
  children,
}: {
  readonly at: Point;
  readonly size?: number;
  readonly color?: string;
  readonly anchor?: TextAnchor;
  readonly children: string;
}) {
  const inter = useMsdf(INTER);
  return (
    <Text
      font={inter}
      style={{ fontSize: size, color, letterSpacing: 0.02 }}
      layout={{ wrap: 'none' }}
      constraints={anchor === undefined ? undefined : { anchor }}
      position={[x, -y, 0]}
    >
      {children}
    </Text>
  );
}
