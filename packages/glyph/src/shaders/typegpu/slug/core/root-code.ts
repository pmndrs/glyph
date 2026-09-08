/**
 * Adapted from three-flatland Slug at 2935a89f (MIT).
 * See RESEARCH.md for repository provenance.
 */
import { d, std } from 'typegpu';

/**
 * Calculate root eligibility from the signs of three control-point coordinates.
 * Bit 0 selects the first ordered root and bit 8 selects the second.
 */
export function calcRootCode(y1: number, y2: number, y3: number): number {
  'use gpu';

  const s1 = std.select(d.u32(0), d.u32(1), y1 < 0);
  const s2 = std.select(d.u32(0), d.u32(1), y2 < 0);
  const s3 = std.select(d.u32(0), d.u32(1), y3 < 0);
  const shift = s1 | (s2 << 1) | (s3 << 2);

  return (d.u32(0x2e74) >>> shift) & d.u32(0x0101);
}
