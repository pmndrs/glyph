import { Leva } from 'leva';
import { useEffect } from 'react';

import { LookPanel } from './look-panel';
import { bindDebugToggle, useDebugVisible } from './visibility';

/**
 * The development overlays: leva's panel, the look controls that write into
 * `live`, and the space bar that hides them.
 *
 * Reached only through `import()` from a branch guarded by `import.meta.env.DEV`,
 * which Vite folds to `false` in a production build. Everything below — leva,
 * its stitches theme, the key binding — then sits in a chunk production never
 * emits. A static import would not: leva builds its theme at module scope, so
 * tree-shaking cannot drop it.
 */
export default function DevOverlays() {
  const visible = useDebugVisible();
  useEffect(bindDebugToggle, []);

  // `hidden` rather than unmounting: leva keeps its store either way, so a
  // toggle never resets a value that was dialled in.
  return (
    <>
      <Leva collapsed hidden={!visible} titleBar={{ title: 'glÿph' }} />
      <LookPanel />
    </>
  );
}
