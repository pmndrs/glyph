export type GlyphFrameStore = {
  getState(): { advance(timestamp: number): unknown };
};

/** R3F WebGPU's store advance is global, so one active store advances every pooled renderer root. */
export function advancePooledRoots(stores: readonly GlyphFrameStore[], timestamp: number): void {
  stores[0]?.getState().advance(timestamp);
}
