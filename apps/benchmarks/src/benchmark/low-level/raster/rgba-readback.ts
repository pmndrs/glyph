/** Normalize compact or WebGPU-row-aligned RGBA8 bytes into top-to-bottom compact rows. */
export function compactRgba8Readback(
  source: Uint8Array,
  width: number,
  height: number,
  rowOrder: 'top-to-bottom' | 'bottom-to-top' = 'top-to-bottom',
): Uint8Array {
  const rowBytes = width * 4;
  const compactLength = rowBytes * height;
  const sourceRowBytes = source.byteLength === compactLength ? rowBytes : Math.ceil(rowBytes / 256) * 256;
  const expectedLength = (height - 1) * sourceRowBytes + rowBytes;
  if (source.byteLength !== expectedLength) {
    throw new Error(
      `RGBA8 readback returned ${source.byteLength} bytes; expected ${compactLength} compact or ${expectedLength} aligned bytes`,
    );
  }
  const compact = new Uint8Array(compactLength);
  // WebGPU copies rows from the top-left; WebGL readPixels returns bottom-left rows.
  for (let row = 0; row < height; row += 1) {
    const sourceRow = rowOrder === 'bottom-to-top' ? height - row - 1 : row;
    const sourceOffset = sourceRow * sourceRowBytes;
    compact.set(source.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes);
  }
  return compact;
}
