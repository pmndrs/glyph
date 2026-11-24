import { describe, expect, it } from 'vitest';

import {
  completeOrbitDistanceTransition,
  initialOrbitDistanceTransition,
  retargetOrbitDistance,
} from './orbit-distance-transition';

describe('showcase orbit-distance transitions', () => {
  it('completes a return target even when the wide target never settled', () => {
    let transition = initialOrbitDistanceTransition(15);
    transition = retargetOrbitDistance(transition, 31.5);
    transition = retargetOrbitDistance(transition, 15);

    const result = completeOrbitDistanceTransition(transition, 15);
    expect(result.completed).toBe(true);
    expect(result.transition).toEqual({ pending: false, target: 15 });
  });

  it('does not complete before the current camera radius reaches its target', () => {
    const transition = retargetOrbitDistance(initialOrbitDistanceTransition(15), 31.5);
    expect(completeOrbitDistanceTransition(transition, 24)).toEqual({ completed: false, transition });
  });
});
