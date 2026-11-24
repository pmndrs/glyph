import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { Mesh, MeshBasicNodeMaterial, PlaneGeometry, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

const PADDING = 0.28;

/**
 * The imperative twin: a panel scaled from the layout summary in `onLayout`. The callback runs after the
 * text is first prepared and whenever its summary changes, before the frame that draws it.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:inspect-on-layout', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicNodeMaterial({ color: '#1c2536' });
  const panel = new Mesh(geometry, material);

  const text = three.createText({
    font: inter,
    text: 'Saved',
    style: { fontSize: 0.36, color: '#e7ecf6', lineHeight: 1.4 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'at-most', size: 4 } },
  });
  text.onLayout = (_text, layout) => {
    // Transforms may be written here; a layout input (text, style, constraints) would throw.
    panel.scale.set(layout.width + PADDING * 2, layout.height + PADDING * 2, 1);
    panel.position.set(layout.width / 2, -layout.height / 2, -0.02);
  };
  text.add(panel); // the panel shares the text's transform
  scene.add(text);

  // Later: a setter marks the text dirty; the next frame prepares it and calls onLayout before drawing.
  text.text = 'Longer text wraps, and the panel grows with it.';

  return () => {
    geometry.dispose();
    material.dispose();
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
