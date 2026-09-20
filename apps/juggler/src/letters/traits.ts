import { trait } from 'koota';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { Group, InstancedBufferAttribute, InstancedMesh } from 'three/webgpu';
import type { Side } from '../juggler/utils';

/** `dead` letters were dropped: they fall to the floor and are buried. */
export type LetterState = 'queued' | 'airborne' | 'held' | 'dead';

/** One typed character that is not a space, from its slot in the sentence through the juggling cascade. */
export const Letter = trait({
  /** UTF-16 offset of this character in the typed sentence. */
  index: 0,
  char: '',
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  rotation: 0,
  spin: 0,
  state: 'queued' as LetterState,
  /** Hand expected to receive the letter while it is airborne. */
  target: 'left' as Side,
  catches: 0,
  /** Seconds since the letter was typed. */
  age: 0,
  /** Seconds since the letter left the sentence, or -1 while it still waits there. */
  released: -1,
  /** Seconds since a dropped letter hit the floor, or -1 before then. */
  died: -1,
  /** Ink centre in paragraph space, filled in once a layout commits. */
  placed: false,
  homeX: 0,
  homeY: 0,
  line: 0,
});

/** The typed text. React renders the layout oracle from it, so it changes only on keystrokes. */
export const Sentence = trait({ text: '' });

/** Cadence of letters leaving the sentence. */
export const Release = trait({ timer: 0, count: 0 });

/** Where the sentence sits: it scrolls up as its leading lines empty and flinches when a letter drops out. */
export const Paragraph = trait({
  scroll: 0,
  kick: 0,
  seenReleases: 0,
  baselines: (): number[] => [],
});

export interface LetterDraw {
  group: Group;
  text: ThreeText<never>;
  centered: boolean;
  /** Last encoded heat and tint written to the glyph's style, so unchanged frames skip the update. */
  heat: number;
  blend: number;
}

export const LetterView = trait((): LetterDraw | undefined => undefined);

export const DEBRIS_CAPACITY = 512;

/** Shards of exploded letters, as flat arrays so bursts never allocate. */
export const Debris = trait({
  count: 0,
  x: () => new Float32Array(DEBRIS_CAPACITY),
  y: () => new Float32Array(DEBRIS_CAPACITY),
  vx: () => new Float32Array(DEBRIS_CAPACITY),
  vy: () => new Float32Array(DEBRIS_CAPACITY),
  angle: () => new Float32Array(DEBRIS_CAPACITY),
  spin: () => new Float32Array(DEBRIS_CAPACITY),
  size: () => new Float32Array(DEBRIS_CAPACITY),
  life: () => new Float32Array(DEBRIS_CAPACITY),
  hue: () => new Float32Array(DEBRIS_CAPACITY),
});

export interface DebrisDraw {
  mesh: InstancedMesh;
  data: InstancedBufferAttribute;
}

export const DebrisView = trait((): DebrisDraw | undefined => undefined);

export interface FlameDraw {
  mesh: InstancedMesh;
  data: InstancedBufferAttribute;
}

export const FlameView = trait((): FlameDraw | undefined => undefined);
