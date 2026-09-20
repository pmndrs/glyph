import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useLayoutEffect } from 'react';
import { useKeyboard } from './input/hooks';
import { jugglerActions } from './juggler/actions';
import { catchLetters, chaseLandings, moveHands, syncFigureView } from './juggler/systems';
import {
  ageLetters,
  explodeLetters,
  fallLetters,
  moveDebris,
  releaseLetters,
  scrollParagraph,
  seatLetters,
  syncDebrisView,
  syncFlames,
  syncLetterViews,
} from './letters/systems';
import { updateTime } from './time/systems';

/** Connects the renderer clock and the browser to the simulation, listing every system in execution order. */
export function FrameLoop() {
  const world = useWorld();
  const width = useThree((state) => state.viewport.width);
  const height = useThree((state) => state.viewport.height);

  useKeyboard(world);

  useLayoutEffect(() => {
    jugglerActions(world).setViewport(width, height);
  }, [world, width, height]);

  useFrame(
    (_, delta) => {
      updateTime(world, delta);
      ageLetters(world);
      releaseLetters(world);
      fallLetters(world);
      chaseLandings(world);
      catchLetters(world);
      moveHands(world);
      scrollParagraph(world);
      seatLetters(world);
      explodeLetters(world);
      moveDebris(world);
    },
    { id: 'juggler-simulation', phase: 'physics' },
  );

  useFrame(
    () => {
      syncLetterViews(world);
      syncFlames(world);
      syncDebrisView(world);
      syncFigureView(world);
    },
    { id: 'juggler-views' },
  );

  return null;
}
