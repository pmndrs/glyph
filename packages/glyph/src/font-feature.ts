export interface FontFeature {
  readonly tag: string;
  readonly value?: number;
  readonly start?: number;
  readonly end?: number;
}

/** Resolved, absolute UTF-16 feature range passed to the shaping ABI. */
export interface ResolvedFontFeature {
  readonly tag: string;
  readonly value: number;
  readonly start: number;
  readonly end: number;
}
