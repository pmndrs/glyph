import { lerp, vec2, vec3 } from 'math';
import type { Footprint } from './traits';
import { jitter } from '../sequence/departure';

export const COUNT = 128;
export const BASE_Z = 0.12;
export const RISE = 0.8;

/** Bounded particle pool. The oldest slot is overwritten on saturation. */
export function createDust() {
  return {
    particles: Array.from({ length: COUNT }, () => ({
      age: 1,
      life: 1,
      position: vec3.create(),
      velocity: vec3.create(),
      roll: 0,
      spin: 0,
      size: 1,
    })),
    previous: vec2.create(),
    hasPrevious: false,
    carry: 0,
    emitted: 0,
  };
}
export type DustState = ReturnType<typeof createDust>;

/** Emits by distance, excluding teleports above four units. Copies the borrowed footprint before returning. */
export function stepDust(state: DustState, step: number, current: Footprint | undefined): void {
  for (let index = 0; index < COUNT; index++) state.particles[index]!.age += step;
  const before = state.previous;
  if (current !== undefined && state.hasPrevious) {
    const dx = current.x - before[0];
    const dy = current.y - before[1];
    const distance = Math.hypot(dx, dy);
    if (distance > 4) state.carry = 0;
    else if (distance > 0) {
      const cos = Math.cos(current.heading);
      const sin = Math.sin(current.heading);
      const speed = distance / Math.max(step, 0.001);
      const kick = 0.25 + Math.min(speed, 15) * 0.035;
      for (let along = 0.09 - state.carry; along <= distance; along += 0.09) {
        const serial = state.emitted++;
        const particle = state.particles[serial % COUNT]!;
        const side = serial % 2 === 0 ? -1 : 1;
        const across = side * current.halfExtents[1] * 0.85 + (jitter(serial + 31) - 0.5) * 0.2;
        const rear = current.halfExtents[0] + jitter(serial + 53) * 0.25;
        const fraction = along / distance;
        const spread = side * (0.25 + jitter(serial + 71) * 0.65);
        particle.age = 0;
        particle.life = 1.1 + jitter(serial + 97) * 0.7;
        vec3.set(
          particle.position,
          lerp(before[0], current.x, fraction) - cos * rear - sin * across,
          lerp(before[1], current.y, fraction) - sin * rear + cos * across,
          BASE_Z,
        );
        vec3.set(particle.velocity, -cos * kick - sin * spread, -sin * kick + cos * spread, 0);
        particle.roll = jitter(serial + 113) * Math.PI * 2;
        particle.spin = (jitter(serial + 137) - 0.5) * 3;
        particle.size = 0.16 + jitter(serial + 151) * 0.19;
      }
      state.carry = (state.carry + distance) % 0.09;
    }
  } else state.carry = 0;
  state.hasPrevious = current !== undefined;
  if (current !== undefined) vec2.set(before, current.x, current.y);
  const drag = Math.exp(-step * 1.8);
  for (let index = 0; index < COUNT; index++) {
    const particle = state.particles[index]!;
    if (particle.age >= particle.life) continue;
    vec3.scaleAndAdd(particle.position, particle.position, particle.velocity, step);
    vec3.scale(particle.velocity, particle.velocity, drag);
    particle.position[2] = BASE_Z + (RISE * particle.age) / particle.life;
    particle.roll += particle.spin * step;
  }
}
