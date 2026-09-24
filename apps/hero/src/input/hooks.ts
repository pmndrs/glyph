import type { World } from 'koota';
import { useEffect } from 'react';
import { inputActions } from './actions';
import { directorActions } from '../director/actions';
import { soundActions } from '../sound/actions';
import { useThree } from '@react-three/fiber/webgpu';

/** Replay on Space and toggle sound on M, once a press: held keys repeat with `repeat` set, and those are ignored. */
export function useKeyboard(world: World, isReady: boolean): void {
  useEffect(() => {
    const { replayScene } = directorActions(world);
    const { toggleSound } = soundActions(world);

    const down = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select, button') !== null)
      )
        return;

      if (event.key === ' ') event.preventDefault();

      if (event.repeat) return;

      if (event.key.toLowerCase() === 'm' && !event.metaKey && !event.ctrlKey && !event.altKey) toggleSound();

      if (isReady && event.key === ' ') replayScene();
    };

    window.addEventListener('keydown', down);

    return () => window.removeEventListener('keydown', down);
  }, [world, isReady]);
}

/** Synchronize the pointer with the world, and hand its presses to the hero once playback is ready. */
export function usePointer(world: World, isReady: boolean): void {
  const canvas = useThree((state) => state.renderer.domElement);

  useEffect(() => {
    const { movePointer, clearPointer } = inputActions(world);
    const { pressScene } = directorActions(world);

    // The pointer's place over the canvas, in the -1..1 units the world uses, y up.
    const at = (event: PointerEvent, send: (x: number, y: number) => void) => {
      const bounds = canvas.getBoundingClientRect();
      send(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      );
    };
    const moved = (event: PointerEvent) => at(event, movePointer);
    const pressed = (event: PointerEvent) => {
      if (isReady && event.button === 0) at(event, pressScene);
    };

    canvas.addEventListener('pointermove', moved, { passive: true });
    canvas.addEventListener('pointerdown', pressed, { passive: true });
    canvas.addEventListener('pointerleave', clearPointer, { passive: true });
    canvas.addEventListener('pointercancel', clearPointer, { passive: true });
    window.addEventListener('blur', clearPointer);

    return () => {
      canvas.removeEventListener('pointermove', moved);
      canvas.removeEventListener('pointerdown', pressed);
      canvas.removeEventListener('pointerleave', clearPointer);
      canvas.removeEventListener('pointercancel', clearPointer);
      window.removeEventListener('blur', clearPointer);
      clearPointer();
    };
  }, [world, canvas, isReady]);
}
