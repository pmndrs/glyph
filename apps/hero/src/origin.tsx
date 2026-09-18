import { OrbitControls, useVideoTexture } from '@react-three/drei/webgpu';
import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';

import clip from '../assets/sun-loop.mp4?url';
import { useFaces } from './fonts';
import { uDebugUv, uWordOrigin, uWordSize, uWordUvScale } from './materials/screen';
import { CameraDrift } from './origin/CameraDrift';
import { Floor } from './origin/Floor';
import { FloorGlow } from './origin/FloorGlow';
import { OriginPost } from './origin/OriginPost';
import { StoryColumn } from './origin/StoryColumn';
import { Studio } from './origin/Studio';
import { VideoWord } from './origin/VideoWord';
import { useInspector } from './useInspector';

/**
 * The second hero: the word off axis over a reflector in a dark room, the letters a window onto a looping NASA clip,
 * and that same clip lighting them from the environment. The story column sits to the right, justified.
 */
export function Origin() {
  useInspector();
  const faces = useFaces();
  const video = useVideoTexture(clip, { loop: true, muted: true, playbackRate: 2.2, start: true });
  const scene = useThree((state) => state.scene);
  const renderer = useThree((state) => state.renderer);
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(globalThis, {
      heroScene: scene,
      heroRenderer: renderer,
      heroVideo: video,
      heroCamera: camera,
      heroUv: { uWordOrigin, uWordSize, uWordUvScale, uDebugUv },
    });
  }, [camera, renderer, scene, video]);

  return (
    <>
      {/* Orbit is on so the composition can be found by hand. The story column lives in world space, so it swings
          with the scene rather than staying pinned to the right of the screen — say if it should be locked instead. */}
      <OrbitControls enablePan enableZoom makeDefault maxPolarAngle={Math.PI * 0.52} target={[0, 0.1, 0]} />
      <CameraDrift />
      <Studio video={video} />
      <Floor />
      <FloorGlow />
      <VideoWord faces={faces} video={video} />
      <StoryColumn faces={faces} />
      <OriginPost />
    </>
  );
}
