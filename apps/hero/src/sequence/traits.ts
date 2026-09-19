import { trait } from 'koota';

/** Times and delays are in playback seconds. Events rearm their cues from the latest occurrence. */
export type Cue = ({ readonly at: number } | { readonly on: string; readonly after?: number }) & {
  readonly run: () => void;
};

export const Timeline = trait({
  cues: (): readonly Cue[] => [],
  due: () => new Float64Array(0),
});
