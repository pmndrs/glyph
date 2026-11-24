import { glyph } from '@pmndrs/glyph';
import { projectTextFlowBounds, ThreeConfig } from '@pmndrs/glyph/three';
import { BoxGeometry, Mesh, MeshStandardNodeMaterial, type Camera, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { FLOW_PROSE } from '../layout-kit/prose';
import { BOUNDS, REGION, SIZE } from './scene';

/**
 * The imperative twin: move the object, project its bound onto the text
 * plane, and assign the result as the region's exclusion. The helper returns
 * `undefined` when the object cannot cover the flow, for example behind it.
 */
export async function mount(scene: Scene, camera: Camera): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:layout-projected-exclusion', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const text = three.createText({
    font: inter,
    text: FLOW_PROSE,
    style: { fontSize: 0.2, lineHeight: 1.35, color: '#e7ecf6' },
    flow: { regions: [{ key: 'page', shape: { kind: 'rectangle', bounds: REGION } }] },
  });
  text.position.set(-REGION[2] / 2, REGION[3] / 2, 0);
  const cube = new Mesh(new BoxGeometry(SIZE, SIZE, SIZE), new MeshStandardNodeMaterial({ color: '#ffd166' }));
  scene.add(text, cube);

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    cube.position.set(Math.sin(elapsed * 0.4) * 2.6, 0.35 + Math.sin(elapsed * 0.63) * 1.0, 1.6);
    cube.rotation.set(elapsed * 0.5, elapsed * 0.35, 0);
    const exclusion = projectTextFlowBounds({
      key: 'cube',
      camera,
      text,
      object: cube,
      bounds: BOUNDS,
      flowBounds: REGION,
      marginInline: 0.12,
      wrapSide: 'largest',
    });
    text.flow = {
      regions: [
        {
          key: 'page',
          shape: { kind: 'rectangle', bounds: REGION },
          exclusions: exclusion === undefined ? [] : [exclusion],
        },
      ],
    };
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    text.dispose();
    cube.geometry.dispose();
    cube.material.dispose();
    inter.dispose();
    three.dispose();
  };
}
