/** Dev-only diagnostics gate — keep the literal `process.env.NODE_ENV !== 'production'` comparison so
 * bundlers dead-code-eliminate `if (DEV)` blocks; use for guidance only, real invariants still `throw`. */
export const DEV: boolean = process.env.NODE_ENV !== 'production';
