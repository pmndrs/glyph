import { GlyphProvider, Text } from '@pmndrs/glyph/react';
import type { Font } from '@pmndrs/glyph';
import type { ThreeRoot } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/raster/msdf';
import { createPortal, useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useState } from 'react';
import {
  LinearMipmapLinearFilter,
  OrthographicCamera,
  RenderTarget,
  Renderer,
  Scene,
  type Texture,
} from 'three/webgpu';

import { FONT_SIZE, TILE } from '../config';
import { heightInk } from '../materials';

/** A scene of its own, on its own root, rendered to a mipmapped target before the main scene draws. */
export function useHeightTile(): {
  readonly texture: Texture;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  readonly target: RenderTarget;
} {
  const [scene] = useState(() => new Scene());
  const [camera] = useState(() => {
    const view = new OrthographicCamera(-TILE.width / 2, TILE.width / 2, TILE.height / 2, -TILE.height / 2, -10, 10);
    view.position.z = 5;
    return view;
  });
  const [target] = useState(() => {
    const created = new RenderTarget(TILE.width * TILE.pixelsPerUnit, TILE.height * TILE.pixelsPerUnit);
    created.texture.generateMipmaps = true; // the slab samples coarse levels for its slopes
    created.texture.minFilter = LinearMipmapLinearFilter;
    return created;
  });
  useEffect(() => () => target.dispose(), [target]);
  return { texture: target.texture, scene, camera, target };
}

export function HeightTile({
  tile,
  root,
  font,
  word,
}: {
  readonly tile: ReturnType<typeof useHeightTile>;
  readonly root: ThreeRoot;
  readonly font: Font<typeof msdf>;
  readonly word: string;
}) {
  useFrame(({ renderer }) => {
    if (!(renderer instanceof Renderer)) return; // the WebGPU entry always is; the type is a union
    renderer.setRenderTarget(tile.target);
    renderer.render(tile.scene, tile.camera);
    renderer.setRenderTarget(null);
  });

  return createPortal(
    <GlyphProvider handle={root}>
      <color args={['#000000']} attach="background" />
      <Text
        font={font}
        material={heightInk}
        style={{ fontSize: FONT_SIZE, color: '#ffffff', letterSpacing: 0.04 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: TILE.width } }}
        position={[-TILE.width / 2, FONT_SIZE / 2 + 0.35, 0]}
      >
        {word}
      </Text>
    </GlyphProvider>,
    tile.scene,
  );
}
