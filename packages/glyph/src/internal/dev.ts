/** Dev-only diagnostics gate — Vite replaces `import.meta.env.MODE` in application builds;
 * direct ESM imports default to development when no build mode or Node process is present.
 * Use for guidance only; real invariants still `throw`. */
const buildMode = (import.meta as ImportMeta & { readonly env?: { readonly MODE?: string } }).env?.MODE;
export const DEV: boolean =
  buildMode === undefined
    ? typeof process === 'undefined' || process.env.NODE_ENV !== 'production'
    : buildMode !== 'production';
