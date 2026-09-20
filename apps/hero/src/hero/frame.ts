import type { RootState } from '@react-three/fiber/webgpu';
import type { World } from 'koota';
import { inputActions } from '../input/actions';
import { PATTERN_ANGLE } from '../icon-field/content';
import { updateTime } from '../time/systems';
import { Time } from '../time/traits';
import { heroActions } from './actions';
import { updatePaper, uTime } from './materials';
import { heroReady } from './prepare';

/** Sample renderer inputs and synchronize the clock and paper. Returns whether simulation can advance. */
export function syncHeroFrame(world: World, frame: RootState & { time: number }, delta: number): boolean {
  const { viewport, camera, pointer, size, time: now } = frame;
  const ready = heroReady();
  heroActions(world).sampleView(viewport.width, viewport.height, camera.position.z, size.width / size.height);
  inputActions(world).samplePointer(pointer.x, pointer.y);
  updateTime(world, delta, now, ready);
  const time = world.get(Time)!;
  uTime.value = time.elapsed;
  updatePaper(time.elapsed, PATTERN_ANGLE);

  return ready;
}
