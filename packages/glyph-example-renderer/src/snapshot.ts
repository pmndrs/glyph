/**
 * Bytes retained from one plan table. Borrowed targets copy this window before acceptance
 * returns; owned publications keep their existing owned view.
 */
export interface ExampleTableSnapshot {
  readonly count: number;
  readonly stride: number;
  readonly records: Uint8Array;
}
