/**
 * The title's resting ink width, in world units. The feature line fits itself to it, so the two read as one block
 * rather than as two unrelated lines. Published from the title because only it knows when its own layout committed.
 */
let width: number | undefined;

export function setTitleWidth(value: number): void {
  width = value;
}

export function titleWidth(): number | undefined {
  return width;
}
