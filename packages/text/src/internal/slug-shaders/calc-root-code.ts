/**
 * Adapted from three-flatland Slug at 2935a89f (MIT).
 * See RESEARCH.md for repository provenance.
 */
import type { Node } from 'three/webgpu'
import { uint } from 'three/tsl'

/**
 * Calculate root eligibility from the signs of three control-point coordinates.
 * Bit 0 selects the first ordered root and bit 8 selects the second.
 */
export function calcRootCode(
  y1: Node<'float'>,
  y2: Node<'float'>,
  y3: Node<'float'>,
): Node<'uint'> {
  const negative1: Node<'bool'> = y1.lessThan(0)
  const negative2: Node<'bool'> = y2.lessThan(0)
  const negative3: Node<'bool'> = y3.lessThan(0)
  const s1: Node<'uint'> = uint(negative1)
  const s2: Node<'uint'> = uint(negative2)
  const s3: Node<'uint'> = uint(negative3)
  const shifted2: Node<'uint'> = s2.shiftLeft(uint(1))
  const shifted3: Node<'uint'> = s3.shiftLeft(uint(2))
  const lowSigns: Node<'uint'> = s1.bitOr(shifted2)
  const shift: Node<'uint'> = lowSigns.bitOr(shifted3)
  const tableBits: Node<'uint'> = uint(0x2e74).shiftRight(shift)

  return tableBits.bitAnd(uint(0x0101))
}
