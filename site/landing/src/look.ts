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
 * This module ships to production, because the frame loop reads `live` in every
 * build. The panel that writes to it does not: see `dev/look-panel.tsx`.
 */
export interface LookValues {
  aberrationFalloff: number;
  aberrationPeak: number;
  ambient: number;
  bloomRadius: number;
  chorusDepth: number;
  chorusDim: number;
  chorusJustify: number;
  chorusBreak: number;
  chorusGap: number;
  chorusWords: number;
  shakeAim: number;
  shakeDamping: number;
  shakeAmount: number;
  shakeSpeed: number;
  chorusRtl: number;
  chorusRun: number;
  chorusLetter: number;
  chorusMaxSpace: number;
  chorusMinSpace: number;
  chorusLeading: number;
  chorusSize: number;
  bloomStrength: number;
  bloomThreshold: number;
  curvature: number;
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
  chorusBreak: 1,
  chorusDepth: 3.2,
  chorusDim: 0.065,
  chorusGap: 83,
  chorusJustify: 1,
  chorusLeading: 0.92,
  chorusLetter: 0.045,
  chorusMaxSpace: 1.35,
  chorusMinSpace: 0.85,
  chorusRtl: 0.12,
  chorusRun: 1,
  chorusSize: 0.0182,
  chorusWords: 1600,
  curvature: 0.87,
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
  metalness: 0.61,
  rimAngle: 2.4,
  rimIntensity: 1.4,
  roughness: 0.425,
  shakeAim: 0.035,
  shakeAmount: 0.13,
  shakeDamping: 0.45,
  shakeSpeed: 0.058,
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
