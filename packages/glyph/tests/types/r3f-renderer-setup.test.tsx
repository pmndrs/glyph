import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';

const scene = (
  <Canvas
    gl={async ({ canvas }) => {
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('This Canvas setup requires a browser canvas');
      const renderer = new WebGPURenderer({ canvas });
      await renderer.init();
      return renderer;
    }}
  />
);
void scene;
