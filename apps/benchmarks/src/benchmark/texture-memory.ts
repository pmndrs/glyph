export function exactBaseTextureArrayBytes(
  width: number,
  height: number,
  layers: number,
  bytesPerTexel: number,
): number {
  positiveSafeInteger(width, 'texture width');
  positiveSafeInteger(height, 'texture height');
  positiveSafeInteger(layers, 'texture layers');
  positiveSafeInteger(bytesPerTexel, 'bytes per texel');

  return checkedProduct(
    checkedProduct(width, height, 'texture-array texel count'),
    checkedProduct(layers, bytesPerTexel, 'texture-array layer bytes'),
    'texture-array byte length',
  );
}

function positiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function checkedProduct(left: number, right: number, name: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) throw new RangeError(`${name} exceeds safe integer range`);
  return product;
}
