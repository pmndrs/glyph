/** Dev-only diagnostics gate — retain the literal `process.env.NODE_ENV` comparison for
 * production bundlers, and avoid reading a missing Node global in direct browser modules.
 * Use for guidance only; real invariants still `throw`. */
export const DEV: boolean = typeof process === 'undefined' ? false : process.env.NODE_ENV !== 'production';
