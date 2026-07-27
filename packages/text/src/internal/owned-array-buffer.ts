export function copyToOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  return owned.buffer
}

/** Transfer an exact owned view without copying; isolate subviews into their own buffer. */
export function transferableArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer
  }
  return copyToOwnedArrayBuffer(bytes)
}
