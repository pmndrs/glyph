/** Dev-only diagnostics gate. Production bundlers can fold either their build mode or
 * the standard NODE_ENV define; direct browser modules never require a process global.
 * Use for guidance only; real invariants still `throw`. */
const buildMode = (import.meta as ImportMeta & { readonly env?: { readonly MODE?: string } }).env?.MODE;
export const DEV: boolean =
  buildMode !== 'production' && (typeof process === 'undefined' ? false : process.env.NODE_ENV !== 'production');
