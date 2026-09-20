import type { World } from 'koota';
import { useEffect } from 'react';
import { letterActions } from '../letters/actions';

/** Printable ASCII keys type into the sentence; Backspace removes its newest character. */
export function useKeyboard(world: World): void {
  useEffect(() => {
    const { typeCharacter, deleteCharacter } = letterActions(world);

    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Backspace') deleteCharacter();
      else if (event.key.length === 1 && event.key >= ' ' && event.key <= '~') typeCharacter(event.key);
      else return;

      event.preventDefault();
    };

    window.addEventListener('keydown', down);

    return () => window.removeEventListener('keydown', down);
  }, [world]);
}
