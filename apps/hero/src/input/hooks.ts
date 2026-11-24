import { useThree } from '@react-three/fiber/webgpu';
import type { World } from 'koota';
import { useEffect } from 'react';
import { Vector3 } from 'three/webgpu';
import { cameraActions } from '../camera/actions';
import { directorActions } from '../director/actions';
import { PAGE } from '../page/content';

const near = new Vector3();
const far = new Vector3();

/**
 * Hand the pointer, the wheel and the keyboard to the director. A pointer event becomes a point on the page: the
 * ray through it from the camera, met with the page's plane.
 */
export function useInput(world: World, isReady: boolean): void {
  const canvas = useThree((state) => state.renderer.domElement);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!isReady) return;

    const director = directorActions(world);
    const { leanCamera } = cameraActions(world);
    let pressed = -1;

    const onPage = (event: PointerEvent, send: (x: number, y: number) => void) => {
      const bounds = canvas.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      const y = 1 - ((event.clientY - bounds.top) / bounds.height) * 2;
      near.set(x, y, -1).unproject(camera);
      far.set(x, y, 1).unproject(camera);
      const along = near.z / (near.z - far.z);

      if (!Number.isFinite(along) || along < 0) return;

      send(near.x + (far.x - near.x) * along + PAGE.width / 2, PAGE.height / 2 - (near.y + (far.y - near.y) * along));
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || pressed >= 0) return;

      pressed = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      onPage(event, director.pressPage);
    };
    const move = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      leanCamera(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      );

      if (event.pointerId === pressed) onPage(event, director.dragPage);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pressed) return;

      pressed = -1;
      director.releasePage();
    };
    const wheel = (event: WheelEvent) => {
      // Scrolling up with nothing to back out of is the document's, so a page that embeds the hero still scrolls.
      if (director.scrollPage(event.deltaY)) event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (director.pressKey(event.key)) event.preventDefault();
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move, { passive: true });
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);

    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, [world, canvas, camera, isReady]);
}
