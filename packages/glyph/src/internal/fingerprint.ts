import type { Fingerprint } from '../identity.js';

export const fingerprintDomain: Readonly<{
  artifact: number;
  cache: number;
  compatibility: number;
  descriptor: number;
  shaping: number;
  source: number;
}> = Object.freeze({
  artifact: 0x6172_7430,
  cache: 0x6361_6330,
  compatibility: 0x636d_7030,
  descriptor: 0x6473_6330,
  shaping: 0x7368_7030,
  source: 0x736f_7572,
});

/** MurmurHash3 x86 128 serialized as four little-endian u32 lanes. */
export function fingerprint128(bytes: Uint8Array, seed: number): Fingerprint {
  let h1 = seed >>> 0;
  let h2 = h1;
  let h3 = h1;
  let h4 = h1;
  const blockCount = Math.floor(bytes.byteLength / 16);

  for (let block = 0; block < blockCount; block += 1) {
    const offset = block * 16;
    let k1 = readU32(bytes, offset);
    let k2 = readU32(bytes, offset + 4);
    let k3 = readU32(bytes, offset + 8);
    let k4 = readU32(bytes, offset + 12);

    k1 = Math.imul(k1, 0x239b_961b);
    k1 = rotateLeft(k1, 15);
    k1 = Math.imul(k1, 0xab0e_9789);
    h1 ^= k1;
    h1 = rotateLeft(h1, 19);
    h1 = (h1 + h2) >>> 0;
    h1 = (Math.imul(h1, 5) + 0x561c_cd1b) >>> 0;

    k2 = Math.imul(k2, 0xab0e_9789);
    k2 = rotateLeft(k2, 16);
    k2 = Math.imul(k2, 0x38b3_4ae5);
    h2 ^= k2;
    h2 = rotateLeft(h2, 17);
    h2 = (h2 + h3) >>> 0;
    h2 = (Math.imul(h2, 5) + 0x0bca_a747) >>> 0;

    k3 = Math.imul(k3, 0x38b3_4ae5);
    k3 = rotateLeft(k3, 17);
    k3 = Math.imul(k3, 0xa1e3_8b93);
    h3 ^= k3;
    h3 = rotateLeft(h3, 15);
    h3 = (h3 + h4) >>> 0;
    h3 = (Math.imul(h3, 5) + 0x96cd_1c35) >>> 0;

    k4 = Math.imul(k4, 0xa1e3_8b93);
    k4 = rotateLeft(k4, 18);
    k4 = Math.imul(k4, 0x239b_961b);
    h4 ^= k4;
    h4 = rotateLeft(h4, 13);
    h4 = (h4 + h1) >>> 0;
    h4 = (Math.imul(h4, 5) + 0x32ac_3b17) >>> 0;
  }

  const tail = blockCount * 16;
  const remaining = bytes.byteLength & 15;
  let k1 = 0;
  let k2 = 0;
  let k3 = 0;
  let k4 = 0;
  if (remaining >= 15) k4 ^= bytes[tail + 14]! << 16;
  if (remaining >= 14) k4 ^= bytes[tail + 13]! << 8;
  if (remaining >= 13) {
    k4 ^= bytes[tail + 12]!;
    k4 = Math.imul(k4, 0xa1e3_8b93);
    k4 = rotateLeft(k4, 18);
    k4 = Math.imul(k4, 0x239b_961b);
    h4 ^= k4;
  }
  if (remaining >= 12) k3 ^= bytes[tail + 11]! << 24;
  if (remaining >= 11) k3 ^= bytes[tail + 10]! << 16;
  if (remaining >= 10) k3 ^= bytes[tail + 9]! << 8;
  if (remaining >= 9) {
    k3 ^= bytes[tail + 8]!;
    k3 = Math.imul(k3, 0x38b3_4ae5);
    k3 = rotateLeft(k3, 17);
    k3 = Math.imul(k3, 0xa1e3_8b93);
    h3 ^= k3;
  }
  if (remaining >= 8) k2 ^= bytes[tail + 7]! << 24;
  if (remaining >= 7) k2 ^= bytes[tail + 6]! << 16;
  if (remaining >= 6) k2 ^= bytes[tail + 5]! << 8;
  if (remaining >= 5) {
    k2 ^= bytes[tail + 4]!;
    k2 = Math.imul(k2, 0xab0e_9789);
    k2 = rotateLeft(k2, 16);
    k2 = Math.imul(k2, 0x38b3_4ae5);
    h2 ^= k2;
  }
  if (remaining >= 4) k1 ^= bytes[tail + 3]! << 24;
  if (remaining >= 3) k1 ^= bytes[tail + 2]! << 16;
  if (remaining >= 2) k1 ^= bytes[tail + 1]! << 8;
  if (remaining >= 1) {
    k1 ^= bytes[tail]!;
    k1 = Math.imul(k1, 0x239b_961b);
    k1 = rotateLeft(k1, 15);
    k1 = Math.imul(k1, 0xab0e_9789);
    h1 ^= k1;
  }

  const length = bytes.byteLength >>> 0;
  h1 ^= length;
  h2 ^= length;
  h3 ^= length;
  h4 ^= length;
  h1 = (h1 + h2 + h3 + h4) >>> 0;
  h2 = (h2 + h1) >>> 0;
  h3 = (h3 + h1) >>> 0;
  h4 = (h4 + h1) >>> 0;
  h1 = finalize(h1);
  h2 = finalize(h2);
  h3 = finalize(h3);
  h4 = finalize(h4);
  h1 = (h1 + h2 + h3 + h4) >>> 0;
  h2 = (h2 + h1) >>> 0;
  h3 = (h3 + h1) >>> 0;
  h4 = (h4 + h1) >>> 0;
  return [h1, h2, h3, h4].map(littleEndianHex).join('') as Fingerprint;
}

export function isFingerprint(value: unknown): value is Fingerprint {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function rotateLeft(value: number, distance: number): number {
  return ((value << distance) | (value >>> (32 - distance))) >>> 0;
}

function finalize(value: number): number {
  value ^= value >>> 16;
  value = Math.imul(value, 0x85eb_ca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2_ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

function littleEndianHex(value: number): string {
  return [value, value >>> 8, value >>> 16, value >>> 24]
    .map((lane) => (lane & 0xff).toString(16).padStart(2, '0'))
    .join('');
}
