import type { World } from 'koota';
import { clamp } from 'math';
import { Viewport } from '../viewport/traits';
import { Pointer } from '../input/traits';
import { Collapse } from '../black-hole/traits';
import { EMBER_SECONDS } from '../star-embers/content';
import { Time } from '../time/traits';
import { REVEAL_AFTER, REVEAL_SECONDS, overPlayButton } from './content';
import { PlayButton, PlayButtonView } from './traits';

/**
 * Draw the button in once the embers of either mode's finale have gone out, and follow the pointer over it.
 */
export function revealPlayButton(world: World): void {
  const sincePop = world.get(Collapse)!.hole.sincePop ?? -1;
  const reveal = clamp((sincePop - EMBER_SECONDS - REVEAL_AFTER) / REVEAL_SECONDS, 0, 1);
  const pointer = world.get(Pointer)!;
  const { aspect } = world.get(Viewport)!;
  world.set(PlayButton, {
    reveal,
    over: reveal > 0 && pointer.present && overPlayButton(pointer.x * aspect, pointer.y),
  });
}

/** Fit the sheet to the viewport and publish reveal, hover, and time into the mounted button. */
export function syncPlayButtonView(world: World): void {
  const view = world.get(PlayButtonView);

  if (view === undefined) return;

  const { aspect } = world.get(Viewport)!;
  const camera = view.camera;

  if (camera.right !== aspect) {
    camera.left = -aspect;
    camera.right = aspect;
    camera.updateProjectionMatrix();
  }

  const { reveal, over } = world.get(PlayButton)!;
  const time = world.get(Time)!;
  view.reveal.value = reveal;
  view.hover.value += ((over ? 1 : 0) - view.hover.value) * (1 - Math.exp(-time.delta / 0.1));
  view.time.value = time.elapsed;

  if (over) view.root.dataset.heroHover = 'play';
  else delete view.root.dataset.heroHover;
}
