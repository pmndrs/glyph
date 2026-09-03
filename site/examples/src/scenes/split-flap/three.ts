import { glyph } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { ThreeConfig, type Text } from '@pmndrs/glyph/three';
import { Group, InstancedMesh, Matrix4, PlaneGeometry, type Scene } from 'three/webgpu';

import { INTER } from '../../fonts';
import { BOARDS, fit, flipsBetween, wheelAt } from '../../lib/flap';
import { CELL, COLUMNS, FLIP_RATE, FONT_SIZE, HOLD, INK, ROWS } from './config';
import { plateMaterial } from './materials';

/** The imperative twin: one Text per cell in a group that flips, and `set()` at the midpoint. */
export async function mount(scene: Scene): Promise<() => void> {
  await glyph.init();
  const three = glyph.handle('examples:split-flap', ThreeConfig);
  const Inter = glyph.fontFace(INTER, { format: msdf });
  await Inter.load();

  const board = new Group();
  const plates = new InstancedMesh(
    new PlaneGeometry(CELL.width - CELL.gap, CELL.height - CELL.gap),
    plateMaterial(),
    ROWS * COLUMNS,
  );
  const m = new Matrix4();
  const cells = Array.from({ length: ROWS * COLUMNS }, (_, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = (column - (COLUMNS - 1) / 2) * CELL.width;
    const y = ((ROWS - 1) / 2 - row) * CELL.height;
    plates.setMatrixAt(index, m.makeTranslation(x, y, -0.01));
    const group = new Group();
    group.position.set(x, y, 0);
    const text: Text<typeof msdf> = three.createText({
      font: Inter,
      text: ' ',
      style: { fontSize: FONT_SIZE, color: INK, lineHeight: 1 },
      layout: { align: 'center', wrap: 'none' },
      constraints: { width: { mode: 'exact', size: CELL.width } },
    });
    text.position.set(-CELL.width / 2, FONT_SIZE / 2, 0);
    group.add(text);
    board.add(group);
    return { group, text, shown: ' ', target: ' ', flips: 0, next: 0 };
  });
  board.add(plates);
  scene.add(board);
  glyph.shape();

  let shownBoard = -1;
  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    const wanted = Math.floor(elapsed / HOLD) % BOARDS.length;
    if (wanted !== shownBoard) {
      shownBoard = wanted;
      const lines = BOARDS[wanted] ?? [];
      cells.forEach((cell, index) => {
        cell.target = fit(lines[Math.floor(index / COLUMNS)] ?? '', COLUMNS)[index % COLUMNS] ?? ' ';
        cell.flips = flipsBetween(cell.shown, cell.target);
        cell.next = elapsed + (index % COLUMNS) * 0.035;
      });
    }
    for (const cell of cells) {
      if (cell.flips === 0 || elapsed < cell.next) continue;
      const t = Math.min((elapsed - cell.next) * FLIP_RATE, 1);
      if (t >= 0.5 && cell.text.text === cell.shown) {
        cell.shown = wheelAt(cell.shown, 1);
        cell.text.set({ text: cell.shown });
      }
      cell.group.rotation.x = t < 0.5 ? -t * Math.PI : (1 - t) * Math.PI;
      if (t >= 1) {
        cell.flips -= 1;
        cell.next = elapsed;
        cell.group.rotation.x = 0;
      }
    }
    glyph.shape();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const cell of cells) cell.text.dispose();
    plates.geometry.dispose();
    plates.material.dispose();
    Inter.dispose();
    three.dispose();
  };
}
