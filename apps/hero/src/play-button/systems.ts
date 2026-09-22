import type { World } from 'koota';
import { clamp } from 'math';
import { Viewport } from '../hero/traits';
import { Pointer } from '../input/traits';
import { StarEmbers, EMBER_SECONDS } from '../star-embers/traits';
import { Time } from '../time/traits';
import { BUTTON_HEIGHT, BUTTON_WIDTH, REVEAL_AFTER, REVEAL_SECONDS } from './content';
import { PlayButtonView } from './traits';

/** 0..1: how far the module has powered up. It appears once the embers of either mode's finale have gone out. */
export function playReveal(world: World): number {
  return clamp((world.get(StarEmbers)!.age - EMBER_SECONDS - REVEAL_AFTER) / REVEAL_SECONDS, 0, 1);
}

/** Whether a sheet point lies on the button. */
export function overPlayButton(x: number, y: number): boolean {
  return Math.abs(x) <= BUTTON_WIDTH / 2 && Math.abs(y) <= BUTTON_HEIGHT / 2;
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

  const reveal = playReveal(world);
  const pointer = world.get(Pointer)!;
  const over = reveal > 0 && pointer.present && overPlayButton(pointer.x * aspect, pointer.y);
  const time = world.get(Time)!;
  view.reveal.value = reveal;
  view.hover.value += ((over ? 1 : 0) - view.hover.value) * (1 - Math.exp(-time.delta / 0.1));
  view.time.value = time.elapsed;

  if (over) view.root.dataset.heroHover = 'play';
  else delete view.root.dataset.heroHover;
}
