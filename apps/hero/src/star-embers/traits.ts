import { trait } from 'koota';
import type { Group } from 'three/webgpu';

export interface EmberDraw {
  groups: (Group | null)[];
  age: { value: number };
  bloom: { value: number };
}

export const EmberView = trait((): EmberDraw | undefined => undefined);
