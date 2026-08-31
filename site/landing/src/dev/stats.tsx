import { Stats } from '@react-three/drei';

import { useDebugVisible } from './visibility';

/**
 * The frame counter. Renders inside `<Canvas>`, so it is a separate module from
 * the panel, which renders outside it — and separate for the same reason the
 * panel is: production reaches this only through a dead `import()` branch.
 */
export default function DevStats() {
  return useDebugVisible() ? <Stats /> : null;
}
