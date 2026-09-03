import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useMemo, useRef } from 'react';
import { type Group, InstancedMesh, Matrix4, PlaneGeometry } from 'three/webgpu';

import { INTER } from '../../fonts';
import { BOARDS, fit, flipsBetween, wheelAt } from '../../lib/flap';
import { CELL, COLUMNS, FLIP_RATE, FONT_SIZE, HOLD, INK, ROWS } from './config';
import { plateMaterial } from './materials';

/**
 * A split-flap departures board. Every cell is one `Text` holding one
 * character; a message change sends each cell flipping forward through its
 * wheel until it lands. The flip is the cell's group turning about its
 * horizontal midline, and at the halfway point `text.set()` swaps the
 * character, so the glyph that comes back up is the next one. One hundred and
 * fifty texts share one root and one material, so they plan as one draw.
 */
const CELL_INDICES: readonly number[] = Array.from({ length: ROWS * COLUMNS }, (_, index) => index);

type Cell = {
  text: ThreeText<never> | null;
  group: Group | null;
  shown: string;
  target: string;
  flips: number;
  next: number;
};

export default function SplitFlap() {
  const inter = useMsdf(INTER);
  // The cells are records the frame loop owns; render never reads them, only the index list below.
  const cells = useRef<Cell[]>(
    CELL_INDICES.map(() => ({ text: null, group: null, shown: ' ', target: ' ', flips: 0, next: 0 })),
  );
  const board = useRef(-1);
  const plates = useMemo(() => {
    const mesh = new InstancedMesh(
      new PlaneGeometry(CELL.width - CELL.gap, CELL.height - CELL.gap),
      plateMaterial(),
      ROWS * COLUMNS,
    );
    const m = new Matrix4();
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        m.makeTranslation(cellX(column), cellY(row), -0.01);
        mesh.setMatrixAt(row * COLUMNS + column, m);
      }
    }
    return mesh;
  }, []);

  useFrame(({ elapsed }) => {
    const wanted = Math.floor(elapsed / HOLD) % BOARDS.length;
    if (wanted !== board.current) {
      board.current = wanted;
      const lines = BOARDS[wanted] ?? [];
      cells.current.forEach((cell, index) => {
        const line = fit(lines[Math.floor(index / COLUMNS)] ?? '', COLUMNS);
        cell.target = line[index % COLUMNS] ?? ' ';
        cell.flips = flipsBetween(cell.shown, cell.target);
        // Cells start in a ripple from the left, a few frames apart.
        cell.next = elapsed + (index % COLUMNS) * 0.035;
      });
    }
    for (const cell of cells.current) {
      if (cell.group === null || cell.text === null) continue;
      if (cell.flips === 0 || elapsed < cell.next) {
        cell.group.rotation.x = 0;
        continue;
      }
      // One flip: the top half falls (0 → −π/2), the character swaps, the new one rises (π/2 → 0).
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
  });

  return (
    <group position={[0, 0.1, 0]}>
      <primitive object={plates} />
      {CELL_INDICES.map((index) => (
        <group
          key={`${Math.floor(index / COLUMNS)}:${index % COLUMNS}`}
          position={[cellX(index % COLUMNS), cellY(Math.floor(index / COLUMNS)), 0]}
          ref={(group: Group | null) => {
            const cell = cells.current[index];
            if (cell) cell.group = group;
          }}
        >
          <Text
            ref={(text: ThreeText<never> | null) => {
              const cell = cells.current[index];
              if (cell) cell.text = text;
            }}
            font={inter}
            style={{ fontSize: FONT_SIZE, color: INK, lineHeight: 1 }}
            layout={{ align: 'center', wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: CELL.width } }}
            position={[-CELL.width / 2, FONT_SIZE / 2, 0]}
          >
            {' '}
          </Text>
        </group>
      ))}
    </group>
  );
}

function cellX(column: number): number {
  return (column - (COLUMNS - 1) / 2) * CELL.width;
}

function cellY(row: number): number {
  return ((ROWS - 1) / 2 - row) * CELL.height;
}
