import { WorldProvider } from 'koota/react';
import type { ReactNode } from 'react';

import { runtimeWorld } from './runtime-world-instance';

export function RuntimeWorldProvider({ children }: { readonly children: ReactNode }) {
  return <WorldProvider world={runtimeWorld}>{children}</WorldProvider>;
}
