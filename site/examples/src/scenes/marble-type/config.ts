/** The phrase stamped before the reader takes over. */
export const AUTO_PHRASE = 'MAKE AN IMPACT';

export const SLAB = {
  width: 9.4,
  height: 4.7,
  depth: 0.5,
  radius: 0.18,
} as const;

export const TEXT = {
  x: -3.85,
  y: 0.55,
  width: 7.7,
  fontSize: 0.86,
  maxLength: 18,
} as const;

export const STAMP = {
  duration: 0.46,
  startScale: 4.2,
  startDepth: 3.8,
  surfaceDepth: SLAB.depth / 2 + 0.018,
  autoDelay: 0.65,
  autoInterval: 0.3,
  shakeDuration: 0.2,
} as const;

export const CRACKS = {
  branches: 7,
  segmentsPerBranch: 3,
  maxImpacts: TEXT.maxLength,
  depth: SLAB.depth / 2 + 0.024,
} as const;
