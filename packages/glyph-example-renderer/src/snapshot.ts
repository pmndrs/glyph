/**
 * An owned view of one plan table.
 *
 * `records` is a window into the retained publication's own bytes — the single copy
 * `TextEngineSession.retain` made — so holding it is free and always safe. It never
 * aliases engine memory.
 */
export interface ExampleTableSnapshot {
  readonly count: number;
  readonly stride: number;
  readonly records: Uint8Array;
}
