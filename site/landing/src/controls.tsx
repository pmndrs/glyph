import { button, folder, useControls } from 'leva';

/**
 * Every dial the look depends on, in one place, so values can be set by eye and
 * handed back as a block rather than guessed a round-trip at a time.
 *
 * Deliberately *not* React context. `Scene` and `Effects` render inside
 * `<Canvas>`, which is its own reconciler root, and context does not cross that
 * boundary — consumers there read the default value and nothing appears to
 * update. `live` is a plain mutable record instead: the panel writes to it and
 * the frame loop reads it, which is both simpler and immediate.
 *
 * Dev only. `import.meta.env.DEV` is a build-time constant, so the panel and
 * leva itself drop out of a production bundle.
 */
export interface LookValues {
  aberrationFalloff: number;
  aberrationPeak: number;
  ambient: number;
  bloomRadius: number;
  bloomStrength: number;
  bloomThreshold: number;
  curvature: number;
  descent: number;
  emissive: number;
  envIntensity: number;
  envResolution: number;
  exposure: number;
  fillIntensity: number;
  flareAttenuation: number;
  flareSamples: number;
  flareSpacing: number;
  flareThreshold: number;
  keyElevation: number;
  keyIntensity: number;
  keyRadius: number;
  keySpeed: number;
  markGap: number;
  measure: number;
  metalness: number;
  rimAngle: number;
  rimIntensity: number;
  roughness: number;
  studioBack: number;
  studioKey: number;
  studioSides: number;
  studioTop: number;
}

/** The committed look. `Reset` returns the panel to exactly this. */
export const LOOK: Readonly<LookValues> = Object.freeze({
  aberrationFalloff: 2.2,
  aberrationPeak: 0.16,
  ambient: 0.62,
  bloomRadius: 0.32,
  bloomStrength: 0.3,
  bloomThreshold: 0.92,
  curvature: 0.4,
  descent: 0.42,
  emissive: 0.008,
  envIntensity: 0.3,
  envResolution: 256,
  exposure: 0.86,
  fillIntensity: 0.35,
  flareAttenuation: 26,
  flareSamples: 6,
  flareSpacing: 0.16,
  flareThreshold: 0.72,
  keyElevation: 0.55,
  keyIntensity: 3.6,
  keyRadius: 5,
  keySpeed: 0.35,
  markGap: 0.218,
  measure: 0.28,
  metalness: 0.18,
  rimAngle: 2.4,
  rimIntensity: 1.4,
  roughness: 0.3,
  studioBack: 0.35,
  studioKey: 1.1,
  studioSides: 0.9,
  studioTop: 0.7,
});

/** What the scene actually reads, every frame. */
export const live: LookValues = { ...LOOK };

// Reachable from the console in development, which is how the panel's own
// behaviour gets checked rather than assumed.
if (import.meta.env.DEV) {
  (globalThis as unknown as { __look: LookValues }).__look = live;
}

/** Bumped whenever a value that is compiled into the render graph changes. */
export const graphVersion = { value: 0 };

const GRAPH_KEYS = new Set<keyof LookValues>([
  'bloomRadius',
  'bloomStrength',
  'bloomThreshold',
  'envResolution',
  'flareAttenuation',
  'flareSamples',
  'flareSpacing',
  'flareThreshold',
]);

const RANGES: Record<keyof LookValues, readonly [number, number, number]> = {
  aberrationFalloff: [0, 8, 0.1],
  aberrationPeak: [0, 0.8, 0.005],
  ambient: [0, 3, 0.005],
  bloomRadius: [0, 1, 0.01],
  bloomStrength: [0, 2, 0.01],
  bloomThreshold: [0, 1.5, 0.005],
  curvature: [0, 2, 0.01],
  descent: [0, 1.5, 0.005],
  emissive: [0, 0.3, 0.001],
  envIntensity: [0, 4, 0.01],
  envResolution: [64, 1024, 64],
  exposure: [0.1, 2, 0.01],
  fillIntensity: [0, 4, 0.01],
  flareAttenuation: [1, 60, 1],
  flareSamples: [1, 12, 1],
  flareSpacing: [0, 1, 0.01],
  flareThreshold: [0, 1.5, 0.01],
  keyElevation: [-1.5, 1.5, 0.01],
  keyIntensity: [0, 12, 0.05],
  keyRadius: [0, 14, 0.1],
  keySpeed: [0, 2, 0.01],
  markGap: [0, 2, 0.01],
  measure: [0.05, 0.9, 0.005],
  metalness: [0, 1, 0.01],
  rimAngle: [0, 6.283, 0.01],
  rimIntensity: [0, 4, 0.01],
  roughness: [0, 1, 0.005],
  studioBack: [0, 4, 0.01],
  studioKey: [0, 6, 0.01],
  studioSides: [0, 6, 0.01],
  studioTop: [0, 6, 0.01],
};

const GROUPS = {
  Mark: ['measure', 'descent', 'markGap', 'curvature', 'metalness', 'roughness', 'emissive'],
  Light: [
    'keyIntensity',
    'keyRadius',
    'keyElevation',
    'keySpeed',
    'fillIntensity',
    'rimIntensity',
    'rimAngle',
    'ambient',
  ],
  Studio: ['studioKey', 'studioTop', 'studioSides', 'studioBack', 'envIntensity', 'envResolution'],
  Bloom: ['bloomStrength', 'bloomRadius', 'bloomThreshold'],
  Flare: ['flareSamples', 'flareSpacing', 'flareAttenuation', 'flareThreshold'],
  Lens: ['exposure', 'aberrationPeak', 'aberrationFalloff'],
} as const satisfies Record<string, readonly (keyof LookValues)[]>;

const KEYS = Object.keys(LOOK) as (keyof LookValues)[];

function pathOf(key: keyof LookValues): string {
  const group = Object.entries(GROUPS).find(([, keys]) => (keys as readonly string[]).includes(key));
  return `${group![0]}.${key}`;
}

function apply(key: keyof LookValues, value: number): void {
  if (live[key] === value) return;
  live[key] = value;
  if (GRAPH_KEYS.has(key)) graphVersion.value += 1;
}

function schema(keys: readonly (keyof LookValues)[]) {
  return Object.fromEntries(
    keys.map((key) => {
      const [min, max, step] = RANGES[key];
      return [key, { max, min, onChange: (value: number) => apply(key, value), step, value: LOOK[key] }];
    }),
  );
}

/**
 * The panel. Rendered outside `<Canvas>`; it never re-renders the scene, it just
 * writes into `live`.
 */
export function LookPanel() {
  const [values, set] = useControls(() => ({
    ...Object.fromEntries(
      Object.entries(GROUPS).map(([name, keys]) => [name, folder(schema(keys), { collapsed: true })]),
    ),
    Reset: button(() => {
      set(Object.fromEntries(KEYS.map((key) => [pathOf(key), LOOK[key]])));
    }),
    'Copy for handoff': button(() => {
      const block = [
        'export const LOOK: Readonly<LookValues> = Object.freeze({',
        ...KEYS.map((key) => `  ${key}: ${Math.round(live[key] * 1e4) / 1e4},`),
        '});',
      ].join('\n');
      void navigator.clipboard.writeText(block);
    }),
  }));

  // leva flattens folder contents by key, so this bridges the panel into the
  // record the frame loop reads. The scene is never re-rendered by it.
  const held = values as Partial<Record<keyof LookValues, number>>;
  for (const key of KEYS) {
    const value = held[key];
    if (typeof value === 'number') apply(key, value);
  }

  return null;
}
