import type { Font } from '@pmndrs/glyph';
import { GlyphProvider, Text } from '@pmndrs/glyph/react';
import type { slug } from '@pmndrs/glyph/raster/slug';
import type { ThreeRoot } from '@pmndrs/glyph/three';
import { createPortal, useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useState } from 'react';
import {
  LinearMipmapLinearFilter,
  OrthographicCamera,
  RenderTarget,
  Renderer,
  RepeatWrapping,
  Scene,
  type Texture,
} from 'three/webgpu';

import { ACCENT } from '../../../theme';
import { BIG_FONT, SMALL_FONT, SMALL_LANE_Y, SMALL_LETTER_SPACING, SMALL_REPEATS, SMALL_TEXT, STRIP } from '../config';

/**
 * The passage as it is typed, rendered to a wide strip every frame. The
 * strip is its own scene on its own root — a root spans at most one Scene —
 * drawn to a render target before the main scene; whatever samples `texture`
 * sees the words the moment they are written. The passage is end-aligned in
 * a box the strip's width, so the newest word always sits at the strip's
 * right edge and the older text scrolls off its left; it rides the middle
 * half of the strip, and two lanes of small type ride the quarters either
 * side.
 */
export function useStripTile(): {
  readonly texture: Texture;
  readonly scene: Scene;
  readonly camera: OrthographicCamera;
  readonly target: RenderTarget;
} {
  const [scene] = useState(() => new Scene());
  const [camera] = useState(() => {
    const view = new OrthographicCamera(
      -STRIP.width / 2,
      STRIP.width / 2,
      STRIP.height / 2,
      -STRIP.height / 2,
      -10,
      10,
    );
    view.position.z = 5;
    return view;
  });
  const [target] = useState(() => {
    const created = new RenderTarget(
      Math.round(STRIP.width * STRIP.pixelsPerUnit),
      Math.round(STRIP.height * STRIP.pixelsPerUnit),
    );
    created.texture.generateMipmaps = true; // the far side of the tube minifies the strip
    created.texture.minFilter = LinearMipmapLinearFilter;
    // The skin repeats the strip; wrapping in the sampler keeps the UV derivative continuous across the seam,
    // where a `fract` would flash the smallest mip as a stitch line.
    created.texture.wrapS = RepeatWrapping;
    created.texture.wrapT = RepeatWrapping;
    return created;
  });
  useEffect(() => () => target.dispose(), [target]);
  return { texture: target.texture, scene, camera, target };
}

export function StripTile({
  tile,
  root,
  font,
  before,
  current,
}: {
  readonly tile: ReturnType<typeof useStripTile>;
  readonly root: ThreeRoot;
  readonly font: Font<typeof slug>;
  /** The passage up to the word being typed. */
  readonly before: string;
  /** The word being typed, accented on the surface. */
  readonly current: string;
}) {
  useFrame(({ renderer }) => {
    // The strip renders first; the main scene is drawn after this callback.
    if (!(renderer instanceof Renderer)) return; // the WebGPU entry always is; the type is a union
    renderer.setRenderTarget(tile.target);
    renderer.render(tile.scene, tile.camera);
    renderer.setRenderTarget(null);
  });
  return createPortal(
    <GlyphProvider handle={root}>
      <Text
        font={font}
        style={{ fontSize: BIG_FONT, color: '#ffffff', letterSpacing: 0.04, lineHeight: 1 }}
        layout={{ wrap: 'none', align: 'end' }}
        constraints={{ width: { mode: 'exact', size: STRIP.width } }}
        // One line, end-aligned in a box exactly the strip. `wrap: 'none'` means the passage is
        // never broken, so it grows leftward out of the box as it is typed and the camera's
        // frustum clips it at the strip's edge: the newest word is always at the right, and
        // everything older has already left. Nothing measures or truncates the string — the box
        // and the frustum do it, so the cost is the same whatever the passage has grown to.
        position={[-STRIP.width / 2, BIG_FONT / 2, 0]}
      >
        {before.toUpperCase()}
        <Text style={{ color: ACCENT }}>{current.toUpperCase()}</Text>
      </Text>
      {[SMALL_LANE_Y, -SMALL_LANE_Y].map((y, lane) => (
        <Text
          key={y}
          font={font}
          style={{ fontSize: SMALL_FONT, color: '#9aa6be', letterSpacing: SMALL_LETTER_SPACING, lineHeight: 1 }}
          layout={{ wrap: 'none' }}
          constraints={{ width: { mode: 'exact', size: STRIP.width * 2 } }}
          position={[-STRIP.width / 2 - (lane === 0 ? 0 : STRIP.width * 0.37), y + SMALL_FONT / 2, 0]}
        >
          {SMALL_TEXT.repeat(SMALL_REPEATS)}
        </Text>
      ))}
    </GlyphProvider>,
    tile.scene,
  );
}
