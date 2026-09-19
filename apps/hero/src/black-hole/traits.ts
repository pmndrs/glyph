import { trait } from 'koota';
import { createHoleState } from './utils';

export const Collapse = trait(() => ({
  openedAt: undefined as number | undefined,
  held: undefined as number | undefined,
  hole: createHoleState(),
}));
