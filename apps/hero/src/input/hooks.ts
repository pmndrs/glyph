import type { World } from 'koota';
import { useEffect, useEffectEvent } from 'react';
import { inputActions } from './actions';

/** DOM events update input state and request application commands. */
export function useInput(world: World, replay: () => void): void {
  const requestReplay = useEffectEvent(replay);

  useEffect(() => {
    const { activatePointer: moved, clearPointer: left } = inputActions(world);

    const restart = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;

      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select, button') !== null)
      )
        return;

      event.preventDefault();

      if (!event.repeat) requestReplay();
    };

    window.addEventListener('keydown', restart);
    window.addEventListener('pointermove', moved, { passive: true });
    window.addEventListener('pointerleave', left, { passive: true });

    return () => {
      window.removeEventListener('keydown', restart);
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerleave', left);
    };
  }, [world]);
}
