import { glyph, msdf, type LayoutBox, type TextPosition, type TextUnit } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';

/**
 * The imperative twin: every caret stop of one unit, found by repeating `move` from the start of the text
 * until the position stops changing.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:editing-movement', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: 'Move by unit. One call, one step: a grapheme, a word, a sentence or a line.',
    style: { fontSize: 0.36, color: '#e7ecf6', lineHeight: 1.45 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 4.5 } },
  });
  scene.add(text);

  const stopsOf = (unit: TextUnit): readonly LayoutBox[] => {
    const stops: LayoutBox[] = [];
    let position: TextPosition = { offset: 0, affinity: 'downstream' };
    let moved = true;
    while (moved) {
      stops.push(text.caret(position).rect); // Text-local, +Y down: draw at (x, -(y + height / 2))
      const next = text.move(position, 'forward', unit).position;
      moved = next.offset !== position.offset || next.affinity !== position.affinity;
      position = next;
    }
    return stops;
  };
  void [stopsOf('grapheme'), stopsOf('word'), stopsOf('sentence')];

  // Vertical movement takes unit 'line' and the goalX the previous vertical move returned.
  const first = text.move({ offset: 9, affinity: 'downstream' }, 'down', 'line');
  const second = text.move(first.position, 'down', 'line', first.goalX);
  void second;

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
