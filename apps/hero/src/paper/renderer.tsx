import { bakePaperGrain, paperMaterial, uPaperDrift } from './materials';
import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import { useActions } from 'koota/react';
import { paperActions } from './actions';

/** The paper everything lies on, its grain baked once when it mounts and scrolled with the icon paper. */
export function Paper() {
  const { mountPaperView, unmountPaperView } = useActions(paperActions);
  const renderer = useThree((state) => state.renderer);

  useEffect(() => {
    bakePaperGrain(renderer);
    mountPaperView(uPaperDrift.value);

    return unmountPaperView;
  }, [mountPaperView, renderer, unmountPaperView]);

  return (
    <mesh material={paperMaterial} position={[0, 0, -14]}>
      <planeGeometry args={[160, 90]} />
    </mesh>
  );
}
