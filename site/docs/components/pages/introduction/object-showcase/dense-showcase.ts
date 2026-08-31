import { SRGBColorSpace } from 'three';

import {
  colorFromOklch,
  colorToOklch,
  SHOWCASE_OBJECTS,
  type ShowcaseCategory,
  type ShowcaseObject,
} from './showcase-objects';

export const DENSE_ADDITION_COUNT = 360;
export const DENSE_ORBIT_DISTANCE = 31.5;
export const DENSE_REVEAL_PER_FRAME = 10;
export const DENSE_SHOWCASE_CAPACITY = SHOWCASE_OBJECTS.length + DENSE_ADDITION_COUNT;
export const DENSE_SHADE_STEPS = 9;
export const DENSE_FIELD_EXTENT = Object.freeze([17.8, 13.8] as const);

const OBJECT_GAP = 0.1;
const MIN_GENERATED_VOLUME = 0.55 * 0.62 * 0.55;
const MAX_GENERATED_VOLUME = 0.98 * 1.32 * 0.98;

const CATEGORY_WORDS: Readonly<Record<ShowcaseCategory, readonly string[]>> = Object.freeze({
  console: ['Beacon', 'Cache', 'Command', 'Kernel', 'Ledger', 'Prompt', 'Relay', 'Signal', 'Socket', 'Terminal'],
  editor: ['Draft', 'Essay', 'Folio', 'Note', 'Page', 'Pencil', 'Script', 'Story', 'Verse', 'Writer'],
  energy: ['Arc', 'Charge', 'Current', 'Flux', 'Glow', 'Pulse', 'Spark', 'Surge', 'Volt', 'Wave'],
  launch: ['Booster', 'Comet', 'Flight', 'Orbit', 'Rocket', 'Shuttle', 'Star', 'Vector', 'Voyage', 'Zenith'],
  palette: ['Azure', 'Coral', 'Indigo', 'Lilac', 'Mint', 'Ochre', 'Peach', 'Rose', 'Teal', 'Violet'],
  studio: ['Canvas', 'Craft', 'Design', 'Frame', 'Gallery', 'Motion', 'Render', 'Scene', 'Sketch', 'Sprite'],
});

/** Build a deterministic, collision-free population themed by the selected object's parent category. */
export function createDenseShowcaseObjects(selected: ShowcaseObject): readonly ShowcaseObject[] {
  const source = SHOWCASE_OBJECTS.find((item) => item.category === selected.category)!;
  const random = seededRandom(hashString(source.category));
  const words = CATEGORY_WORDS[source.category];
  const occupied = SHOWCASE_OBJECTS.map(footprint);
  const generated: ShowcaseObject[] = [];

  for (let index = 0; index < DENSE_ADDITION_COUNT; index += 1) {
    const width = range(random, 0.55, 0.98);
    const height = range(random, 0.62, 1.32);
    const depth = range(random, 0.55, 0.98);
    const position = placeObject(random, width, depth, occupied);
    const volume = width * height * depth;
    const sizeAmount = clamp((volume - MIN_GENERATED_VOLUME) / (MAX_GENERATED_VOLUME - MIN_GENERATED_VOLUME));
    const color = sizeThemeColor(source, sizeAmount);
    const first = words[Math.floor(random() * words.length)]!;
    const label = `${first} ${index + 1}`;
    const item = Object.freeze({
      category: source.category,
      color,
      description: source.description,
      icon: source.icon,
      iconColor: `#${color.getHexString(SRGBColorSpace)}`,
      id: `dense-${source.category}-${index}`,
      label,
      position,
      role: 'generated',
      size: [width, height, depth],
    } satisfies ShowcaseObject);
    generated.push(item);
    occupied.push(footprint(item));
  }

  return Object.freeze(generated);
}

/** Reveal exactly one generated instance per rendered frame. */
export function nextVisibleShowcaseCount(current: number, total: number): number {
  return Math.min(total, current + DENSE_REVEAL_PER_FRAME);
}

function sizeThemeColor(source: ShowcaseObject, sizeAmount: number) {
  const [sourceLightness, sourceChroma, hue] = colorToOklch(source.color);
  const step = Math.round(sizeAmount * (DENSE_SHADE_STEPS - 1));
  const amount = step / Math.max(1, DENSE_SHADE_STEPS - 1);
  const lightness = clamp(sourceLightness + 0.14 - amount * 0.2);
  const chroma = sourceChroma * (0.45 + amount * 0.65);
  return colorFromOklch(lightness, chroma, hue);
}

function placeObject(
  random: () => number,
  width: number,
  depth: number,
  occupied: readonly Footprint[],
): readonly [number, number] {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const x = range(random, -DENSE_FIELD_EXTENT[0] + width / 2, DENSE_FIELD_EXTENT[0] - width / 2);
    const z = range(random, -DENSE_FIELD_EXTENT[1] + depth / 2, DENSE_FIELD_EXTENT[1] - depth / 2);
    if (isSeparated(x, z, width, depth, occupied)) return [x, z];
  }
  throw new Error('Unable to place the deterministic showcase population without overlap');
}

type Footprint = Readonly<{ depth: number; width: number; x: number; z: number }>;

function footprint(item: ShowcaseObject): Footprint {
  return { depth: item.size[2], width: item.size[0], x: item.position[0], z: item.position[1] };
}

function isSeparated(x: number, z: number, width: number, depth: number, occupied: readonly Footprint[]): boolean {
  for (let index = 0; index < occupied.length; index += 1) {
    const other = occupied[index]!;
    if (
      Math.abs(x - other.x) < (width + other.width) / 2 + OBJECT_GAP &&
      Math.abs(z - other.z) < (depth + other.depth) / 2 + OBJECT_GAP
    ) {
      return false;
    }
  }
  return true;
}

function range(random: () => number, minimum: number, maximum: number): number {
  return minimum + (maximum - minimum) * random();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
