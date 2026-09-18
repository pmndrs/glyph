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

/** The highest point of any letter above the floor, in world units: zero while the word rests. Published by the
 * title's bodies each physics step, because only they know how high a lifted or tumbling letter reaches. */
let reach = 0;

export function setTitleReach(value: number): void {
  reach = value;
}

export function titleReach(): number {
  return reach;
}
