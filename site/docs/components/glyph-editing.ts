export type MutablePoint2 = {
  set(x: number, y: number): unknown;
};

/** Map proxy-local CSS pixels to Three's normalized device coordinates without allocating. */
export function setProxyPointNdc(target: MutablePoint2, x: number, y: number, width: number, height: number): void {
  target.set((x / width) * 2 - 1, 1 - (y / height) * 2);
}
