export function exactMipmappedTextureArrayBytes(
  width: number,
  height: number,
  layers: number,
  bytesPerTexel: number,
): number {
  positiveSafeInteger(width, 'texture width')
  positiveSafeInteger(height, 'texture height')
  positiveSafeInteger(layers, 'texture layers')
  positiveSafeInteger(bytesPerTexel, 'bytes per texel')

  let levelWidth = width
  let levelHeight = height
  let totalBytes = 0
  while (true) {
    const levelBytes = checkedProduct(
      checkedProduct(levelWidth, levelHeight, 'mip texel count'),
      checkedProduct(layers, bytesPerTexel, 'layer texel bytes'),
      'mip byte length',
    )
    totalBytes = checkedSum(totalBytes, levelBytes, 'mip-chain byte length')
    if (levelWidth === 1 && levelHeight === 1) return totalBytes
    levelWidth = Math.max(1, Math.floor(levelWidth / 2))
    levelHeight = Math.max(1, Math.floor(levelHeight / 2))
  }
}

function positiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
}

function checkedProduct(left: number, right: number, name: string): number {
  const product = left * right
  if (!Number.isSafeInteger(product)) throw new RangeError(`${name} exceeds safe integer range`)
  return product
}

function checkedSum(left: number, right: number, name: string): number {
  const sum = left + right
  if (!Number.isSafeInteger(sum)) throw new RangeError(`${name} exceeds safe integer range`)
  return sum
}
