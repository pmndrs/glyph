import { createWorld } from 'koota';
import { OrthographicCamera } from 'three/webgpu';
import { expect, it } from 'vitest';
import { Viewport } from '../viewport/traits';
import { inputActions } from '../input/actions';
import { fadePointer } from '../input/systems';
import { Pointer } from '../input/traits';
import { Collapse } from '../black-hole/traits';
import { EMBER_SECONDS } from '../star-embers/content';
import { Time } from '../time/traits';
import { uiActions } from './actions';
import { REVEAL_AFTER, REVEAL_SECONDS } from './content';
import { revealPlayButton, syncPlayButtonView } from './systems';

it('keeps the button lit while the pointer rests on it, and lets go when the pointer leaves', () => {
  const world = createWorld(Time, Pointer, Viewport, Collapse);
  const view = {
    camera: new OrthographicCamera(),
    reveal: { value: 0 },
    hover: { value: 0 },
    time: { value: 0 },
    root: { dataset: {} as DOMStringMap },
  };
  const { movePointer, clearPointer } = inputActions(world);
  const frame = () => {
    world.set(Time, { delta: 1 / 60, elapsed: world.get(Time)!.elapsed + 1 / 60 });
    fadePointer(world);
    revealPlayButton(world);
    syncPlayButtonView(world);
  };

  try {
    // The finale has popped and its embers have burnt out.
    world.get(Collapse)!.hole.beat = 'black';
    world.get(Collapse)!.hole.sincePop = EMBER_SECONDS + REVEAL_AFTER + REVEAL_SECONDS;
    uiActions(world).initializePlayButton();
    uiActions(world).mountPlayButtonView(view);
    movePointer(0.1, 0.05);

    // Three seconds at rest: the pointer's motion has long faded, and the button stays lit.
    for (let step = 0; step < 180; step++) frame();

    expect(world.get(Pointer)!.strength).toBe(0);
    expect(view.hover.value).toBeGreaterThan(0.99);
    expect(view.root.dataset.heroHover).toBe('play');

    clearPointer();

    for (let step = 0; step < 180; step++) frame();

    expect(view.hover.value).toBeLessThan(0.01);
    expect(view.root.dataset.heroHover).toBeUndefined();
  } finally {
    world.destroy();
  }
});
