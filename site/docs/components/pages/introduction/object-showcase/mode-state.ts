import { DENSE_ORBIT_DISTANCE } from './dense-showcase';

export type ShowcaseMode = 'dense' | 'exiting' | 'standard';

export const STANDARD_ORBIT_DISTANCE = 15;

/** The exit state remains non-interactive while targeting the standard camera radius. */
export function showcaseModeState(mode: ShowcaseMode) {
  return Object.freeze({
    denseInteraction: mode !== 'standard',
    exitVisible: mode === 'dense',
    orbitDistance: mode === 'dense' ? DENSE_ORBIT_DISTANCE : STANDARD_ORBIT_DISTANCE,
  });
}
