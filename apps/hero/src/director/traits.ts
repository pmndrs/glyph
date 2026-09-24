import { trait } from 'koota';

export type ModeKind = 'sequence' | 'play';

/**
 * Which script the world is running: the scripted sequence, or free play with the robot under the pointer, and the
 * playback second it began.
 */
export const Mode = trait({ kind: 'sequence' as ModeKind, since: 0 });
