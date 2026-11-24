export type GlyphFrameStore = {
  getState(): { advance(timestamp: number): unknown };
};

/** Step each active logical root once; a store-local R3F advance only steps that root ID. */
export function advancePooledRoots(stores: readonly GlyphFrameStore[], timestamp: number): void {
  for (const store of stores) store.getState().advance(timestamp);
}
