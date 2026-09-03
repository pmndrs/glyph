import { GlyphEngineStatusError, glyph } from '@pmndrs/glyph';
import { TextFrameError, ThreeConfig } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import type { Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ATTEMPTS, SENTINEL, WIDTH } from './config';

/**
 * The imperative twin: the door and the room. Construction, `set()`, and
 * every setter validate the whole next state before assigning it, so a
 * `TypeError` or `RangeError` there leaves the text as it was. A frame the
 * engine refuses during `glyph.shape()` is retained on the text instead and
 * forwarded to `onError`; the last accepted draw stays on screen.
 */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:errors', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: SENTINEL,
    style: { fontSize: 0.4, color: '#e7ecf6', lineHeight: 1.35 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: WIDTH } },
  });
  text.position.set(-WIDTH / 2, 2.3, 0);
  scene.add(text);

  // The door: each of these throws with the field and value in the message; `text` is unchanged.
  for (const attempt of ATTEMPTS) {
    try {
      attempt.apply(text);
    } catch (error) {
      if (!(error instanceof TypeError) && !(error instanceof RangeError)) throw error;
      console.warn(attempt.label, error.message);
    }
  }

  // The room: a refused frame is retained, not thrown mid-traversal. Branch on the class, then the code.
  text.onError = (error) => {
    if (error instanceof TextFrameError) console.warn(error.rejection.cause, error.rejection);
    else if (error instanceof GlyphEngineStatusError) console.warn(error.code, error.status);
  };
  glyph.shape();
  void text.error; // the retained error, or undefined
  void text.commitState(); // { status: 'failed', error } when a frame was refused

  return () => {
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
