import { glyph, msdf } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { Raycaster, Vector2, Vector3, type Camera, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { FONT_SIZE, INITIAL, TOP, WIDTH } from './config';
import { collapsed, drag, geometry, press, pressKey, selectWord, type Selection } from './field';

/**
 * The imperative twin: the same field functions behind DOM listeners. A pointer event becomes a Text-local
 * point (the ray meets the text's plane, `worldToLocal`, y flipped); a key becomes one `pressKey`.
 */
export async function mount(scene: Scene, camera: Camera, canvas: HTMLCanvasElement): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:editing-field', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: msdf });
  await inter.load();

  const text = three.createText({
    font: inter,
    text: INITIAL,
    style: { fontSize: FONT_SIZE, color: '#e7ecf6', lineHeight: 1.4 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: WIDTH } },
  });
  text.position.set(-WIDTH / 2, TOP, 0);
  scene.add(text);

  let selection: Selection = collapsed({ offset: text.text.length, affinity: 'upstream' });
  const show = (next: Selection) => {
    selection = next;
    const { caret, rects } = geometry(text, selection);
    void caret; // a quad CARET_WIDTH wide at (caret.x, -(caret.y + caret.height / 2)) in the text's local space
    void rects; // one quad each at (x + width / 2, -(y + height / 2))
  };

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const hit = new Vector3();
  const pointOf = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const { origin, direction } = raycaster.ray;
    hit.copy(origin).addScaledVector(direction, -origin.z / direction.z); // where the ray crosses z = 0
    const local = text.worldToLocal(hit);
    return { x: local.x, y: -local.y };
  };

  const down = (event: PointerEvent) => show(press(text, pointOf(event)));
  const double = () => show(selectWord(text, selection.focus));
  const move = (event: PointerEvent) => {
    if ((event.buttons & 1) !== 0) show(drag(text, selection, pointOf(event)));
  };
  const key = (event: KeyboardEvent) => {
    const next = pressKey(text, selection, event.key);
    if (next === selection) return;
    event.preventDefault();
    show(next);
  };
  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('dblclick', double);
  canvas.addEventListener('keydown', key);
  show(selection);

  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('dblclick', double);
    canvas.removeEventListener('keydown', key);
    text.dispose();
    inter.dispose();
    three.dispose();
  };
}
