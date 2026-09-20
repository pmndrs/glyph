import type { World } from 'koota';
import { useEffect } from 'react';
import { inputActions } from './actions';
import { heroActions } from '../hero/actions';
import { Keys } from './traits';
import { useThree } from '@react-three/fiber/webgpu';

/** Synchronize browser keyboard events with the world's key state. */
export function useKeyboard(world: World, isReady: boolean): void {
  useEffect(() => {
    const { setKey, clearKeys } = inputActions(world);
    const { replayHero } = heroActions(world);
    const keys = world.get(Keys)!;

    const down = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select, button') !== null)
      )
        return;

      if (event.key === ' ') event.preventDefault();

      const key = event.key.toLowerCase();

      if (event.repeat || keys.has(key)) return;

      setKey(key, true);

      if (isReady && key === ' ') replayHero();
    };
    const up = (event: KeyboardEvent) => setKey(event.key.toLowerCase(), false);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clearKeys);

    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clearKeys);
      clearKeys();
    };
  }, [world, isReady]);
}

export function usePointer(world: World): void {
  const canvas = useThree((state) => state.renderer.domElement);

  useEffect(() => {
    const { movePointer, clearPointer } = inputActions(world);

    const moved = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      movePointer(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      );
    };

    canvas.addEventListener('pointermove', moved, { passive: true });
    canvas.addEventListener('pointerleave', clearPointer, { passive: true });
    canvas.addEventListener('pointercancel', clearPointer, { passive: true });
    window.addEventListener('blur', clearPointer);

    return () => {
      canvas.removeEventListener('pointermove', moved);
      canvas.removeEventListener('pointerleave', clearPointer);
      canvas.removeEventListener('pointercancel', clearPointer);
      window.removeEventListener('blur', clearPointer);
      clearPointer();
    };
  }, [world, canvas]);
}
