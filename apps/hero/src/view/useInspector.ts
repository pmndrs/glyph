import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { getConsoleFunction, setConsoleFunction } from 'three/webgpu';

/** D enables the development inspector; hidden recording frames pay none of its profiling cost. */
export function useInspector(): void {
  const renderer = useThree((state) => state.renderer);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const previous = renderer.inspector;
    // Three 0.185.1 implements these profiling members; @types/three 0.185.4 omits them.
    const backend = renderer.backend as typeof renderer.backend & { trackTimestamp: boolean };
    const trackTimestamp = backend.trackTimestamp;
    const consoleFunction = getConsoleFunction();
    let inspector: (Inspector & { resolveTimestamp(): Promise<void> }) | undefined;
    let loading: Promise<void> | undefined;
    let shown = false;
    let cancelled = false;

    const sync = () => {
      if (inspector === undefined) return;
      inspector.domElement.style.display = shown ? '' : 'none';
      if (shown) renderer.inspector = inspector;
      // Its pending timestamp callback still needs its renderer. Drain it before detaching.
      else if (renderer.inspector === inspector) {
        void inspector.resolveTimestamp().then(() => {
          if (shown) return;
          renderer.inspector = previous;
          backend.trackTimestamp = trackTimestamp;
          setConsoleFunction(consoleFunction);
        });
      }
    };
    const toggle = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== 'd' && event.key !== 'D')) return;
      event.preventDefault();
      shown = !shown;
      if (inspector !== undefined) sync();
      else if (shown) {
        loading ??= import('three/addons/inspector/Inspector.js').then(async (module) => {
          await renderer.init();
          if (cancelled) return;
          inspector = new module.Inspector() as Inspector & { resolveTimestamp(): Promise<void> };
          renderer.inspector = inspector;
          inspector.init();
          document.body.append(inspector.domElement);
          sync();
        });
      }
    };
    window.addEventListener('keydown', toggle);
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', toggle);
      shown = false;
      sync();
      inspector?.domElement.remove();
    };
  }, [renderer]);
}
