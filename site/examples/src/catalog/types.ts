import type { ComponentType } from 'react';

/**
 * Every hosted example. Each entry names the docs page it belongs to, the
 * stage it wants, and a loader for its scene module — one feature, one
 * scene, a few dozen lines each.
 *
 * A scene module exports its React component as `default` and, beside it, a
 * `three.ts` twin that states the same thing imperatively. The twin is
 * typechecked with the scene but never executed here: the docs show it as
 * the parallel, and the R3F scene is what runs.
 */
/** What a scene stands on; see `docs/components/pages/examples/stage.tsx`. */
export interface StageOptions {
  /** Pixel-unit orthographic camera; `fontSize` is then in frame pixels. */
  readonly orthographic?: boolean;
  /** A studio light rig and film-like tone mapping for PBR materials. */
  readonly lit?: boolean;
}

export interface ExampleEntry {
  readonly title: string;
  /** The docs page this example belongs to, as a site-absolute path. */
  readonly page: string;
  readonly stage: StageOptions;
  /** The card's shape in the gallery; 16 / 9 unless the scene wants otherwise. */
  readonly aspect?: '16 / 9' | '4 / 3' | '3 / 2' | '1 / 1' | '3 / 4';
  readonly load: () => Promise<{ readonly default: ComponentType }>;
}
