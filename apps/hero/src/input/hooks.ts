import type { World } from 'koota';
import { useEffect } from 'react';
import { inputActions } from './actions';
import { heroActions } from '../hero/actions';
import { Keys } from './traits';

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
  useEffect(() => {
    const { activatePointer: moved, clearPointer: left } = inputActions(world);

    window.addEventListener('pointermove', moved, { passive: true });
    window.addEventListener('pointerleave', left, { passive: true });

    return () => {
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerleave', left);
    };
  }, [world]);
}
