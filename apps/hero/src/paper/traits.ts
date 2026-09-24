import { trait } from 'koota';
import type { Vector2 } from 'three/webgpu';

/** The mounted paper's drift, which scrolls its baked grain with the foreground icon paper. */
export const PaperView = trait((): Vector2 | undefined => undefined);
