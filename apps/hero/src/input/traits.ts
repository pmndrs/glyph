import { trait } from 'koota';

export const Keys = trait(() => new Set<string>());
export const Pointer = trait({ x: 0, y: 0, strength: 0 });
