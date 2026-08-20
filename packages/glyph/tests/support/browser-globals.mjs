/**
 * react-three-fiber's WebGPU entry eagerly imports three's Inspector, which reads `localStorage`
 * at module scope. R3F is client-only, so that is correct for its intended environment and wrong
 * only for a Node test process. Importing this module first supplies the one global that import
 * path requires; it is test scaffolding, not a polyfill the package ships.
 */
if (globalThis.localStorage === undefined) {
  const entries = new Map();
  globalThis.localStorage = {
    getItem: (key) => (entries.has(String(key)) ? entries.get(String(key)) : null),
    setItem: (key, value) => void entries.set(String(key), String(value)),
    removeItem: (key) => void entries.delete(String(key)),
    clear: () => void entries.clear(),
    key: (index) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  };
}
