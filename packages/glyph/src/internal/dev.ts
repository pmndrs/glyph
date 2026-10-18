/** Dev-only diagnostics gate. Vite injects `hot` while serving browser modules and
 * replaces NODE_ENV there; library builds leave `hot` undefined. Untransformed
 * browser imports without process leave diagnostics off. Real invariants still `throw`. */
const serving = (import.meta as ImportMeta & { readonly hot?: unknown }).hot !== undefined;
const buildDev = (import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }).env?.DEV;
export const DEV: boolean = serving
  ? process.env.NODE_ENV !== 'production'
  : buildDev === false
    ? false
    : typeof process === 'undefined'
      ? false
      : process.env.NODE_ENV !== 'production';
