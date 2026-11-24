/**
 * A layout box drawn as four thin quads. Layout boxes are y-down from the paragraph's top-left corner;
 * the parent group's origin is that corner, so y flips here and nowhere else.
 */
export function Frame({
  x,
  y,
  width,
  height,
  color,
  thickness = 0.012,
  z = 0.005,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly thickness?: number;
  readonly z?: number;
}) {
  return (
    <group position={[x + width / 2, -(y + height / 2), z]}>
      <mesh position={[0, height / 2, 0]}>
        <planeGeometry args={[width + thickness, thickness]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
      <mesh position={[0, -height / 2, 0]}>
        <planeGeometry args={[width + thickness, thickness]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
      <mesh position={[-width / 2, 0, 0]}>
        <planeGeometry args={[thickness, height]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
      <mesh position={[width / 2, 0, 0]}>
        <planeGeometry args={[thickness, height]} />
        <meshBasicNodeMaterial color={color} />
      </mesh>
    </group>
  );
}

/** A horizontal rule at layout `y`, from `x` to `x + width`. */
export function Rule({
  x,
  y,
  width,
  color,
  thickness = 0.012,
  z = 0.006,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly color: string;
  readonly thickness?: number;
  readonly z?: number;
}) {
  return (
    <mesh position={[x + width / 2, -y, z]}>
      <planeGeometry args={[width, thickness]} />
      <meshBasicNodeMaterial color={color} />
    </mesh>
  );
}
