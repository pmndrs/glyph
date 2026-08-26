import { button, folder, useControls } from 'leva';

import { LOOK, type LookValues, graphVersion, live } from '../look';

/**
 * The leva panel, and every table it needs.
 *
 * Dev only, and kept in its own module for a measured reason: leva builds its
 * stitches theme at module scope, so a static import survives tree-shaking even
 * when every use of it is behind `import.meta.env.DEV`. A production build of
 * an earlier revision carried leva's whole panel UI. Reaching this module only
 * through `import()` inside a branch the constant folds away leaves the code in
 * a chunk that production never emits.
 */
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
  chorusDepth: [0, 12, 0.1],
  chorusDim: [0, 1, 0.001],
  chorusJustify: [0, 1, 1],
  chorusBreak: [0, 1, 1],
  chorusGap: [0, 220, 2],
  chorusWords: [200, 8000, 100],
  shakeAim: [0, 0.4, 0.001],
  shakeDamping: [0.02, 2, 0.01],
  shakeAmount: [0, 1.2, 0.005],
  shakeSpeed: [0, 1, 0.005],
  chorusRtl: [0, 0.6, 0.01],
  chorusRun: [1, 40, 1],
  chorusLetter: [0, 0.4, 0.005],
  chorusMaxSpace: [1, 3, 0.01],
  chorusMinSpace: [0.4, 1, 0.01],
  chorusLeading: [0.6, 2.2, 0.01],
  chorusSize: [0.008, 0.09, 0.001],
  bloomStrength: [0, 2, 0.01],
  bloomThreshold: [0, 1.5, 0.005],
  curvature: [0, 2, 0.01],
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
  Mark: ['measure', 'markGap', 'curvature', 'metalness', 'roughness', 'emissive'],
  Chorus: [
    'chorusJustify',
    'chorusSize',
    'chorusLeading',
    'chorusDim',
    'chorusDepth',
    'chorusMinSpace',
    'chorusMaxSpace',
    'chorusLetter',
    'chorusGap',
    'chorusBreak',
    'chorusRtl',
    'chorusRun',
    'chorusWords',
  ],
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
  Camera: ['shakeAmount', 'shakeAim', 'shakeSpeed', 'shakeDamping'],
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
