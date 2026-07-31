import { describe, expect, it } from 'vitest';

import { createPersistentSceneActivation } from './persistent-scene-activation';

describe('persistent scene activation', () => {
  it('releases pre-activation work with the active runtime', async () => {
    const activation = createPersistentSceneActivation<{ readonly id: string }>();
    const waiting = activation.wait();

    activation.resolve({ id: 'retained' });

    await expect(waiting).resolves.toEqual({ id: 'retained' });
  });

  it('rejects pre-activation work when activation cannot complete', async () => {
    const activation = createPersistentSceneActivation<never>();
    const waiting = activation.wait();

    activation.reject(new DOMException('superseded', 'AbortError'));

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
