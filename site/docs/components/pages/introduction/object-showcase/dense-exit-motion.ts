const DENSE_EXIT_SPEED = 9;
const DENSE_EXIT_EPSILON = 0.01;

/** Collapse generated objects quickly while retaining frame-rate independent timing. */
export function advanceDenseExitScale(current: number, delta: number): number {
  const next = current * Math.exp(-DENSE_EXIT_SPEED * Math.max(0, delta));
  return next <= DENSE_EXIT_EPSILON ? 0 : next;
}
