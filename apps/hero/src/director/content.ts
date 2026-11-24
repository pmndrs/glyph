import { BODY_BOX } from '../page/content';

/** Seconds a visitor may leave the page alone before the attract loop resumes. */
export const IDLE_SECONDS = 32;

/** The stone's path through the text in the attract loop, in page units, and how fast it is led along it. */
export const STONE_PATH: readonly (readonly [number, number])[] = [
  [BODY_BOX.right - 1.6, BODY_BOX.top + 2.6],
  [BODY_BOX.right - 6.5, BODY_BOX.top + 8.2],
  [BODY_BOX.right - 11.5, BODY_BOX.top + 11.6],
  [BODY_BOX.left + 10.2, BODY_BOX.top + 12.4],
  [BODY_BOX.left + 5.2, BODY_BOX.top + 8.6],
  [BODY_BOX.left + 4.6, BODY_BOX.top + 11.5],
];
export const STONE_SPEED = 2.5;

/** Where the stone rests when the visitor takes over without one on the page. */
export const STONE_REST: readonly [number, number] = [BODY_BOX.right - 5.2, BODY_BOX.bottom - 3.4];
