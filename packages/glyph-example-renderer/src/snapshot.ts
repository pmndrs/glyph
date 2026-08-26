/**
 * An owned view of one plan table.
 *
 * `records` is a window into the owned publication's bytes — the single copy
 * `TextEngineSession.copyPublication` made — so holding it is free and always safe. It never
 * aliases engine memory.
 */
export interface ExampleTableSnapshot {
  readonly count: number;
  readonly stride: number;
  readonly records: Uint8Array;
}
