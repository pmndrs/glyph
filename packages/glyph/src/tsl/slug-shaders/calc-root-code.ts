/** Adapted from three-flatland Slug at 2935a89f (MIT); see RESEARCH.md for provenance. */
import type { Node } from 'three/webgpu';
import { lessThan, uint } from 'three/tsl';
import { uintBitAnd, uintBitOr, uintShiftLeft, uintShiftRight } from './tsl-compat.js';

/** Root eligibility from the signs of three control-point coordinates; bit 0 selects the first ordered root, bit 8 the second. */
export function calcRootCode(y1: Node<'float'>, y2: Node<'float'>, y3: Node<'float'>): Node<'uint'> {
  const negative1: Node<'bool'> = lessThan(y1, 0);
  const negative2: Node<'bool'> = lessThan(y2, 0);
  const negative3: Node<'bool'> = lessThan(y3, 0);
  const s1: Node<'uint'> = uint(negative1);
  const s2: Node<'uint'> = uint(negative2);
  const s3: Node<'uint'> = uint(negative3);
  const shifted2: Node<'uint'> = uintShiftLeft(s2, uint(1));
  const shifted3: Node<'uint'> = uintShiftLeft(s3, uint(2));
  const lowSigns: Node<'uint'> = uintBitOr(s1, shifted2);
  const shift: Node<'uint'> = uintBitOr(lowSigns, shifted3);
  const tableBits: Node<'uint'> = uintShiftRight(uint(0x2e74), shift);

  return uintBitAnd(tableBits, uint(0x0101));
}
