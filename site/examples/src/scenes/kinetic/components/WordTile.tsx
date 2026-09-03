import { GlyphProvider, Text } from '@pmndrs/glyph/react';
import type { Font } from '@pmndrs/glyph';
import type { ThreeRoot } from '@pmndrs/glyph/three';
import type { slug } from '@pmndrs/glyph/raster/slug';
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

import { TILE } from '../config';

/**
 * One word, rendered to a texture every frame. The tile is its own scene on
 * its own root — a root spans at most one Scene — drawn to a render target
 * before the main scene; whatever samples `texture` sees the word as it is
 * being typed.
 */
export function useWordTile(): {
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
    created.texture.generateMipmaps = true; // the far side of the tube minifies the tile
    created.texture.minFilter = LinearMipmapLinearFilter;
    return created;
  });
  useEffect(() => () => target.dispose(), [target]);
  return { texture: target.texture, scene, camera, target };
}

export function WordTile({
  tile,
  root,
  font,
  word,
}: {
  readonly tile: ReturnType<typeof useWordTile>;
  readonly root: ThreeRoot;
  readonly font: Font<typeof slug>;
  readonly word: string;
}) {
  useFrame(({ renderer }) => {
    // The tile renders first; the main scene is drawn after this callback.
    if (!(renderer instanceof Renderer)) return; // the WebGPU entry always is; the type is a union
    renderer.setRenderTarget(tile.target);
    renderer.render(tile.scene, tile.camera);
    renderer.setRenderTarget(null);
  });

  return createPortal(
    <GlyphProvider handle={root}>
      <Text
        font={font}
        style={{ fontSize: 0.92, color: '#ffffff', letterSpacing: 0.02 }}
        layout={{ wrap: 'none', align: 'center' }}
        constraints={{ width: { mode: 'exact', size: TILE.width } }}
        position={[-TILE.width / 2, 0.44, 0]}
      >
        {word}
      </Text>
    </GlyphProvider>,
    tile.scene,
  );
}
