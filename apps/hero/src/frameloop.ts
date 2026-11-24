import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { directCamera, syncCameraView } from './camera/systems';
import { resumeAttract, walkStonePath } from './director/systems';
import { syncDiveView } from './dive/systems';
import { resolveEditor, syncEditorView, typePending } from './editor/systems';
import { useInput } from './input/hooks';
import { useHeroReady } from './loading/prepare';
import {
  applyScriptEdits,
  readLayout,
  springLetters,
  springSpread,
  syncFlow,
  syncPageView,
  writeLetters,
} from './page/systems';
import { stepPhysics } from './physics/systems';
import { budgetFrame } from './quality/systems';
import { advanceSequence } from './sequence/systems';
import { captureLetters, finishRewind, moveStone, pullBodies, syncStoneView } from './stone/systems';
import { updateTime } from './time/systems';
import { syncHeadlineView, typeHeadline } from './title/systems';
import { useViewport } from './viewport/hooks';

export function FrameLoop() {
  const world = useWorld();
  const isReady = useHeroReady();
  useInput(world, isReady);
  useViewport(world);

  useFrame(
    ({ elapsed }, delta) => {
      if (!isReady) return;

      updateTime(world, delta, elapsed);
      budgetFrame(world);
      advanceSequence(world);
      resumeAttract(world);
      typeHeadline(world);
      typePending(world);
      springSpread(world);
      walkStonePath(world);
      moveStone(world);
      captureLetters(world);
      stepPhysics(world);
      pullBodies(world);
      finishRewind(world);
      springLetters(world);
      directCamera(world);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  useFrame(
    () => {
      applyScriptEdits(world);
      resolveEditor(world);
      syncFlow(world);
      readLayout(world);
      writeLetters(world);
      syncPageView(world);
      syncHeadlineView(world);
      syncEditorView(world);
      syncCameraView(world);
      syncStoneView(world);
      syncDiveView(world);
    },
    { id: 'hero-views', phase: 'render', before: 'hero-render', fps: 60 },
  );

  return null;
}
