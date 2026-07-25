export const FONT_ARTIFACT_FUZZ_SEED = 0x504d4e44;

export function* mutateFontArtifact(source, runs, seed = FONT_ARTIFACT_FUZZ_SEED) {
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  for (let id = 0; id < runs; id += 1) {
    const mode = random() % 6;
    let bytes;
    if (mode === 0) {
      bytes = source.slice();
      const offset = random() % bytes.byteLength;
      bytes[offset] ^= 1 << (random() & 7);
    } else if (mode === 1) {
      bytes = source.slice(0, random() % source.byteLength);
    } else if (mode === 2) {
      bytes = source.slice();
      const offset = random() % (bytes.byteLength - 3);
      new DataView(bytes.buffer).setUint32(offset, random(), true);
    } else if (mode === 3) {
      const length = 1 + (random() & 15);
      const offset = random() % (source.byteLength + 1);
      bytes = new Uint8Array(source.byteLength + length);
      bytes.set(source.subarray(0, offset));
      for (let index = 0; index < length; index += 1) bytes[offset + index] = random() & 0xff;
      bytes.set(source.subarray(offset), offset + length);
    } else if (mode === 4) {
      const start = random() % source.byteLength;
      const length = Math.min(1 + (random() & 31), source.byteLength - start);
      bytes = new Uint8Array(source.byteLength - length);
      bytes.set(source.subarray(0, start));
      bytes.set(source.subarray(start + length), start);
    } else {
      bytes = source.slice();
      const start = random() % bytes.byteLength;
      const length = Math.min(1 + (random() & 31), bytes.byteLength - start);
      bytes.fill(random() & 0xff, start, start + length);
    }
    yield { id, mode, seed: seed >>> 0, bytes };
  }
}
