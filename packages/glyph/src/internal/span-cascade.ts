/** Authoring half of the span cascade — a span states only what it changes. The fold is the engine's (last-wins by `cascadeOrder`); the host's job is separating a stated property from an absent one so explicit `undefined` never shadows an enclosing value. */

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
