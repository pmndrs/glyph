import { TITLE_WORDS, type TitleWord } from './content';

/** Precompute grapheme prefixes so combining marks and joined scripts remain intact during typing. */
export interface CycleWord extends TitleWord {
  readonly clusters: readonly string[];
  /** Cumulative prefixes, so a frame is a lookup rather than a join. */
  readonly prefixes: readonly string[];
}

function split(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  return [...segmenter.segment(text)].map((entry) => entry.segment);
}

/** Development control `?word=<n>` repeats one language. An absent or invalid index uses the whole cycle. */
const PINNED = import.meta.env.DEV ? new URLSearchParams(location.search).get('word') : null;
const ONLY = PINNED === null ? undefined : TITLE_WORDS[Number(PINNED)];
const CHOSEN = ONLY === undefined ? TITLE_WORDS : [ONLY];

export const CYCLE: readonly CycleWord[] = CHOSEN.map((word) => {
  const clusters = split(word.text);
  const prefixes: string[] = [''];

  for (const cluster of clusters) prefixes.push((prefixes.at(-1) ?? '') + cluster);

  return { ...word, clusters, prefixes };
});

/** Seconds a cluster waits before the next one is typed. */
export const TYPE_SECONDS = 0.075;
/** Seconds between deleted grapheme clusters. */
export const DELETE_SECONDS = 0.045;
/** Seconds the finished word stands whole before it comes apart. */
export const HOLD_SECONDS = 1;
/** Seconds of empty line between words. */
export const CLEAR_SECONDS = 0.12;

export type CycleStage = 'typing' | 'holding' | 'deleting' | 'clear';

export interface CycleState {
  /** Position in the cycle, so the camera can vary its angle per language without a lookup. */
  readonly index: number;
  readonly stage: CycleStage;
  /** Seconds elapsed in this stage. */
  readonly seconds: number;
}

export interface CycleFrame {
  readonly word: CycleWord;
  readonly text: string;
  readonly index: number;
}

export const START: CycleState = { index: 0, stage: 'typing', seconds: 0 };

/** Wrap the cycle index when hot reload changes the word list. */
function wordAt(index: number): CycleWord {
  return CYCLE[index % CYCLE.length] ?? (CYCLE[0] as CycleWord);
}

/** The longest step a stage will take in one frame, so no frame can cross two of its own boundaries. */
function step(stage: CycleStage): number {
  switch (stage) {
    case 'typing':
      return TYPE_SECONDS;
    case 'deleting':
      return DELETE_SECONDS;
    case 'holding':
      return HOLD_SECONDS;
    case 'clear':
      return CLEAR_SECONDS;
  }
}

function next(state: CycleState, stage: CycleStage, index = state.index): CycleState {
  return { index, stage, seconds: 0 };
}

/** Advance at most one grapheme per frame so slow frames cannot skip visible typing steps. */
export function advance(state: CycleState, delta: number): CycleState {
  const word = wordAt(state.index);
  const seconds = state.seconds + Math.min(delta, step(state.stage));

  switch (state.stage) {
    case 'typing':
      return seconds >= word.clusters.length * TYPE_SECONDS ? next(state, 'holding') : { ...state, seconds };
    case 'holding':
      return seconds >= HOLD_SECONDS ? next(state, 'deleting') : { ...state, seconds };
    case 'deleting':
      return seconds >= word.clusters.length * DELETE_SECONDS ? next(state, 'clear') : { ...state, seconds };
    case 'clear':
      return seconds >= CLEAR_SECONDS ? next(state, 'typing', (state.index + 1) % CYCLE.length) : { ...state, seconds };
  }
}

/** What is on screen in this state. */
export function textOf(state: CycleState): CycleFrame {
  const word = wordAt(state.index);
  const index = state.index;

  switch (state.stage) {
    case 'typing': {
      const shown = Math.floor(state.seconds / TYPE_SECONDS) + 1;

      return { word, index, text: word.prefixes[shown] ?? word.text };
    }
    case 'holding':
      return { word, index, text: word.text };
    case 'deleting': {
      // Backspace: the word comes apart cluster by cluster, so the script unwinds the way it was written.
      const gone = Math.floor(state.seconds / DELETE_SECONDS) + 1;
      const left = Math.max(word.clusters.length - gone, 0);

      return { word, index, text: word.prefixes[left] ?? '' };
    }
    case 'clear':
      return { word, index, text: '' };
  }
}
