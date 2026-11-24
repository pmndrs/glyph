import { CRACKS } from './config';

export interface EditableLine {
  readonly text: string;
  readonly caret: number;
}

export interface CrackSegment {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

/** Apply the subset of keyboard editing that the proxy's ordered key stream can represent. */
export function editLine(line: EditableLine, key: string, maxLength: number): EditableLine {
  if (key === 'ArrowLeft') return { ...line, caret: Math.max(0, line.caret - 1) };
  if (key === 'ArrowRight') return { ...line, caret: Math.min(line.text.length, line.caret + 1) };
  if (key === 'Home') return { ...line, caret: 0 };
  if (key === 'End') return { ...line, caret: line.text.length };
  if (key === 'Backspace') {
    if (line.caret === 0) return line;
    return {
      text: line.text.slice(0, line.caret - 1) + line.text.slice(line.caret),
      caret: line.caret - 1,
    };
  }
  if (key === 'Delete') {
    if (line.caret >= line.text.length) return line;
    return { text: line.text.slice(0, line.caret) + line.text.slice(line.caret + 1), caret: line.caret };
  }
  if (!isPrintableKey(key) || line.text.length >= maxLength) return line;
  return {
    text: line.text.slice(0, line.caret) + key + line.text.slice(line.caret),
    caret: line.caret + key.length,
  };
}

export function isPrintableKey(key: string): boolean {
  return Array.from(key).length === 1 && key !== '\n' && key !== '\r';
}

/** Exponential arrival: most of the travel is visible, the final contact is crisp. */
export function stampProgress(elapsed: number, duration: number): number {
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 1;
  return 1 - Math.pow(2, -10 * (elapsed / duration));
}

/** A stable scalar hash so every character makes the same crack fan on every run. */
function random01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

/** Build a small branching radial fracture without allocating in the render loop. */
export function crackSegments(centerX: number, centerY: number, seed: number): readonly CrackSegment[] {
  const result: CrackSegment[] = [];
  for (let branch = 0; branch < CRACKS.branches; branch += 1) {
    let x = centerX;
    let y = centerY;
    const baseAngle = (branch / CRACKS.branches) * Math.PI * 2 + (random01(seed + branch) - 0.5) * 0.45;
    for (let segment = 0; segment < CRACKS.segmentsPerBranch; segment += 1) {
      const at = seed * 97 + branch * 13 + segment * 5;
      const angle = baseAngle + (random01(at) - 0.5) * 0.55;
      const length = 0.12 + random01(at + 1) * 0.13 - segment * 0.012;
      const nextX = x + Math.cos(angle) * length;
      const nextY = y + Math.sin(angle) * length * 0.72;
      result.push({ fromX: x, fromY: y, toX: nextX, toY: nextY });
      x = nextX;
      y = nextY;
    }
  }
  return result;
}

/** Write one crack fan into a preallocated xyz line-segment column. */
export function writeCrack(
  positions: Float32Array,
  floatOffset: number,
  centerX: number,
  centerY: number,
  depth: number,
  seed: number,
): number {
  let cursor = floatOffset;
  for (const segment of crackSegments(centerX, centerY, seed)) {
    positions[cursor++] = segment.fromX;
    positions[cursor++] = segment.fromY;
    positions[cursor++] = depth;
    positions[cursor++] = segment.toX;
    positions[cursor++] = segment.toY;
    positions[cursor++] = depth;
  }
  return cursor;
}
