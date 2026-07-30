const PARAGRAPH_STRESS_CYCLE_MS = 8_000;
const START_WIDTH_PERCENT = 82;
const END_WIDTH_PERCENT = 40;
const END_FONT_SIZE = 8;

export interface ParagraphStressMotionFrame {
  readonly fontSize: number;
  readonly layoutWidthPercent: number;
  readonly scrollProgress: number;
}

export function paragraphStressMotionFrame(
  elapsedMs: number,
  animationSpeed: number,
  startFontSize: number,
): ParagraphStressMotionFrame {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError('paragraph stress elapsed time must be finite and nonnegative');
  }
  if (!Number.isFinite(animationSpeed) || animationSpeed < 0 || animationSpeed > 100) {
    throw new RangeError('paragraph stress animation speed must be in [0, 100]');
  }
  if (!Number.isFinite(startFontSize) || startFontSize < END_FONT_SIZE) {
    throw new RangeError(`paragraph stress start font size must be at least ${END_FONT_SIZE}`);
  }

  const animationRate = 0.25 + animationSpeed * 0.0175;
  const cycle = ((elapsedMs / PARAGRAPH_STRESS_CYCLE_MS) * animationRate) % 1;
  const widthProgress = easeOutCubic(clamp01(cycle / 0.22));
  const fontProgress = easeInOutCubic(clamp01((cycle - 0.22) / 0.3));
  const scrollProgress = easeInOutCubic(clamp01((cycle - 0.52) / 0.4));

  return {
    fontSize: Math.round(startFontSize + (END_FONT_SIZE - startFontSize) * fontProgress),
    layoutWidthPercent: Math.round(START_WIDTH_PERCENT + (END_WIDTH_PERCENT - START_WIDTH_PERCENT) * widthProgress),
    scrollProgress,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}
