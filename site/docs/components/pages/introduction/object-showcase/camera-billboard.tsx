import type { ThreeElements } from '@react-three/fiber/webgpu';
import { forwardRef, type ReactNode } from 'react';
import type { Group } from 'three';

type CameraBillboardProps = Omit<ThreeElements['group'], 'ref'> & {
  readonly children?: ReactNode;
};

/** Retained label transform updated by the owning world-label layer. */
export const CameraBillboard = forwardRef<Group, CameraBillboardProps>(function CameraBillboard(
  { children, ...props },
  forwardedRef,
) {
  return (
    <group ref={forwardedRef} {...props}>
      {children}
    </group>
  );
});
