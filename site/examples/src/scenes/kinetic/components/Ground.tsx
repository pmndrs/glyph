import { useEffect, useMemo } from 'react';

import { groundMaterial } from '../materials';

/** A soft radial ground behind everything, so the knot sits in a space rather than on flat black. */
export function Ground() {
  const material = useMemo(() => groundMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh material={material} position={[0, 0, -9]}>
      <planeGeometry args={[60, 34]} />
    </mesh>
  );
}
