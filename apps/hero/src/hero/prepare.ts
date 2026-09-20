import { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from 'react';
import { type Object3D, WebGPUBackend, type WebGPURenderer } from 'three/webgpu';

type Phase = 'preparing' | 'compiling' | 'settling' | 'ready' | 'failed';
const checks = new Map<string, () => boolean>();
const listeners = new Set<() => void>();
let phase: Phase = 'preparing';
let failure = '';

/** Animation starts only after retained geometry, every draw variant, and GPU uploads are ready. */
export function heroReady(): boolean {
  return phase === 'ready';
}

function publish(next: Phase): void {
  phase = next;
  document.documentElement.dataset.heroState = next;

  for (const listener of listeners) listener();
}

/** Registers a component's concrete preparation condition, including work completed after text commits. */
export function usePreparation(name: string, check: () => boolean): void {
  const read = useEffectEvent(check);

  useEffect(() => {
    checks.set(name, () => read());

    return () => {
      checks.delete(name);
    };
  }, [name]);
}

/** Tests the mounted text producers, including texts hidden until a later beat. */
export function textPrepared(root: Object3D | null): boolean {
  if (root === null) return false;

  let count = 0;
  let prepared = true;

  root.traverse((object) => {
    if (object instanceof ThreeText && !(object.parent instanceof ThreeText)) {
      count++;
      const state = object.commitState();

      if (state.status === 'failed') throw state.error;

      if (state.status !== 'committed') prepared = false;
    }
  });

  return count > 0 && prepared;
}

async function uploadsComplete(renderer: WebGPURenderer): Promise<void> {
  if (renderer.backend instanceof WebGPUBackend) {
    // Three 0.185.1 owns this initialized device. @types/three 0.185.4 omits WebGPUBackend.device.
    const backend = renderer.backend as WebGPUBackend & {
      device: { queue: { onSubmittedWorkDone(): Promise<void> } };
    };
    await backend.device.queue.onSubmittedWorkDone();
  }
}

/** Owns the render job so warm-up uses the same targets, transmission, shadows, and post passes as playback. */
export function PrepareHero() {
  const required = ['title', 'feature', 'icons:-6', 'icons:-9.5', 'robot', 'dust', 'star-embers'];
  const state = useThree();
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    publish('preparing');

    return () => {
      alive.current = false;
    };
  }, []);

  useFrame(
    () => {
      if (phase === 'compiling' || phase === 'failed') return;

      const { renderer, scene, camera, renderPipeline } = state;

      if (phase === 'ready') {
        if (renderPipeline === null) renderer.render(scene, camera);
        else renderPipeline.render();

        return;
      }

      const render = () => {
        if (renderPipeline === null) renderer.render(scene, camera);
        else renderPipeline.render();
      };

      const fail = (error: unknown) => {
        if (!alive.current) return;

        failure = error instanceof Error ? error.message : String(error);
        publish('failed');
        console.error(error);
      };

      if (phase === 'settling') {
        // Compile/upload the normal visibility set too, before revealing the canvas or starting any clock.
        publish('compiling');

        try {
          render();

          void uploadsComplete(renderer).then(() => {
            if (alive.current) publish('ready');
          }, fail);
        } catch (error) {
          fail(error);
        }

        return;
      }

      const visibility: [Object3D, boolean, boolean][] = [];

      scene.traverse((object) => {
        visibility.push([object, object.visible, object.frustumCulled]);
        object.visible = true;
        object.frustumCulled = false;
      });

      try {
        render();

        if (
          scene.environment !== null &&
          scene.getObjectByName('glass-shadows') !== undefined &&
          renderPipeline !== null &&
          required.every((name) => checks.get(name)?.() === true)
        ) {
          publish('compiling');

          void renderer
            .compileAsync(scene, camera)
            .then(() => uploadsComplete(renderer))
            .then(() => {
              if (alive.current) publish('settling');
            }, fail);
        }
      } catch (error) {
        fail(error);
      } finally {
        for (const [object, visible, culled] of visibility) {
          object.visible = visible;
          object.frustumCulled = culled;
        }
      }
    },
    { id: 'hero-render', phase: 'render', fps: 60 },
  );

  return null;
}

/** Subscribe to preparation progress and its failure message. */
export function usePreparationStatus() {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    () => phase,
  );

  return { phase: current, failure };
}
