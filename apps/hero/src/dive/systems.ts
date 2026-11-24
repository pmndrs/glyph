import type { World } from 'koota';
import { Shot } from '../camera/traits';
import { Letterpress } from '../page/traits';
import { BODY_ORIGIN, pageToWorldX, pageToWorldY } from '../page/utils';
import { DiveView } from './traits';

/**
 * Lay the outline over the drop cap, wherever the layout has it, and tell its shader how far the dive has gone:
 * the curves draw themselves on as the camera closes in, and the control points follow.
 */
export function syncDiveView(world: World): void {
  const view = world.get(DiveView);
  const letters = world.get(Letterpress)!;

  if (view === undefined) return;

  const { dive } = world.get(Shot)!;
  view.group.visible = dive > 0.02 && letters.count > 0;

  if (!view.group.visible) return;

  view.group.position.set(
    pageToWorldX(BODY_ORIGIN.x + letters.x[0]!),
    pageToWorldY(BODY_ORIGIN.y + letters.y[0]!),
    0.04,
  );
  view.group.scale.setScalar(letters.fontSize[0]!);
  view.uniforms.uDrawn.value = Math.min(1, Math.max(0, (dive - 0.18) / 0.34));
  view.uniforms.uPoints.value = Math.min(1, Math.max(0, (dive - 0.46) / 0.16));
}
