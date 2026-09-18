import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';

import type { Director } from './director';

/** Space/R restart · click aims the launch during the title · T live typing (keys type, Backspace, Enter finishes). */
export function useDirectorInput(director: Director): void {
  const canvas = useThree((state) => state.renderer.domElement);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { beat, liveTyping } = director.state;
      if (liveTyping && beat === 'type') {
        if (event.key === 'Enter') director.next();
        else if (event.key === 'Backspace') director.backspace();
        else if (event.key.length === 1) director.typeCharacter(event.key);
        else return;
        event.preventDefault();
        return;
      }
      // The piece plays itself; Space (or R) restarts it from the title.
      if (event.key === ' ' || event.key === 'r' || event.key === 'R') director.reset();
      else if (event.key === 't' || event.key === 'T') director.toggleLiveTyping();
      else return;
      event.preventDefault();
    };
    const onPointer = (event: PointerEvent): void => {
      const bounds = canvas.getBoundingClientRect();
      director.launch({
        x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        y: -(((event.clientY - bounds.top) / bounds.height) * 2 - 1),
      });
    };
    window.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      canvas.removeEventListener('pointerdown', onPointer);
    };
  }, [canvas, director]);
}
