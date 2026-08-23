/**
 * The authoring half of the span cascade.
 *
 * A span states only the properties it changes, so a span stating a colour keeps the
 * font, size, outline, and shadow of the scope enclosing it. The fold itself belongs to
 * the engine: `cascadeOrder` is the authored array index and Rust resolves each offset by
 * `(root, cascade_order)`, so overlap is last-wins and needs no host-side resolution.
 * What the host still owns is separating a property a caller stated from one they left
 * absent, because an explicit `undefined` must not shadow an enclosing value.
 */

/** A source that may hold an explicit `undefined` for any property it does not state. */
export type StatedSource<Properties extends object> = {
  readonly [Key in keyof Properties]?: Properties[Key] | undefined;
};

/** Copy the keys a caller states, so an explicit `undefined` cannot shadow an enclosing value. */
export function statedProperties<Properties extends object>(
  ...sources: readonly (StatedSource<Properties> | undefined)[]
): Properties {
  const stated: Record<string, unknown> = {};
  for (const source of sources) {
    if (source === undefined) continue;
    for (const [key, value] of Object.entries(source)) if (value !== undefined) stated[key] = value;
  }
  return stated as Properties;
}
