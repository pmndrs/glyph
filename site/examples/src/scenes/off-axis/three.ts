import { glyph, loadFont, txt } from '@pmndrs/glyph';
import { ThreeConfig, span } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/three/slug';
import { Group, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: the paragraph sits in a group and the group is what
 * turns. Nothing about the text knows it is off-axis; the camera does.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:off-axis', ThreeConfig);
  const inter = await loadFont({ baked: INTER }, slug);

  const violet = span({ color: '#a855f7' });
  const cyan = span({ color: '#22d3ee' });
  const green = span({ color: '#34d399' });
  const amber = span({ color: '#f59e0b' });
  const rose = span({ color: '#fb7185' });
  const pink = span({ color: '#ff4dc4' });

  const paragraph = three.createText({
    font: inter,
    text: txt`Render ${violet`shaped`} text directly in your ${cyan`canvas`}, without the DOM. It ${green`reflows`} at runtime and uses the scene camera and depth. ${amber`Bitmap`}, ${rose`MSDF`}, ${pink`Slug`}.`,
    style: { fontSize: 0.52, color: '#e7ecf6', lineHeight: 1.3 },
    layout: { wrap: 'word', align: 'center' },
    constraints: { width: { mode: 'exact', size: 7.5 } },
  });
  paragraph.position.set(-3.75, 1.7, 0);

  const panel = new Group();
  panel.position.x = 0.8;
  panel.add(paragraph);
  scene.add(panel);
  glyph.shape();

  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const p = elapsed * 0.55;
    panel.rotation.set(
      -0.08 + Math.sin(p * 0.83) * 0.18,
      0.62 + Math.sin(p + Math.PI / 2) * 0.2,
      Math.sin(p * 0.47) * 0.06,
    );
    panel.position.z = -(1.2 + Math.sin(p * 0.61) * 0.5);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    paragraph.dispose();
    inter.dispose();
    three.dispose();
  };
}
