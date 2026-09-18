/**
 * What is driving on the floor, published by the robot and read by whatever it can push. The floor is the screen
 * plane; a footprint is an upright box on it. Module state: there is a single scene.
 */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  /** Centre height above the floor. */
  readonly z: number;
  /** Direction of travel, from the x axis. */
  readonly heading: number;
  /** Along the direction of travel, across it, and up. */
  readonly halfExtents: readonly [number, number, number];
}

let current: Footprint | undefined;

/** Undefined while nothing is on the floor. */
export function setFootprint(next: Footprint | undefined): void {
  current = next;
}

export function footprint(): Footprint | undefined {
  return current;
}
