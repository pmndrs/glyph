import { useFrame } from '@react-three/fiber/webgpu';
import { useRef } from 'react';

import { selectedShowcaseIndex, type ShowcaseInteraction } from './interaction-state';
import { advanceSelectionScale, SHOWCASE_REST_SCALE } from './selection-motion';

export type ShowcaseSelectionMotion = Readonly<{
  scale: number;
  selectedIndex: number | undefined;
}>;

export type ShowcaseSelectionMotionSource = Readonly<{ current: ShowcaseSelectionMotion }>;

type MutableShowcaseSelectionMotion = {
  scale: number;
  selectedIndex: number | undefined;
};

/** Own one timeline shared by the instanced object and its independently rendered label. */
export function useShowcaseSelectionMotion(interaction: ShowcaseInteraction): ShowcaseSelectionMotionSource {
  const motion = useRef<MutableShowcaseSelectionMotion>({ scale: SHOWCASE_REST_SCALE, selectedIndex: undefined });
  useFrame((_state, delta) => {
    const requestedIndex = selectedShowcaseIndex(interaction);
    const selectedIndex = requestedIndex ?? motion.current.selectedIndex;
    const changedSelection = requestedIndex !== undefined && requestedIndex !== motion.current.selectedIndex;
    const scale = advanceSelectionScale(
      changedSelection ? SHOWCASE_REST_SCALE : motion.current.scale,
      interaction,
      delta,
    );
    motion.current.scale = scale;
    motion.current.selectedIndex =
      scale === SHOWCASE_REST_SCALE && interaction.phase === 'orbiting' ? undefined : selectedIndex;
  }, -1);
  return motion;
}
