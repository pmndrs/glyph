import { describe, expect, it } from 'vitest';

import { DENSE_ORBIT_DISTANCE } from './dense-showcase';
import { showcaseModeState, STANDARD_ORBIT_DISTANCE } from './mode-state';

describe('object-showcase mode state', () => {
  it('keeps dense mode non-interactive at the wide camera radius', () => {
    expect(showcaseModeState('dense')).toEqual({
      denseInteraction: true,
      exitVisible: true,
      orbitDistance: DENSE_ORBIT_DISTANCE,
    });
  });

  it('targets the standard radius while retaining the exit interaction lock', () => {
    expect(showcaseModeState('exiting')).toEqual({
      denseInteraction: true,
      exitVisible: false,
      orbitDistance: STANDARD_ORBIT_DISTANCE,
    });
  });
});
