import { slug } from '@pmndrs/glyph';
import { defineTextMaterial, type Text } from '@pmndrs/glyph/three';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { compactRgba8Readback } from '../../low-level/raster/rgba-readback';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  type RendererBackend,
} from '../../../renderer/webgpu-renderer';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from '../../../three-root';
import { loadSlugFontAsset } from '../../../workloads/font-assets/slug';

const width = 320;
const height = 160;
type TransformMode = 'direct' | 'indexed';

/** Real Slug draw oracle: paragraph UV follows positioned ink, while a fragment read of final position compiles. */
export async function probeMaterialPosition(
  backend: RendererBackend,
  transformMode: TransformMode,
  displacement: boolean,
): Promise<{
  readonly backend: RendererBackend;
  readonly transformMode: TransformMode;
  readonly displacement: boolean;
  readonly inkPixels: number;
  readonly leftPixels: number;
  readonly rightPixels: number;
  readonly maximumUvError: number;
}> {
  const renderer = await createConfiguredRenderer({
    canvas: document.createElement('canvas'),
    width,
    height,
    dpr: 1,
    backend,
  });
  let root: ReturnType<typeof createBenchmarkThreeRoot> | undefined;
  let font: Awaited<ReturnType<typeof loadSlugFontAsset>>['loaded'] | undefined;
  let label: Text<typeof slug> | undefined;
  let target: THREE.RenderTarget | undefined;
  try {
    root = createBenchmarkThreeRoot(`material-position-${backend}-${transformMode}`, { transformMode });
    font = (await loadSlugFontAsset({ technique: 'slug', fixture: 'inter', delivery: 'baked' })).loaded;
    label = root.createText({
      font,
      text: 'MAT',
      constraints: { anchor: { x: 'center', y: 'top' }, width: { mode: 'exact', size: 180 } },
      layout: { align: 'center', wrap: 'none' },
      style: { fontSize: 64, color: '#ffffff' },
    });
    const bounds = label.glyphs().inkBounds;
    if (bounds === undefined || bounds.width < 60 || bounds.height < 10) {
      throw new Error(`Slug specimen has no usable paragraph ink bounds: ${JSON.stringify(bounds)}`);
    }
    const anchor = label.measure().anchorOffset;
    if (anchor.x === 0) throw new Error('Slug specimen did not retain its center anchor');
    label.material = defineTextMaterial((context) => {
      const material = context.createDefaultMaterial();
      if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return material;
      const uvX = context.paragraphPosition.x.sub(bounds.x).div(bounds.width).clamp(0, 1);
      if (displacement) {
        material.positionNode = context.position.add(TSL.vec3(context.paragraphPosition.x.sin().mul(0.8), 0, 0));
      }
      // The green channel forces a fragment read of the transformed position too.
      material.colorNode = TSL.vec3(uvX, context.position.x.div(width).clamp(0, 1), TSL.float(1).sub(uvX));
      return material;
    });
    label.position.set(140, -24, 0);
    label.scale.set(0.85, 1.08, 1);
    const scene = new THREE.Scene();
    const ancestor = new THREE.Group();
    ancestor.position.set(19, -13, 0);
    ancestor.rotation.z = 0.06;
    ancestor.scale.set(1.16, 0.78, 1);
    ancestor.add(label);
    scene.add(ancestor);
    scene.updateMatrixWorld(true);
    if (label.error !== undefined) throw label.error;
    const inverseTextWorld = label.matrixWorld.clone().invert();

    const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000);
    camera.position.z = 500;
    camera.updateProjectionMatrix();
    target = new THREE.RenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    const readback = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height);
    const pixels = compactRgba8Readback(
      new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
      width,
      height,
      backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
    );

    let inkPixels = 0;
    let leftPixels = 0;
    let rightPixels = 0;
    let maximumUvError = 0;
    const worldPixel = new THREE.Vector3();
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const red = pixels[offset]!;
        const blue = pixels[offset + 2]!;
        if (red + blue < 160) continue; // keep opaque interior ink; ignore AA edges
        worldPixel.set(x + 0.5, -(y + 0.5), 0).applyMatrix4(inverseTextWorld);
        const expectedUv = (worldPixel.x - anchor.x - bounds.x) / bounds.width;
        if (expectedUv < 0.05 || expectedUv > 0.95) continue; // dilation can extend outside the ink box
        const observedUv = red / (red + blue);
        maximumUvError = Math.max(maximumUvError, Math.abs(observedUv - expectedUv));
        inkPixels += 1;
        if (expectedUv < 0.33) {
          leftPixels += 1;
          if (red >= blue) throw new Error(`left ink at x=${x} used the transformed position`);
        }
        if (expectedUv > 0.67) {
          rightPixels += 1;
          if (red <= blue) throw new Error(`right ink at x=${x} used the transformed position`);
        }
      }
    }
    if (inkPixels < 300 || leftPixels < 50 || rightPixels < 50 || maximumUvError > 0.03) {
      throw new Error(
        `Slug paragraph-position oracle failed: ${JSON.stringify({ inkPixels, leftPixels, rightPixels, maximumUvError, bounds })}`,
      );
    }
    return { backend, transformMode, displacement, inkPixels, leftPixels, rightPixels, maximumUvError };
  } finally {
    renderer.setRenderTarget(null);
    target?.dispose();
    label?.dispose();
    if (root !== undefined) disposeBenchmarkThreeRoot(root);
    font?.dispose();
    await disposeConfiguredRenderer(renderer);
  }
}
