import type { Text } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/raster/msdf';

export interface Attempt {
  /** What the scene shows it tried, as the caller would write it. */
  readonly label: string;
  readonly apply: (text: Text<typeof msdf>) => void;
}

/**
 * Bad inputs, one per tick. Each is refused at the call with the offending
 * field in the message, and the desired state stays what it was. Nothing
 * here reaches the engine: the door, not the room.
 */
export const ATTEMPTS: readonly Attempt[] = [
  { label: 'set({ rasterPixelRatio: -1 })', apply: (text) => text.set({ rasterPixelRatio: -1 }) },
  { label: 'set({ style: { fontSize: -2 } })', apply: (text) => text.set({ style: { fontSize: -2 } }) },
  { label: 'set({ text: 42 })', apply: (text) => text.set({ text: 42 as unknown as string }) },
  {
    label: "set({ constraints: { width: { mode: 'exact', size: -1 } } })",
    apply: (text) => text.set({ constraints: { width: { mode: 'exact', size: -1 } } }),
  },
  {
    label: "set({ layout: { wrap: 'diagonal' } })",
    apply: (text) => text.set({ layout: { wrap: 'diagonal' as never } }),
  },
  { label: 'set(null)', apply: (text) => text.set(null as never) },
];

/** Seconds between attempts. */
export const PERIOD = 1.8;
export const WIDTH = 9.6;
/** Basic Latin only: the checked-in Inter subset covers U+0020–007E. */
export const SENTINEL = 'Still here. Every update below was refused at the call, and this paragraph never changed.';
