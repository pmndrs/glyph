import { createActions, type Entity } from 'koota';
import { GRAVITY, figure, flightTime, handOffsetX, opposite, type Side } from '../juggler/utils';
import { Viewport } from '../juggler/traits';
import {
  Debris,
  DEBRIS_CAPACITY,
  DebrisView,
  FlameView,
  Letter,
  LetterView,
  Paragraph,
  Release,
  Sentence,
  type DebrisDraw,
  type FlameDraw,
  type LetterDraw,
} from './traits';

/** Pause between one queued letter dropping and the next while few letters wait. */
export const RELEASE_INTERVAL = 0.6;
/** Extra beat the first letter of a fresh sentence waits before dropping, so the words can be read. */
export const FIRST_RELEASE_DELAY = 1.1;
/** Upward kick a letter gets as it leaves the sentence, before gravity takes over. */
export const RELEASE_HOP = 340;

export const letterActions = createActions((world) => ({
  typeCharacter: (char: string) => {
    const sentence = world.get(Sentence)!;
    const index = sentence.text.length;

    if (char !== ' ') {
      const waiting = world.query(Letter).some((entity) => entity.get(Letter)!.state === 'queued');

      if (!waiting) world.set(Release, { ...world.get(Release)!, timer: FIRST_RELEASE_DELAY });

      world.spawn(Letter({ index, char, y: figure(world.get(Viewport)!.height).topY }));
    }

    world.set(Sentence, { text: sentence.text + char });
  },
  deleteCharacter: () => {
    const sentence = world.get(Sentence)!;

    if (sentence.text.length === 0) return;

    const index = sentence.text.length - 1;

    for (const entity of world.query(Letter)) {
      if (entity.get(Letter)!.index === index) entity.destroy();
    }

    world.set(Sentence, { text: sentence.text.slice(0, -1) });
  },
  /** Records where the paragraph layout put a character's ink, in paragraph space with +Y up. */
  placeLetter: (index: number, homeX: number, homeY: number, line: number) => {
    world.query(Letter).updateEach(([letter]) => {
      if (letter.index !== index) return;

      letter.homeX = homeX;
      letter.homeY = homeY;
      letter.line = line;
      letter.placed = true;
    });
  },
  setBaselines: (baselines: readonly number[]) => {
    const paragraph = world.get(Paragraph)!;
    paragraph.baselines = [...baselines];
    world.set(Paragraph, paragraph);
  },
  /** The letter leaves the sentence with a hop and a spin, headed for the hand with the lightest load. */
  releaseLetter: (entity: Entity, target: Side) => {
    const letter = entity.get(Letter)!;
    letter.target = target;
    letter.state = 'airborne';
    letter.released = 0;
    letter.vx = 0;
    letter.vy = RELEASE_HOP;
    letter.spin = (letter.index % 2 === 0 ? 1 : -1) * 2.4;
    entity.set(Letter, letter);
    const release = world.get(Release)!;
    release.count += 1;
    world.set(Release, release);
  },
  /** A missed letter keeps falling and dies on the floor. */
  dropLetter: (entity: Entity) => {
    const letter = entity.get(Letter)!;
    letter.state = 'dead';
    entity.set(Letter, letter);
  },
  /** A dropped letter hitting the floor bursts into shards and leaves the world. */
  explodeLetter: (entity: Entity) => {
    const letter = entity.get(Letter)!;
    const debris = world.get(Debris)!;
    const hue = ((letter.index % 7) + 0.5) / 7;

    for (let shard = 0; shard < 14 && debris.count < DEBRIS_CAPACITY; shard += 1) {
      const slot = debris.count;
      // Deterministic spread from the shard number: a fan of pieces flung up and out.
      const angle = Math.PI * (0.15 + (0.7 * shard) / 13) + Math.sin(shard * 12.9898 + letter.index) * 0.2;
      const speed = 380 + ((shard * 7919) % 11) * 32;
      debris.x[slot] = letter.x + Math.cos(angle) * 6;
      debris.y[slot] = letter.y + 4;
      debris.vx[slot] = Math.cos(angle) * speed;
      debris.vy[slot] = Math.sin(angle) * speed;
      debris.angle[slot] = shard;
      debris.spin[slot] = (shard % 2 === 0 ? 1 : -1) * (6 + (shard % 5));
      debris.size[slot] = 5 + ((shard * 31) % 7);
      debris.life[slot] = 1;
      debris.hue[slot] = hue;
      debris.count += 1;
    }

    world.set(Debris, debris);
    entity.destroy();
  },
  catchLetter: (entity: Entity) => {
    const letter = entity.get(Letter)!;
    letter.state = 'held';
    letter.y = figure(world.get(Viewport)!.height).catchY;
    letter.vx = 0;
    letter.vy = 0;
    letter.spin = 0;
    letter.catches += 1;
    entity.set(Letter, letter);
  },
  /** Throws a held letter from `fromSide` in an arc that lands on the other hand's outer catching spot. */
  tossLetter: (entity: Entity, fromSide: Side, bodyX: number) => {
    const letter = entity.get(Letter)!;
    let inPlay = 0;

    for (const other of world.query(Letter)) {
      const state = other.get(Letter)!.state;

      if (state === 'airborne' || state === 'held') inPlay += 1;
    }

    const flight = flightTime(inPlay, world.get(Viewport)!.height);
    const target = opposite(fromSide);
    letter.state = 'airborne';
    letter.target = target;
    letter.vx = (bodyX + handOffsetX(target) - letter.x) / flight;
    letter.vy = (GRAVITY * flight) / 2;
    letter.spin = ((fromSide === 'left' ? -1 : 1) * (2 * Math.PI)) / flight;
    entity.set(Letter, letter);
  },
  mountLetterView: (entity: Entity, view: LetterDraw) => {
    entity.add(LetterView(view));
  },
  unmountLetterView: (entity: Entity) => {
    if (entity.isAlive()) entity.remove(LetterView);
  },
  mountDebrisView: (view: DebrisDraw) => {
    world.set(DebrisView, view);
  },
  unmountDebrisView: () => {
    world.set(DebrisView, undefined);
  },
  mountFlameView: (view: FlameDraw) => {
    world.set(FlameView, view);
  },
  unmountFlameView: () => {
    world.set(FlameView, undefined);
  },
}));
