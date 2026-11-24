import { trait } from 'koota';

/** `attract` plays the script; `play` is the visitor's. */
export type ModeKind = 'attract' | 'play';

export const Mode = trait({
  kind: 'attract' as ModeKind,
  /** When the visitor last did anything, on the playback clock. */
  touchedAt: 0,
  /** When the script began leading the stone along its path, or negative when it is not. */
  pathSince: -1,
});

/** What the visitor's press took hold of. */
export const Grip = trait({
  kind: 'none' as 'none' | 'page' | 'stone' | 'gutter' | 'edge',
  /** Which gutter, counted from one. */
  gutter: 0,
  /** Where the press landed and where the pointer is, in page units, and how far it has travelled. */
  x: 0,
  y: 0,
  travelled: 0,
  /** The pointer's velocity in page units a second, smoothed, for the fling. */
  vx: 0,
  vy: 0,
  at: 0,
});
