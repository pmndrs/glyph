import { trait } from 'koota';
import { FEATURE_LINE } from './content';
import type { TitleBodies } from './bodies';

export const Title = trait(() => ({
  bodies: undefined as TitleBodies | undefined,
  width: undefined as number | undefined,
  reach: 0,
}));
export const Typing = trait(() => ({
  count: FEATURE_LINE.text.length,
  beat: 0,
  wave: 0,
  start: Number.POSITIVE_INFINITY,
}));
