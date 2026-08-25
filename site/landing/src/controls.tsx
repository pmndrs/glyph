import { button, folder, useControls } from 'leva';
import { createContext, createElement, useContext, type ReactNode } from 'react';

/**
 * Every dial the look depends on, in one place, so the values can be set by eye
 * and handed back as a block rather than guessed one round-trip at a time.
 *
 * Dev only. `import.meta.env.DEV` is statically false in a production build, so
 * the panel and leva itself drop out of the bundle.
 */
export interface LookValues {
  readonly aberrationFalloff: number;
  readonly aberrationPeak: number;
  readonly ambient: number;
  readonly bloomRadius: number;
  readonly bloomStrength: number;
  readonly bloomThreshold: number;
  readonly curvature: number;
  readonly emissive: number;
  readonly envIntensity: number;
  readonly exposure: number;
  readonly fillIntensity: number;
  readonly flareAttenuation: number;
  readonly flareSamples: number;
  readonly flareSpacing: number;
  readonly flareThreshold: number;
  readonly keyElevation: number;
  readonly keyIntensity: number;
  readonly keyRadius: number;
  readonly rimAngle: number;
  readonly keySpeed: number;
  readonly measure: number;
  readonly metalness: number;
  readonly rimIntensity: number;
  readonly roughness: number;
}

export const LOOK: LookValues = {
  aberrationFalloff: 2.2,
  aberrationPeak: 0.16,
  ambient: 0.07,
  bloomRadius: 0.32,
  bloomStrength: 0.3,
  bloomThreshold: 0.92,
  curvature: 0.4,
  emissive: 0.008,
  envIntensity: 0.3,
  exposure: 0.6,
  fillIntensity: 0.35,
  flareAttenuation: 26,
  flareSamples: 6,
  flareSpacing: 0.16,
  flareThreshold: 0.72,
  keyElevation: 0.55,
  keyIntensity: 2.4,
  keyRadius: 5,
  rimAngle: 2.4,
  keySpeed: 0.35,
  measure: 0.28,
  metalness: 0.45,
  rimIntensity: 1.4,
  roughness: 0.28,
};

const RANGES: Record<keyof LookValues, readonly [number, number, number]> = {
  aberrationFalloff: [0, 8, 0.1],
  aberrationPeak: [0, 0.8, 0.005],
  ambient: [0, 1, 0.005],
  bloomRadius: [0, 1, 0.01],
  bloomStrength: [0, 2, 0.01],
  bloomThreshold: [0, 1.5, 0.005],
  curvature: [0, 2, 0.01],
  emissive: [0, 0.3, 0.001],
  envIntensity: [0, 4, 0.01],
  exposure: [0.1, 2, 0.01],
  fillIntensity: [0, 4, 0.01],
  flareAttenuation: [1, 60, 1],
  flareSamples: [1, 12, 1],
  flareSpacing: [0, 1, 0.01],
  flareThreshold: [0, 1.5, 0.01],
  keyElevation: [-1.5, 1.5, 0.01],
  keyIntensity: [0, 12, 0.05],
  keyRadius: [0, 14, 0.1],
  rimAngle: [0, 6.283, 0.01],
  keySpeed: [0, 2, 0.01],
  measure: [0.05, 0.9, 0.005],
  metalness: [0, 1, 0.01],
  rimIntensity: [0, 4, 0.01],
  roughness: [0, 1, 0.005],
};

const GROUPS = {
  Mark: ['measure', 'curvature', 'metalness', 'roughness', 'envIntensity', 'emissive'],
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
  Bloom: ['bloomStrength', 'bloomRadius', 'bloomThreshold'],
  Flare: ['flareSamples', 'flareSpacing', 'flareAttenuation', 'flareThreshold'],
  Lens: ['exposure', 'aberrationPeak', 'aberrationFalloff'],
} as const satisfies Record<string, readonly (keyof LookValues)[]>;

function schema(keys: readonly (keyof LookValues)[]) {
  return Object.fromEntries(
    keys.map((key) => {
      const [min, max, step] = RANGES[key];
      return [key, { max, min, step, value: LOOK[key] }];
    }),
  );
}

const LookContext = createContext<LookValues>(LOOK);

/** Reads the shared look. Every consumer sees the same values. */
export function useLook(): LookValues {
  return useContext(LookContext);
}

/**
 * Owns the one leva store and publishes it. In production the provider renders
 * its children against the frozen `LOOK` block and leva never loads.
 */
export function LookProvider({ children }: { children: ReactNode }) {
  if (!import.meta.env.DEV) {
    return createElement(LookContext.Provider, { value: LOOK }, children);
  }

  // Safe: `import.meta.env.DEV` is a build-time constant, so this branch is
  // either always taken or always eliminated and hook order never varies.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const values = useControls(() => ({
    ...Object.fromEntries(
      Object.entries(GROUPS).map(([name, keys]) => [name, folder(schema(keys), { collapsed: false })]),
    ),
    'Copy for handoff': button((get) => {
      const entries = (Object.keys(LOOK) as (keyof LookValues)[])
        .map((key) => {
          const group = Object.entries(GROUPS).find(([, keys]) => (keys as readonly string[]).includes(key));
          return [key, get(`${group![0]}.${key}`) as number] as const;
        })
        .sort(([a], [b]) => a.localeCompare(b));

      const block = [
        'export const LOOK: LookValues = {',
        ...entries.map(([key, value]) => `  ${key}: ${round(value)},`),
        '};',
      ].join('\n');

      void navigator.clipboard.writeText(block);
    }),
  }));

  return createElement(LookContext.Provider, { value: { ...LOOK, ...(values as Partial<LookValues>) } }, children);
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
