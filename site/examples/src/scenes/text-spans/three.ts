import { glyph, txt } from '@pmndrs/glyph';
import { span, ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { BLUE } from './scene';

/**
 * The imperative twin: `txt` and `span` where React nests `<Text>`. Each
 * `span(...)` call returns a tag; tagging a template yields a fragment that
 * `txt` joins into one `{ text, spans }` value. The React scene also gives one
 * run a second font from a hook; this twin keeps that run in the paragraph's
 * font.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:text-spans', ThreeConfig);
  const inter = glyph.fontFace(INTER);
  await inter.load();

  const accent = span({ color: '#ffd166' });
  const large = span({ fontSize: 0.58 });
  const spaced = span({ letterSpacing: 0.12 });
  const underlined = span({ decoration: { underline: true, color: BLUE } });
  const faded = span({ opacity: 0.35 });
  const blue = span({ color: BLUE });

  const paragraph = three.createText({
    font: inter,
    text: txt`A span can change the ${accent`color`}, the ${large`size`}, the ${spaced`spacing`}, add a ${underlined`decoration`}, or fade to ${faded`a lower opacity`}. Spans nest: ${blue`the outer span is blue and ${underlined`the inner one`} inherits it`}.`,
    style: { fontSize: 0.4, color: '#e7ecf6', lineHeight: 1.5 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 8.8 } },
  });
  paragraph.position.set(-4.4, 1.95, 0);
  scene.add(paragraph);
  glyph.shape();

  return () => {
    paragraph.dispose();
    inter.dispose();
    three.dispose();
  };
}
