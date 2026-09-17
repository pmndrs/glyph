export type OrbitDistanceTransition = Readonly<{ pending: boolean; target: number }>;

export function initialOrbitDistanceTransition(target: number): OrbitDistanceTransition {
  return Object.freeze({ pending: false, target });
}

export function retargetOrbitDistance(transition: OrbitDistanceTransition, target: number): OrbitDistanceTransition {
  return transition.target === target ? transition : Object.freeze({ pending: true, target });
}

export function completeOrbitDistanceTransition(
  transition: OrbitDistanceTransition,
  current: number,
  tolerance = 0.015,
): Readonly<{ completed: boolean; transition: OrbitDistanceTransition }> {
  if (!transition.pending || Math.abs(current - transition.target) >= tolerance) {
    return Object.freeze({ completed: false, transition });
  }
  return Object.freeze({
    completed: true,
    transition: Object.freeze({ pending: false, target: transition.target }),
  });
}
